import os
import re
import tempfile
import uuid

from langchain_core.tools import tool

from database.storage import StorageRepository

# Unicode → Latin-1 fallbacks (ReportLab built-in fonts are Latin-1 only)
_CHAR_SUBS: dict[str, str] = {
    '■': '*', '□': '*', '▪': '*', '▫': '*',  # ■ □ ▪ ▫
    '•': '-',                                                  # • bullet
    '–': '-', '—': '--',                                 # – —
    '‘': "'", '’': "'",                                  # curly single quotes
    '“': '"', '”': '"',                                  # curly double quotes
    ' ': ' ',                                                  # non-breaking space
    '→': '->', '←': '<-', '↔': '<->',               # arrows
    '✓': '(v)', '✔': '(v)', '❌': '(X)',             # checkmarks
    '…': '...',                                                # …
    '·': '-',                                                  # middle dot
}


def _sanitize(text: str) -> str:
    for ch, sub in _CHAR_SUBS.items():
        text = text.replace(ch, sub)
    return text.encode('latin-1', errors='ignore').decode('latin-1')


@tool
def create_pdf(title: str, content: str) -> str:
    """Generate a real downloadable PDF from text/markdown content. Use this when the user asks you to create, export, or download a PDF. Returns a URL you MUST include in your reply as a markdown link so the user can download it.

    Args:
        title: Title shown at the top of the PDF and used for the filename.
        content: The body of the PDF. Supports markdown: **bold**, *italic*, # headings, bullet lists, pipe tables, and ![alt](url) images.
    """
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import LETTER
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import (
            HRFlowable, Image as RLImage, Paragraph,
            SimpleDocTemplate, Spacer, Table, TableStyle,
        )
    except Exception as e:
        return f"PDF generation unavailable (reportlab not installed): {e}"

    def _resolve_image(url: str) -> str | None:
        try:
            import httpx
            r = httpx.get(url, timeout=10, follow_redirects=True)
            r.raise_for_status()
            ct = r.headers.get('content-type', '')
            suffix = '.png' if 'png' in ct else '.jpg'
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
            tmp.write(r.content)
            tmp.close()
            return tmp.name
        except Exception:
            return None

    styles = getSampleStyleSheet()
    h1_style = ParagraphStyle('h1', parent=styles['Heading1'], fontSize=16, spaceAfter=8)
    h2_style = ParagraphStyle('h2', parent=styles['Heading2'], fontSize=13, spaceAfter=6)
    h3_style = ParagraphStyle('h3', parent=styles['Heading3'], fontSize=11, spaceAfter=4)
    code_style = ParagraphStyle(
        'code', parent=styles['Code'],
        fontName='Courier', fontSize=8, leading=11,
        leftIndent=12, rightIndent=12,
    )
    bullet_style = ParagraphStyle(
        'bullet', parent=styles['BodyText'],
        leftIndent=20, firstLineIndent=-12, spaceAfter=2,
    )

    def _escape_xml(text: str) -> str:
        return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

    def _inline_markup(text: str) -> str:
        text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
        # Limit italic to spans ≤150 chars to avoid entire-paragraph italic wrapping
        text = re.sub(r'(?<!\*)\*(?!\*)(.{1,150}?)(?<!\*)\*(?!\*)', r'<i>\1</i>', text)
        return text

    def _process_line(line: str) -> str:
        """Sanitize + escape + inline markup a single line."""
        return _inline_markup(_escape_xml(_sanitize(line)))

    # ── code-block extraction ─────────────────────────────────────────────────
    _code_map: dict[str, str] = {}

    def _extract_code_blocks(text: str) -> str:
        def _replacer(m: re.Match) -> str:
            key = f'\x00CODE{len(_code_map)}\x00'
            _code_map[key] = m.group(2)
            return f'\n\n{key}\n\n'
        return re.sub(r'```([a-zA-Z0-9_-]*)\n?(.*?)```', _replacer, text, flags=re.DOTALL)

    # ── pipe table renderer ───────────────────────────────────────────────────
    def _try_render_table(block: str, page_width: float):
        lines = [l.strip() for l in block.strip().splitlines() if l.strip()]
        if not all(l.startswith('|') for l in lines):
            return None
        rows = []
        for line in lines:
            if re.match(r'^\|[-|: ]+\|$', line):
                continue  # skip separator row
            cells = [c.strip() for c in line.strip('|').split('|')]
            rows.append(cells)
        if not rows:
            return None
        ncols = max(len(r) for r in rows)
        for r in rows:
            while len(r) < ncols:
                r.append('')
        col_width = page_width / ncols
        tbl = Table(
            [[Paragraph(_process_line(c), styles['BodyText']) for c in r] for r in rows],
            colWidths=[col_width] * ncols,
        )
        tbl.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2d2d2d')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor('#f5f5f5'), colors.white]),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cccccc')),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ]))
        return tbl

    # ── build story ───────────────────────────────────────────────────────────
    processed = _extract_code_blocks(_sanitize(content.strip()))
    page_width = LETTER[0] - 2 * inch
    story: list = [Paragraph(_sanitize(title), styles['Title']), Spacer(1, 14)]
    _tmp_images: list[str] = []

    for block in re.split(r'\n\s*\n', processed):
        block = block.strip()
        if not block:
            continue

        # Code block placeholder
        if block in _code_map:
            for line in _code_map[block].split('\n'):
                story.append(Paragraph(_escape_xml(line) or ' ', code_style))
            story.append(Spacer(1, 8))
            continue

        # Horizontal rule
        if re.match(r'^[-*_]{3,}$', block):
            story.append(HRFlowable(width='100%', thickness=0.5, color=colors.HexColor('#cccccc')))
            story.append(Spacer(1, 6))
            continue

        # Standalone image
        img_match = re.fullmatch(r'!\[([^\]]*)\]\(([^)]+)\)', block)
        if img_match:
            alt, url = img_match.group(1), img_match.group(2).strip()
            local = _resolve_image(url)
            if local:
                _tmp_images.append(local)
                try:
                    story.append(RLImage(local, width=page_width, height=page_width * 0.6, kind='proportional'))
                    if alt:
                        story.append(Paragraph(f'<i>{_escape_xml(_sanitize(alt))}</i>', styles['Italic']))
                    story.append(Spacer(1, 10))
                    continue
                except Exception:
                    pass
            story.append(Paragraph(f'<link href="{url}">[Image: {_escape_xml(_sanitize(alt or url))}]</link>', styles['BodyText']))
            story.append(Spacer(1, 8))
            continue

        # Markdown pipe table
        tbl = _try_render_table(block, page_width)
        if tbl:
            story.append(tbl)
            story.append(Spacer(1, 10))
            continue

        # Headings
        if block.startswith('### '):
            story.append(Paragraph(_process_line(block[4:]), h3_style))
            continue
        if block.startswith('## '):
            story.append(Paragraph(_process_line(block[3:]), h2_style))
            continue
        if block.startswith('# '):
            story.append(Paragraph(_process_line(block[2:]), h1_style))
            continue

        # General paragraph — process each line independently so inline markup
        # never leaks across lines that are later joined with <br/>
        lines = block.split('\n')
        para_lines: list[str] = []

        for line in lines:
            if not line.strip():
                if para_lines:
                    story.append(Paragraph('<br/>'.join(para_lines), styles['BodyText']))
                    para_lines = []
                    story.append(Spacer(1, 4))
                continue

            # Bullet point (-, *, +)
            bullet_m = re.match(r'^\s*[-*+]\s+(.+)', line)
            if bullet_m:
                if para_lines:
                    story.append(Paragraph('<br/>'.join(para_lines), styles['BodyText']))
                    para_lines = []
                story.append(Paragraph('- ' + _process_line(bullet_m.group(1)), bullet_style))
                continue

            # Numbered list
            num_m = re.match(r'^\s*(\d+\.)\s+(.+)', line)
            if num_m:
                if para_lines:
                    story.append(Paragraph('<br/>'.join(para_lines), styles['BodyText']))
                    para_lines = []
                story.append(Paragraph(f'{num_m.group(1)} {_process_line(num_m.group(2))}', bullet_style))
                continue

            # Inline image
            inline_img = re.search(r'!\[([^\]]*)\]\(([^)]+)\)', line)
            if inline_img:
                pre = line[:inline_img.start()].strip()
                if pre:
                    para_lines.append(_process_line(pre))
                if para_lines:
                    story.append(Paragraph('<br/>'.join(para_lines), styles['BodyText']))
                    para_lines = []
                alt, url = inline_img.group(1), inline_img.group(2).strip()
                local = _resolve_image(url)
                if local:
                    _tmp_images.append(local)
                    try:
                        story.append(RLImage(local, width=page_width, height=page_width * 0.6, kind='proportional'))
                        if alt:
                            story.append(Paragraph(f'<i>{_escape_xml(_sanitize(alt))}</i>', styles['Italic']))
                        story.append(Spacer(1, 10))
                        continue
                    except Exception:
                        pass
                story.append(Paragraph(f'<link href="{url}">[Image: {_escape_xml(_sanitize(alt or url))}]</link>', styles['BodyText']))
                continue

            para_lines.append(_process_line(line))

        if para_lines:
            story.append(Paragraph('<br/>'.join(para_lines), styles['BodyText']))
        story.append(Spacer(1, 8))

    tmp_pdf = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
    tmp_pdf.close()
    try:
        SimpleDocTemplate(tmp_pdf.name, pagesize=LETTER).build(story)
        with open(tmp_pdf.name, 'rb') as f:
            pdf_bytes = f.read()
    except Exception as e:
        return f'PDF generation failed: {e}'
    finally:
        if os.path.exists(tmp_pdf.name):
            os.unlink(tmp_pdf.name)
        for p in _tmp_images:
            if os.path.exists(p):
                os.unlink(p)

    safe_title = re.sub(r'[^A-Za-z0-9_-]+', '-', title).strip('-') or 'document'
    path = f'pdfs/{safe_title}-{uuid.uuid4().hex[:8]}.pdf'
    try:
        url = StorageRepository().upload(path, pdf_bytes, 'application/pdf')
    except Exception as e:
        return f'Failed to upload PDF: {e}'

    return f"PDF created at {url}. Include this URL in your reply as a markdown link like [Download {title}]({url}) so the user can download it."
