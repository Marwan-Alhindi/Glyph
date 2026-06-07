import io

from langchain_core.tools import tool


@tool
def read_file(url: str) -> str:
    """Read the text content of an uploaded file by its URL. Supports plain text, code, CSV, JSON, and PDF files. For images, use your vision capability directly — this tool cannot describe images. Returns the raw text content (truncated at 8000 chars for large files)."""
    try:
        import httpx
    except ImportError:
        return "httpx not available."

    try:
        resp = httpx.get(url, timeout=30, follow_redirects=True)
        resp.raise_for_status()
    except Exception as e:
        return f"Failed to download file: {e}"

    ct = resp.headers.get("content-type", "").lower()
    raw = resp.content

    if "pdf" in ct or url.lower().endswith(".pdf"):
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(raw)) as pdf:
                pages = [p.extract_text() or "" for p in pdf.pages]
            text = "\n\n".join(pages).strip()
            if not text:
                return "PDF contained no extractable text (it may be a scanned image)."
            return text[:8000] + ("\n\n[Truncated]" if len(text) > 8000 else "")
        except Exception as e:
            return f"PDF extraction failed: {e}"

    try:
        text = raw.decode("utf-8", errors="replace")
        return text[:8000] + ("\n\n[Truncated]" if len(text) > 8000 else "")
    except Exception as e:
        return f"Could not decode file: {e}"
