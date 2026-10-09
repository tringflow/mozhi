import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  ALLOWED_AUDIO_EXTENSIONS,
  isAllowedAudioExtension,
  type AudioExtension,
} from "./audio";

/**
 * Object paths in the `audio` bucket are minted by the server and handed to the browser along
 * with a signed upload URL. The browser later quotes the path back (to transcribe it, then to
 * save it to history), so the path alone cannot be trusted: a client could otherwise name ANY
 * object in the bucket and have the server transcribe it or attach it to a history row.
 *
 * Each path therefore travels with an HMAC over `path` + expiry. The server re-derives the MAC
 * before touching storage, so the only paths it will act on are ones it minted itself and that
 * are still within their window. Structural validation (`AUDIO_PATH_PATTERN`) is kept as a
 * second, independent check so a path can never contain traversal segments or escape `uploads/`.
 */

/** `uploads/<uuid>.<ext>` and nothing else: no traversal, no nesting, no client-chosen names. */
export const AUDIO_PATH_PATTERN = new RegExp(
  `^uploads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(${ALLOWED_AUDIO_EXTENSIONS.join("|")})$`
);

/**
 * How long a minted path stays usable. Covers the whole pipeline (direct upload, then batch
 * transcription, then the save to history) and matches the 2-hour life of a Supabase signed
 * upload URL, so the token never outlives the URL it was issued with.
 */
export const PATH_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export class UploadConfigError extends Error {}

/**
 * Secret for the path MAC. Falls back to the service-role key, which this flow already requires
 * for `createSignedUploadUrl`, so the common setup needs no extra variable. The anon key is
 * deliberately NOT a fallback: it ships to the browser, so signatures made with it would be
 * forgeable. Deployments running without a service-role key must set UPLOAD_SIGNING_SECRET.
 */
function signingSecret(): string {
  const secret = process.env.UPLOAD_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new UploadConfigError(
      "Direct audio uploads need a server-side signing secret. Set SUPABASE_SERVICE_ROLE_KEY (recommended) or UPLOAD_SIGNING_SECRET."
    );
  }
  return secret;
}

function mac(path: string, expiresAt: number): string {
  return createHmac("sha256", signingSecret())
    .update(`${path}\n${expiresAt}`)
    .digest("base64url");
}

/** Allocates a fresh, server-controlled object path plus the token that authorises its reuse. */
export function mintAudioObject(ext: AudioExtension): { path: string; pathToken: string } {
  const path = `uploads/${randomUUID()}.${ext}`;
  return { path, pathToken: signAudioPath(path) };
}

export function signAudioPath(path: string, now = Date.now()): string {
  const expiresAt = now + PATH_TOKEN_TTL_MS;
  return `${expiresAt}.${mac(path, expiresAt)}`;
}

export type PathTokenFailure = "malformed" | "expired" | "bad_signature";

/**
 * Verifies that `path` was minted by this server and has not expired.
 * Returns null when the pair is good, or the reason it was rejected.
 */
export function verifyAudioPath(path: unknown, token: unknown): PathTokenFailure | null {
  if (typeof path !== "string" || typeof token !== "string") return "malformed";
  if (!AUDIO_PATH_PATTERN.test(path)) return "malformed";

  const separator = token.indexOf(".");
  if (separator <= 0) return "malformed";

  const expiresAt = Number(token.slice(0, separator));
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) return "malformed";

  const expected = Buffer.from(mac(path, expiresAt));
  const received = Buffer.from(token.slice(separator + 1));
  // Compare before the expiry check so an expired-but-unsigned token is still reported as forged.
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return "bad_signature";
  }
  if (Date.now() > expiresAt) return "expired";
  return null;
}

/** The object's basename (`<uuid>.<ext>`), used as the filename handed to Sarvam's batch job. */
export function audioObjectName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Matches the basenames produced by `mintAudioObject`, for validating the batch job filename. */
export function isAudioObjectName(value: unknown): value is string {
  return typeof value === "string" && AUDIO_PATH_PATTERN.test(`uploads/${value}`);
}

/** Resolves a client-supplied extension to one we accept, for the minting endpoint. */
export function resolveAudioExtension(filename: unknown): AudioExtension | null {
  if (typeof filename !== "string") return null;
  const ext = filename.split(".").pop()?.toLowerCase();
  return isAllowedAudioExtension(ext) ? ext : null;
}
