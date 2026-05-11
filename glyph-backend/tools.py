"""Agent tools — LangChain `@tool`-decorated functions.

Two flavors:
  - Stateless tools need no per-request context; they're singletons.
  - Context-aware tools close over per-request data (chat_id, llm_id, etc.)
    and are built fresh by make_*_tool(ctx) for each agent run.

`get_tools(ctx=None)` returns the full toolset. Without ctx, only stateless
tools are included (used at import time / for tests).

Stateless tools:
  web_search, create_pdf, read_url, execute_code, read_file,
  create_chart, write_file

Context-aware (factory functions):
  make_delegate_tool   — handoff to another LLM
  make_python_repl_tool — stateful Python REPL (namespace lives in ctx)
  make_query_tool      — read-only chat data queries
  make_memory_tools    — save_memory + recall_memories (pgvector)
"""

import io
import json
import os
import re
import subprocess
import sys
import uuid
from dataclasses import dataclass, field

from langchain_core.tools import tool

from config import CHARTS_DIR, FILES_DIR, PDFS_DIR, supabase


PUBLIC_API_BASE = os.getenv("PUBLIC_API_BASE", "http://localhost:8000").rstrip("/")
_OUTPUT_LIMIT = 4000  # chars; truncate tool outputs beyond this


# ---------------------------------------------------------------------------
# Shared dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Delegation:
    """A queued handoff produced by the delegate tool during one agent run."""
    target_llm_id: str
    target_name: str
    task: str
    message_id: str | None = None


@dataclass
class ToolContext:
    """Per-request data tools may close over."""
    chat_id: str
    sender_llm_id: str
    # Map of normalized display_name -> invited_llms.id for the chat,
    # EXCLUDING the sender (you can't delegate to yourself).
    other_llms_by_name: dict[str, str]
    delegations: list[Delegation] = field(default_factory=list)
    # Namespace dict for the stateful Python REPL — shared across all repl
    # calls within a single agent run.
    repl_namespace: dict = field(default_factory=dict)


def normalize_llm_name(value: str) -> str:
    """Normalize display names for mention/delegate lookups."""
    return re.sub(r"\s+", " ", (value or "").lstrip("@").strip()).lower()


# ---------------------------------------------------------------------------
# Stateless tools
# ---------------------------------------------------------------------------


@tool
def web_search(query: str) -> str:
    """Search the web for current information. Use when the answer depends on recent events or facts outside your training data."""
    try:
        from ddgs import DDGS
        results = DDGS().text(query, max_results=5)
    except Exception as e:
        return f"Search failed: {e}"

    if not results:
        return "No results."

    lines = []
    for r in results:
        title = r.get("title", "")
        href = r.get("href", "")
        body = (r.get("body") or "")[:300]
        lines.append(f"- {title} ({href}): {body}")
    return "\n".join(lines)


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


@tool
def execute_code(code: str, language: str = "python") -> str:
    """Execute a self-contained code snippet and return its stdout/stderr output. Supports 'python' (default) and 'javascript' (requires node). Use for calculations, data processing, text transformations, and any computation. Each call is isolated — variables do not persist. For a stateful session use the python_repl tool instead.

    When Python code uses matplotlib to create plots, the charts are automatically saved and their URLs are returned — include them in your reply as markdown images so the user can see them inline."""
    if language not in ("python", "javascript"):
        return f"Unsupported language '{language}'. Use 'python' or 'javascript'."

    if language == "python":
        # Preamble: force Agg backend BEFORE user code imports matplotlib so
        # no GUI window opens, and no-op plt.show() so figures stay open for capture.
        preamble = f"""\
import matplotlib as _mpl
_mpl.use("Agg")
import matplotlib.pyplot as _plt_noop
_plt_noop.show = lambda *_a, **_kw: None
"""
        # Postamble: save every open figure and print GLYPH_IMG: markers.
        postamble = f"""
try:
    import matplotlib.pyplot as _plt, os as _os, uuid as _uuid
    _figs = _plt.get_fignums()
    for _fn in _figs:
        _fig = _plt.figure(_fn)
        _name = f"chart-{{_uuid.uuid4().hex[:8]}}.png"
        _path = _os.path.join({CHARTS_DIR!r}, _name)
        _fig.savefig(_path, dpi=120, bbox_inches='tight')
        print(f"GLYPH_IMG:{PUBLIC_API_BASE}/charts/{{_name}}")
    _plt.close('all')
except Exception:
    pass
"""
        full_code = preamble + "\n" + code + "\n" + postamble
        cmd = [sys.executable, "-c", full_code]
    else:
        cmd = ["node", "-e", code]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,
        )
        out = result.stdout
        err = result.stderr

        # Extract GLYPH_IMG markers and convert to markdown image lines
        image_lines = []
        clean_out_lines = []
        for line in out.splitlines():
            if line.startswith("GLYPH_IMG:"):
                url = line[len("GLYPH_IMG:"):].strip()
                # Use the last path segment as the alt text
                name = url.rsplit("/", 1)[-1]
                image_lines.append(f"![{name}]({url})\n[Download {name}]({url})")
            else:
                clean_out_lines.append(line)

        clean_out = "\n".join(clean_out_lines).strip()
        stderr_part = f"\nSTDERR:\n{err.strip()}" if err.strip() else ""
        text_part = (clean_out + stderr_part)[:_OUTPUT_LIMIT]

        parts = []
        if text_part.strip():
            parts.append(text_part)
        if image_lines:
            parts.append("\n\n".join(image_lines))
        return "\n\n".join(parts) if parts else "(no output)"

    except subprocess.TimeoutExpired:
        return "Execution timed out after 60 seconds."
    except FileNotFoundError:
        return f"Runtime for '{language}' not found on this server."
    except Exception as e:
        return f"Execution failed: {e}"


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

    # PDF extraction
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

    # Everything else: decode as UTF-8
    try:
        text = raw.decode("utf-8", errors="replace")
        return text[:8000] + ("\n\n[Truncated]" if len(text) > 8000 else "")
    except Exception as e:
        return f"Could not decode file: {e}"


@tool
def create_chart(
    chart_type: str,
    title: str,
    data: str,
    x_label: str = "",
    y_label: str = "",
) -> str:
    """Generate a chart image and return a download URL.

    chart_type: 'bar', 'line', 'pie', or 'scatter'
    title: chart title
    data: JSON string with keys:
      - 'labels': list of strings (x-axis or pie slice names)
      - 'series': list of objects with 'name' (str) and 'values' (list of numbers)
      Example: {"labels": ["Q1","Q2","Q3"], "series": [{"name": "Revenue", "values": [10,20,15]}]}
    x_label: x-axis label (ignored for pie)
    y_label: y-axis label (ignored for pie)
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return "matplotlib is not installed on this server."

    try:
        spec = json.loads(data)
        labels = spec.get("labels", [])
        series = spec.get("series", [])
    except json.JSONDecodeError as e:
        return f"Invalid data JSON: {e}"

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.set_title(title)

    try:
        if chart_type == "pie":
            values = series[0]["values"] if series else []
            ax.pie(values, labels=labels, autopct="%1.1f%%", startangle=90)
            ax.axis("equal")
        elif chart_type == "bar":
            x = range(len(labels))
            for i, s in enumerate(series):
                offset = [v + i * 0.8 / max(len(series), 1) for v in x]
                ax.bar(offset, s["values"], width=0.8 / max(len(series), 1), label=s.get("name", ""))
            ax.set_xticks(list(x))
            ax.set_xticklabels(labels)
            if len(series) > 1:
                ax.legend()
            if x_label:
                ax.set_xlabel(x_label)
            if y_label:
                ax.set_ylabel(y_label)
        elif chart_type == "line":
            for s in series:
                ax.plot(labels, s["values"], marker="o", label=s.get("name", ""))
            if len(series) > 1:
                ax.legend()
            if x_label:
                ax.set_xlabel(x_label)
            if y_label:
                ax.set_ylabel(y_label)
        elif chart_type == "scatter":
            for s in series:
                vals = s["values"]
                if vals and isinstance(vals[0], (list, tuple)):
                    xs, ys = zip(*vals)
                else:
                    xs, ys = range(len(vals)), vals
                ax.scatter(xs, ys, label=s.get("name", ""))
            if len(series) > 1:
                ax.legend()
            if x_label:
                ax.set_xlabel(x_label)
            if y_label:
                ax.set_ylabel(y_label)
        else:
            return f"Unknown chart_type '{chart_type}'. Use bar, line, pie, or scatter."
    except Exception as e:
        plt.close(fig)
        return f"Chart rendering error: {e}"

    filename = f"chart-{uuid.uuid4().hex[:8]}.png"
    path = os.path.join(CHARTS_DIR, filename)
    try:
        fig.tight_layout()
        fig.savefig(path, dpi=120, bbox_inches="tight")
    except Exception as e:
        return f"Failed to save chart: {e}"
    finally:
        plt.close(fig)

    url = f"{PUBLIC_API_BASE}/charts/{filename}"
    return f"Chart created. Include EXACTLY this in your reply so it renders inline:\n\n![{title}]({url})\n\n[Download {title}]({url})"


@tool
def write_file(filename: str, content: str) -> str:
    """Save text content as a downloadable file and return its URL. Use for code files, CSVs, Markdown documents, JSON, or any text output the user might want to download. The filename determines the extension (e.g. 'analysis.csv', 'script.py')."""
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", filename).strip("-") or "file"
    unique_name = f"{uuid.uuid4().hex[:8]}-{safe_name}"
    path = os.path.join(FILES_DIR, unique_name)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
    except Exception as e:
        return f"Failed to write file: {e}"

    url = f"{PUBLIC_API_BASE}/files/{unique_name}"
    ext = unique_name.rsplit(".", 1)[-1].lower() if "." in unique_name else ""
    if ext in ("png", "jpg", "jpeg", "gif", "webp", "svg"):
        return f"File saved. Include EXACTLY this in your reply:\n\n![{filename}]({url})\n\n[Download {filename}]({url})"
    return f"File saved. Include EXACTLY this in your reply so the user can download it:\n\n[Download {filename}]({url})"


@tool
def create_pdf(title: str, content: str) -> str:
    """Generate a real downloadable PDF from text/markdown content. Use this when the user asks you to create, export, or download a PDF. Returns a URL you MUST include in your reply as a markdown link so the user can download it.

    Args:
        title: Title shown at the top of the PDF and used for the filename.
        content: The body of the PDF. Supports markdown: **bold**, *italic*, # headings, and ![alt](url) images. Images hosted on this server are embedded directly; external images are fetched.
    """
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import LETTER
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image as RLImage
    except Exception as e:
        return f"PDF generation unavailable (reportlab not installed): {e}"

    os.makedirs(PDFS_DIR, exist_ok=True)

    safe_title = re.sub(r"[^A-Za-z0-9_-]+", "-", title).strip("-") or "document"
    filename = f"{safe_title}-{uuid.uuid4().hex[:8]}.pdf"
    path = os.path.join(PDFS_DIR, filename)

    # Map URL prefixes back to local file paths so we never do a network round-
    # trip for images that already live on this server.
    _url_to_local: dict[str, str] = {
        f"{PUBLIC_API_BASE}/charts/": CHARTS_DIR + "/",
        f"{PUBLIC_API_BASE}/files/": FILES_DIR + "/",
        f"{PUBLIC_API_BASE}/pdfs/": PDFS_DIR + "/",
    }

    def _resolve_image(url: str) -> str | None:
        """Return a local file path for the image, fetching remote URLs if needed."""
        for prefix, local_dir in _url_to_local.items():
            if url.startswith(prefix):
                local_path = local_dir + url[len(prefix):]
                return local_path if os.path.isfile(local_path) else None
        # External URL — fetch into a temp file
        try:
            import httpx, tempfile
            r = httpx.get(url, timeout=10, follow_redirects=True)
            r.raise_for_status()
            suffix = ".png" if "png" in r.headers.get("content-type", "") else ".jpg"
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

    def _inline_markup(text: str) -> str:
        text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
        text = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<i>\1</i>", text)
        return text

    story: list = [Paragraph(title, styles["Title"]), Spacer(1, 14)]
    page_width = LETTER[0] - 2 * inch  # usable width inside default margins

    for block in re.split(r"\n\s*\n", content.strip()):
        block = block.strip()
        if not block:
            continue

        # Markdown image: ![alt](url) — embed as a real image
        img_match = re.fullmatch(r"!\[([^\]]*)\]\(([^)]+)\)", block)
        if img_match:
            alt, url = img_match.group(1), img_match.group(2).strip()
            local = _resolve_image(url)
            if local:
                try:
                    img = RLImage(local, width=page_width, height=page_width * 0.6, kind="proportional")
                    story.append(img)
                    if alt:
                        story.append(Paragraph(f"<i>{alt}</i>", styles["Italic"]))
                    story.append(Spacer(1, 10))
                    continue
                except Exception:
                    pass
            # Fallback: show as a link if image can't be embedded
            story.append(Paragraph(f'<link href="{url}">[Image: {alt or url}]</link>', styles["BodyText"]))
            story.append(Spacer(1, 8))
            continue

        # Headings
        if block.startswith("### "):
            story.append(Paragraph(_inline_markup(block[4:]), heading3_style))
            continue
        if block.startswith("## "):
            story.append(Paragraph(_inline_markup(block[3:]), heading2_style))
            continue
        if block.startswith("# "):
            story.append(Paragraph(_inline_markup(block[2:]), heading1_style))
            continue

        # Mixed block: might contain inline images among text lines
        lines = block.split("\n")
        text_lines = []
        for line in lines:
            inline_img = re.fullmatch(r"!\[([^\]]*)\]\(([^)]+)\)", line.strip())
            if inline_img:
                # Flush accumulated text first
                if text_lines:
                    html = _inline_markup("<br/>".join(text_lines))
                    story.append(Paragraph(html, styles["BodyText"]))
                    story.append(Spacer(1, 6))
                    text_lines = []
                alt, url = inline_img.group(1), inline_img.group(2).strip()
                local = _resolve_image(url)
                if local:
                    try:
                        img = RLImage(local, width=page_width, height=page_width * 0.6, kind="proportional")
                        story.append(img)
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
            html = _inline_markup("<br/>".join(text_lines))
            story.append(Paragraph(html, styles["BodyText"]))
        story.append(Spacer(1, 8))

    try:
        SimpleDocTemplate(path, pagesize=LETTER).build(story)
    except Exception as e:
        return f"PDF generation failed: {e}"

    url = f"{PUBLIC_API_BASE}/pdfs/{filename}"
    return f"PDF created at {url}. Include this URL in your reply as a markdown link like [Download {title}]({url}) so the user can download it."


# ---------------------------------------------------------------------------
# Context-aware tool factories
# ---------------------------------------------------------------------------


def make_delegate_tool(ctx: ToolContext):
    """Build a `delegate` tool bound to this agent run."""

    @tool
    def delegate(target_name: str, task: str) -> str:
        """Hand off a follow-up task to another LLM in this chat.

        Use this only after you have completed your own part and the right
        next step is for a different LLM to act on your output (e.g. you're a
        researcher producing material for a designer). Only use it when
        delegation is genuinely useful — a casual mention of another LLM's
        name is not a reason to delegate. The user will not see this handoff
        message in the normal timeline, so your final reply should contain
        your own finished outcome, not narration about the handoff.

        Args:
            target_name: Display name of the target LLM, e.g. "Designer".
                Case-insensitive. Don't include the leading '@'.
            task: A clear, self-contained instruction the target LLM should
                act on. Include the completed facts, summary, findings, or
                context from your work that the target will need.
        """
        display_target = target_name.lstrip("@").strip()
        normalized = normalize_llm_name(target_name)
        target_id = ctx.other_llms_by_name.get(normalized)
        if not target_id:
            available = sorted(ctx.other_llms_by_name.keys())
            if not available:
                return "There are no other LLMs in this chat to delegate to."
            return (
                f"No LLM named {target_name!r} in this chat. "
                f"Available: {available}"
            )

        task_text = task.strip()
        if not task_text:
            return "Delegation skipped: the task was empty."

        if any(d.target_llm_id == target_id and d.task == task_text for d in ctx.delegations):
            return f"Delegation to @{display_target} was already queued for this response."

        try:
            insert_result = supabase.table("messages").insert({
                "chat_id": ctx.chat_id,
                "sender_type": "llm",
                "sender_llm_id": ctx.sender_llm_id,
                "content": f"-> @{display_target}: {task_text}",
                "kind": "delegation",
            }).execute()
        except Exception as e:
            return f"Delegation failed: {e}"

        message_id = insert_result.data[0].get("id") if insert_result.data else None
        ctx.delegations.append(Delegation(
            target_llm_id=target_id,
            target_name=display_target,
            task=task_text,
            message_id=message_id,
        ))

        return (
            f"Delegation to @{display_target} queued. "
            "Now give the user your final outcome without describing the handoff."
        )

    return delegate


def make_python_repl_tool(ctx: ToolContext):
    """Build a stateful Python REPL that shares a namespace within one agent run."""

    @tool
    def python_repl(code: str) -> str:
        """Execute Python code in a persistent session. Variables, imports, and results persist across multiple calls within this conversation turn — use this for iterative data analysis, building on previous computations, or step-by-step problem solving. Each new message starts a fresh session.

        When the code creates matplotlib figures they are automatically saved and their URLs returned — include them as markdown images in your reply."""
        # Ensure Agg backend on first repl call so plt.show() never opens a window.
        if "_mpl_backend_set" not in ctx.repl_namespace:
            try:
                import matplotlib as _mpl
                _mpl.use("Agg")
                import matplotlib.pyplot as _plt_ns
                _plt_ns.show = lambda *_a, **_kw: None
            except Exception:
                pass
            ctx.repl_namespace["_mpl_backend_set"] = True

        old_stdout = sys.stdout
        old_stderr = sys.stderr
        sys.stdout = io.StringIO()
        sys.stderr = io.StringIO()
        try:
            exec(code, ctx.repl_namespace)  # noqa: S102
            out = sys.stdout.getvalue()
            err = sys.stderr.getvalue()

            # Auto-capture any open matplotlib figures
            image_lines = []
            try:
                import matplotlib.pyplot as _plt
                figs = _plt.get_fignums()
                if figs:
                    for fn in figs:
                        fig = _plt.figure(fn)
                        name = f"chart-{uuid.uuid4().hex[:8]}.png"
                        path = os.path.join(CHARTS_DIR, name)
                        fig.savefig(path, dpi=120, bbox_inches="tight")
                        url = f"{PUBLIC_API_BASE}/charts/{name}"
                        image_lines.append(f"![{name}]({url})\n[Download {name}]({url})")
                    _plt.close("all")
            except Exception:
                pass

            parts = []
            text = (out + (f"\nSTDERR:\n{err}" if err else "")).strip()
            if text:
                parts.append(text[:_OUTPUT_LIMIT])
            if image_lines:
                parts.append("\n\n".join(image_lines))
            return "\n\n".join(parts) if parts else "(no output)"
        except Exception as e:
            return f"Error: {type(e).__name__}: {e}"
        finally:
            sys.stdout = old_stdout
            sys.stderr = old_stderr

    return python_repl


def make_query_tool(ctx: ToolContext):
    """Build a read-only chat data query tool scoped to ctx.chat_id."""

    @tool
    def query_chat_data(query_type: str, limit: int = 20) -> str:
        """Query data from this chat. Useful for summarising history or retrieving planner notes.

        query_type options:
          'recent_messages'  — last N messages from all participants
          'user_messages'    — only human-sent messages
          'my_messages'      — only your own past replies
          'daily_notes'      — all planner daily notes for this chat
        limit: max rows to return (default 20, max 100)
        """
        limit = max(1, min(limit, 100))
        try:
            if query_type == "recent_messages":
                rows = (
                    supabase.table("messages")
                    .select("sender_type, sender_llm_id, content, created_at, invited_llms(display_name)")
                    .eq("chat_id", ctx.chat_id)
                    .is_("deleted_at", "null")
                    .order("created_at", desc=True)
                    .limit(limit)
                    .execute()
                    .data or []
                )
                lines = []
                for r in reversed(rows):
                    if r["sender_type"] == "llm":
                        name = (r.get("invited_llms") or {}).get("display_name") or "LLM"
                    else:
                        name = "User"
                    lines.append(f"[{r['created_at'][:16]}] {name}: {(r['content'] or '')[:200]}")
                return "\n".join(lines) or "No messages found."

            elif query_type == "user_messages":
                rows = (
                    supabase.table("messages")
                    .select("content, created_at")
                    .eq("chat_id", ctx.chat_id)
                    .eq("sender_type", "user")
                    .is_("deleted_at", "null")
                    .order("created_at", desc=True)
                    .limit(limit)
                    .execute()
                    .data or []
                )
                return "\n".join(
                    f"[{r['created_at'][:16]}] {(r['content'] or '')[:200]}" for r in reversed(rows)
                ) or "No user messages found."

            elif query_type == "my_messages":
                rows = (
                    supabase.table("messages")
                    .select("content, created_at")
                    .eq("chat_id", ctx.chat_id)
                    .eq("sender_type", "llm")
                    .eq("sender_llm_id", ctx.sender_llm_id)
                    .is_("deleted_at", "null")
                    .order("created_at", desc=True)
                    .limit(limit)
                    .execute()
                    .data or []
                )
                return "\n".join(
                    f"[{r['created_at'][:16]}] {(r['content'] or '')[:200]}" for r in reversed(rows)
                ) or "No messages from you yet."

            elif query_type == "daily_notes":
                rows = (
                    supabase.table("daily_notes")
                    .select("date, content")
                    .eq("chat_id", ctx.chat_id)
                    .order("date", desc=True)
                    .limit(limit)
                    .execute()
                    .data or []
                )
                return "\n\n".join(
                    f"=== {r['date']} ===\n{r['content'] or '(empty)'}" for r in rows
                ) or "No daily notes yet."

            else:
                return f"Unknown query_type '{query_type}'. Options: recent_messages, user_messages, my_messages, daily_notes."
        except Exception as e:
            return f"Query failed: {e}"

    return query_chat_data


def make_memory_tools(ctx: ToolContext):
    """Build save_memory and recall_memories tools scoped to this chat + LLM."""

    @tool
    def save_memory(content: str) -> str:
        """Persist a fact, preference, or piece of knowledge to long-term memory for this chat. Saved memories persist across all future conversations in this chat and can be retrieved with recall_memories. Use this for important facts the user mentions, decisions made, or context that should survive beyond this session."""
        content = content.strip()
        if not content:
            return "Memory content cannot be empty."

        try:
            from openai import OpenAI
            client = OpenAI()
            embedding_resp = client.embeddings.create(
                model="text-embedding-3-small",
                input=content,
            )
            embedding = embedding_resp.data[0].embedding
        except Exception as e:
            return f"Failed to generate embedding: {e}"

        try:
            supabase.table("memories").insert({
                "chat_id": ctx.chat_id,
                "llm_id": ctx.sender_llm_id,
                "content": content,
                "embedding": embedding,
            }).execute()
        except Exception as e:
            return f"Failed to save memory: {e}"

        return f"Memory saved: {content[:100]}{'…' if len(content) > 100 else ''}"

    @tool
    def recall_memories(query: str, limit: int = 5) -> str:
        """Search long-term memory for facts relevant to a query. Returns the most semantically similar memories saved in this chat. Use before answering questions about past decisions, user preferences, or facts that may have been stored in previous conversations."""
        query = query.strip()
        if not query:
            return "Query cannot be empty."
        limit = max(1, min(limit, 20))

        try:
            from openai import OpenAI
            client = OpenAI()
            embedding_resp = client.embeddings.create(
                model="text-embedding-3-small",
                input=query,
            )
            embedding = embedding_resp.data[0].embedding
        except Exception as e:
            return f"Failed to generate query embedding: {e}"

        try:
            rows = supabase.rpc("match_memories", {
                "query_embedding": embedding,
                "match_threshold": 0.3,
                "match_count": limit,
                "p_chat_id": ctx.chat_id,
            }).execute().data or []
        except Exception as e:
            return f"Memory search failed: {e}"

        if not rows:
            return "No relevant memories found."

        lines = [f"{i+1}. (similarity {r['similarity']:.2f}) {r['content']}" for i, r in enumerate(rows)]
        return "Relevant memories:\n" + "\n".join(lines)

    return [save_memory, recall_memories]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_tools(ctx: ToolContext | None = None):
    """Return the tool list used by the chat agent.

    Pass `ctx` from the request handler to enable context-aware tools.
    Without it, only stateless tools are included.
    """
    base = [web_search, read_url, execute_code, read_file, create_chart, write_file, create_pdf]
    if ctx is not None:
        base.append(make_delegate_tool(ctx))
        base.append(make_python_repl_tool(ctx))
        base.append(make_query_tool(ctx))
        base.extend(make_memory_tools(ctx))
    return base
