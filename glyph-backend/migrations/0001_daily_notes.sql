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
