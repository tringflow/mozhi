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
3. [`supabase/storage-and-rls.sql`](supabase/storage-and-rls.sql) – creates the **private** `audio` bucket (25 MB limit, audio MIME types only) and sets Row Level Security. Read the file: it explains **Option A** (anon policies, works with the anon key alone) vs **Option B** (service-role key, anon access fully closed – recommended).

The app never creates the bucket itself. If it is missing, uploads fail with a message naming what to create; if an upload fails, the transcript is still saved to history without the original audio.

**Upgrading an existing deployment:** step 3 flips the `audio` bucket from public to private. Existing history keeps working — the app recovers the object path from the old public URL and signs it on read — but audio links shared outside the app stop resolving, which is the intent. Direct uploads can also leave objects behind if a tab is closed mid-pipeline; the SQL file ends with a query to list unreferenced ones.

## Checks

```bash
npm test           # node --test, no test framework needed
npx tsc --noEmit
npm run lint
npm run build
```

Tests cover the parts worth pinning down without a network: upload-path signing and rejection, the size/format rules, legacy URL parsing, and Sarvam response-shape handling. `npm test` runs Node's built-in runner over the `.ts` files directly (see [`scripts/test-hooks.mjs`](scripts/test-hooks.mjs)).

## Deployment

Mozhi has no login and its API routes call a paid API (Sarvam). Anyone who can reach `/api/uploads` can mint an upload URL, so put the app behind your platform's access control or rate limiting before exposing it publicly.

Any host works, including serverless. On Vercel, `/api/transcribe` declares `maxDuration = 300`, which is both the default and the maximum on Hobby and the default on Pro, so it needs no plan-specific configuration. The heaviest request is the batch hand-off, which moves one file out of Supabase and into Sarvam; browser polling keeps transcription itself off the request path.

For a Node host instead:

```bash
npm ci
npm run build
npm start          # listens on $PORT (default 3000)
```

Set the environment variables above on the host.
