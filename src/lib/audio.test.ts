import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWED_AUDIO_EXTENSIONS,
  AUDIO_CONTENT_TYPES,
  MAX_AUDIO_BYTES,
  SYNC_STT_MAX_BYTES,
  getAudioExtension,
  isAllowedAudioExtension,
  isSizeError,
  validateAudioFile,
} from "./audio.ts";

test("the supported ceiling is 25 MB", () => {
  assert.equal(MAX_AUDIO_BYTES, 26_214_400);
});

test("a file at exactly the limit is accepted", () => {
  assert.equal(validateAudioFile({ name: "long.mp3", size: MAX_AUDIO_BYTES }), null);
});

test("a file one byte over the limit is a size error", () => {
  const message = validateAudioFile({ name: "long.mp3", size: MAX_AUDIO_BYTES + 1 });
  assert.ok(message);
  assert.ok(isSizeError(message), "callers rely on this to answer 413");
  assert.match(message, /25MB/);
});

test("empty and nonsensical sizes are rejected", () => {
  assert.match(validateAudioFile({ name: "a.mp3", size: 0 })!, /empty/);
  assert.match(validateAudioFile({ name: "a.mp3", size: -1 })!, /empty/);
  assert.match(validateAudioFile({ name: "a.mp3", size: Number.NaN })!, /empty/);
});

test("every allowed extension passes, case-insensitively", () => {
  for (const ext of ALLOWED_AUDIO_EXTENSIONS) {
    assert.equal(validateAudioFile({ name: `clip.${ext}`, size: 1024 }), null);
    assert.equal(validateAudioFile({ name: `clip.${ext.toUpperCase()}`, size: 1024 }), null);
  }
});

test("unsupported formats are rejected, not silently accepted", () => {
  for (const name of ["clip.flac", "clip.exe", "clip", "clip.mp3.exe", ".mp3."]) {
    const message = validateAudioFile({ name, size: 1024 });
    assert.ok(message, `should reject ${name}`);
    assert.ok(!isSizeError(message));
  }
});

test("a size error is reported even when the format is also wrong", () => {
  // Size is checked first so the user hears the limit, which is the actionable part.
  const message = validateAudioFile({ name: "huge.flac", size: MAX_AUDIO_BYTES + 1 });
  assert.ok(message && isSizeError(message));
});

test("every allowed extension has exactly one canonical content type", () => {
  for (const ext of ALLOWED_AUDIO_EXTENSIONS) {
    assert.match(AUDIO_CONTENT_TYPES[ext], /^audio\//);
  }
  // The bucket's allowed_mime_types is written from this set, so it must not grow silently.
  assert.deepEqual(Object.keys(AUDIO_CONTENT_TYPES).sort(), [...ALLOWED_AUDIO_EXTENSIONS].sort());
});

test("extension helpers agree with the allowlist", () => {
  assert.equal(getAudioExtension("a/b/c.WAV"), "wav");
  assert.equal(getAudioExtension("noext"), "noext");
  assert.ok(isAllowedAudioExtension("mp3"));
  assert.ok(!isAllowedAudioExtension("flac"));
  assert.ok(!isAllowedAudioExtension(undefined));
});

test("the sync-STT threshold stays well below the upload ceiling", () => {
  // Sarvam's synchronous endpoint caps at 30 s of audio; the threshold exists to avoid
  // uploading a large file to it just to be rejected.
  assert.ok(SYNC_STT_MAX_BYTES < MAX_AUDIO_BYTES / 10);
});
