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
