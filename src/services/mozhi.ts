export interface Translation {
  id: string;
  audio_url: string;
  audio_filename: string;
  audio_duration: number;
  tamil_text: string;
  english_text: string;
  status: string;
  created_at: string;
}

export interface TranscribeResult {
  success: boolean;
  isAsync: boolean;
  jobId?: string;
  filename?: string;
  tamilText?: string;
  transcription?: string;
}

export interface BatchStatusResult {
  status: "processing" | "completed" | "failed";
  transcription?: string;
  translation?: string;
  error?: string;
}

export const mozhiService = {
  async transcribeAudio(file: File): Promise<TranscribeResult> {
    const formData = new FormData();
    formData.append("audio", file);

    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to transcribe Tamil audio");
    }

    return response.json();
  },

  async checkBatchStatus(jobId: string, filename: string): Promise<BatchStatusResult> {
    const response = await fetch(
      `/api/transcribe/status?jobId=${encodeURIComponent(jobId)}&filename=${encodeURIComponent(filename)}`
    );

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to retrieve job status");
    }

    return response.json();
  },

  async translateText(tamilText: string): Promise<string> {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tamilText }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to translate text");
    }

    const data = await response.json();
    return data.englishText;
  },

  async saveTranslation(
    file: File,
    tamilText: string,
    englishText: string,
    duration: number,
    filename: string
  ): Promise<Translation> {
    const formData = new FormData();
    formData.append("audio", file);
    formData.append("tamilText", tamilText);
    formData.append("englishText", englishText);
    formData.append("duration", duration.toString());
    formData.append("filename", filename);

    const response = await fetch("/api/translations", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to save translation");
    }

    return response.json();
  },

  async getHistory(search?: string): Promise<Translation[]> {
    const url = search
      ? `/api/translations?search=${encodeURIComponent(search)}`
      : "/api/translations";

    const response = await fetch(url);
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to fetch history");
    }

    return response.json();
  },

  async getTranslation(id: string): Promise<Translation> {
    const response = await fetch(`/api/translations/${id}`);
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to fetch translation details");
    }

    return response.json();
  },

  async deleteTranslation(id: string): Promise<void> {
    const response = await fetch(`/api/translations/${id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to delete translation");
    }
  },
};
