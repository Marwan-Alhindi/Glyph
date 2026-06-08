"""Chunking + embedding helpers for the RAG ingestion pipeline.

Reuses read_file.extract_text() for download/extraction, splits with a
token-aware RecursiveCharacterTextSplitter, and batch-embeds with the same
OpenAI text-embedding-3-small model used by the memory tool.
"""

import hashlib

import tiktoken

from agents.tools.stateless.read_file import extract_text
from dependencies import get_openai

EMBED_MODEL = "text-embedding-3-small"
CHUNK_SIZE = 800        # tokens per chunk
CHUNK_OVERLAP = 120     # token overlap between consecutive chunks
_EMBED_BATCH = 128      # max inputs per embeddings.create call

# cl100k_base is the tokenizer for text-embedding-3-* and GPT-4o — token-aware
# chunking with it keeps chunks within the embedding model's effective window.
_ENC = tiktoken.get_encoding("cl100k_base")


def content_hash(source_url: str, chunk_index: int, content: str) -> str:
    return hashlib.sha256(f"{source_url}|{chunk_index}|{content}".encode("utf-8")).hexdigest()


def chunk_text(text: str) -> list[str]:
    """Token-aware sliding-window chunking (no external splitter dependency)."""
    text = (text or "").strip()
    if not text:
        return []
    tokens = _ENC.encode(text)
    if len(tokens) <= CHUNK_SIZE:
        return [text]
    step = CHUNK_SIZE - CHUNK_OVERLAP
    chunks = []
    for start in range(0, len(tokens), step):
        window = tokens[start:start + CHUNK_SIZE]
        if not window:
            break
        piece = _ENC.decode(window).strip()
        if piece:
            chunks.append(piece)
        if start + CHUNK_SIZE >= len(tokens):
            break
    return chunks


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Batch-embed a list of strings. Returns one 1536-dim vector per input."""
    if not texts:
        return []
    client = get_openai()
    out: list[list[float]] = []
    for i in range(0, len(texts), _EMBED_BATCH):
        batch = texts[i:i + _EMBED_BATCH]
        resp = client.embeddings.create(model=EMBED_MODEL, input=batch)
        # OpenAI preserves input order in resp.data.
        out.extend(d.embedding for d in resp.data)
    return out


def embed_query(text: str) -> list[float]:
    """Embed a single query string."""
    client = get_openai()
    resp = client.embeddings.create(model=EMBED_MODEL, input=text)
    return resp.data[0].embedding


def build_chunk_rows(chat_id: str, source_url: str, source_name: str,
                     mime_type: str, text: str) -> list[dict]:
    """Extracted text -> list of document rows ready for insert (without embeddings)."""
    rows = []
    for i, chunk in enumerate(chunk_text(text)):
        rows.append({
            "chat_id": chat_id,
            "source_url": source_url,
            "source_name": source_name,
            "mime_type": mime_type,
            "chunk_index": i,
            "content": chunk,
            "metadata": {"retriever_kind": "base", "source_name": source_name},
            "content_hash": content_hash(source_url, i, chunk),
        })
    return rows


__all__ = [
    "extract_text", "chunk_text", "embed_texts", "embed_query",
    "build_chunk_rows", "content_hash", "EMBED_MODEL",
]
