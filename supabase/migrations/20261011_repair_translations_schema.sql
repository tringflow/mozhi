-- Brings public.translations to exactly what the current code reads and writes, and reports the
-- result. Idempotent and non-destructive: it only ADDS columns and RELAXES constraints, never
-- drops a column or touches a row.
--
-- WHY THIS EXISTS
-- Saving to history can fail while upload, transcription and translation all succeed, because
-- the save is the only step that writes to this table. Two drifts cause it:
--
--   1. `audio_path` missing. The direct-upload flow records the storage object's PATH instead of
--      a URL. PostgREST answers PGRST204 ("column not found in schema cache") and the whole
--      insert fails. Introduced in 20261009_add_audio_path.sql; if that never ran, this fixes it.
--
--   2. `audio_url` still NOT NULL. The bucket is private now, so there is no durable URL to
--      store and the app writes no value for that column. On a table created before
--      20261007 relaxed it, Postgres answers 23502 and the insert fails. The app no longer
--      sends an explicit null, so a DEFAULT is enough - but dropping NOT NULL is the real fix.
--
-- ---------------------------------------------------------------------------------------------
-- DIAGNOSTIC: run this FIRST to see which drift you actually have.
-- ---------------------------------------------------------------------------------------------
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'translations'
--   order by ordinal_position;
--
-- Expect these nine columns. `audio_url` and `audio_path` MUST show is_nullable = 'YES':
--   id, audio_url, audio_path, audio_filename, audio_duration,
--   tamil_text, english_text, language, status, created_at
-- ---------------------------------------------------------------------------------------------

create table if not exists public.translations (
  id             uuid primary key default gen_random_uuid(),
  audio_url      text,
  audio_path     text,
  audio_filename text not null default '',
  audio_duration double precision not null default 0,
  tamil_text     text not null default '',
  english_text   text not null default '',
  language       text not null default 'ta',
  status         text not null default 'completed',
  created_at     timestamptz not null default now()
);

-- Every column the app touches, added if absent. Existing rows take the defaults.
alter table public.translations add column if not exists audio_url      text;
alter table public.translations add column if not exists audio_path     text;
alter table public.translations add column if not exists audio_filename text not null default '';
alter table public.translations add column if not exists audio_duration double precision not null default 0;
alter table public.translations add column if not exists tamil_text     text not null default '';
alter table public.translations add column if not exists english_text   text not null default '';
alter table public.translations add column if not exists language       text not null default 'ta';
alter table public.translations add column if not exists status         text not null default 'completed';
alter table public.translations add column if not exists created_at     timestamptz not null default now();

-- Both audio columns must accept null: a row is saved even when the audio was not kept, and the
-- private-bucket flow stores a path rather than a URL.
alter table public.translations alter column audio_url  drop not null;
alter table public.translations alter column audio_path drop not null;

-- Belt and braces for drift #2: with a default, an insert that omits audio_url succeeds even if
-- some other process re-adds NOT NULL.
alter table public.translations alter column audio_url set default null;

-- Keeps the lookup of rows that have audio cheap as history grows (also in 20261009).
create index if not exists translations_audio_path_idx
  on public.translations (audio_path)
  where audio_path is not null;

-- PostgREST caches the schema; without this a just-added column still answers PGRST204.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------------------------
-- VERIFY: this should return one row reading `ok = true`.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_missing text;
  v_audio_url_nullable text;
begin
  select string_agg(required, ', ')
  into v_missing
  from unnest(array[
    'id','audio_url','audio_path','audio_filename','audio_duration',
    'tamil_text','english_text','language','status','created_at'
  ]) as required
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'translations' and column_name = required
  );

  select is_nullable into v_audio_url_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'translations' and column_name = 'audio_url';

  if v_missing is not null then
    raise exception 'translations is still missing column(s): %', v_missing;
  end if;

  if v_audio_url_nullable <> 'YES' then
    raise exception 'translations.audio_url is still NOT NULL; inserts will fail with 23502';
  end if;

  raise notice 'translations schema OK: all columns present, audio_url and audio_path nullable.';
end $$;
