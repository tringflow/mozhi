import { NextRequest, NextResponse } from "next/server";
import { resolveLanguage } from "../../../lib/languages";
import { validateAudioFile } from "../../../lib/audio";
import { getErrorMessage } from "../../../lib/errors";
import { transcribeAudio, initiateSTTJob, getSTTUploadUrl, startSTTJob } from "../../../lib/sarvam";

// Long uploads (batch hand-off) can take a while on serverless platforms.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audio = formData.get("audio");

    if (!(audio instanceof File)) {
      return NextResponse.json(
        { error: "Audio file is required" },
        { status: 400 }
      );
    }

    const lang = resolveLanguage(formData.get("language"));
    if (!lang) {
      return NextResponse.json(
        { error: "Unsupported or missing language" },
        { status: 400 }
      );
    }

    const invalid = validateAudioFile(audio);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: invalid.includes("size limit") ? 413 : 400 });
    }

    try {
      // 1. Try synchronous STT first
      const result = await transcribeAudio(audio, lang);
      const transcript = typeof result.transcript === "string" ? result.transcript.trim() : "";

      if (!transcript) {
        return NextResponse.json(
          { error: "No speech was detected in the audio." },
          { status: 422 }
        );
      }

      return NextResponse.json({
        success: true,
        isAsync: false,
        transcription: transcript,
      });
    } catch (sttError) {
      // 2. If sync STT fails because of the 30-second limit, start the async pipeline
      const message = getErrorMessage(sttError);
      const isDurationLimit =
        message.includes("limit of 30 seconds") ||
        message.toLowerCase().includes("duration");

      if (!isDurationLimit) {
        throw sttError;
      }

      // Initiate job
      const initResult = await initiateSTTJob(lang);
      const jobId = initResult.job_id;

      // Get pre-signed upload URL
      const uploadResult = await getSTTUploadUrl(jobId, audio.name);
      const uploadUrlObj = uploadResult.upload_urls[audio.name];
      const uploadUrl = uploadUrlObj && typeof uploadUrlObj === "object" ? uploadUrlObj.file_url : uploadUrlObj;

      if (!uploadUrl) {
        throw new Error("Could not retrieve upload URL for the batch job.");
      }

      // Upload the audio file binary
      const buffer = Buffer.from(await audio.arrayBuffer());

      const putResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": audio.type || "audio/webm",
          "x-ms-blob-type": "BlockBlob",
        },
        body: buffer,
        signal: AbortSignal.timeout(120_000),
      });

      if (!putResponse.ok) {
        // Don't echo the body: it can contain the signed URL.
        throw new Error(`Failed to upload file to Sarvam batch storage (HTTP ${putResponse.status}).`);
      }

      // Start the job
      await startSTTJob(jobId);

      return NextResponse.json({
        success: true,
        isAsync: true,
        jobId: jobId,
        filename: audio.name,
      });
    }
  } catch (error) {
    console.error("Transcription error:", error);
    return NextResponse.json(
      { error: `Transcription error: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
