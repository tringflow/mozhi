const SARVAM_API_KEY = process.env.SARVAM_API_KEY!;

export async function transcribeTamil(audio: File) {
  const formData = new FormData();

  formData.append("file", audio);
  formData.append("model", "saaras:v3");
  formData.append("language_code", "ta-IN");
  formData.append("mode", "transcribe");

  const response = await fetch(
    "https://api.sarvam.ai/speech-to-text",
    {
      method: "POST",
      headers: {
        "api-subscription-key": SARVAM_API_KEY,
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

export async function translateTamil(text: string) {
  const response = await fetch("https://api.sarvam.ai/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": SARVAM_API_KEY,
    },
    body: JSON.stringify({
      input: text,
      source_language_code: "ta-IN",
      target_language_code: "en-IN",
      model: "sarvam-translate:v1",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Sarvam Translation failed: ${error}`);
  }

  const result = await response.json();
  return result.translated_text;
}

export async function translateTamilLongText(text: string): Promise<string> {
  if (text.length <= 1800) {
    return translateTamil(text);
  }

  console.log(`Text length (${text.length}) exceeds 1800. Splitting into chunks for translation...`);

  // Split by sentence endings or line breaks
  const sentences = text.match(/[^.!?\n]+[.!?\n]*|\n+/g) || [text];
  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > 1800) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  const translatedChunks: string[] = [];
  for (const chunk of chunks) {
    const translated = await translateTamil(chunk);
    translatedChunks.push(translated);
    // Add small delay to respect rate limit boundaries
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return translatedChunks.join(" ");
}

// Sarvam Batch/Asynchronous Speech-to-Text API Helpers

export async function initiateSTTJob() {
  const response = await fetch("https://api.sarvam.ai/speech-to-text/job/v1", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": SARVAM_API_KEY,
    },
    body: JSON.stringify({
      job_parameters: {
        model: "saaras:v3",
        mode: "transcribe",
        language_code: "ta-IN",
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
  const response = await fetch("https://api.sarvam.ai/speech-to-text/job/v1/upload-files", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": SARVAM_API_KEY,
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
  const response = await fetch(`https://api.sarvam.ai/speech-to-text/job/v1/${jobId}/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": SARVAM_API_KEY,
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
  const response = await fetch(`https://api.sarvam.ai/speech-to-text/job/v1/${jobId}/status`, {
    method: "GET",
    headers: {
      "api-subscription-key": SARVAM_API_KEY,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to check job status: ${errorText}`);
  }

  return response.json(); // returns { job_state: "Completed", job_details: [...] }
}

export async function getSTTDownloadUrl(jobId: string, outputFilename: string) {
  const response = await fetch("https://api.sarvam.ai/speech-to-text/job/v1/download-files", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": SARVAM_API_KEY,
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