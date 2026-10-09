import { test } from "node:test";
import assert from "node:assert/strict";

import { isDurationLimitError, resolveSignedEntry } from "./sarvam.ts";

// Sarvam's batch endpoints have returned signed URLs both as a bare string and wrapped in an
// object, so the resolver has to accept either without guessing.

test("accepts a bare URL string", () => {
  assert.equal(resolveSignedEntry("https://example.blob.core.windows.net/x?sig=1"), "https://example.blob.core.windows.net/x?sig=1");
});

test("accepts the object form", () => {
  assert.equal(resolveSignedEntry({ file_url: "https://example.com/x" }), "https://example.com/x");
});

test("returns null for missing or empty entries, so callers fail loudly", () => {
  assert.equal(resolveSignedEntry(undefined), null);
  assert.equal(resolveSignedEntry(null), null);
  assert.equal(resolveSignedEntry(""), null);
  assert.equal(resolveSignedEntry({}), null);
  assert.equal(resolveSignedEntry({ file_url: "" }), null);
});

test("recognises the 30-second rejection that triggers the batch fallback", () => {
  assert.ok(isDurationLimitError("Audio exceeds the limit of 30 seconds"));
  assert.ok(isDurationLimitError("invalid audio Duration"));
  assert.ok(!isDurationLimitError("Invalid API key"));
  assert.ok(!isDurationLimitError("Rate limit exceeded"));
});
