import { test } from "node:test";
import assert from "node:assert/strict";

// Set before any helper runs: the secret is read lazily, inside the HMAC.
process.env.UPLOAD_SIGNING_SECRET = "test-secret-not-a-real-key";

import {
  AUDIO_PATH_PATTERN,
  PATH_TOKEN_TTL_MS,
  audioObjectName,
  isAudioObjectName,
  mintAudioObject,
  resolveAudioExtension,
  signAudioPath,
  verifyAudioPath,
} from "./upload-token.ts";

test("a freshly minted path verifies", () => {
  const { path, pathToken } = mintAudioObject("mp3");
  assert.match(path, AUDIO_PATH_PATTERN);
  assert.equal(verifyAudioPath(path, pathToken), null);
});

test("minted paths are unique and carry the requested extension", () => {
  const first = mintAudioObject("wav");
  const second = mintAudioObject("wav");
  assert.notEqual(first.path, second.path);
  assert.ok(first.path.endsWith(".wav"));
});

test("a token is not transferable to another path", () => {
  const { pathToken } = mintAudioObject("mp3");
  const other = mintAudioObject("mp3");
  assert.equal(verifyAudioPath(other.path, pathToken), "bad_signature");
});

test("a tampered signature is rejected", () => {
  const { path, pathToken } = mintAudioObject("m4a");
  const [expiry, mac] = pathToken.split(".");
  const flipped = mac.startsWith("A") ? `B${mac.slice(1)}` : `A${mac.slice(1)}`;
  assert.equal(verifyAudioPath(path, `${expiry}.${flipped}`), "bad_signature");
});

test("extending the expiry does not forge a token", () => {
  const { path, pathToken } = mintAudioObject("webm");
  const mac = pathToken.slice(pathToken.indexOf(".") + 1);
  const later = Date.now() + 10 * PATH_TOKEN_TTL_MS;
  assert.equal(verifyAudioPath(path, `${later}.${mac}`), "bad_signature");
});

test("an expired but correctly signed token is reported as expired", () => {
  const { path } = mintAudioObject("mp3");
  const token = signAudioPath(path, Date.now() - PATH_TOKEN_TTL_MS - 1000);
  assert.equal(verifyAudioPath(path, token), "expired");
});

test("paths outside the minted shape are rejected before any storage call", () => {
  const { pathToken } = mintAudioObject("mp3");
  const rejected = [
    "uploads/../secrets.mp3",
    "uploads/../../etc/passwd",
    "/etc/passwd",
    "other-bucket/file.mp3",
    "uploads/not-a-uuid.mp3",
    // A real uuid, but an extension we never mint.
    "uploads/3f2504e0-4f89-41d3-9a0c-0305e82c3301.exe",
    // Nested paths are never minted.
    "uploads/3f2504e0-4f89-41d3-9a0c-0305e82c3301/x.mp3",
    "",
  ];

  for (const path of rejected) {
    assert.equal(verifyAudioPath(path, pathToken), "malformed", `should reject ${path || "(empty)"}`);
    assert.doesNotMatch(path, AUDIO_PATH_PATTERN);
  }
});

test("non-string input is rejected", () => {
  assert.equal(verifyAudioPath(null, "x"), "malformed");
  assert.equal(verifyAudioPath(undefined, undefined), "malformed");
  assert.equal(verifyAudioPath({ path: "x" }, 42), "malformed");
  const { path } = mintAudioObject("mp3");
  assert.equal(verifyAudioPath(path, ""), "malformed");
  assert.equal(verifyAudioPath(path, "no-separator"), "malformed");
  assert.equal(verifyAudioPath(path, "notanumber.abc"), "malformed");
});

test("object names round-trip and are validated", () => {
  const { path } = mintAudioObject("mp3");
  const name = audioObjectName(path);
  assert.equal(name, path.slice("uploads/".length));
  assert.ok(isAudioObjectName(name));
  assert.ok(!isAudioObjectName("../escape.mp3"));
  assert.ok(!isAudioObjectName("recording.mp3"));
  assert.ok(!isAudioObjectName(42));
});

test("extensions are resolved from a filename against the allowlist", () => {
  assert.equal(resolveAudioExtension("interview.MP3"), "mp3");
  assert.equal(resolveAudioExtension("a.b.c.wav"), "wav");
  assert.equal(resolveAudioExtension("clip.m4a"), "m4a");
  assert.equal(resolveAudioExtension("voice.webm"), "webm");
  assert.equal(resolveAudioExtension("script.exe"), null);
  assert.equal(resolveAudioExtension("noextension"), null);
  assert.equal(resolveAudioExtension(undefined), null);
});
