-- Run this in Supabase SQL Editor after reviewing the schema.
create table if not exists public.audio_messages (
  id uuid primary key,
  title text not null default 'Voice message',
  path text not null unique,
  duration_seconds integer not null default 0 check (duration_seconds between 0 and 180),
  owner_id text not null,
  created_at timestamptz not null default now()
);
alter table public.audio_messages enable row level security;
revoke all on table public.audio_messages from anon, authenticated;
