-- Adds the source language to each record. Existing rows are Tamil.
-- `tamil_text` is kept as-is and now holds the source-language transcript.
alter table public.translations
  add column if not exists language text not null default 'ta';
