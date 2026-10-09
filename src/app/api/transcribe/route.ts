import { NextRequest, NextResponse } from "next/server";
import { resolveLanguage } from "../../../lib/languages";
import { AUDIO_CONTENT_TYPES, SYNC_STT_MAX_BYTES, SYNC_STT_MAX_SECONDS, getAudioExtension, isAllowedAudioExtension } from "../../../lib/audio";
import { getErrorMessage } from "../../../lib/errors";
import { audioObjectName, UploadConfigError } from "../../../lib/upload-token";
import { resolveAudioReference, downloadAudioObject, AudioStorageError } from "../../../lib/audio-storage";
import { SupabaseConfigError } from "../../../lib/supabase";
import { guardWriteRoute } from "../../../lib/api-guard";
import { TRANSCRIBE_RATE_LIMIT } from "../../../lib/rate-limit";
import {
  transcribeAudio,
  initiateSTTJob,
  getSTTUploadUrl,
  startSTTJob,
  uploadToSTTJob,
  resolveSignedEntry,
  isDurationLimitError,
} from "../../../lib/sarvam";

/**
 * Transcribes audio that the browser has already uploaded to Supabase Storage. The request body
 * is a small JSON reference, never the audio, which is what keeps this working on Vercel for
 * files far above its 4.5 MB request-body limit.
 *
 * The audio reaches Sarvam over two server-to-server hops, because Sarvam's batch API only
 * accepts bytes PUT to a pre-signed URL it issues (see the note in src/lib/sarvam.ts) - a
 * Supabase URL cannot be handed to it. Neither hop is subject to the request-body limit.
 */

// The batch hand-off moves up to 25 MB out of Supabase and into Sarvam's object store within
// this one request. 300 s is the default and the maximum on Vercel's Hobby plan, and the
// default on Pro/Enterprise, so it is safe to ask for on any plan.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    // This route spends Sarvam credit, so it is throttled on the same terms as /api/uploads.
    // Status polling is deliberately not rate limited: it runs every 3 s during a batch job.
    const rejection = await guardWriteRoute(request.headers, [TRANSCRIBE_RATE_LIMIT]);
    if (rejection) {
      return NextResponse.json({ error: rejection.error }, { status: rejection.status, headers: rejection.headers });
    }

    let body: { path?: unknown; pathToken?: unknown; language?: unknown; durationSeconds?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }

    const lang = resolveLanguage(body.language);
    if (!lang) {
      return NextResponse.json({ error: "Unsupported or missing language" }, { status: 400 });
    }

    // Verifies the path was minted by this server, then measures the stored bytes.
    const reference = await resolveAudioReference(body.path, body.pathToken);
    if (!reference.ok) {
      return NextResponse.json({ error: reference.error }, { status: reference.status });
    }

    const { path, stat } = reference;
    const objectName = audioObjectName(path);
    const ext = getAudioExtension(objectName);
    // The path pattern already guarantees this; narrow it for the content-type lookup.
    const contentType = isAllowedAudioExtension(ext) ? AUDIO_CONTENT_TYPES[ext] : "application/octet-stream";

    // The browser's duration is a hint for routing only, never a security or correctness input.
    const hintedDuration = typeof body.durationSeconds === "number" && Number.isFinite(body.durationSeconds)
      ? body.durationSeconds
      : null;

    // Sarvam's sync endpoint caps at 30 s of audio, so only try it when the file is plausibly
    // that short. Guessing wrong is still safe: a duration rejection falls through to batch.
    const trySync =
      stat.size <= SYNC_STT_MAX_BYTES &&
      (hintedDuration === null || hintedDuration <= SYNC_STT_MAX_SECONDS);

    if (trySync) {
      try {
        const audio = await downloadAudioObject(path);
        const result = await transcribeAudio(audio, objectName, lang);
        const transcript = typeof result.transcript === "string" ? result.transcript.trim() : "";

        if (!transcript) {
          return NextResponse.json({ error: "No speech was detected in the audio." }, { status: 422 });
        }

        return NextResponse.json({ success: true, isAsync: false, transcription: transcript });
      } catch (sttError) {
        if (!isDurationLimitError(getErrorMessage(sttError))) throw sttError;
        console.info("[transcribe POST] sync STT rejected the clip as too long; using the batch API.");
      }
    }

    // Batch pipeline: create the job, get Sarvam's pre-signed URL, relay the bytes, start it.
    // The browser then polls /api/transcribe/status, so no request waits on transcription.
    const { job_id: jobId } = await initiateSTTJob(lang);
    if (typeof jobId !== "string" || !jobId) {
      throw new Error("Sarvam did not return a job id.");
    }

    const uploadResult = await getSTTUploadUrl(jobId, objectName);
    const uploadUrl = resolveSignedEntry(uploadResult.upload_urls?.[objectName]);
    if (!uploadUrl) {
      throw new Error("Could not retrieve an upload URL for the batch job.");
    }

    const audio = await downloadAudioObject(path);
    await uploadToSTTJob(uploadUrl, audio, contentType);
    await startSTTJob(jobId);

    return NextResponse.json({
      success: true,
      isAsync: true,
      jobId,
      filename: objectName,
    });
  } catch (error) {
    // Configuration problems and Storage problems get their own, accurate message; anything
    // else reaching here came from Sarvam and is reported as a transcription failure.
    if (error instanceof UploadConfigError || error instanceof SupabaseConfigError) {
      console.error("[transcribe POST] not configured:", error.message);
      return NextResponse.json({ error: error.message, code: "config" }, { status: 500 });
    }
    if (error instanceof AudioStorageError) {
      console.error("[transcribe POST] storage failure:", error.failure.code, error.failure.message);
      return NextResponse.json(
        { error: error.failure.message, code: error.failure.code },
        { status: error.failure.code === "bucket_missing" ? 500 : 502 }
      );
    }

    console.error("[transcribe POST] failed:", error);
    return NextResponse.json(
      { error: `Transcription error: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
