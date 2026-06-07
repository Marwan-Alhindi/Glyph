"""LLM integrations router — per-LLM credential store and OAuth flows."""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from auth import get_current_user
from database.integrations import IntegrationRepository
from database.llms import LLMRepository
from database.chats import ChatRepository
from api.integrations.catalog import CATALOG
from settings import get_settings

router = APIRouter(prefix="/integrations", tags=["integrations"])

_GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
]


class SaveCredentialsRequest(BaseModel):
    credentials: dict


# ------------------------------------------------------------------ helpers


def _verify_llm_access(authorization: str, llm_id: str) -> str:
    """Return user_id if the requester is a participant in the chat owning llm_id."""
    user_id = get_current_user(authorization)
    llm_repo = LLMRepository()
    chat_id = llm_repo.get_chat_id(llm_id)
    if not chat_id:
        raise HTTPException(status_code=404, detail="LLM not found")
    participant = ChatRepository().get_participant(chat_id, user_id)
    if not participant:
        raise HTTPException(status_code=403, detail="Not a participant in this chat")
    return user_id


def _sign_state(user_id: str, llm_id: str, integration_type: str, code_verifier: str = "") -> str:
    s = get_settings()
    exp = int(time.time()) + 300
    payload = json.dumps({
        "user_id": user_id,
        "llm_id": llm_id,
        "integration_type": integration_type,
        "exp": exp,
        "cv": code_verifier,
    })
    sig = hmac.new(s.supabase_service_key.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}|{sig}".encode()).decode()


def _verify_state(token: str) -> dict:
    s = get_settings()
    try:
        decoded = base64.urlsafe_b64decode(token + "==").decode()
        payload_str, sig = decoded.rsplit("|", 1)
        expected = hmac.new(s.supabase_service_key.encode(), payload_str.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise ValueError("invalid signature")
        data = json.loads(payload_str)
        if data.get("exp", 0) < time.time():
            raise ValueError("state expired")
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid OAuth state: {e}")


# ------------------------------------------------------------------ exact paths first


@router.get("/catalog")
def get_catalog(authorization: str = Header()):
    get_current_user(authorization)
    return {"integrations": [spec.to_dict() for spec in CATALOG.values()]}


@router.get("/oauth/callback")
def oauth_callback(code: str = "", state: str = "", error: str = ""):
    if error:
        return HTMLResponse(
            f"<script>window.opener?.postMessage({{type:'oauth_error',detail:{json.dumps(error)}}},'*');window.close();</script>"
        )
    if not code or not state:
        return HTMLResponse("<script>window.close();</script>")

    state_data = _verify_state(state)
    llm_id = state_data["llm_id"]
    integration_type = state_data["integration_type"]
    code_verifier = state_data.get("cv", "")

    try:
        from google_auth_oauthlib.flow import Flow
    except ImportError:
        return HTMLResponse("<script>window.close();</script>", status_code=501)

    s = get_settings()
    flow = Flow.from_client_config(
        client_config={
            "web": {
                "client_id": s.google_client_id,
                "client_secret": s.google_client_secret,
                "redirect_uris": [s.integrations_oauth_redirect_uri],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=_GMAIL_SCOPES,
        redirect_uri=s.integrations_oauth_redirect_uri,
        state=state,
    )
    flow.fetch_token(code=code, code_verifier=code_verifier)
    creds = flow.credentials

    IntegrationRepository().upsert(
        llm_id=llm_id,
        integration_type=integration_type,
        credentials={
            "access_token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_expiry": creds.expiry.isoformat() if creds.expiry else None,
            "client_id": s.google_client_id,
            "client_secret": s.google_client_secret,
            "scopes": list(creds.scopes or _GMAIL_SCOPES),
        },
    )

    return HTMLResponse(
        f"<script>"
        f"window.opener?.postMessage({{type:'oauth_complete',integration:{json.dumps(integration_type)}}},'*');"
        f"window.close();"
        f"</script>"
    )


# ------------------------------------------------------------------ parameterized paths


@router.get("/{llm_id}")
def list_integrations(llm_id: str, authorization: str = Header()):
    _verify_llm_access(authorization, llm_id)
    return {"integrations": IntegrationRepository().list_active(llm_id)}


@router.post("/{llm_id}/{integration_type}/credentials")
def save_credentials(
    llm_id: str,
    integration_type: str,
    body: SaveCredentialsRequest,
    authorization: str = Header(),
):
    _verify_llm_access(authorization, llm_id)
    IntegrationRepository().upsert(llm_id, integration_type, body.credentials)
    return {"ok": True}


@router.delete("/{llm_id}/{integration_type}")
def delete_integration(llm_id: str, integration_type: str, authorization: str = Header()):
    _verify_llm_access(authorization, llm_id)
    IntegrationRepository().delete(llm_id, integration_type)
    return {"ok": True}


@router.get("/{llm_id}/oauth/gmail/start")
def oauth_start(llm_id: str, authorization: str = Header()):
    user_id = _verify_llm_access(authorization, llm_id)
    s = get_settings()

    if not s.google_client_id or not s.google_client_secret:
        raise HTTPException(
            status_code=501,
            detail="Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env",
        )

    try:
        from google_auth_oauthlib.flow import Flow
    except ImportError:
        raise HTTPException(status_code=501, detail="google-auth-oauthlib is not installed")

    code_verifier = secrets.token_urlsafe(96)
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).rstrip(b"=").decode()
    state = _sign_state(user_id, llm_id, "gmail", code_verifier)

    flow = Flow.from_client_config(
        client_config={
            "web": {
                "client_id": s.google_client_id,
                "client_secret": s.google_client_secret,
                "redirect_uris": [s.integrations_oauth_redirect_uri],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=_GMAIL_SCOPES,
        redirect_uri=s.integrations_oauth_redirect_uri,
    )
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        prompt="consent",
        state=state,
        include_granted_scopes="true",
        code_challenge=code_challenge,
        code_challenge_method="S256",
    )
    return {"url": auth_url}
