// Audio upload limits shared by the browser (early feedback) and the API routes (enforcement).
// Safe to import from client and server code.

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const ALLOWED_AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "webm"] as const;

export function getAudioExtension(filename: string): string | undefined {
  return filename.split(".").pop()?.toLowerCase();
}

/** Returns a user-facing error message, or null if the file is acceptable. */
export function validateAudioFile(file: { name: string; size: number }): string | null {
  if (file.size === 0) return "The audio file is empty.";
  if (file.size > MAX_AUDIO_BYTES) {
    return `File exceeds the ${MAX_AUDIO_BYTES / (1024 * 1024)}MB size limit.`;
  }
  const ext = getAudioExtension(file.name);
  if (!ext || !(ALLOWED_AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
    return "Unsupported format. Please upload MP3, WAV, M4A, or WEBM.";
  }
  return null;
}
