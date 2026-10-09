import { NextRequest, NextResponse } from "next/server";
import { AUDIO_CONTENT_TYPES, MAX_AUDIO_BYTES } from "../../../lib/audio";
import { mintAudioObject, resolveAudioExtension, UploadConfigError } from "../../../lib/upload-token";
import { createAudioUploadUrl } from "../../../lib/audio-storage";
import { classifySupabaseError } from "../../../lib/supabase";

/**
 * Mints a signed URL that the browser PUTs the audio to directly, so the bytes never pass
 * through this function. That is what lifts the ceiling to 25 MB on Vercel, where a request
 * body sent to a function is capped at 4.5 MB.
 *
 * Only metadata crosses this route, so it is fast and stays on the default duration.
 */
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    let body: { filename?: unknown; size?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }

    const ext = resolveAudioExtension(body.filename);
    if (!ext) {
      return NextResponse.json(
        { error: "Unsupported format. Please upload MP3, WAV, M4A, or WEBM." },
        { status: 400 }
      );
    }

    // First of the two server-side size boundaries: refuse to mint a URL for an oversized file.
    // The second is the measurement of the stored object (see checkAudioObject), which is what
    // actually gates Sarvam and the database, since this number is only the browser's claim.
    const size = typeof body.size === "number" ? body.size : Number.NaN;
    if (!Number.isFinite(size) || size <= 0) {
      return NextResponse.json({ error: "A positive file size is required" }, { status: 400 });
    }
    if (size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: `File exceeds the ${MAX_AUDIO_BYTES / (1024 * 1024)}MB size limit.` },
        { status: 413 }
      );
    }

    const { path, pathToken } = mintAudioObject(ext);
    const result = await createAudioUploadUrl(path);

    if ("failure" in result) {
      console.error(`[uploads POST] could not mint upload URL (${result.failure.code}):`, result.failure.message);
      return NextResponse.json(
        { error: result.failure.message, code: result.failure.code },
        { status: result.failure.code === "bucket_missing" ? 500 : 502 }
      );
    }

    return NextResponse.json({
      uploadUrl: result.uploadUrl,
      path,
      pathToken,
      // The browser must send exactly this, so the bucket's allowed_mime_types can stay strict.
      contentType: AUDIO_CONTENT_TYPES[ext],
      maxBytes: MAX_AUDIO_BYTES,
    });
  } catch (error) {
    if (error instanceof UploadConfigError) {
      console.error("[uploads POST] not configured:", error.message);
      return NextResponse.json({ error: error.message, code: "config" }, { status: 500 });
    }
    const failure = classifySupabaseError(error);
    console.error("[uploads POST] failed:", failure.code, error);
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
}
