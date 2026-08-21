import { NextRequest, NextResponse } from "next/server";
import { getSTTJobStatus, getSTTDownloadUrl, translateTamilLongText } from "../../../../lib/sarvam";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");
    const filename = searchParams.get("filename");

    if (!jobId || !filename) {
      return NextResponse.json(
        { error: "jobId and filename are required" },
        { status: 400 }
      );
    }

    const statusData = await getSTTJobStatus(jobId);
    console.log("Sarvam statusData:", JSON.stringify(statusData));
    const jobState = statusData.job_state;

    if (jobState === "Failed") {
      return NextResponse.json({
        status: "failed",
        error: "Sarvam STT async job failed during execution.",
      });
    }

    if (jobState === "Completed" || jobState === "PartiallyCompleted") {
      // Find output file name from statusData
      let outputFileName = "0.json";
      const fileDetail = statusData.job_details?.find(
        (detail: any) => detail.file_name === filename
      );
      if (fileDetail && fileDetail.outputs && fileDetail.outputs.length > 0) {
        outputFileName = fileDetail.outputs[0].file_name;
      }
      console.log("Determined outputFileName:", outputFileName);

      // Fetch download URL
      const downloadData = await getSTTDownloadUrl(jobId, outputFileName);
      console.log("Sarvam downloadData response:", JSON.stringify(downloadData));
      const downloadUrlObj = downloadData.download_urls[outputFileName];
      const downloadUrl = downloadUrlObj && typeof downloadUrlObj === "object" ? downloadUrlObj.file_url : downloadUrlObj;
      console.log("Final downloadUrl string:", downloadUrl);

      if (!downloadUrl) {
        return NextResponse.json(
          { error: "No download URL returned from Sarvam" },
          { status: 500 }
        );
      }

      // Download the result JSON
      const finalResultResponse = await fetch(downloadUrl);
      if (!finalResultResponse.ok) {
        return NextResponse.json(
          { error: "Failed to download transcription results" },
          { status: 500 }
        );
      }

      const finalResult = await finalResultResponse.json();
      const transcript = finalResult.transcript || "";

      // Translate the transcription to English using the long-text helper to handle >2000 chars
      const englishTranslation = await translateTamilLongText(transcript);

      return NextResponse.json({
        status: "completed",
        transcription: transcript,
        translation: englishTranslation,
      });
    }

    return NextResponse.json({ status: "processing" });
  } catch (error) {
    console.error("Status route error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Status check failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}
