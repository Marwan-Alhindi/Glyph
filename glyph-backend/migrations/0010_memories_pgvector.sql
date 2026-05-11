-- LLM memory store backed by pgvector.
-- Requires the vector extension (enabled by default on Supabase).
--
-- Each memory is scoped to a chat + the LLM that created it.
-- `embedding` uses OpenAI text-embedding-3-small output dimension (1536).

create extension if not exists vector;

create table if not exists public.memories (
    id          uuid primary key default gen_random_uuid(),
    chat_id     uuid not null references public.chats(id) on delete cascade,
    llm_id      uuid not null references public.invited_llms(id) on delete cascade,
    content     text not null,
    embedding   vector(1536),
    created_at  timestamptz not null default now()
);

create index if not exists memories_chat_id_idx on public.memories(chat_id);
create index if not exists memories_embedding_idx on public.memories
    using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

-- Stored function used by recall_memories tool.
-- Returns memories ordered by cosine similarity, filtered by chat.
create or replace function match_memories(
    query_embedding vector(1536),
    match_threshold float,
    match_count     int,
    p_chat_id       uuid
)
returns table (
    id         uuid,
    content    text,
    similarity float
)
language sql stable
as $$
    select
        m.id,
        m.content,
        1 - (m.embedding <=> query_embedding) as similarity
    from public.memories m
    where m.chat_id = p_chat_id
      and 1 - (m.embedding <=> query_embedding) > match_threshold
    order by m.embedding <=> query_embedding
    limit match_count;
$$;
