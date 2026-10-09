// Audio upload limits shared by the browser (early feedback) and the server (enforcement).
// Safe to import from client and server code: no secrets, no server-only imports.

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const ALLOWED_AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "webm"] as const;

export type AudioExtension = (typeof ALLOWED_AUDIO_EXTENSIONS)[number];

/**
 * The content type the browser must send when PUTting to the signed upload URL, keyed by
 * extension. The server dictates this value (see /api/uploads) rather than trusting
 * `File.type`, which varies by browser and OS ("audio/mp3", "audio/x-m4a", ""), so the
 * `audio` bucket's `allowed_mime_types` can be locked to exactly these four.
 */
export const AUDIO_CONTENT_TYPES: Record<AudioExtension, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  webm: "audio/webm",
};

/**
 * Sarvam's synchronous /speech-to-text endpoint accepts at most 30 seconds of audio; longer
 * clips must go through the batch (job) API. Anything above this size is almost certainly
 * over 30 s (30 s of 320 kbps MP3 is ~1.2 MB), so we skip the doomed sync attempt and hand
 * straight to the batch pipeline instead of uploading the whole file just to be rejected.
 */
export const SYNC_STT_MAX_BYTES = 1_200_000;
export const SYNC_STT_MAX_SECONDS = 30;

export function getAudioExtension(filename: string): string | undefined {
  return filename.split(".").pop()?.toLowerCase();
}

export function isAllowedAudioExtension(ext: string | undefined): ext is AudioExtension {
  return !!ext && (ALLOWED_AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

const MAX_MB = MAX_AUDIO_BYTES / (1024 * 1024);

/** Returns a user-facing error message, or null if the file is acceptable. */
export function validateAudioFile(file: { name: string; size: number }): string | null {
  if (!Number.isFinite(file.size) || file.size <= 0) return "The audio file is empty.";
  if (file.size > MAX_AUDIO_BYTES) {
    return `File exceeds the ${MAX_MB}MB size limit.`;
  }
  if (!isAllowedAudioExtension(getAudioExtension(file.name))) {
    return "Unsupported format. Please upload MP3, WAV, M4A, or WEBM.";
  }
  return null;
}

/** True when a validation message from `validateAudioFile` is about size, so callers can answer 413. */
export function isSizeError(message: string): boolean {
  return message.includes("size limit");
}
