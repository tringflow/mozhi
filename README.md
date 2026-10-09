# Mozhi

Tamil and Telugu speech → transcript → English translation, with history and analytics.

- **Speech-to-text and translation:** [Sarvam AI](https://www.sarvam.ai) (`saaras:v3`, `sarvam-translate:v1`). Clips over ~30 s automatically use Sarvam's batch (asynchronous) API; the browser polls for completion.
- **History, analytics, audio storage:** Supabase (Postgres + private Storage bucket).
- **Stack:** Next.js 16 (App Router), React 19, Tailwind 4.

Languages are configured in one place: [`src/lib/languages.ts`](src/lib/languages.ts). Add an entry there to support another Sarvam language.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

### Environment variables

| Variable | Where | Notes |
| --- | --- | --- |
| `SARVAM_API_KEY` | server only | Never exposed to the browser. |
| `NEXT_PUBLIC_SUPABASE_URL` | server (name is public by Next convention) | Project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | server (name is public by Next convention) | Used for database access if no service key is set. |
| `SUPABASE_SERVICE_ROLE_KEY` | server only, **required for audio uploads** | Lets the server mint signed Storage URLs and bypass RLS, and is the default secret for signing upload paths. Never prefix with `NEXT_PUBLIC_`. |
| `UPLOAD_SIGNING_SECRET` | server only, optional | Any long random string. Only needed if you run **without** a service-role key; see [`supabase/storage-and-rls.sql`](supabase/storage-and-rls.sql). |
| `CRON_SECRET` | server only, **required for cleanup** | At least 16 random characters. Vercel sends it automatically as `Authorization: Bearer …` to the cleanup cron. Without it the cleanup route refuses to run. |
| `ORPHAN_GRACE_HOURS` | server only, optional | How long an unreferenced upload survives before cleanup. Defaults to 24; values below 4 are clamped up, so it can never collect a live upload. |

Neither API key ever reaches the browser. The browser holds no Supabase key at all: it talks to Storage only through short-lived signed URLs minted by the API routes.

## How audio gets in

Audio does **not** pass through the Next.js server. Up to 25 MB is supported, and the path is the same on every host:

1. `POST /api/uploads` — the browser sends only the filename and size. The server validates both, mints an object path it controls (`uploads/<uuid>.<ext>`), and returns a signed upload URL plus an HMAC over the path.
2. The browser `PUT`s the file **straight to Supabase Storage** with upload progress. The bytes never touch a serverless function, which is what keeps 25 MB files working on hosts that cap request bodies (Vercel: 4.5 MB).
3. `POST /api/transcribe` — the browser sends the path and its HMAC, never the audio. The server verifies the signature, measures the stored object, and transcribes it.
4. `POST /api/translations` — attaches the same object to a history row by reference.

Because the path travels with a signature, a client cannot name an object the server did not issue for it, and cannot escape the `uploads/` prefix.

**Sarvam's batch API cannot be given a Supabase URL.** It accepts audio only as bytes `PUT` to a pre-signed URL that it issues, so for clips over 30 s the server relays Supabase Storage → server → Sarvam. Both hops are server-to-server and so are unaffected by request-body limits. Limits worth knowing: Sarvam's synchronous endpoint takes 30 s of audio, its batch API 2 hours per file and 20 files per job.

Playback is signed too: the `audio` bucket is private, so `GET /api/translations` mints a one-hour signed URL per row on each read. Nothing durable is handed to the browser — don't persist `audio_url`, re-fetch the record.

### Supabase one-time setup

Run these in the Supabase SQL Editor, in order (all are safe to re-run):

1. [`supabase/migrations/20261007_translations_schema.sql`](supabase/migrations/20261007_translations_schema.sql) – creates/updates the `translations` table (including the `language` column).
2. [`supabase/migrations/20261009_add_audio_path.sql`](supabase/migrations/20261009_add_audio_path.sql) – adds `audio_path`, which records the stored object instead of a durable URL.
3. [`supabase/migrations/20261010_rate_limit.sql`](supabase/migrations/20261010_rate_limit.sql) – adds the rate-limit counter table and the atomic `mozhi_rate_limit` function used by the write routes.
4. [`supabase/migrations/20261011_repair_translations_schema.sql`](supabase/migrations/20261011_repair_translations_schema.sql) – brings `translations` to exactly what the code writes and **raises an error if anything is still wrong**. Run this if saving to history fails; it is idempotent, so running it anyway is safe.
5. [`supabase/storage-and-rls.sql`](supabase/storage-and-rls.sql) – creates the **private** `audio` bucket (25 MB limit, audio MIME types only) and sets Row Level Security. Read the file: it explains **Option A** (anon policies, works with the anon key alone) vs **Option B** (service-role key, anon access fully closed – recommended).

The app never creates the bucket itself. If it is missing, uploads fail with a message naming what to create; if an upload fails, the transcript is still saved to history without the original audio.

**Upgrading an existing deployment:** step 5 flips the `audio` bucket from public to private. Existing history keeps working — the app recovers the object path from the old public URL and signs it on read — but audio links shared outside the app stop resolving, which is the intent.

### Cleaning up abandoned uploads

A direct upload can be abandoned: a tab closes between the upload and the save, or the insert fails. [`/api/cron/cleanup-orphans`](src/app/api/cron/cleanup-orphans/route.ts) collects those, and [`vercel.json`](vercel.json) schedules it daily — the maximum frequency on Vercel's Hobby plan. Set `CRON_SECRET` in the project environment; Vercel then sends it as a bearer token, and **without it the route refuses to run** rather than becoming a world-callable delete button.

Four rules decide what goes, and each one fails closed:

| Rule | Effect |
| --- | --- |
| Path must match `uploads/<uuid>.<ext>` | Legacy root-level audio and anything hand-uploaded are out of scope. |
| Must not be referenced by a history row | Saved history is protected regardless of age. |
| Creation time must be positively established | A missing or unparseable timestamp means keep. |
| Must be older than the grace period | Default 24 h. |

The grace period is what makes this safe for **active processing and retries**. An object is reachable only by quoting its path with the HMAC issued for it, and that token expires after 2 hours; both `/api/transcribe` and `/api/translations` reject an expired token. So once the token dies the object is permanently unreachable, and "older than the token lifetime and unreferenced" is a sound definition of dead. `ORPHAN_GRACE_HOURS` is clamped to a 4-hour floor — twice the token lifetime — so it cannot be misconfigured into deleting a live upload.

The job is idempotent, so Vercel's best-effort delivery (which may skip or duplicate a run) is harmless. Verify a new setup without deleting anything:

```bash
curl -H "Authorization: Bearer $CRON_SECRET"   "https://your-app.vercel.app/api/cron/cleanup-orphans?dryRun=1"
```

On a non-Vercel host, call the same URL from your own scheduler (cron, systemd timer, `pg_cron` + `pg_net`). The SQL file also ends with a query to list unreferenced objects by hand.

### When saving to history fails

Upload, transcription and translation can all succeed while the save fails, because the save is
the only step that writes to the `translations` table. Two schema drifts cause it, and the UI now
shows which:

| Message in the UI | Postgres code | Fix |
| --- | --- | --- |
| "Database schema is out of date…" | `PGRST204` | `audio_path` is missing — the direct-upload flow stores the object path, not a URL. |
| "Database column \"audio_url\" rejects null…" | `23502` | `audio_url` is still `NOT NULL` on a table created before it was relaxed. The app writes no value for it now. |

Run migration 4 above; it repairs both and fails loudly if anything remains. The server log also
carries the raw diagnostics, with no transcript text and no keys:

```
[translations POST] insert failed: constraint { message, code, details, hint, columns, hasAudioPath }
```

Check the actual schema directly with:

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'translations'
order by ordinal_position;
```

`audio_url` and `audio_path` must both report `is_nullable = YES`.

Row-level security is an unlikely cause if uploads work: minting a signed upload URL needs the
service-role key, and that key bypasses RLS on this table too.

### Access control

Mozhi has no accounts, and `/api/uploads` mints Storage capacity while `/api/transcribe` spends Sarvam credit. Two app-level controls limit the damage on any host:

- **Same-origin enforcement** on both routes, via `Sec-Fetch-Site` with an `Origin`/`Host` fallback. This stops another site driving the endpoints. It does not stop `curl`, which can set any header.
- **Rate limiting**, counted in Postgres because serverless instances share no memory: 20 uploads and 20 transcriptions per address per 10 minutes, plus a 300/hour ceiling across the whole deployment so rotating addresses cannot multiply the per-caller limit. Status polling is not limited — it runs every 3 seconds during a batch job. The limiter **fails open**: if the counter is unreachable the request proceeds and the problem is logged, because a database blip should not stop someone transcribing audio.

Neither is authentication, and address-based limits are defeated by rotation. **If the deployment should not be public, put real access control in front of it** — on Vercel that is [Deployment Protection](https://vercel.com/docs/deployment-protection) (password or SSO), which needs no code and covers every route. That is the smallest genuine fix; the controls above are defence in depth for when the app is meant to be reachable.

## Checks

```bash
npm test           # node --test, no test framework needed
npx tsc --noEmit
npm run lint
npm run build
```

Tests cover the parts worth pinning down without a network: upload-path signing and rejection, the orphan-cleanup safety rules, same-origin and caller-identity handling, the size/format rules, legacy URL parsing, and Sarvam response-shape handling. One suite asserts at source level that no API route reads a multipart body, which is the property that keeps 25 MB uploads working. `npm test` runs Node's built-in runner over the `.ts` files directly (see [`scripts/test-hooks.mjs`](scripts/test-hooks.mjs)).

## Deployment

Mozhi has no login and its API routes call a paid API (Sarvam). See [Access control](#access-control) for what the app enforces itself and what still needs to come from the platform.

Set `CRON_SECRET` as well as the variables above, or the cleanup cron will return 503 on every run.

Any host works, including serverless. On Vercel, `/api/transcribe` declares `maxDuration = 300`, which is both the default and the maximum on Hobby and the default on Pro, so it needs no plan-specific configuration. The heaviest request is the batch hand-off, which moves one file out of Supabase and into Sarvam; browser polling keeps transcription itself off the request path.

For a Node host instead:

```bash
npm ci
npm run build
npm start          # listens on $PORT (default 3000)
```

Set the environment variables above on the host.
