-- Fixed-window rate limiting for the write API routes. Safe to re-run.
--
-- Mozhi has no user accounts, so /api/uploads and /api/transcribe are reachable by anyone who
-- can reach the app. Rate limiting bounds the damage: a filled Storage bucket and a Sarvam bill.
-- It is a throttle, not an authorization check - see the deployment notes in README.md.
--
-- Postgres is used as the counter store because Supabase is already a dependency. An in-memory
-- counter would not work: serverless invocations do not share memory, so each cold instance
-- would start from zero.

create table if not exists public.rate_limit_hits (
  -- Identifies the caller and the limit being applied, e.g. 'uploads:203.0.113.4'.
  bucket_key   text        not null,
  -- Start of the fixed window this row counts, truncated to the window size.
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (bucket_key, window_start)
);

-- Supports the opportunistic purge of windows that have rolled over.
create index if not exists rate_limit_hits_window_start_idx
  on public.rate_limit_hits (window_start);

-- Counters are server-side bookkeeping, never read by the browser.
alter table public.rate_limit_hits enable row level security;

/*
  Atomically records one hit and reports whether the caller is within the limit.

  The insert-on-conflict-update is a single statement, so concurrent invocations cannot
  interleave into a lost update the way a read-then-write would. SECURITY DEFINER lets the
  function run with the table owner's rights, so callers need no direct table privileges and
  RLS above stays closed.
*/
create or replace function public.mozhi_rate_limit(
  p_key    text,
  p_max    integer,
  p_window integer  -- window size in seconds
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz;
  v_hits         integer;
begin
  if p_max < 1 or p_window < 1 then
    raise exception 'mozhi_rate_limit: p_max and p_window must be positive';
  end if;

  -- Truncate now() down to the start of the current window.
  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window) * p_window
  );

  insert into public.rate_limit_hits as r (bucket_key, window_start, hits)
  values (p_key, v_window_start, 1)
  on conflict (bucket_key, window_start)
    do update set hits = r.hits + 1
  returning r.hits into v_hits;

  -- Purge rolled-over windows occasionally rather than on every call, so the common path stays
  -- a single upsert. Bounded by the index above.
  if random() < 0.01 then
    delete from public.rate_limit_hits
    where window_start < clock_timestamp() - interval '1 day';
  end if;

  return jsonb_build_object(
    'allowed',    v_hits <= p_max,
    'hits',       v_hits,
    'remaining',  greatest(p_max - v_hits, 0),
    'reset_at',   v_window_start + make_interval(secs => p_window)
  );
end;
$$;

-- The server calls this with the service-role key, or with the anon key under Option A in
-- supabase/storage-and-rls.sql. Nothing else needs it.
revoke all on function public.mozhi_rate_limit(text, integer, integer) from public;
grant execute on function public.mozhi_rate_limit(text, integer, integer) to anon, service_role;

notify pgrst, 'reload schema';
