import re
import uuid

from langchain_core.tools import tool

from database.storage import StorageRepository

_EXT_MIME: dict[str, str] = {
    "html": "text/html",
    "htm": "text/html",
    "csv": "text/csv",
    "json": "application/json",
    "md": "text/markdown",
    "py": "text/x-python",
    "js": "text/javascript",
    "ts": "text/typescript",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "svg": "image/svg+xml",
}


@tool
def write_file(filename: str, content: str) -> str:
    """Save text content as a downloadable file and return its URL. Use for code files, CSVs, Markdown documents, JSON, or any text output the user might want to download. The filename determines the extension (e.g. 'analysis.csv', 'script.py')."""
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", filename).strip("-") or "file"
    unique_name = f"{uuid.uuid4().hex[:8]}-{safe_name}"
    ext = unique_name.rsplit(".", 1)[-1].lower() if "." in unique_name else ""
    mime = _EXT_MIME.get(ext, "text/plain")

    try:
        url = StorageRepository().upload(f"files/{unique_name}", content.encode("utf-8"), mime)
    except Exception as e:
        return f"Failed to upload file: {e}"

    if ext in ("png", "jpg", "jpeg", "gif", "webp", "svg"):
        return f"File saved. Include EXACTLY this in your reply:\n\n![{filename}]({url})\n\n[Download {filename}]({url})"
    return f"File saved. Include EXACTLY this in your reply so the user can download it:\n\n[Download {filename}]({url})"
