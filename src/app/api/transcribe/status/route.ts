import { NextRequest, NextResponse } from "next/server";
import { resolveLanguage } from "../../../../lib/languages";
import { getErrorMessage } from "../../../../lib/errors";
import { getSTTJobStatus, getSTTDownloadUrl, translateLongText, resolveSignedEntry } from "../../../../lib/sarvam";
import { isAudioObjectName } from "../../../../lib/upload-token";

// Completion triggers chunked translation of the whole transcript within this request.
export const maxDuration = 300;

interface JobDetail {
  file_name?: string;
  state?: string;
  error_message?: string;
  outputs?: { file_name: string }[];
}

/** `jobId` is interpolated into a Sarvam URL path, so keep it to an opaque identifier. */
const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");
    const filename = searchParams.get("filename");
    const lang = resolveLanguage(searchParams.get("language"));

    if (!lang) {
      return NextResponse.json(
        { error: "Unsupported or missing language" },
        { status: 400 }
      );
    }

    if (!jobId || !JOB_ID_PATTERN.test(jobId)) {
      return NextResponse.json({ error: "A valid jobId is required" }, { status: 400 });
    }

    // Batch jobs are always submitted under a server-minted object name, so anything else is
    // not a filename this app created.
    if (!isAudioObjectName(filename)) {
      return NextResponse.json({ error: "A valid filename is required" }, { status: 400 });
    }

    const statusData = await getSTTJobStatus(jobId);
    const jobState: string = statusData.job_state;

    if (jobState === "Failed") {
      return NextResponse.json({
        status: "failed",
        error: "Sarvam STT async job failed during execution.",
      });
    }

    if (jobState === "Completed" || jobState === "PartiallyCompleted") {
      const fileDetail = (statusData.job_details as JobDetail[] | undefined)?.find(
        (detail) => detail.file_name === filename
      );

      // A PartiallyCompleted job can contain a failed file; don't treat that as success.
      if (fileDetail?.state === "Failed") {
        return NextResponse.json({
          status: "failed",
          error: fileDetail.error_message || "Sarvam could not process this audio file.",
        });
      }

      const outputFileName = fileDetail?.outputs?.[0]?.file_name ?? "0.json";

      const downloadData = await getSTTDownloadUrl(jobId, outputFileName);
      const downloadUrl = resolveSignedEntry(downloadData.download_urls?.[outputFileName]);

      if (!downloadUrl) {
        return NextResponse.json(
          { error: "No download URL returned from Sarvam" },
          { status: 502 }
        );
      }

      // The URL is a signed link: never log it.
      const finalResultResponse = await fetch(downloadUrl, { signal: AbortSignal.timeout(60_000) });
      if (!finalResultResponse.ok) {
        return NextResponse.json(
          { error: "Failed to download transcription results" },
          { status: 502 }
        );
      }

      const finalResult = await finalResultResponse.json();
      const transcript = typeof finalResult.transcript === "string" ? finalResult.transcript.trim() : "";

      if (!transcript) {
        return NextResponse.json({
          status: "failed",
          error: "No speech was detected in the audio.",
        });
      }

      // Translate to English; the long-text helper chunks transcripts that exceed the API limit.
      const englishTranslation = await translateLongText(transcript, lang);

      return NextResponse.json({
        status: "completed",
        transcription: transcript,
        translation: englishTranslation,
      });
    }

    return NextResponse.json({ status: "processing" });
  } catch (error) {
    console.error("Status route error:", error);
    return NextResponse.json(
      { error: `Status check failed: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
