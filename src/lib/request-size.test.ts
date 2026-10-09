import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

process.env.UPLOAD_SIGNING_SECRET = "test-secret-not-a-real-key";

import { MAX_AUDIO_BYTES } from "./audio.ts";
import { mintAudioObject } from "./upload-token.ts";

/**
 * Guards the property that makes 25 MB uploads work on Vercel: no API route may receive a
 * request body that could contain audio. Vercel caps a function's request AND response body at
 * 4.5 MB and the limit is not configurable, so the audio has to reach Storage directly.
 *
 * These are source-level assertions on purpose. The failure they protect against is someone
 * reintroducing a multipart upload, which no unit test of current behaviour would catch.
 */

/** Vercel's hard cap on a function request or response body. */
const VERCEL_BODY_LIMIT = 4.5 * 1024 * 1024;

const API_DIR = join(import.meta.dirname, "..", "app", "api");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === "route.ts" ? [full] : [];
  });
}

test("the supported audio size exceeds Vercel's body limit, so it cannot go through a function", () => {
  // This is the whole reason the direct-upload path exists. If it ever stops being true, the
  // architecture could be simplified - and this test should be the thing that says so.
  assert.ok(
    MAX_AUDIO_BYTES > VERCEL_BODY_LIMIT,
    "a 25 MB file is 5.5x Vercel's 4.5 MB limit; it must be uploaded directly to Storage"
  );
});

test("no API route reads a multipart body", () => {
  const offenders = routeFiles(API_DIR).filter((file) =>
    /\.formData\s*\(/.test(readFileSync(file, "utf8"))
  );

  assert.deepEqual(
    offenders,
    [],
    "reading formData() means a file could be posted to a function, which caps the app at 4.5 MB"
  );
});

test("the browser client never posts a file to Mozhi's own API", () => {
  const client = readFileSync(join(import.meta.dirname, "..", "services", "mozhi.ts"), "utf8");

  // The only body the client builds for /api/* is JSON. The audio goes out via XHR to the
  // Supabase signed URL, which is a different origin entirely.
  assert.ok(!/new FormData\s*\(/.test(client), "the client must not build a multipart body");

  // Every call the client makes to /api/* builds its body with JSON.stringify. A raw File or
  // Blob as a body would mean the audio is going to a function.
  const rawBinaryBody = /body:\s*(file|audioFile|formData|blob|buffer)\b/i.test(client);
  assert.ok(!rawBinaryBody, "the file must never be the body of a request to /api/*");

  // The audio does leave the client as a raw body - but via XHR to the Supabase signed URL.
  assert.ok(/request\.send\(file\)/.test(client), "the direct upload path should still be present");
});

test("every request body on the pipeline stays far under the limit", () => {
  // A real reference, built the way the server builds it.
  const { path, pathToken } = mintAudioObject("mp3");

  const uploadsBody = JSON.stringify({ filename: "a".repeat(255), size: MAX_AUDIO_BYTES });
  const transcribeBody = JSON.stringify({ path, pathToken, language: "ta", durationSeconds: 7200 });

  for (const [name, body] of [
    ["/api/uploads", uploadsBody],
    ["/api/transcribe", transcribeBody],
  ] as const) {
    const bytes = Buffer.byteLength(body, "utf8");
    assert.ok(bytes < 4096, `${name} body is ${bytes} B, expected well under 4 KB`);
  }
});

test("the largest text body the app accepts still fits, with room to spare", () => {
  // /api/translations carries the transcript. Worst case is two maxed-out fields of the
  // most expensive script: Tamil is 3 bytes per character in UTF-8.
  const MAX_TEXT_CHARS = 100_000; // mirrors the cap in the translations route
  const worstCase = MAX_TEXT_CHARS * 3 + MAX_TEXT_CHARS * 1 + 1024;

  assert.ok(
    worstCase < VERCEL_BODY_LIMIT,
    `worst-case save body is ~${Math.round(worstCase / 1024)} KB, which must stay under 4.5 MB`
  );
});
