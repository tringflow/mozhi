import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class SupabaseConfigError extends Error {}

/**
 * Storage bucket for original audio. Must be provisioned in Supabase beforehand (see
 * supabase/storage-and-rls.sql); the app never creates it. The bucket is PRIVATE: the browser
 * only ever touches it through signed URLs minted server-side.
 */
export const AUDIO_BUCKET = "audio";

let client: SupabaseClient | null = null;

/**
 * Lazily creates the Supabase client (server-side only) and validates the env first, so a missing
 * or malformed variable produces a clear error instead of a vague network failure.
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY when set (server-only, bypasses RLS, never sent to the browser),
 * otherwise falls back to the public anon key, which is then subject to RLS policies.
 */
export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "NEXT_PUBLIC_SUPABASE_ANON_KEY"]
      .filter(Boolean)
      .join(", ");
    throw new SupabaseConfigError(`Missing environment variable(s): ${missing}`);
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("bad protocol");
  } catch {
    throw new SupabaseConfigError("NEXT_PUBLIC_SUPABASE_URL is not a valid URL");
  }

  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export type ApiFailure = {
  /** Machine-readable category, safe to show the browser. */
  code: "config" | "unreachable" | "schema" | "permission" | "unknown";
  status: number;
  /** Safe, user-facing message. Never includes keys or raw internals. */
  message: string;
};

interface SupabaseLikeError {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

/**
 * Maps a thrown error or a PostgREST error to a safe response. The caller should
 * log the original error server-side; only the returned `message` goes to the browser.
 */
export function classifySupabaseError(err: unknown): ApiFailure {
  if (err instanceof SupabaseConfigError) {
    return { code: "config", status: 500, message: "Server is not configured for database access. Check the Supabase environment variables." };
  }

  const e = (err ?? {}) as SupabaseLikeError;
  const text = `${e.message ?? ""} ${e.details ?? ""}`;

  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(text)) {
    return { code: "unreachable", status: 503, message: "Could not reach the database. Check NEXT_PUBLIC_SUPABASE_URL and that the Supabase project is active." };
  }
  // 42703 undefined column, 42P01 undefined table, PGRST204/PGRST205 = not in PostgREST schema cache
  if (e.code && ["42703", "42P01", "PGRST204", "PGRST205"].includes(e.code)) {
    return { code: "schema", status: 500, message: "Database schema is out of date. Apply the latest migration in supabase/migrations." };
  }
  // 42501 insufficient privilege / RLS violation; PGRST301/PGRST303 = JWT/auth problems
  if (e.code === "42501" || /row-level security|permission denied|invalid api key|jwt/i.test(text)) {
    return { code: "permission", status: 403, message: "The database rejected the request (permissions / row-level security / API key)." };
  }
  return { code: "unknown", status: 500, message: "Unexpected database error." };
}

export type StorageFailure = {
  code: "bucket_missing" | "permission" | "too_large" | "bad_type" | "unreachable" | "unknown";
  /** Actionable message for the server log. */
  message: string;
};

/** Classifies a Supabase Storage error (these have `message` and a string `statusCode`, not Postgres codes). */
export function classifyStorageError(err: { message?: string; statusCode?: string }): StorageFailure {
  const text = err.message ?? "";
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(text)) {
    return { code: "unreachable", message: "Could not reach Supabase Storage." };
  }
  if (/bucket not found/i.test(text) || err.statusCode === "404") {
    return {
      code: "bucket_missing",
      message: `Supabase Storage bucket "${AUDIO_BUCKET}" does not exist. Create it in Supabase Storage before uploading files.`,
    };
  }
  if (/exceeded the maximum allowed size|payload too large/i.test(text) || err.statusCode === "413") {
    return {
      code: "too_large",
      message: `Storage rejected the object as too large. Raise file_size_limit on the "${AUDIO_BUCKET}" bucket to at least 25 MB.`,
    };
  }
  if (/mime type|invalid_mime_type/i.test(text) || err.statusCode === "415") {
    return {
      code: "bad_type",
      message: `Storage rejected the object's content type. Check allowed_mime_types on the "${AUDIO_BUCKET}" bucket.`,
    };
  }
  if (/row-level security|unauthorized|not allowed|permission|jwt|invalid api key/i.test(text) || err.statusCode === "403" || err.statusCode === "401") {
    return {
      code: "permission",
      message: `Storage rejected the request for "${AUDIO_BUCKET}". Set SUPABASE_SERVICE_ROLE_KEY so the server can mint signed upload URLs, or add the matching policies on storage.objects.`,
    };
  }
  return { code: "unknown", message: "Unexpected storage error." };
}
