-- Storage bucket + Row Level Security for Mozhi. Run in the Supabase SQL Editor. Safe to re-run.
-- The app never creates the bucket itself; this does, once.
--
-- Mozhi has NO user authentication, so the browser-visible anon key is the only identity available.
-- Choose ONE of the two options below.

-- ---------------------------------------------------------------------------------------------
-- Always: bucket (public so history can play audio via its URL; 25 MB matches the upload limit)
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('audio', 'audio', true, 26214400)
on conflict (id) do nothing;

alter table public.translations enable row level security;

-- ---------------------------------------------------------------------------------------------
-- OPTION A: works with the anon key only (no extra env var).
-- Trade-off: the anon key is public (it ships to the browser), so anyone who has it can read,
-- insert and delete history rows and upload/delete audio directly against Supabase. Fine for a
-- personal/dev deployment; not for sensitive data.
-- ---------------------------------------------------------------------------------------------
drop policy if exists "mozhi anon select translations" on public.translations;
drop policy if exists "mozhi anon insert translations" on public.translations;
drop policy if exists "mozhi anon delete translations" on public.translations;
create policy "mozhi anon select translations" on public.translations for select to anon using (true);
create policy "mozhi anon insert translations" on public.translations for insert to anon with check (true);
create policy "mozhi anon delete translations" on public.translations for delete to anon using (true);

-- Public bucket => files are readable by URL without a SELECT policy (and the bucket can't be listed).
drop policy if exists "mozhi anon upload audio" on storage.objects;
drop policy if exists "mozhi anon delete audio" on storage.objects;
create policy "mozhi anon upload audio" on storage.objects for insert to anon with check (bucket_id = 'audio');
create policy "mozhi anon delete audio" on storage.objects for delete to anon using (bucket_id = 'audio');

-- ---------------------------------------------------------------------------------------------
-- OPTION B (recommended once you can add an env var): server-only service-role key.
-- 1. Add SUPABASE_SERVICE_ROLE_KEY to .env.local / your host's server env (never NEXT_PUBLIC_).
-- 2. Remove the anon policies above, leaving RLS ON with no policies, so the anon key can do nothing
--    and only Mozhi's API routes (which use the service key and bypass RLS) can touch the data:
--
--   drop policy if exists "mozhi anon select translations" on public.translations;
--   drop policy if exists "mozhi anon insert translations" on public.translations;
--   drop policy if exists "mozhi anon delete translations" on public.translations;
--   drop policy if exists "mozhi anon upload audio" on storage.objects;
--   drop policy if exists "mozhi anon delete audio" on storage.objects;
-- ---------------------------------------------------------------------------------------------
