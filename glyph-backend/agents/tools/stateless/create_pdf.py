import os
import re
import tempfile
import uuid

from langchain_core.tools import tool

from database.storage import StorageRepository


@tool
def create_pdf(title: str, content: str) -> str:
    """Generate a real downloadable PDF from text/markdown content. Use this when the user asks you to create, export, or download a PDF. Returns a URL you MUST include in your reply as a markdown link so the user can download it.

    Args:
        title: Title shown at the top of the PDF and used for the filename.
        content: The body of the PDF. Supports markdown: **bold**, *italic*, # headings, and ![alt](url) images.
    """
    try:
        from reportlab.lib.pagesizes import LETTER
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image as RLImage
    except Exception as e:
        return f"PDF generation unavailable (reportlab not installed): {e}"

    def _resolve_image(url: str) -> str | None:
        """Fetch any image URL into a temp file reportlab can read."""
        try:
            import httpx
            r = httpx.get(url, timeout=10, follow_redirects=True)
            r.raise_for_status()
            ct = r.headers.get("content-type", "")
            suffix = ".png" if "png" in ct else ".jpg"
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
            tmp.write(r.content)
            tmp.close()
            return tmp.name
        except Exception:
            return None

    styles = getSampleStyleSheet()
    heading1_style = ParagraphStyle("h1", parent=styles["Heading1"], fontSize=16, spaceAfter=8)
    heading2_style = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=13, spaceAfter=6)
    heading3_style = ParagraphStyle("h3", parent=styles["Heading3"], fontSize=11, spaceAfter=4)
    code_style = ParagraphStyle(
        "code", parent=styles["Code"],
        fontName="Courier", fontSize=8, leading=11,
        leftIndent=12, rightIndent=12,
    )

    def _inline_markup(text: str) -> str:
        text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
        text = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<i>\1</i>", text)
        return text

    def _escape_xml(text: str) -> str:
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    _code_map: dict[str, str] = {}

    def _extract_code_blocks(text: str) -> str:
        def _replacer(m: re.Match) -> str:
            key = f"\x00CODE{len(_code_map)}\x00"
            _code_map[key] = m.group(2)
            return f"\n\n{key}\n\n"
        return re.sub(r"```([a-zA-Z0-9_-]*)\n?(.*?)```", _replacer, text, flags=re.DOTALL)

    processed_content = _extract_code_blocks(content.strip())
    page_width = LETTER[0] - 2 * inch
    story: list = [Paragraph(title, styles["Title"]), Spacer(1, 14)]
    _tmp_images: list[str] = []

    for block in re.split(r"\n\s*\n", processed_content):
        block = block.strip()
        if not block:
            continue

        if block in _code_map:
            for line in _code_map[block].split("\n"):
                story.append(Paragraph(_escape_xml(line) or " ", code_style))
            story.append(Spacer(1, 8))
            continue

        img_match = re.fullmatch(r"!\[([^\]]*)\]\(([^)]+)\)", block)
        if img_match:
            alt, url = img_match.group(1), img_match.group(2).strip()
            local = _resolve_image(url)
            if local:
                _tmp_images.append(local)
                try:
                    story.append(RLImage(local, width=page_width, height=page_width * 0.6, kind="proportional"))
                    if alt:
                        story.append(Paragraph(f"<i>{alt}</i>", styles["Italic"]))
                    story.append(Spacer(1, 10))
                    continue
                except Exception:
                    pass
            story.append(Paragraph(f'<link href="{url}">[Image: {alt or url}]</link>', styles["BodyText"]))
            story.append(Spacer(1, 8))
            continue

        if block.startswith("### "):
            story.append(Paragraph(_inline_markup(_escape_xml(block[4:])), heading3_style))
            continue
        if block.startswith("## "):
            story.append(Paragraph(_inline_markup(_escape_xml(block[3:])), heading2_style))
            continue
        if block.startswith("# "):
            story.append(Paragraph(_inline_markup(_escape_xml(block[2:])), heading1_style))
            continue

        lines = block.split("\n")
        text_lines: list[str] = []
        for line in lines:
            inline_img = re.search(r"!\[([^\]]*)\]\(([^)]+)\)", line)
            if inline_img:
                pre = line[:inline_img.start()].strip()
                if pre:
                    text_lines.append(pre)
                if text_lines:
                    story.append(Paragraph(_inline_markup("<br/>".join(text_lines)), styles["BodyText"]))
                    story.append(Spacer(1, 6))
                    text_lines = []
                alt, url = inline_img.group(1), inline_img.group(2).strip()
                local = _resolve_image(url)
                if local:
                    _tmp_images.append(local)
                    try:
                        story.append(RLImage(local, width=page_width, height=page_width * 0.6, kind="proportional"))
                        if alt:
                            story.append(Paragraph(f"<i>{alt}</i>", styles["Italic"]))
                        story.append(Spacer(1, 10))
                        continue
                    except Exception:
                        pass
                story.append(Paragraph(f'<link href="{url}">[Image: {alt or url}]</link>', styles["BodyText"]))
            else:
                text_lines.append(line)
        if text_lines:
            story.append(Paragraph(_inline_markup("<br/>".join(_escape_xml(l) for l in text_lines)), styles["BodyText"]))
        story.append(Spacer(1, 8))

    tmp_pdf = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp_pdf.close()
    try:
        SimpleDocTemplate(tmp_pdf.name, pagesize=LETTER).build(story)
        with open(tmp_pdf.name, "rb") as f:
            pdf_bytes = f.read()
    except Exception as e:
        return f"PDF generation failed: {e}"
    finally:
        if os.path.exists(tmp_pdf.name):
            os.unlink(tmp_pdf.name)
        for p in _tmp_images:
            if os.path.exists(p):
                os.unlink(p)

    safe_title = re.sub(r"[^A-Za-z0-9_-]+", "-", title).strip("-") or "document"
    path = f"pdfs/{safe_title}-{uuid.uuid4().hex[:8]}.pdf"
    try:
        url = StorageRepository().upload(path, pdf_bytes, "application/pdf")
    except Exception as e:
        return f"Failed to upload PDF: {e}"

    return f"PDF created at {url}. Include this URL in your reply as a markdown link like [Download {title}]({url}) so the user can download it."
