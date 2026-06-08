import io

from langchain_core.tools import tool


def extract_text(url: str) -> str:
    """Download a file by URL and return its extracted text.

    Supports PDF (via pdfplumber), and utf-8 decodable text/code/CSV/JSON.
    Returns the FULL text (no truncation) — callers that need a cap should
    apply it themselves. Raises nothing; returns an error string on failure
    (callers should check for the leading marker) — kept simple so both the
    read_file tool and the RAG ingestion pipeline share one implementation.
    """
    try:
        import httpx
    except ImportError:
        return "ERROR: httpx not available."

    try:
        resp = httpx.get(url, timeout=30, follow_redirects=True)
        resp.raise_for_status()
    except Exception as e:
        return f"ERROR: Failed to download file: {e}"

    ct = resp.headers.get("content-type", "").lower()
    raw = resp.content

    if "pdf" in ct or url.lower().endswith(".pdf"):
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(raw)) as pdf:
                pages = [p.extract_text() or "" for p in pdf.pages]
            text = "\n\n".join(pages).strip()
            if not text:
                return "ERROR: PDF contained no extractable text (it may be a scanned image)."
            return text
        except Exception as e:
            return f"ERROR: PDF extraction failed: {e}"

    try:
        return raw.decode("utf-8", errors="replace")
    except Exception as e:
        return f"ERROR: Could not decode file: {e}"


@tool
def read_file(url: str) -> str:
    """Read the text content of an uploaded file by its URL. Supports plain text, code, CSV, JSON, and PDF files. For images, use your vision capability directly — this tool cannot describe images. Returns the raw text content (truncated at 8000 chars for large files)."""
    text = extract_text(url)
    if text.startswith("ERROR: "):
        # Preserve the original tool-facing phrasing (without the marker).
        return text[len("ERROR: "):]
    return text[:8000] + ("\n\n[Truncated]" if len(text) > 8000 else "")
