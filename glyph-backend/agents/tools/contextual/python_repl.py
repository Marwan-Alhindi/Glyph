import io
import sys
import uuid

from langchain_core.tools import tool

from agents.tools.context import ToolContext
from database.storage import StorageRepository

_OUTPUT_LIMIT = 4000


def make_python_repl_tool(ctx: ToolContext):
    @tool
    def python_repl(code: str) -> str:
        """Execute Python code in a persistent session. Variables, imports, and results persist across multiple calls within this conversation turn — use this for iterative data analysis, building on previous computations, or step-by-step problem solving. Each new message starts a fresh session.

        When the code creates matplotlib figures they are automatically saved and their URLs returned — include them as markdown images in your reply."""
        if "_mpl_backend_set" not in ctx.repl_namespace:
            try:
                import matplotlib as _mpl
                _mpl.use("Agg")
                import matplotlib.pyplot as _plt_ns
                _plt_ns.show = lambda *_a, **_kw: None
            except Exception:
                pass
            ctx.repl_namespace["_mpl_backend_set"] = True

        old_stdout, old_stderr = sys.stdout, sys.stderr
        sys.stdout = io.StringIO()
        sys.stderr = io.StringIO()
        try:
            exec(code, ctx.repl_namespace)  # noqa: S102
            out = sys.stdout.getvalue()
            err = sys.stderr.getvalue()

            image_lines: list[str] = []
            try:
                import matplotlib.pyplot as _plt
                figs = _plt.get_fignums()
                if figs:
                    storage = StorageRepository()
                    for fn in figs:
                        fig = _plt.figure(fn)
                        buf = io.BytesIO()
                        fig.savefig(buf, format="png", dpi=120, bbox_inches="tight")
                        buf.seek(0)
                        name = f"chart-{uuid.uuid4().hex[:8]}.png"
                        url = storage.upload(f"charts/{name}", buf.read(), "image/png")
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
