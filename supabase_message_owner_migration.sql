-- Run this once in the Supabase SQL Editor.
-- Existing messages will have NULL owner_ip_hash and therefore cannot be
-- protected/unprotected until they are replaced by newly sent messages.

alter table public.messageport5555
    add column if not exists owner_ip_hash text;

create index if not exists messageport5555_owner_ip_hash_idx
    on public.messageport5555 (owner_ip_hash);
