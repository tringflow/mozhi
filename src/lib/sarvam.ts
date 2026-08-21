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