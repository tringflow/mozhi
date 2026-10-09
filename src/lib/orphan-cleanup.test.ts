import { test } from "node:test";
import assert from "node:assert/strict";

process.env.UPLOAD_SIGNING_SECRET = "test-secret-not-a-real-key";

import {
  DEFAULT_GRACE_MS,
  MIN_GRACE_MS,
  resolveGraceMs,
  selectOrphans,
  type StorageObject,
} from "./orphan-cleanup.ts";
import { PATH_TOKEN_TTL_MS } from "./upload-token.ts";

const UUID_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const UUID_B = "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d";

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const CUTOFF = new Date(NOW - DEFAULT_GRACE_MS);
const OLD = new Date(NOW - 48 * 60 * 60 * 1000).toISOString();
const RECENT = new Date(NOW - 60 * 1000).toISOString();

function object(name: string, created_at: string | null): StorageObject {
  return { name, created_at };
}

test("an old, unreferenced upload is deleted", () => {
  const { deletable, kept } = selectOrphans([object(`${UUID_A}.mp3`, OLD)], new Set(), CUTOFF);
  assert.deepEqual(deletable, [`uploads/${UUID_A}.mp3`]);
  assert.equal(kept.length, 0);
});

test("a file referenced by a history row is never deleted, however old", () => {
  const path = `uploads/${UUID_A}.mp3`;
  const ancient = new Date(NOW - 365 * 24 * 60 * 60 * 1000).toISOString();

  const { deletable, kept } = selectOrphans([object(`${UUID_A}.mp3`, ancient)], new Set([path]), CUTOFF);
  assert.deepEqual(deletable, []);
  assert.match(kept[0].reason, /referenced by a history row/);
});

test("a file inside the grace period is never deleted", () => {
  // Covers active processing and a valid retry: both happen within minutes, and the path token
  // they depend on expires long before the grace period ends.
  const { deletable, kept } = selectOrphans([object(`${UUID_A}.webm`, RECENT)], new Set(), CUTOFF);
  assert.deepEqual(deletable, []);
  assert.match(kept[0].reason, /within the grace period/);
});

test("a file exactly at the cutoff is kept, not deleted", () => {
  const atCutoff = new Date(CUTOFF.getTime()).toISOString();
  const { deletable } = selectOrphans([object(`${UUID_A}.mp3`, atCutoff)], new Set(), CUTOFF);
  assert.deepEqual(deletable, [], "the boundary must be exclusive");
});

test("a file with no usable timestamp is kept rather than assumed old", () => {
  for (const created of [null, "", "not-a-date"]) {
    const { deletable, kept } = selectOrphans([object(`${UUID_A}.mp3`, created)], new Set(), CUTOFF);
    assert.deepEqual(deletable, [], `should keep when created_at is ${JSON.stringify(created)}`);
    assert.match(kept[0].reason, /no usable creation timestamp/);
  }
});

test("objects this app never minted are out of scope entirely", () => {
  // Legacy rows stored audio at the bucket root, and anything hand-uploaded is not ours to
  // delete. Both are excluded by the path pattern before age is even considered.
  const foreign = [
    object("not-a-uuid.mp3", OLD),
    object(`${UUID_A}.exe`, OLD),
    object(`${UUID_A}/nested.mp3`, OLD),
    object("../escape.mp3", OLD),
    object("keep-me.wav", OLD),
  ];

  const { deletable, kept } = selectOrphans(foreign, new Set(), CUTOFF);
  assert.deepEqual(deletable, []);
  assert.equal(kept.length, foreign.length);
  for (const entry of kept) {
    assert.match(entry.reason, /not a minted upload path/);
  }
});

test("a mixed listing deletes only what every rule clears", () => {
  const referenced = new Set([`uploads/${UUID_B}.mp3`]);
  const { deletable } = selectOrphans(
    [
      object(`${UUID_A}.mp3`, OLD), // old + unreferenced -> delete
      object(`${UUID_B}.mp3`, OLD), // old but saved      -> keep
      object(`${UUID_A}.wav`, RECENT), // too new         -> keep
      object("stray.txt", OLD), // not ours               -> keep
    ],
    referenced,
    CUTOFF
  );
  assert.deepEqual(deletable, [`uploads/${UUID_A}.mp3`]);
});

test("an empty listing is handled without error", () => {
  assert.deepEqual(selectOrphans([], new Set(), CUTOFF), { deletable: [], kept: [] });
});

// --- grace period configuration ---

test("the grace period defaults to 24 hours", () => {
  assert.equal(resolveGraceMs(undefined), DEFAULT_GRACE_MS);
  assert.equal(DEFAULT_GRACE_MS, 24 * 60 * 60 * 1000);
});

test("the grace period can never be configured below the safe floor", () => {
  // The floor is what guarantees a live upload is never collected: an object is only reachable
  // while its path token lives, so the floor must exceed that lifetime.
  assert.ok(MIN_GRACE_MS > PATH_TOKEN_TTL_MS);
  for (const raw of ["0", "-5", "1", "0.5", "abc", ""]) {
    assert.ok(
      resolveGraceMs(raw) >= MIN_GRACE_MS,
      `ORPHAN_GRACE_HOURS=${JSON.stringify(raw)} must not drop below the floor`
    );
  }
});

test("a larger configured grace period is honoured", () => {
  assert.equal(resolveGraceMs("72"), 72 * 60 * 60 * 1000);
});
