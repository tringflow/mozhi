import { NextRequest, NextResponse } from "next/server";
import { transcribeTamil, initiateSTTJob, getSTTUploadUrl, startSTTJob } from "../../../lib/sarvam";

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

    try {
      // 1. Try synchronous STT first
      const result = await transcribeTamil(audio);
      return NextResponse.json({
        success: true,
        isAsync: false,
        transcription: result.transcript,
        tamilText: result.transcript,
      });
    } catch (sttError: any) {
      // 2. If sync STT fails because of the 30-second limit, start the async pipeline
      const isDurationLimit =
        sttError.message.includes("limit of 30 seconds") ||
        sttError.message.toLowerCase().includes("duration");

      if (isDurationLimit) {
        console.log("Audio duration exceeds limit. Transitioning to Sarvam Batch/Asynchronous Job...");

        // Initiate job
        const initResult = await initiateSTTJob();
        const jobId = initResult.job_id;

        // Get pre-signed upload URL
        const uploadResult = await getSTTUploadUrl(jobId, audio.name);
        const uploadUrlObj = uploadResult.upload_urls[audio.name];
        const uploadUrl = uploadUrlObj && typeof uploadUrlObj === "object" ? uploadUrlObj.file_url : uploadUrlObj;

        if (!uploadUrl) {
          throw new Error("Could not retrieve upload URL for the batch job.");
        }

        // Upload the audio file binary
        const arrayBuffer = await audio.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const putResponse = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": audio.type || "audio/webm",
            "x-ms-blob-type": "BlockBlob",
          },
          body: buffer,
        });

        if (!putResponse.ok) {
          const putError = await putResponse.text();
          throw new Error(`Failed to upload file to Sarvam batch storage: ${putError}`);
        }

        // Start the job
        await startSTTJob(jobId);

        return NextResponse.json({
          success: true,
          isAsync: true,
          jobId: jobId,
          filename: audio.name,
        });
      } else {
        // Reraise other errors
        throw sttError;
      }
    }
  } catch (error) {
    console.error("Transcription error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Transcription error: ${errorMessage}` },
      { status: 500 }
    );
  }
}