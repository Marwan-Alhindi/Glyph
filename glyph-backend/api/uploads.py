import uuid

from fastapi import APIRouter, Header, HTTPException, UploadFile, File
from pydantic import BaseModel

from auth import get_current_user
from dependencies import get_supabase

router = APIRouter()

BUCKET = "chat-uploads"
MAX_SIZE = 20 * 1024 * 1024        # 20 MB — legacy through-the-backend upload
# Direct-to-storage cap. The hard ceiling is the Supabase project/bucket file-size
# limit (50 MB on the free plan); keep this aligned with the bucket setting.
MAX_SIGNED_SIZE = 50 * 1024 * 1024  # 50 MB


class SignUploadRequest(BaseModel):
    filename: str
    content_type: str | None = None
    size: int | None = None


@router.post("/uploads/sign")
def sign_upload(body: SignUploadRequest, authorization: str = Header()):
    """Return a signed URL so the client can upload a file DIRECTLY to Supabase
    Storage, bypassing the backend request body (and any proxy body limit). The
    backend never holds the bytes. The client then sends only the public URL to
    /messages, and the existing RAG ingest pipeline runs unchanged."""
    get_current_user(authorization)

    if body.size is not None and body.size > MAX_SIGNED_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds {MAX_SIGNED_SIZE // (1024 * 1024)} MB limit",
        )

    ext = ""
    if body.filename and "." in body.filename:
        ext = "." + body.filename.rsplit(".", 1)[-1].lower()
    storage_path = f"{uuid.uuid4().hex}{ext}"

    db = get_supabase()
    try:
        signed = db.storage.from_(BUCKET).create_signed_upload_url(storage_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not create signed upload URL: {e}")
    try:
        public_url = db.storage.from_(BUCKET).get_public_url(storage_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not get public URL: {e}")

    return {
        "path": signed.get("path") or storage_path,
        "token": signed["token"],
        "signed_url": signed.get("signed_url") or signed.get("signedUrl"),
        "public_url": public_url,
        "mime_type": body.content_type or "application/octet-stream",
        "filename": body.filename or storage_path,
    }


@router.post("/uploads")
async def upload_file(file: UploadFile = File(...), authorization: str = Header()):
    get_current_user(authorization)

    data = await file.read()
    if len(data) > MAX_SIZE:
        raise HTTPException(status_code=413, detail="File exceeds 20 MB limit")

    ext = ""
    if file.filename and "." in file.filename:
        ext = "." + file.filename.rsplit(".", 1)[-1].lower()

    storage_path = f"{uuid.uuid4().hex}{ext}"
    mime = file.content_type or "application/octet-stream"

    db = get_supabase()
    try:
        db.storage.from_(BUCKET).upload(
            storage_path, data, file_options={"content-type": mime, "upsert": "false"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {e}")

    try:
        public_url = db.storage.from_(BUCKET).get_public_url(storage_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not get public URL: {e}")

    return {
        "url": public_url,
        "mime_type": mime,
        "filename": file.filename or storage_path,
        "size": len(data),
    }
