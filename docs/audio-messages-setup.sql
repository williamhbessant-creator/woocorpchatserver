-- One-time setup for public audio upload and playback using the Supabase publishable key.
-- Public audio is visible to anyone with the page or a public URL. Do not store sensitive recordings here.

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
grant select, insert on table public.audio_messages to anon, authenticated;

drop policy if exists "Public can read audio message metadata" on public.audio_messages;
create policy "Public can read audio message metadata"
  on public.audio_messages for select to anon, authenticated
  using (true);

drop policy if exists "Public can add audio message metadata" on public.audio_messages;
create policy "Public can add audio message metadata"
  on public.audio_messages for insert to anon, authenticated
  with check (
    duration_seconds between 0 and 180
    and char_length(title) <= 80
    and char_length(path) <= 300
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audio-messages',
  'audio-messages',
  true,
  10485760,
  array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav']::text[]
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can upload audio messages" on storage.objects;
create policy "Public can upload audio messages"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'audio-messages');

-- No public UPDATE or DELETE policy is created.
