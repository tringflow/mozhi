# Mozhi

Tamil and Telugu speech → transcript → English translation, with history and analytics.

- **Speech-to-text and translation:** [Sarvam AI](https://www.sarvam.ai) (`saaras:v3`, `sarvam-translate:v1`). Clips over ~30 s automatically use Sarvam's batch (asynchronous) API; the browser polls for completion.
- **History, analytics, audio storage:** Supabase (Postgres + Storage).
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
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | server (name is public by Next convention) | Used if no service key is set. |
| `SUPABASE_SERVICE_ROLE_KEY` | server only, **optional** | When set, API routes use it and bypass RLS. Never prefix with `NEXT_PUBLIC_`. |

All Supabase access happens in the API routes (`src/lib/supabase.ts` is `server-only`); the browser never talks to Supabase directly.

### Supabase one-time setup

Run these in the Supabase SQL Editor, in order (both are safe to re-run):

1. [`supabase/migrations/20261007_translations_schema.sql`](supabase/migrations/20261007_translations_schema.sql) – creates/updates the `translations` table (including the `language` column).
2. [`supabase/storage-and-rls.sql`](supabase/storage-and-rls.sql) – creates the `audio` storage bucket and Row Level Security. Read the file: it explains **Option A** (anon policies, works with the anon key alone) vs **Option B** (service-role key, anon access fully closed – recommended).

The app never creates the bucket itself. If it is missing, history is still saved (without the original audio) and the server logs say what to create.

## Checks

```bash
npx tsc --noEmit
npm run lint
npm run build
```

## Deployment

Mozhi has no login and its API routes call a paid API (Sarvam). Put it behind your platform's access control or rate limiting before exposing it publicly.

**Use a Node host (Render, Railway, Fly.io, a VPS, Docker), not a serverless platform with a small request-body limit.** Audio (up to 25 MB) is uploaded through the Next.js API routes twice (once for transcription, once for storage), and serverless platforms such as Vercel cap request bodies at about 4.5 MB, so larger files would fail there. If you must use such a platform, uploads need to be reworked to go directly to Supabase Storage / Sarvam via signed URLs.

```bash
npm ci
npm run build
npm start          # listens on $PORT (default 3000)
```

Set the environment variables above on the host. Batch polling is done by the browser (each status request is short), so no long-lived server connections are required; routes declare `maxDuration` for platforms that honour it.
