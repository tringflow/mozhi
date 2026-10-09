-- Storage bucket + Row Level Security for Mozhi. Run in the Supabase SQL Editor. Safe to re-run.
-- The app never creates the bucket itself; this does, once.
--
-- Mozhi has NO user authentication. Audio goes straight from the browser to Storage, but only
-- through a signed upload URL that the server mints per file (POST /api/uploads), so the browser
-- never needs a Storage policy and never holds a key. Playback URLs are signed per read.

-- ---------------------------------------------------------------------------------------------
-- 1. The audio bucket: PRIVATE, 25 MB, audio only.
-- ---------------------------------------------------------------------------------------------
-- * private      - objects are unreadable without a signed URL. Signed upload and read URLs are
--                  minted server-side, so nothing in the browser can list or fetch the bucket.
-- * 26214400     - 25 MB, matching MAX_AUDIO_BYTES in src/lib/audio.ts. Storage enforces this
--                  itself, so it holds even for a direct browser upload.
-- * mime types   - the server dictates the Content-Type of every upload from the file extension
--                  (AUDIO_CONTENT_TYPES in src/lib/audio.ts), so this list can stay exact.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audio', 'audio', false, 26214400,
  array['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/webm']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = 26214400,
      allowed_mime_types = array['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/webm'];

-- NOTE ON UPGRADING: the bucket used to be public. Flipping it to private is intentional and
-- does not break existing history - the app recovers the object path from the old public URL and
-- signs it on read (see legacyAudioPath in src/lib/audio-storage.ts). Any public audio link
-- shared outside the app, however, stops working. That is the point.

-- ---------------------------------------------------------------------------------------------
-- 2. The server key. REQUIRED for uploads.
-- ---------------------------------------------------------------------------------------------
-- Set SUPABASE_SERVICE_ROLE_KEY (server-only; never prefix with NEXT_PUBLIC_). The server needs
-- it to mint signed upload/read URLs, and it doubles as the secret for the HMAC that stops a
-- client from quoting back an object path the server did not issue. Without a service-role key
-- you must set UPLOAD_SIGNING_SECRET to any long random string, and grant the anon role insert
-- and select on storage.objects for the audio bucket - a weaker setup, since the anon key is
-- public.

alter table public.translations enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 3. Row Level Security on the history table. Choose ONE.
-- ---------------------------------------------------------------------------------------------

-- OPTION A: works with the anon key alone (no service-role key).
-- Trade-off: the anon key ships to the browser, so anyone holding it can read, insert and delete
-- history rows directly against Supabase. Fine for a personal/dev deployment; not for sensitive
-- data. Audio uploads still need UPLOAD_SIGNING_SECRET and the storage policies noted above.
drop policy if exists "mozhi anon select translations" on public.translations;
drop policy if exists "mozhi anon insert translations" on public.translations;
drop policy if exists "mozhi anon delete translations" on public.translations;
create policy "mozhi anon select translations" on public.translations for select to anon using (true);
create policy "mozhi anon insert translations" on public.translations for insert to anon with check (true);
create policy "mozhi anon delete translations" on public.translations for delete to anon using (true);

-- OPTION B (recommended): server-only service-role key, anon access fully closed.
-- 1. Set SUPABASE_SERVICE_ROLE_KEY in the server environment.
-- 2. Run the drops below, leaving RLS ON with no policies, so the anon key can do nothing and
--    only Mozhi's API routes (service key, bypasses RLS) can touch the data:
--
--   drop policy if exists "mozhi anon select translations" on public.translations;
--   drop policy if exists "mozhi anon insert translations" on public.translations;
--   drop policy if exists "mozhi anon delete translations" on public.translations;

-- The old anon storage policies are no longer used by any code path: uploads go through signed
-- URLs, which need no policy at all. Remove them so the bucket is not writable with the anon key.
drop policy if exists "mozhi anon upload audio" on storage.objects;
drop policy if exists "mozhi anon delete audio" on storage.objects;

-- ---------------------------------------------------------------------------------------------
-- 4. Optional: sweep orphaned uploads.
-- ---------------------------------------------------------------------------------------------
-- With direct uploads the browser can create an object and then never save a history row (it
-- closed the tab, or the insert failed). Those objects are not deleted automatically, because
-- doing so would also destroy audio the user could still save on a retry. Run this occasionally
-- to list objects older than a day that no row references, then delete them from the dashboard
-- (or with `supabase.storage.from('audio').remove([...])`):
--
--   select o.name, o.created_at, (o.metadata->>'size')::bigint as bytes
--   from storage.objects o
--   where o.bucket_id = 'audio'
--     and o.created_at < now() - interval '1 day'
--     and not exists (
--       select 1 from public.translations t
--       where t.audio_path = o.name or t.audio_url like '%' || o.name
--     )
--   order by o.created_at;
