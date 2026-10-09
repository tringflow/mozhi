import "server-only";
import { getSupabase, AUDIO_BUCKET, classifyStorageError, type StorageFailure } from "./supabase";
import { MAX_AUDIO_BYTES } from "./audio";
import { audioObjectName, verifyAudioPath } from "./upload-token";

/**
 * Storage operations on audio objects. The `audio` bucket is PRIVATE: the browser never reads
 * from it with the anon key. Uploads go through short-lived signed upload URLs minted here, and
 * playback goes through short-lived signed read URLs minted on each history read.
 */

/** Lifetime of a signed playback URL. Long enough to start and finish playing a 25 MB clip. */
export const AUDIO_READ_URL_TTL_SECONDS = 60 * 60;

type StorageErrorLike = { message?: string; statusCode?: string };

/**
 * Wraps a Supabase Storage failure so callers can tell it apart from, say, a Sarvam network
 * error. Without this, a generic "fetch failed" from either side looks identical and gets
 * reported to the user with the wrong cause.
 */
export class AudioStorageError extends Error {
  // Declared explicitly rather than as a constructor parameter property: Node's type stripping
  // (used by `npm test`) cannot transform those.
  readonly failure: StorageFailure;

  constructor(failure: StorageFailure) {
    super(failure.message);
    this.name = "AudioStorageError";
    this.failure = failure;
  }
}

function asStorageError(error: unknown): AudioStorageError {
  return new AudioStorageError(classifyStorageError((error ?? {}) as StorageErrorLike));
}

/** Mints a signed URL the browser can PUT the audio to directly, bypassing this server entirely. */
export async function createAudioUploadUrl(
  path: string
): Promise<{ uploadUrl: string } | { failure: StorageFailure }> {
  const { data, error } = await getSupabase()
    .storage.from(AUDIO_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    return { failure: classifyStorageError((error ?? {}) as StorageErrorLike) };
  }
  return { uploadUrl: data.signedUrl };
}

export type AudioObjectStat = { size: number; contentType: string | null };

/**
 * Reads the object's real size and type from storage. This is the authoritative size check:
 * the browser's number is a hint and the bucket's `file_size_limit` could be misconfigured,
 * so nothing is handed to Sarvam or saved to history until the stored bytes have been measured.
 * Returns null when the object does not exist.
 */
export async function statAudioObject(path: string): Promise<AudioObjectStat | null> {
  const name = audioObjectName(path);
  const prefix = path.slice(0, path.lastIndexOf("/"));

  const { data, error } = await getSupabase()
    .storage.from(AUDIO_BUCKET)
    .list(prefix, { search: name, limit: 100 });

  if (error) throw asStorageError(error);

  // `search` is a substring filter, so match the name exactly.
  const match = data?.find((entry) => entry.name === name);
  if (!match?.metadata) return null;

  return {
    size: Number(match.metadata.size ?? 0),
    contentType: typeof match.metadata.mimetype === "string" ? match.metadata.mimetype : null,
  };
}

export type AudioObjectCheck =
  | { ok: true; stat: AudioObjectStat }
  | { ok: false; status: number; error: string };

/** `statAudioObject` plus the size/emptiness rules, as an HTTP-shaped result. */
export async function checkAudioObject(path: string): Promise<AudioObjectCheck> {
  const stat = await statAudioObject(path);

  if (!stat) {
    return { ok: false, status: 404, error: "The uploaded audio could not be found. Please upload it again." };
  }
  if (stat.size <= 0) {
    return { ok: false, status: 400, error: "The audio file is empty." };
  }
  if (stat.size > MAX_AUDIO_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `File exceeds the ${MAX_AUDIO_BYTES / (1024 * 1024)}MB size limit.`,
    };
  }
  return { ok: true, stat };
}

export type AudioReference =
  | { ok: true; path: string; stat: AudioObjectStat }
  | { ok: false; status: number; error: string };

/**
 * The single entry point for a client-supplied audio reference: proves the path was minted by
 * this server and is unexpired, then measures the stored object. Every route that acts on an
 * uploaded file goes through here, so no route decides for itself what to trust.
 */
export async function resolveAudioReference(path: unknown, pathToken: unknown): Promise<AudioReference> {
  const failure = verifyAudioPath(path, pathToken);
  if (failure) {
    return failure === "expired"
      ? { ok: false, status: 410, error: "This upload has expired. Please upload the file again." }
      : { ok: false, status: 400, error: "Invalid audio reference." };
  }

  const verified = path as string;
  const check = await checkAudioObject(verified);
  if (!check.ok) return check;

  return { ok: true, path: verified, stat: check.stat };
}

/**
 * Pulls the object into this server. Server-to-server, so Vercel's 4.5 MB limit on request and
 * response bodies does not apply: it only caps what a browser sends to, or receives from, a
 * function. Returned as a Blob so the onward PUT to Sarvam carries a Content-Length.
 */
export async function downloadAudioObject(path: string): Promise<Blob> {
  const { data, error } = await getSupabase().storage.from(AUDIO_BUCKET).download(path);
  if (error || !data) {
    throw asStorageError(error);
  }
  return data;
}

/** A short-lived playback URL, or null if one could not be minted (the row then renders as "no audio"). */
export async function createAudioReadUrl(path: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .storage.from(AUDIO_BUCKET)
    .createSignedUrl(path, AUDIO_READ_URL_TTL_SECONDS);

  if (error || !data) {
    const failure = classifyStorageError((error ?? {}) as StorageErrorLike);
    console.warn(`[audio-storage] could not sign playback URL (${failure.code}):`, failure.message);
    return null;
  }
  return data.signedUrl;
}

/**
 * Signs many paths in one request, for list views. Returns a path -> URL map that omits any
 * path storage could not sign, so a single bad object does not fail the whole history page.
 */
export async function createAudioReadUrls(paths: string[]): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  if (paths.length === 0) return signed;

  const unique = [...new Set(paths)];
  const { data, error } = await getSupabase()
    .storage.from(AUDIO_BUCKET)
    .createSignedUrls(unique, AUDIO_READ_URL_TTL_SECONDS);

  if (error || !data) {
    const failure = classifyStorageError((error ?? {}) as StorageErrorLike);
    console.warn(`[audio-storage] could not sign playback URLs (${failure.code}):`, failure.message);
    return signed;
  }

  for (const entry of data) {
    if (entry.path && entry.signedUrl && !entry.error) signed.set(entry.path, entry.signedUrl);
  }
  return signed;
}

export async function removeAudioObject(path: string): Promise<void> {
  const { error } = await getSupabase().storage.from(AUDIO_BUCKET).remove([path]);
  if (error) {
    console.warn("[audio-storage] could not remove object:", error);
  }
}

/** Objects per delete request. Keeps the cleanup job's round-trips bounded. */
export const REMOVE_BATCH_SIZE = 100;

/**
 * Removes many objects in batches rather than one request each, so a cleanup backlog does not
 * spend its whole time budget on round-trips. Returns how many were removed; a failed batch is
 * logged and skipped, since the next run will reconsider those objects.
 */
export async function removeAudioObjects(paths: string[]): Promise<number> {
  const storage = getSupabase().storage.from(AUDIO_BUCKET);
  let removed = 0;

  for (let i = 0; i < paths.length; i += REMOVE_BATCH_SIZE) {
    const batch = paths.slice(i, i + REMOVE_BATCH_SIZE);
    const { error } = await storage.remove(batch);
    if (error) {
      const failure = classifyStorageError(error as StorageErrorLike);
      console.warn(`[audio-storage] batch delete failed (${failure.code}); skipping:`, failure.message);
      continue;
    }
    removed += batch.length;
  }

  return removed;
}

/**
 * Recovers the object path from a public URL stored by an earlier version of Mozhi, so history
 * rows written while the bucket was public keep working (and keep being deletable) now that it
 * is private and rows carry `audio_path` instead.
 */
export function legacyAudioPath(audioUrl: string | null | undefined): string | null {
  if (!audioUrl) return null;

  // Covers every Supabase object URL shape: /object/public/audio/…, /object/sign/audio/… and
  // the plain authenticated /object/audio/…. Anchoring on `/object/` means a bucket name that
  // merely appears inside a filename is not mistaken for the marker.
  const match = audioUrl.match(
    new RegExp(`/object/(?:public/|sign/)?${AUDIO_BUCKET}/(.+)$`)
  );
  const path = match?.[1]?.split("?")[0];
  return path ? decodeURIComponent(path) : null;
}
