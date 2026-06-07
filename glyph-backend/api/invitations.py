"""Email-based chat invitation endpoints."""

import re
import secrets
from datetime import datetime, timedelta, timezone

import resend
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from database.chats import ChatRepository
from database.invitations import InvitationRepository
from database.users import UserRepository
from settings import get_settings
from usage import get_plan_limits

router = APIRouter()

INVITATION_TTL = timedelta(days=7)
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _is_expired(expires_at: str | None) -> bool:
    if not expires_at:
        return False
    return datetime.fromisoformat(expires_at.replace("Z", "+00:00")) < datetime.now(timezone.utc)


def _send_invitation_email(to_email: str, chat_name: str, inviter_name: str, token: str) -> None:
    s = get_settings()
    resend.api_key = s.resend_api_key
    link = f"{s.app_url.rstrip('/')}/invite/{token}"
    safe_chat = (chat_name or "a Glyph chat").strip()
    safe_inviter = (inviter_name or "Someone").strip()
    html = (
        f'<div style="font-family: -apple-system, system-ui, sans-serif; padding: 24px; max-width: 480px;">'
        f'<h2 style="margin: 0 0 8px;">You\'re invited to a Glyph chat</h2>'
        f'<p style="margin: 0 0 16px; color: #444;"><strong>{safe_inviter}</strong> invited you to <strong>{safe_chat}</strong>.</p>'
        f'<p style="margin: 0 0 24px;"><a href="{link}" style="display: inline-block; background: #0a0a0a; color: #fff; padding: 10px 16px; border-radius: 8px; text-decoration: none;">Join the chat</a></p>'
        f'<p style="margin: 0; font-size: 12px; color: #888;">Or paste this link in your browser:<br/>{link}</p>'
        f'<p style="margin: 16px 0 0; font-size: 12px; color: #888;">This link expires in 7 days.</p>'
        f'</div>'
    )
    text = f"{safe_inviter} invited you to {safe_chat} on Glyph.\n\nJoin: {link}\n\nThis link expires in 7 days."
    try:
        resend.Emails.send({
            "from": s.email_from,
            "to": to_email,
            "subject": f"You're invited to {safe_chat}",
            "html": html,
            "text": text,
        })
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to send invitation email: {e}")


def _verify_can_invite(user_id: str, chat_id: str) -> dict:
    row = ChatRepository().get_participant(chat_id, user_id)
    if not row:
        raise HTTPException(status_code=403, detail="Not a participant of this chat")
    if row.get("role") != "owner" and not row.get("can_invite"):
        raise HTTPException(status_code=403, detail="Not allowed to invite to this chat")
    return row


class CreateInvitationRequest(BaseModel):
    chat_id: str
    email: str


class AcceptInvitationRequest(BaseModel):
    token: str


class CanInviteRequest(BaseModel):
    can_invite: bool


@router.post("/invitations")
def create_invitation(body: CreateInvitationRequest, authorization: str = Header()):
    user_id = get_current_user(authorization)
    _verify_can_invite(user_id, body.chat_id)

    limits = get_plan_limits(user_id)
    if limits["max_teammates"] is not None:
        current = ChatRepository().count_human_participants(body.chat_id)
        # current includes the owner, so teammates = current - 1
        if current - 1 >= limits["max_teammates"]:
            raise HTTPException(
                status_code=403,
                detail=f"Your plan allows {limits['max_teammates']} teammate(s) per chat. Upgrade to invite more.",
            )

    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Invalid email address")

    inv_repo = InvitationRepository()
    if inv_repo.get_pending(body.chat_id, email):
        raise HTTPException(status_code=409, detail="An invitation for this email is already pending")

    chat_repo = ChatRepository()
    chat_name = chat_repo.get_name(body.chat_id) or "a Glyph chat"
    inviter_name = chat_repo.get_profile_first_name(user_id)

    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + INVITATION_TTL).isoformat()
    new_row = inv_repo.create(body.chat_id, email, token, user_id, expires_at)
    if not new_row:
        raise HTTPException(status_code=500, detail="Failed to create invitation")

    _send_invitation_email(to_email=email, chat_name=chat_name, inviter_name=inviter_name, token=token)
    return new_row


@router.get("/invitations")
def list_invitations(chat_id: str, authorization: str = Header()):
    user_id = get_current_user(authorization)
    _verify_can_invite(user_id, chat_id)

    now_iso = datetime.now(timezone.utc).isoformat()
    return {"invitations": InvitationRepository().list_active(chat_id, now_iso)}


@router.delete("/invitations/{invitation_id}")
def revoke_invitation(invitation_id: str, authorization: str = Header()):
    user_id = get_current_user(authorization)
    inv_repo = InvitationRepository()

    invitation = inv_repo.get_by_id(invitation_id)
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    if invitation["invited_by"] != user_id:
        if not ChatRepository().is_owner(invitation["chat_id"], user_id):
            raise HTTPException(status_code=403, detail="Not allowed to revoke this invitation")

    inv_repo.revoke(invitation_id, datetime.now(timezone.utc).isoformat())
    return {"ok": True}


@router.post("/invitations/claim_pending")
def claim_pending_invitations(authorization: str = Header()):
    user_id = get_current_user(authorization)
    user_email = UserRepository().get_email(user_id)

    now_iso = datetime.now(timezone.utc).isoformat()
    inv_repo = InvitationRepository()
    chat_repo = ChatRepository()
    pending = inv_repo.list_pending_for_email(user_email, now_iso)

    joined_chat_ids: list[str] = []
    for inv in pending:
        chat_id = inv["chat_id"]
        if not chat_repo.get_participant(chat_id, user_id):
            chat_repo.add_participant(chat_id, user_id, role="member")
            joined_chat_ids.append(chat_id)
        inv_repo.accept(inv["id"], now_iso, user_id)

    return {"joined_chat_ids": joined_chat_ids}


@router.post("/invitations/accept")
def accept_invitation(body: AcceptInvitationRequest, authorization: str = Header()):
    user_id = get_current_user(authorization)
    user_email = UserRepository().get_email(user_id)
    inv_repo = InvitationRepository()

    invitation = inv_repo.get_by_token(body.token)
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if invitation.get("revoked_at"):
        raise HTTPException(status_code=410, detail="This invitation has been revoked")
    if invitation.get("accepted_at"):
        raise HTTPException(status_code=410, detail="This invitation has already been used")
    if _is_expired(invitation.get("expires_at")):
        raise HTTPException(status_code=410, detail="This invitation has expired")
    if (invitation.get("email") or "").lower() != user_email:
        raise HTTPException(status_code=403, detail="This invitation isn't for your account")

    chat_id = invitation["chat_id"]
    chat_repo = ChatRepository()
    if not chat_repo.get_participant(chat_id, user_id):
        chat_repo.add_participant(chat_id, user_id, role="member")

    inv_repo.accept(invitation["id"], datetime.now(timezone.utc).isoformat(), user_id)
    return {"chat_id": chat_id}


@router.get("/invitations/peek")
def peek_invitation(token: str):
    inv_repo = InvitationRepository()
    invitation = inv_repo.get_by_token(token)
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if invitation.get("revoked_at") or invitation.get("accepted_at"):
        raise HTTPException(status_code=410, detail="This invitation is no longer valid")
    if _is_expired(invitation.get("expires_at")):
        raise HTTPException(status_code=410, detail="This invitation has expired")

    chat_repo = ChatRepository()
    chat_name = chat_repo.get_name(invitation["chat_id"]) or "a Glyph chat"
    inviter_name = chat_repo.get_profile_first_name(invitation["invited_by"])

    return {
        "email": invitation["email"],
        "chat_name": chat_name,
        "inviter_name": inviter_name,
        "expires_at": invitation["expires_at"],
    }


@router.patch("/chat_participants/{participant_id}/can_invite")
def update_can_invite(participant_id: str, body: CanInviteRequest, authorization: str = Header()):
    user_id = get_current_user(authorization)
    chat_repo = ChatRepository()

    target = chat_repo.get_participant_by_id(participant_id)
    if not target:
        raise HTTPException(status_code=404, detail="Participant not found")
    if target.get("role") == "owner":
        raise HTTPException(status_code=400, detail="Cannot change can_invite for the owner")
    if not chat_repo.is_owner(target["chat_id"], user_id):
        raise HTTPException(status_code=403, detail="Only the chat owner can change permissions")

    chat_repo.update_can_invite(participant_id, bool(body.can_invite))
    return {"ok": True}
