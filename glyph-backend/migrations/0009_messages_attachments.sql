-- Add attachments column to messages so users can send files alongside text.
-- Each element: {url, mime_type, filename, size}
-- Defaults to empty array so existing rows stay valid.

alter table public.messages
    add column if not exists attachments jsonb not null default '[]'::jsonb;
