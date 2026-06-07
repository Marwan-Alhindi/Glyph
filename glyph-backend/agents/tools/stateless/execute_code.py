import os
import shutil
import subprocess
import sys
import tempfile

from langchain_core.tools import tool

from database.storage import StorageRepository

_OUTPUT_LIMIT = 4000


@tool
def execute_code(code: str, language: str = "python") -> str:
    """Execute a self-contained code snippet and return its stdout/stderr output. Supports 'python' (default) and 'javascript' (requires node). Use for calculations, data processing, text transformations, and any computation. Each call is isolated — variables do not persist. For a stateful session use the python_repl tool instead.

    When Python code uses matplotlib to create plots, the charts are automatically saved and their URLs are returned — include them in your reply as markdown images so the user can see them inline."""
    if language not in ("python", "javascript"):
        return f"Unsupported language '{language}'. Use 'python' or 'javascript'."

    if language == "python":
        tmp_dir = tempfile.mkdtemp()
        try:
            # Preamble: redirect matplotlib saves to tmp_dir, print GLYPH_LOCAL: markers
            preamble = f"""\
import matplotlib as _mpl
_mpl.use("Agg")
import matplotlib.pyplot as _plt_noop
import os as _os_pre, uuid as _uuid_pre

_TMP_DIR = {tmp_dir!r}

_orig_savefig = _plt_noop.savefig
def _glyph_savefig(fname=None, *args, **kwargs):
    import uuid as _u2, os as _o2
    _name = f"chart-{{_u2.uuid4().hex[:8]}}.png"
    _dest = _o2.join(_TMP_DIR, _name)
    kwargs.setdefault("dpi", 120)
    kwargs.setdefault("bbox_inches", "tight")
    _orig_savefig(_dest, *args, **kwargs)
    print(f"GLYPH_LOCAL:{{_dest}}")
_plt_noop.savefig = _glyph_savefig
_plt_noop.show = lambda *_a, **_kw: None
"""
            postamble = f"""
try:
    import matplotlib.pyplot as _plt, os as _os, uuid as _uuid
    for _fn in _plt.get_fignums():
        _fig = _plt.figure(_fn)
        _name = f"chart-{{_uuid.uuid4().hex[:8]}}.png"
        _path = _os.path.join({tmp_dir!r}, _name)
        _fig.savefig(_path, dpi=120, bbox_inches='tight')
        print(f"GLYPH_LOCAL:{{_path}}")
    _plt.close('all')
except Exception:
    pass
"""
            result = subprocess.run(
                [sys.executable, "-c", preamble + "\n" + code + "\n" + postamble],
                capture_output=True, text=True, timeout=60,
            )
            out = result.stdout
            err = result.stderr

            # Upload any chart files the subprocess produced, replace markers with URLs
            storage = StorageRepository()
            image_lines: list[str] = []
            clean_lines: list[str] = []

            for line in out.splitlines():
                if line.startswith("GLYPH_LOCAL:"):
                    local_path = line[len("GLYPH_LOCAL:"):].strip()
                    if os.path.isfile(local_path):
                        fname = os.path.basename(local_path)
                        with open(local_path, "rb") as f:
                            try:
                                url = storage.upload(f"charts/{fname}", f.read(), "image/png")
                                image_lines.append(f"![{fname}]({url})\n[Download {fname}]({url})")
                            except Exception as upload_err:
                                clean_lines.append(f"(chart upload failed: {upload_err})")
                else:
                    clean_lines.append(line)

            text_part = ("\n".join(clean_lines).strip() +
                         (f"\nSTDERR:\n{err.strip()}" if err.strip() else ""))[:_OUTPUT_LIMIT]

            parts = []
            if text_part.strip():
                parts.append(text_part)
            if image_lines:
                parts.append("\n\n".join(image_lines))
            return "\n\n".join(parts) if parts else "(no output)"

        except subprocess.TimeoutExpired:
            return "Execution timed out after 60 seconds."
        except FileNotFoundError:
            return "Python runtime not found on this server."
        except Exception as e:
            return f"Execution failed: {e}"
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    else:
        try:
            result = subprocess.run(
                ["node", "-e", code],
                capture_output=True, text=True, timeout=60,
            )
            out = result.stdout.strip()
            err = result.stderr.strip()
            text = (out + (f"\nSTDERR:\n{err}" if err else ""))[:_OUTPUT_LIMIT]
            return text or "(no output)"
        except subprocess.TimeoutExpired:
            return "Execution timed out after 60 seconds."
        except FileNotFoundError:
            return "Node.js runtime not found on this server."
        except Exception as e:
            return f"Execution failed: {e}"
