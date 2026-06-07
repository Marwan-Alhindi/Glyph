"""Supabase Storage access — agent-generated files (charts, PDFs, written files).

Single bucket: agent-outputs
Paths:  charts/{uuid}.png
        pdfs/{name}-{uuid}.pdf
        files/{uuid}-{name}

The bucket must exist in Supabase Storage with public read access.
User uploads go to the separate chat-uploads bucket (see api/uploads.py).
"""

from supabase import Client

from dependencies import get_supabase

BUCKET = "agent-outputs"


class StorageRepository:
    def __init__(self, client: Client | None = None) -> None:
        self._db = client or get_supabase()

    def upload(self, path: str, data: bytes, content_type: str) -> str:
        """Upload bytes to agent-outputs at the given path, return public URL."""
        self._db.storage.from_(BUCKET).upload(
            path,
            data,
            file_options={"content-type": content_type, "upsert": "true"},
        )
        return self._db.storage.from_(BUCKET).get_public_url(path)
