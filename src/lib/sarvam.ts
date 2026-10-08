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

export async function transcribeAudio(audio: File, lang: LanguageConfig) {
  const formData = new FormData();

  formData.append("file", audio);
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

// Sarvam Batch/Asynchronous Speech-to-Text API Helpers

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