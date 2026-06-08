"""Ingest uploaded files into the `documents` table for RAG retrieval.

Called as a FastAPI BackgroundTask from api/messages.create_message after a
user message with attachments is committed. Extraction -> chunk -> batch embed
-> upsert. Record-Manager semantics: re-ingesting a source replaces its chunks
(delete-by-source then insert), so edits/re-sends never duplicate rows.
"""

import logging

from agents.rag.chunking import build_chunk_rows, embed_texts, extract_text
from dependencies import get_supabase

logger = logging.getLogger(__name__)

# MIME types / extensions we can extract text from. Images are skipped (the
# model sees them via vision); audio/video/binary are skipped.
_TEXT_EXTS = (
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml",
    ".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".c", ".cpp", ".h", ".go",
    ".rs", ".rb", ".php", ".sh", ".sql", ".html", ".css", ".xml", ".log",
)


def is_ingestable(attachment: dict) -> bool:
    mime = (attachment.get("mime_type") or "").lower()
    name = (attachment.get("filename") or attachment.get("url") or "").lower()
    if mime.startswith("image/") or mime.startswith("audio/") or mime.startswith("video/"):
        return False
    if "pdf" in mime or name.endswith(".pdf"):
        return True
    if mime.startswith("text/") or "json" in mime or "csv" in mime:
        return True
    return name.endswith(_TEXT_EXTS)


def ingest_attachment(chat_id: str, attachment: dict) -> int:
    """Chunk + embed one attachment into `documents`. Returns chunks written.

    Safe to call repeatedly (record-manager replace-by-source). Never raises —
    logs and returns 0 on failure so a bad upload can't break message sending.
    """
    try:
        url = attachment.get("url")
        if not url or not is_ingestable(attachment):
            return 0

        source_name = attachment.get("filename") or url
        mime = attachment.get("mime_type") or ""

        text = extract_text(url)
        if text.startswith("ERROR: "):
            logger.warning("RAG ingest skipped %s: %s", source_name, text)
            return 0

        rows = build_chunk_rows(chat_id, url, source_name, mime, text)
        if not rows:
            return 0

        embeddings = embed_texts([r["content"] for r in rows])
        for r, emb in zip(rows, embeddings):
            r["embedding"] = emb

        db = get_supabase()
        # Record-Manager: replace any prior chunks for this source in this chat.
        db.table("documents").delete().eq("chat_id", chat_id).eq("source_url", url).execute()
        db.table("documents").insert(rows).execute()
        logger.info("RAG ingest: %d chunks from %s into chat %s", len(rows), source_name, chat_id)
        return len(rows)
    except Exception as e:
        logger.exception("RAG ingest failed: %s", e)
        return 0


def ingest_attachments(chat_id: str, attachments: list[dict]) -> int:
    total = 0
    for a in attachments or []:
        total += ingest_attachment(chat_id, a)
    return total
