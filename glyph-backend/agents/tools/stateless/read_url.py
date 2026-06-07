from langchain_core.tools import tool


@tool
def read_url(url: str) -> str:
    """Fetch and read the full text content of a web page or online document. Use when you need to read an article, documentation page, GitHub file, or any URL in full — not just a search snippet."""
    try:
        import httpx
        from bs4 import BeautifulSoup
    except ImportError as e:
        return f"Missing dependency: {e}"

    try:
        resp = httpx.get(
            url,
            timeout=20,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; GlyphBot/1.0)"},
        )
        resp.raise_for_status()
    except Exception as e:
        return f"Failed to fetch URL: {e}"

    ct = resp.headers.get("content-type", "")
    if "text/html" in ct:
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()
        text = soup.get_text(separator="\n", strip=True)
    else:
        text = resp.text

    if len(text) > 8000:
        text = text[:8000] + "\n\n[Content truncated to 8000 chars]"
    return text or "No readable content found."
