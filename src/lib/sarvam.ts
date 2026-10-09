import "server-only";
import type { LanguageConfig } from "./languages";

const SARVAM_TIMEOUT_MS = 60_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const TRANSLATE_CHUNK_CHARS = 1800;

function apiKey(): string {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error("SARVAM_API_KEY is not configured on the server.");
  return key;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** fetch with a timeout, and optional retries (transient HTTP statuses and network errors) with backoff. */
async function sarvamFetch(url: string, init: RequestInit, retries = 0): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(SARVAM_TIMEOUT_MS) });
      if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      return response;
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(500 * 2 ** attempt);
    }
  }
}

/**
 * Synchronous speech-to-text. Sarvam caps this endpoint at 30 seconds of audio and one file per
 * request; longer clips must go through the batch helpers below.
 */
export async function transcribeAudio(audio: Blob, filename: string, lang: LanguageConfig) {
  const formData = new FormData();

  formData.append("file", audio, filename);
  formData.append("model", lang.transcription.model);
  formData.append("language_code", lang.code);
  formData.append("mode", lang.transcription.mode);

  const response = await sarvamFetch(
    "https://api.sarvam.ai/speech-to-text",
    {
      method: "POST",
      headers: {
        "api-subscription-key": apiKey(),
      },
      body: formData,
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Sarvam STT failed: ${error}`);
  }

  return response.json();
}

export async function translateToEnglish(text: string, lang: LanguageConfig) {
  const response = await sarvamFetch("https://api.sarvam.ai/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": apiKey(),
    },
    body: JSON.stringify({
      input: text,
      source_language_code: lang.code,
      target_language_code: lang.translation.targetCode,
      model: lang.translation.model,
    }),
  }, 2);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Sarvam Translation failed: ${error}`);
  }

  const result = await response.json();
  if (typeof result.translated_text !== "string") {
    throw new Error("Sarvam Translation returned an unexpected response.");
  }
  return result.translated_text;
}

/** Splits text into pieces of at most `max` chars, preferring sentence ends, then spaces. Order is preserved. */
function splitForTranslation(text: string, max: number): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?\n]*|\n+/g) || [text];
  const units: string[] = [];

  for (const sentence of sentences) {
    let rest = sentence;
    // A single "sentence" can exceed the limit (e.g. no punctuation); cut it at a space, or hard-cut.
    while (rest.length > max) {
      let cut = rest.lastIndexOf(" ", max);
      if (cut <= 0) cut = max;
      units.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    units.push(rest);
  }

  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    if ((current + unit).length > max) {
      if (current.trim()) chunks.push(current.trim());
      current = unit;
    } else {
      current += unit;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export async function translateLongText(text: string, lang: LanguageConfig): Promise<string> {
  if (text.length <= TRANSLATE_CHUNK_CHARS) {
    return translateToEnglish(text, lang);
  }

  const chunks = splitForTranslation(text, TRANSLATE_CHUNK_CHARS);

  // Sequential on purpose: keeps output order and respects rate limits.
  const translatedChunks: string[] = [];
  for (const chunk of chunks) {
    translatedChunks.push(await translateToEnglish(chunk, lang));
    await sleep(150);
  }

  return translatedChunks.join(" ");
}

/** True when a sync STT failure is Sarvam refusing the clip for being longer than 30 seconds. */
export function isDurationLimitError(message: string): boolean {
  return message.includes("limit of 30 seconds") || message.toLowerCase().includes("duration");
}

// ---------------------------------------------------------------------------------------------
// Sarvam Batch / Asynchronous Speech-to-Text API Helpers
//
// The batch API accepts audio ONLY as bytes PUT to a pre-signed URL that Sarvam issues
// (`/job/v1/upload-files`). It has no parameter for an externally hosted audio URL, so a
// Supabase Storage link - public or signed - cannot be handed to it. Mozhi therefore relays:
// Supabase Storage -> this server -> Sarvam's pre-signed URL. Both legs are server-to-server,
// so neither is subject to a serverless request-body limit.
//
// Documented limits: 2 hours of audio per file, up to 20 files per job.
// ---------------------------------------------------------------------------------------------

/** Generous: this leg moves the whole file (up to 25 MB) to Sarvam's object store. */
const SARVAM_UPLOAD_TIMEOUT_MS = 180_000;

export async function initiateSTTJob(lang: LanguageConfig) {
  const response = await sarvamFetch("https://api.sarvam.ai/speech-to-text/job/v1", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": apiKey(),
    },
    body: JSON.stringify({
      job_parameters: {
        model: lang.transcription.model,
        mode: lang.transcription.mode,
        language_code: lang.code,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to initiate async job: ${errorText}`);
  }

  return response.json(); // returns { job_id: "uuid" }
}

export async function getSTTUploadUrl(jobId: string, filename: string) {
  const response = await sarvamFetch("https://api.sarvam.ai/speech-to-text/job/v1/upload-files", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": apiKey(),
    },
    body: JSON.stringify({
      job_id: jobId,
      files: [filename],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to retrieve upload pre-signed URL: ${errorText}`);
  }

  return response.json(); // returns { upload_urls: { "filename": "presigned-put-url" } }
}

/** The API has returned both a bare string and a `{ file_url }` object for these entries. */
type SignedEntry = string | { file_url?: string } | undefined | null;

export function resolveSignedEntry(entry: SignedEntry): string | null {
  if (typeof entry === "string") return entry || null;
  if (entry && typeof entry === "object") return entry.file_url || null;
  return null;
}

/**
 * Streams the audio to Sarvam's pre-signed URL. `x-ms-blob-type` is required because the URL
 * points at Azure Blob Storage. A Blob body gives fetch a Content-Length, which the store needs.
 */
export async function uploadToSTTJob(uploadUrl: string, audio: Blob, contentType: string) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-ms-blob-type": "BlockBlob",
    },
    body: audio,
    signal: AbortSignal.timeout(SARVAM_UPLOAD_TIMEOUT_MS),
  });

  if (!response.ok) {
    // Don't echo the body: it can contain the signed URL.
    throw new Error(`Failed to upload audio to Sarvam batch storage (HTTP ${response.status}).`);
  }
}

export async function startSTTJob(jobId: string) {
  const response = await sarvamFetch(`https://api.sarvam.ai/speech-to-text/job/v1/${jobId}/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": apiKey(),
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to start async job: ${errorText}`);
  }

  return response.json();
}

export async function getSTTJobStatus(jobId: string) {
  const response = await sarvamFetch(`https://api.sarvam.ai/speech-to-text/job/v1/${jobId}/status`, {
    method: "GET",
    headers: {
      "api-subscription-key": apiKey(),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to check job status: ${errorText}`);
  }

  return response.json(); // returns { job_state: "Completed", job_details: [...] }
}

export async function getSTTDownloadUrl(jobId: string, outputFilename: string) {
  const response = await sarvamFetch("https://api.sarvam.ai/speech-to-text/job/v1/download-files", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": apiKey(),
    },
    body: JSON.stringify({
      job_id: jobId,
      files: [outputFilename],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch download URLs: ${errorText}`);
  }

  return response.json(); // returns { download_urls: { "0.json": "presigned-get-url" } }
}