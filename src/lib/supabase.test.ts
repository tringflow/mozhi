import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { classifySupabaseError, SupabaseConfigError } from "./supabase.ts";

/**
 * These are the failures that actually surface when saving to history, which is the only step
 * that writes to `translations`. Each must produce a message that names the fix, because the
 * message is now what the user sees in the UI.
 */

test("a missing column is reported as an out-of-date schema, not an unknown error", () => {
  // What PostgREST answers when `audio_path` has not been migrated yet.
  const failure = classifySupabaseError({
    code: "PGRST204",
    message: "Could not find the 'audio_path' column of 'translations' in the schema cache",
  });

  assert.equal(failure.code, "schema");
  assert.match(failure.message, /migration/i);
});

test("a not-null violation names the offending column", () => {
  // What Postgres answers when `audio_url` is still NOT NULL and the app writes no value.
  const failure = classifySupabaseError({
    code: "23502",
    message:
      'null value in column "audio_url" of relation "translations" violates not-null constraint',
  });

  assert.equal(failure.code, "constraint");
  assert.match(failure.message, /audio_url/, "the column name is the actionable part");
  assert.match(failure.message, /migration/i);
  assert.notEqual(failure.message, "Unexpected database error.");
});

test("a not-null violation without a parseable column still gives an actionable message", () => {
  const failure = classifySupabaseError({ code: "23502", message: "not-null constraint" });
  assert.equal(failure.code, "constraint");
  assert.match(failure.message, /migration/i);
});

test("other constraint violations are reported as such", () => {
  for (const code of ["23503", "23505", "23514"]) {
    const failure = classifySupabaseError({ code, message: "violates constraint" });
    assert.equal(failure.code, "constraint", `${code} should classify as a constraint failure`);
  }
});

test("an RLS rejection is distinguished from schema drift", () => {
  const failure = classifySupabaseError({
    code: "42501",
    message: "new row violates row-level security policy for table \"translations\"",
  });
  assert.equal(failure.code, "permission");
  assert.equal(failure.status, 403);
});

test("an undefined column or table is schema drift", () => {
  assert.equal(classifySupabaseError({ code: "42703", message: "column does not exist" }).code, "schema");
  assert.equal(classifySupabaseError({ code: "42P01", message: "relation does not exist" }).code, "schema");
  assert.equal(classifySupabaseError({ code: "PGRST205", message: "not in schema cache" }).code, "schema");
});

test("a network failure is reported as unreachable, not as a schema problem", () => {
  const failure = classifySupabaseError(new TypeError("fetch failed"));
  assert.equal(failure.code, "unreachable");
  assert.equal(failure.status, 503);
});

test("a missing environment variable is a configuration failure", () => {
  const failure = classifySupabaseError(new SupabaseConfigError("Missing environment variable(s)"));
  assert.equal(failure.code, "config");
  assert.equal(failure.status, 500);
});

test("no classified message leaks a key or connection string", () => {
  const secretish = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.super-secret-service-role-key";
  const failure = classifySupabaseError({
    code: "08006",
    message: `connection failure using apikey=${secretish}`,
    details: secretish,
  });

  assert.ok(!failure.message.includes(secretish), "the raw error must stay in the server log only");
});

test("an unrecognised error still yields a safe generic message", () => {
  const failure = classifySupabaseError({ code: "XX000", message: "internal error" });
  assert.equal(failure.code, "unknown");
  assert.equal(failure.status, 500);
});

// --- the write contract for `translations` ---

const TRANSLATIONS_ROUTE = readFileSync(
  join(import.meta.dirname, "..", "app", "api", "translations", "route.ts"),
  "utf8"
);

test("the insert does not write audio_url", () => {
  // Writing `audio_url: null` broke saving on any table where that column is still NOT NULL.
  // Omitting the key lets a column default apply instead. The bucket is private, so there is
  // no durable URL to store in the first place - playback URLs are signed from audio_path.
  const insertBlock = /\.insert\(([\s\S]*?)\)\s*\n\s*\.select\(\)/.exec(TRANSLATIONS_ROUTE);
  const rowLiteral = /const row = \{([\s\S]*?)\n    \};/.exec(TRANSLATIONS_ROUTE);

  assert.ok(rowLiteral, "expected the inserted row to be a named literal");
  assert.ok(
    !/\baudio_url\b/.test(rowLiteral[1]),
    "audio_url must not appear in the inserted row"
  );
  assert.ok(insertBlock, "expected an .insert(...).select() call");
});

test("the insert still writes every column history depends on", () => {
  const rowLiteral = /const row = \{([\s\S]*?)\n    \};/.exec(TRANSLATIONS_ROUTE);
  assert.ok(rowLiteral);

  // language carries Tamil/Telugu; tamil_text holds the source transcript whichever it is.
  for (const column of [
    "audio_path",
    "audio_filename",
    "audio_duration",
    "tamil_text",
    "language",
    "english_text",
    "status",
  ]) {
    assert.match(rowLiteral[1], new RegExp(`\\b${column}\\b`), `${column} must still be written`);
  }
});

test("the insert failure path logs the Postgres diagnostics", () => {
  // Without code/details/hint in the log there is no way to tell schema drift from an RLS
  // rejection on a deployment you cannot query directly.
  const logBlock = /insert failed:[\s\S]{0,400}/.exec(TRANSLATIONS_ROUTE);
  assert.ok(logBlock, "expected an insert-failure log");
  for (const field of ["code", "details", "hint", "columns"]) {
    assert.match(logBlock[0], new RegExp(`\\b${field}\\b`), `log should include ${field}`);
  }
});
