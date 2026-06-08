"""Assembles the tool list for an agent run.

get_tools(ctx=None) — pass a ToolContext to include context-aware tools.
Without ctx, only stateless tools are returned (safe at import time / for tests).
"""

from agents.tools.context import ToolContext
from agents.tools.stateless.web_search import web_search
from agents.tools.stateless.read_url import read_url
from agents.tools.stateless.execute_code import execute_code
from agents.tools.stateless.read_file import read_file
from agents.tools.stateless.create_chart import create_chart
from agents.tools.stateless.write_file import write_file
from agents.tools.stateless.create_pdf import create_pdf
from agents.tools.contextual.python_repl import make_python_repl_tool
from agents.tools.contextual.query_chat import make_query_tool
from agents.tools.contextual.memory import make_memory_tools
from agents.tools.contextual.delegate import make_delegate_tool

_STATELESS = [web_search, read_url, execute_code, read_file, create_chart, write_file, create_pdf]


def get_tools(ctx: ToolContext | None = None) -> list:
    tools = list(_STATELESS)
    if ctx is not None:
        tools.append(make_python_repl_tool(ctx))
        tools.append(make_query_tool(ctx))
        tools.extend(make_memory_tools(ctx))
        tools.append(make_delegate_tool(ctx))
    return tools
