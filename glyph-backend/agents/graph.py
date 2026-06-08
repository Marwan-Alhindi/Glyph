"""Module-level compiled graph for LangGraph Studio / langgraph dev.

Uses the default model (Claude) and stateless tools only — no ToolContext
needed for visualization purposes.
"""
from agents.agent import _build_graph, AgentState  # noqa: F401  (re-exported for Studio)
from agents.providers.registry import get_model
from agents.tools.registry import get_tools

graph = _build_graph(get_model("openai"), get_tools())
