-- Records the audio object's PATH instead of a durable URL. Safe to re-run; never drops data.
--
-- Audio now goes straight from the browser to Supabase Storage through a signed upload URL, and
-- the `audio` bucket is private, so there is no longer a stable public URL to store. Playback
-- URLs are signed per read from this path (see src/lib/audio-storage.ts).
--
-- `audio_url` is kept, and still read, so rows written while the bucket was public keep playing:
-- the app recovers the path from that URL when `audio_path` is null. New rows set `audio_path`
-- and leave `audio_url` null.

alter table public.translations add column if not exists audio_path text;

-- History is listed newest-first and each row's object is signed on read; this keeps the lookup
-- of rows that actually have audio cheap as history grows.
create index if not exists translations_audio_path_idx
  on public.translations (audio_path)
  where audio_path is not null;

-- Make PostgREST pick up the new column immediately (fixes PGRST204 "schema cache").
notify pgrst, 'reload schema';
