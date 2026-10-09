import type { LanguageId } from "../lib/languages";

export interface Translation {
  id: string;
  /**
   * A short-lived signed playback URL minted per read, or null when no audio is stored.
   * Not durable: re-fetch the record rather than persisting this value.
   */
  audio_url: string | null;
  /** Path of the object in the private `audio` bucket. Null when the audio was not kept. */
  audio_path?: string | null;
  audio_filename: string;
  audio_duration: number;
  /** Source-language transcript (legacy column name; may be Tamil or Telugu). */
  tamil_text: string;
  /** Null/undefined on records saved before multilingual support (treated as Tamil). */
  language?: LanguageId | null;
  english_text: string;
  status: string;
  created_at: string;
}

/**
 * A verified handle on an uploaded object. `path` names the object and `pathToken` is the
 * server's signature over it; both must be quoted back for the server to act on the upload.
 */
export interface AudioReference {
  path: string;
  pathToken: string;
}

export interface UploadTicket extends AudioReference {
  uploadUrl: string;
  /** The exact Content-Type the PUT must carry; the bucket only accepts these. */
  contentType: string;
  maxBytes: number;
}

export interface TranscribeResult {
  success: boolean;
  isAsync: boolean;
  jobId?: string;
  filename?: string;
  transcription?: string;
}

export interface BatchStatusResult {
  status: "processing" | "completed" | "failed";
  transcription?: string;
  translation?: string;
  error?: string;
}

async function failure(response: Response, fallback: string): Promise<Error> {
  const data = await response.json().catch(() => ({}));
  return new Error(data.error || fallback);
}

async function postJson<T>(url: string, body: unknown, fallback: string): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await failure(response, fallback);
  return response.json();
}

export const mozhiService = {
  /**
   * Step 1 of an upload: asks the server for a signed URL pointing at an object path it
   * controls. No audio is sent here, only its name and size.
   */
  async createUpload(file: File): Promise<UploadTicket> {
    return postJson<UploadTicket>(
      "/api/uploads",
      { filename: file.name, size: file.size },
      "Could not prepare the upload"
    );
  },

  /**
   * Step 2: PUTs the audio straight to Supabase Storage, so the bytes never pass through the
   * Next.js server and are not subject to Vercel's 4.5 MB request-body limit.
   *
   * Uses XMLHttpRequest rather than fetch because only XHR reports upload progress.
   * Returns a cancel function alongside the promise so navigating away can abort the transfer.
   */
  uploadAudio(
    ticket: UploadTicket,
    file: File,
    onProgress?: (fraction: number) => void
  ): { promise: Promise<void>; cancel: () => void } {
    const request = new XMLHttpRequest();

    const promise = new Promise<void>((resolve, reject) => {
      request.open("PUT", ticket.uploadUrl, true);
      // Must match what the server minted: the bucket's allowed_mime_types is strict.
      request.setRequestHeader("Content-Type", ticket.contentType);
      request.setRequestHeader("Cache-Control", "max-age=3600");

      request.upload.onprogress = (event) => {
        if (onProgress && event.lengthComputable && event.total > 0) {
          onProgress(event.loaded / event.total);
        }
      };

      request.onload = () => {
        if (request.status >= 200 && request.status < 300) {
          onProgress?.(1);
          resolve();
          return;
        }
        // Storage enforces the bucket's size limit itself, so surface that case plainly.
        if (request.status === 413) {
          reject(new Error("Supabase Storage rejected the file as too large."));
          return;
        }
        reject(new Error(`Upload failed (HTTP ${request.status}). Please try again.`));
      };
      request.onerror = () => reject(new Error("Upload failed: the network request did not complete."));
      request.onabort = () => reject(new Error("Upload cancelled."));
      request.ontimeout = () => reject(new Error("Upload timed out. Please try again."));

      request.send(file);
    });

    return { promise, cancel: () => request.abort() };
  },

  /**
   * Step 3: transcribe an object that is already in Storage. `durationSeconds` is a hint that
   * lets the server skip Sarvam's 30-second synchronous endpoint for longer clips.
   */
  async transcribeAudio(
    reference: AudioReference,
    language: LanguageId,
    durationSeconds?: number
  ): Promise<TranscribeResult> {
    return postJson<TranscribeResult>(
      "/api/transcribe",
      { ...reference, language, durationSeconds },
      "Failed to transcribe audio"
    );
  },

  async checkBatchStatus(jobId: string, filename: string, language: LanguageId): Promise<BatchStatusResult> {
    const response = await fetch(
      `/api/transcribe/status?jobId=${encodeURIComponent(jobId)}&filename=${encodeURIComponent(filename)}&language=${language}`
    );

    if (!response.ok) throw await failure(response, "Failed to retrieve job status");

    return response.json();
  },

  async translateText(text: string, language: LanguageId): Promise<string> {
    const data = await postJson<{ englishText: string }>(
      "/api/translate",
      { text, language },
      "Failed to translate text"
    );
    return data.englishText;
  },

  /** Attaches the already-uploaded object to a history row. Pass `null` to save without audio. */
  async saveTranslation(
    reference: AudioReference | null,
    language: LanguageId,
    sourceText: string,
    englishText: string,
    duration: number,
    filename: string
  ): Promise<Translation> {
    return postJson<Translation>(
      "/api/translations",
      { ...(reference ?? {}), language, sourceText, englishText, duration, filename },
      "Failed to save translation"
    );
  },

  async getHistory(search?: string): Promise<Translation[]> {
    const url = search
      ? `/api/translations?search=${encodeURIComponent(search)}`
      : "/api/translations";

    const response = await fetch(url);
    if (!response.ok) throw await failure(response, "Failed to fetch history");

    return response.json();
  },

  async getTranslation(id: string): Promise<Translation> {
    const response = await fetch(`/api/translations/${id}`);
    if (!response.ok) throw await failure(response, "Failed to fetch translation details");

    return response.json();
  },

  async deleteTranslation(id: string): Promise<void> {
    const response = await fetch(`/api/translations/${id}`, { method: "DELETE" });
    if (!response.ok) throw await failure(response, "Failed to delete translation");
  },
};
