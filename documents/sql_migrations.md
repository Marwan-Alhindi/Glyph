## 0001_daily_notes.sql

```sql
-- daily_notes: per-chat planner notes shared with all chat participants.
-- One row per (chat_id, date). content is markdown.

create table public.daily_notes (
    id uuid primary key default gen_random_uuid(),
    chat_id uuid not null references public.chats(id) on delete cascade,
    date date not null,
    content text not null default '',
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (chat_id, date)
);

create index daily_notes_chat_id_idx on public.daily_notes (chat_id);

alter table public.daily_notes enable row level security;

-- Read: chat participants only
create policy "daily_notes_select_participants"
    on public.daily_notes for select
    using (
        exists (
            select 1 from public.chat_participants cp
            where cp.chat_id = daily_notes.chat_id and cp.user_id = auth.uid()
        )
    );

-- Insert/Update/Delete: chat participants only
create policy "daily_notes_modify_participants"
    on public.daily_notes for all
    using (
        exists (
            select 1 from public.chat_participants cp
            where cp.chat_id = daily_notes.chat_id and cp.user_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from public.chat_participants cp
            where cp.chat_id = daily_notes.chat_id and cp.user_id = auth.uid()
        )
    );

-- Maintain updated_at on every UPDATE
create or replace function public.touch_daily_notes_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists daily_notes_updated_at on public.daily_notes;
create trigger daily_notes_updated_at
    before update on public.daily_notes
    for each row execute function public.touch_daily_notes_updated_at();

-- Stream postgres_changes to subscribers (so other participants see edits live)
alter publication supabase_realtime add table public.daily_notes;
```

## 0002_chat_participants_realtime.sql

```sql
-- Stream chat_participants INSERT/DELETE so co-members see joins/leaves
-- without a manual refresh.

-- 1. Add to the realtime publication (skip if already present)
do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'chat_participants'
    ) then
        execute 'alter publication supabase_realtime add table public.chat_participants';
    end if;
end $$;

-- 2. REPLICA IDENTITY FULL — needed so DELETE payloads include chat_id
--    (otherwise the `chat_id=eq.${chatId}` filter on DELETE events drops them).
alter table public.chat_participants replica identity full;
```

## 0003_chat_participants_pinned.sql

```sql
-- Per-user pinning of chats. pinned_at is NULL when unpinned; otherwise the
-- timestamp the user pinned the chat (used to order pinned items by recency).

alter table public.chat_participants
    add column if not exists pinned_at timestamptz;

-- Speeds up the per-user "pinned first, then by joined_at" ordering.
create index if not exists chat_participants_user_pinned_idx
    on public.chat_participants (user_id, pinned_at desc nulls last);

-- Allow a user to update their own participant row (covers pinning).
-- Idempotent: skip if a matching policy already exists.
do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'chat_participants'
          and policyname = 'chat_participants_update_own'
    ) then
        execute $policy$
            create policy chat_participants_update_own
                on public.chat_participants
                for update
                using (user_id = auth.uid())
                with check (user_id = auth.uid())
        $policy$;
    end if;
end $$;
```

## 0004_messages_edit_delete.sql

```sql
-- Soft delete + edit for user messages.
-- deleted_at: when the sender deleted the message (UI shows a tombstone).
-- edited_at:  when the sender last edited the message (UI shows "edited").
-- Both NULL on insert. AI replies are never auto-cascaded — see app logic.

alter table public.messages
    add column if not exists deleted_at timestamptz,
    add column if not exists edited_at timestamptz;

-- Allow a user to update their own user-sent messages (covers edit/soft-delete).
-- Idempotent.
do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'messages'
          and policyname = 'messages_update_own'
    ) then
        execute $policy$
            create policy messages_update_own
                on public.messages
                for update
                using (sender_type = 'user' and sender_user_id = auth.uid())
                with check (sender_type = 'user' and sender_user_id = auth.uid())
        $policy$;
    end if;
end $$;

-- Stream UPDATE events so co-members see edits/deletions live.
-- The publication already includes `messages` for INSERT; ensure UPDATE flows too.
alter table public.messages replica identity full;
```

## 0005_messages_context_inclusion.sql

```sql
-- Lets the UI keep side questions visible in chat history while excluding
-- them from future model context.

alter table public.messages
    add column if not exists included_in_context boolean not null default true;
```

## 0006_messages_context_update_policy.sql

```sql
-- Let chat participants update context inclusion on side messages, including
-- LLM replies. Existing client-side edit/delete controls still restrict user
-- message content changes in the app.

drop policy if exists messages_update_own on public.messages;

create policy messages_update_participant
    on public.messages
    for update
    using (
        exists (
            select 1
            from public.chat_participants cp
            where cp.chat_id = messages.chat_id
              and cp.user_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1
            from public.chat_participants cp
            where cp.chat_id = messages.chat_id
              and cp.user_id = auth.uid()
        )
    );
```

## 0007_messages_side_parent.sql

```sql
-- Links a side reply back to the side user message that caused it.

alter table public.messages
    add column if not exists side_parent_message_id uuid references public.messages(id) on delete set null;

create index if not exists messages_side_parent_message_id_idx
    on public.messages(side_parent_message_id);
```

## 0008_messages_kind_delegation.sql

```sql
-- Add 'delegation' to the allowed message kinds so the delegate tool can
-- write a properly tagged row.
--
-- Existing kinds in production (verified via select distinct on 2026-05-07):
--   chat   — regular user/LLM chat message (column default)
--   join   — LLM joined the chat
--   leave  — user left the chat
-- NULL is also allowed defensively in case any historical row slipped in.

alter table public.messages
    drop constraint if exists messages_kind_check;

alter table public.messages
    add constraint messages_kind_check
    check (kind is null or kind in ('chat', 'join', 'leave', 'delegation'));
```

## 0009_messages_attachments.sql

```sql
-- Add attachments column to messages so users can send files alongside text.
-- Each element: {url, mime_type, filename, size}
-- Defaults to empty array so existing rows stay valid.

alter table public.messages
    add column if not exists attachments jsonb not null default '[]'::jsonb;
```

## 0010_memories_pgvector.sql

```sql
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
```

## 0011a_cleanup_adaptive_tables.sql

```sql
-- Remove tables and columns from the abandoned adaptive/My Model feature.
-- Run this BEFORE 0011_llm_integrations.sql.

drop table if exists public.adaptive_messages cascade;
drop table if exists public.user_integrations cascade;

alter table public.invited_llms
    drop column if exists model_type;
```

## 0011_llm_integrations.sql

```sql
-- Per-LLM integration credentials
create table if not exists public.llm_integrations (
    id               uuid primary key default gen_random_uuid(),
    llm_id           uuid not null references public.invited_llms(id) on delete cascade,
    integration_type text not null,
    credentials      jsonb not null default '{}',
    status           text not null default 'active',
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    constraint llm_integrations_unique unique (llm_id, integration_type)
);

create index if not exists llm_integrations_llm_id_idx on public.llm_integrations(llm_id);

alter table public.llm_integrations enable row level security;

-- Users can manage integrations for LLMs in chats they participate in
drop policy if exists "chat_participant" on public.llm_integrations;
create policy "chat_participant" on public.llm_integrations for all
    using (
        exists (
            select 1 from public.invited_llms il
            join public.chat_participants cp on cp.chat_id = il.chat_id
            where il.id = llm_integrations.llm_id
              and cp.user_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from public.invited_llms il
            join public.chat_participants cp on cp.chat_id = il.chat_id
            where il.id = llm_integrations.llm_id
              and cp.user_id = auth.uid()
        )
    );

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger llm_integrations_updated_at
    before update on public.llm_integrations
    for each row execute function public.set_updated_at();
```

## 0012_llm_model_type.sql

```sql
-- Add model_type to invited_llms so each LLM row can specify which
-- provider backs it (openai, anthropic, gemini).  Existing rows default
-- to 'openai' which preserves current behaviour.

ALTER TABLE invited_llms
  ADD COLUMN IF NOT EXISTS model_type text NOT NULL DEFAULT 'openai';
```

## 0013_usage_tracking.sql

```sql
-- Add plan tier to profiles (free / pro / builder).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro', 'max'));

-- Per-user monthly token usage counters.
CREATE TABLE IF NOT EXISTS usage_tracking (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start date        NOT NULL,
  tokens_used  bigint      NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_start)
);

ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

-- Users can only read their own rows (backend writes via service key, bypassing RLS).
CREATE POLICY "usage_tracking_read_own"
  ON usage_tracking FOR SELECT
  USING (auth.uid() = user_id);

-- Atomic upsert helper used by the backend to increment token counts.
CREATE OR REPLACE FUNCTION increment_usage(p_user_id uuid, p_period date, p_tokens bigint)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO usage_tracking (user_id, period_start, tokens_used)
  VALUES (p_user_id, p_period, p_tokens)
  ON CONFLICT (user_id, period_start)
  DO UPDATE SET
    tokens_used = usage_tracking.tokens_used + EXCLUDED.tokens_used,
    updated_at  = now();
$$;
```

## 0014_documents_rag.sql

```sql
-- RAG document store backed by pgvector (KAN-6).
-- Uploaded files are chunked, embedded, and stored here for retrieval.
-- Mirrors 0010_memories_pgvector.sql: no RLS (backend service-key access only),
-- `embedding` is OpenAI text-embedding-3-small output dimension (1536).

create extension if not exists vector;

create table if not exists public.documents (
    id           uuid primary key default gen_random_uuid(),
    chat_id      uuid not null references public.chats(id) on delete cascade,
    source_url   text not null,              -- public URL of the uploaded file (chat-uploads bucket)
    source_name  text,                       -- original filename, for citation display
    mime_type    text,
    chunk_index  int  not null,              -- 0-based ordinal of this chunk within the source file
    content      text not null,              -- the chunk text
    embedding    vector(1536),
    metadata     jsonb not null default '{}'::jsonb,  -- {retriever_kind, parent_chunk_id, page, doc_type, ...}
    content_hash text not null,              -- sha256(source_url|chunk_index|content) — record-manager key
    created_at   timestamptz not null default now()
);

-- Record Manager: one row per unique (source, chunk, content) — re-ingest upserts, no duplicates.
create unique index if not exists documents_content_hash_uniq on public.documents(content_hash);
create index if not exists documents_chat_id_idx on public.documents(chat_id);
create index if not exists documents_source_idx  on public.documents(chat_id, source_url);
create index if not exists documents_embedding_idx on public.documents
    using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);
create index if not exists documents_metadata_idx on public.documents using gin (metadata);

-- Stored function used by the RAG retrieve subgraph.
-- Returns chunks ordered by cosine similarity, filtered by chat, optional jsonb
-- metadata containment (self-query / text-to-metadata) and retriever_kind
-- (base / summary / raptor — for the multivector & raptor methods).
create or replace function match_documents(
    query_embedding vector(1536),
    match_threshold float default 0.3,
    match_count     int   default 8,
    p_chat_id       uuid  default null,
    p_filter        jsonb default '{}'::jsonb,
    p_kind          text  default null
)
returns table (
    id          uuid,
    source_url  text,
    source_name text,
    chunk_index int,
    content     text,
    metadata    jsonb,
    similarity  float
)
language sql stable
as $$
    select
        d.id,
        d.source_url,
        d.source_name,
        d.chunk_index,
        d.content,
        d.metadata,
        1 - (d.embedding <=> query_embedding) as similarity
    from public.documents d
    where (p_chat_id is null or d.chat_id = p_chat_id)
      and (p_kind is null or d.metadata->>'retriever_kind' = p_kind)
      and d.metadata @> p_filter
      and 1 - (d.embedding <=> query_embedding) > match_threshold
    order by d.embedding <=> query_embedding
    limit match_count;
$$;
```

## 0015_noon_subscriptions.sql

```sql
-- Noon Payments subscriptions (KAN-10).
-- payment_orders: one row per checkout attempt — the idempotency/audit log.
-- subscriptions:  current paid state per user (one row each).
-- profiles.plan (added in 0013) stays the effective entitlement read by usage.py;
-- the backend updates it in lockstep with subscriptions.activate().

CREATE TABLE IF NOT EXISTS payment_orders (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_reference text        NOT NULL UNIQUE,           -- our id, sent to Noon as order.reference
  noon_order_id   text,                                  -- Noon's order id (result.order.id)
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan            text        NOT NULL CHECK (plan IN ('pro', 'max')),
  amount          numeric(12,2) NOT NULL,
  currency        text        NOT NULL DEFAULT 'SAR',
  status          text        NOT NULL DEFAULT 'initiated'
                    CHECK (status IN ('initiated', 'paid', 'failed', 'canceled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_orders_user_idx ON payment_orders(user_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan               text        NOT NULL CHECK (plan IN ('pro', 'max')),
  status             text        NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'past_due', 'canceled')),
  noon_card_token    text,                               -- vaulted card for renewals (tokenizeCc)
  current_period_end timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Backend writes via service key (bypasses RLS). Users may read their own rows.
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_orders_read_own" ON payment_orders
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "subscriptions_read_own" ON subscriptions
  FOR SELECT USING (auth.uid() = user_id);
```
