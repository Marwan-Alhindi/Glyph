import uuid

from fastapi import APIRouter, Header, HTTPException, UploadFile, File

from auth import get_current_user
from dependencies import get_supabase

router = APIRouter()

BUCKET = "chat-uploads"
MAX_SIZE = 20 * 1024 * 1024  # 20 MB


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
