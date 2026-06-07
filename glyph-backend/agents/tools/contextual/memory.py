from langchain_core.tools import tool

from agents.tools.context import ToolContext
from dependencies import get_openai, get_supabase


def make_memory_tools(ctx: ToolContext) -> list:
    db = get_supabase()

    @tool
    def save_memory(content: str) -> str:
        """Persist a fact, preference, or piece of knowledge to long-term memory for this chat. Saved memories persist across all future conversations in this chat and can be retrieved with recall_memories. Use this for important facts the user mentions, decisions made, or context that should survive beyond this session."""
        content = content.strip()
        if not content:
            return "Memory content cannot be empty."

        try:
            client = get_openai()
            embedding_resp = client.embeddings.create(
                model="text-embedding-3-small",
                input=content,
            )
            embedding = embedding_resp.data[0].embedding
        except Exception as e:
            return f"Failed to generate embedding: {e}"

        try:
            db.table("memories").insert({
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
            client = get_openai()
            embedding_resp = client.embeddings.create(
                model="text-embedding-3-small",
                input=query,
            )
            embedding = embedding_resp.data[0].embedding
        except Exception as e:
            return f"Failed to generate query embedding: {e}"

        try:
            rows = db.rpc("match_memories", {
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
