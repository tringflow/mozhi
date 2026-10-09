import { test } from "node:test";
import assert from "node:assert/strict";

import { legacyAudioPath } from "./audio-storage.ts";

// History rows written while the `audio` bucket was public stored a durable public URL and no
// path. The bucket is private now, so the path has to be recovered from those URLs to keep old
// audio playable and deletable.

const BASE = "https://abc.supabase.co/storage/v1";

test("recovers the path from a public URL", () => {
  assert.equal(legacyAudioPath(`${BASE}/object/public/audio/5f3c.mp3`), "5f3c.mp3");
});

test("recovers the path from an authenticated object URL", () => {
  assert.equal(legacyAudioPath(`${BASE}/object/audio/5f3c.mp3`), "5f3c.mp3");
});

test("recovers nested paths, including ones under uploads/", () => {
  assert.equal(legacyAudioPath(`${BASE}/object/public/audio/uploads/5f3c.wav`), "uploads/5f3c.wav");
});

test("drops a query string, so a stale signed URL still yields a usable path", () => {
  assert.equal(legacyAudioPath(`${BASE}/object/sign/audio/5f3c.mp3?token=abc.def`), "5f3c.mp3");
});

test("decodes percent-encoded names", () => {
  assert.equal(legacyAudioPath(`${BASE}/object/public/audio/my%20clip.mp3`), "my clip.mp3");
});

test("returns null when there is no audio URL to parse", () => {
  assert.equal(legacyAudioPath(null), null);
  assert.equal(legacyAudioPath(undefined), null);
  assert.equal(legacyAudioPath(""), null);
});

test("returns null for a URL that is not an audio-bucket object", () => {
  assert.equal(legacyAudioPath(`${BASE}/object/public/avatars/me.png`), null);
  assert.equal(legacyAudioPath("https://example.com/not-supabase.mp3"), null);
  // The marker must be a path segment, not just a substring of a name.
  assert.equal(legacyAudioPath(`${BASE}/object/public/other/audio-notes.mp3`), null);
});

test("returns null when the marker is present but names no object", () => {
  assert.equal(legacyAudioPath(`${BASE}/object/public/audio/`), null);
});
