"""The `retrieve_documents` tool SCHEMA.

This tool is bound to the model so it can *request* retrieval, but it is never
executed by ToolNode. The main graph intercepts the call and routes it into the
RETRIEVAL_GRAPH subgraph node (see agents/agent.py::_build_graph), which reads
the `question` argument from the tool call and appends the grounded result.
The body here is only a fallback and should not run in normal operation.
"""

from langchain_core.tools import tool


@tool
def retrieve_documents(question: str) -> str:
    """Search the files uploaded to this chat for passages relevant to a question,
    using multiple RAG strategies (multi-query, RAG-fusion, HyDE, routing), and
    return the most relevant excerpts with citations. Call this whenever answering
    depends on the content of uploaded documents. Pass the user's information need
    as `question`."""
    # Executed by the retrieval subgraph node, not here.
    return "Retrieval is handled by the agent graph; this fallback should not be reached."
