-- Brings public.translations in line with what the app reads/writes. Safe to re-run; never drops data.
-- Columns used by the app: id, audio_url, audio_filename, audio_duration, tamil_text, english_text,
-- language, status, created_at.
--   tamil_text = legacy name, holds the SOURCE-language transcript (Tamil or Telugu).
--   audio_url  = nullable on purpose: history is still saved when the original audio can't be stored.

create table if not exists public.translations (
  id             uuid primary key default gen_random_uuid(),
  audio_url      text,
  audio_filename text not null default '',
  audio_duration double precision not null default 0,
  tamil_text     text not null default '',
  english_text   text not null default '',
  language       text not null default 'ta',
  status         text not null default 'completed',
  created_at     timestamptz not null default now()
);

-- For a table that already exists: add anything missing (existing rows get the defaults, i.e. Tamil).
alter table public.translations add column if not exists language text not null default 'ta';
alter table public.translations add column if not exists status text not null default 'completed';
alter table public.translations add column if not exists audio_url text;

-- Allow history rows without stored audio.
alter table public.translations alter column audio_url drop not null;

-- Make PostgREST pick up the new column immediately (fixes PGRST204 "schema cache").
notify pgrst, 'reload schema';
