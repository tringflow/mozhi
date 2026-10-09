import { test } from "node:test";
import assert from "node:assert/strict";

import { checkSameOrigin } from "./request-origin.ts";
import { clientKey } from "./rate-limit.ts";

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

// --- same-origin enforcement ---

test("Sec-Fetch-Site is authoritative when present", () => {
  assert.equal(checkSameOrigin(headers({ "sec-fetch-site": "same-origin" })).ok, true);
  assert.equal(checkSameOrigin(headers({ "sec-fetch-site": "same-site" })).ok, true);
  assert.equal(checkSameOrigin(headers({ "sec-fetch-site": "cross-site" })).ok, false);
  assert.equal(checkSameOrigin(headers({ "sec-fetch-site": "none" })).ok, false);
});

test("Sec-Fetch-Site wins over a matching Origin", () => {
  // A cross-site caller cannot launder itself by also sending a matching Origin.
  const result = checkSameOrigin(
    headers({ "sec-fetch-site": "cross-site", origin: "https://mozhi.app", host: "mozhi.app" })
  );
  assert.equal(result.ok, false);
});

test("Origin is compared against Host when Sec-Fetch-Site is absent", () => {
  assert.equal(checkSameOrigin(headers({ origin: "https://mozhi.app", host: "mozhi.app" })).ok, true);
  assert.equal(checkSameOrigin(headers({ origin: "https://evil.test", host: "mozhi.app" })).ok, false);
});

test("a port mismatch is a different origin", () => {
  assert.equal(checkSameOrigin(headers({ origin: "http://localhost:3000", host: "localhost:3000" })).ok, true);
  assert.equal(checkSameOrigin(headers({ origin: "http://localhost:4000", host: "localhost:3000" })).ok, false);
});

test("an opaque or malformed Origin is rejected", () => {
  assert.equal(checkSameOrigin(headers({ origin: "null", host: "mozhi.app" })).ok, false);
  assert.equal(checkSameOrigin(headers({ origin: "not a url", host: "mozhi.app" })).ok, false);
});

test("a request with neither header passes, because blocking it would stop nothing", () => {
  // curl and server-to-server callers legitimately send neither, and an attacker would simply
  // add them. The rate limits, not this check, are what bound those callers.
  assert.equal(checkSameOrigin(headers({})).ok, true);
  assert.equal(checkSameOrigin(headers({ host: "mozhi.app" })).ok, true);
});

test("a rejection explains itself for the server log", () => {
  const result = checkSameOrigin(headers({ "sec-fetch-site": "cross-site" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /cross-site/);
});

// --- caller identity for rate limiting ---

test("the first x-forwarded-for entry identifies the caller", () => {
  assert.equal(clientKey(headers({ "x-forwarded-for": "203.0.113.4" })), "203.0.113.4");
  assert.equal(
    clientKey(headers({ "x-forwarded-for": "203.0.113.4, 70.41.3.18, 150.172.238.178" })),
    "203.0.113.4",
    "later entries are proxies, not the client"
  );
});

test("x-real-ip is the fallback", () => {
  assert.equal(clientKey(headers({ "x-real-ip": "198.51.100.7" })), "198.51.100.7");
});

test("a missing address degrades to a shared key rather than throwing", () => {
  assert.equal(clientKey(headers({})), "unknown");
  assert.equal(clientKey(headers({ "x-forwarded-for": "" })), "unknown");
});

test("a forged oversized header cannot bloat the counter key", () => {
  const key = clientKey(headers({ "x-forwarded-for": "a".repeat(5000) }));
  assert.equal(key.length, 64);
});
