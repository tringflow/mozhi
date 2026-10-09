import { NextRequest, NextResponse } from "next/server";
import { getSupabase, classifySupabaseError } from "../../../lib/supabase";
import { resolveLanguage } from "../../../lib/languages";
import { UploadConfigError } from "../../../lib/upload-token";
import {
  resolveAudioReference,
  createAudioReadUrl,
  createAudioReadUrls,
  legacyAudioPath,
  AudioStorageError,
} from "../../../lib/audio-storage";

export const maxDuration = 30;

const MAX_TEXT_CHARS = 100_000;
const MAX_SEARCH_CHARS = 100;
const MAX_FILENAME_CHARS = 255;

type Row = {
  audio_url: string | null;
  audio_path?: string | null;
  [key: string]: unknown;
};

/**
 * The `audio` bucket is private, so a row's stored path is turned into a short-lived signed URL
 * on every read; nothing durable is ever handed to the browser. Rows written by older versions
 * have a public `audio_url` and no path, so the path is recovered from that URL and signed too,
 * which keeps old history playable now that the bucket is no longer public.
 */
function playbackPath(row: Row): string | null {
  return row.audio_path || legacyAudioPath(row.audio_url);
}

async function withPlaybackUrl<T extends Row>(row: T): Promise<T> {
  const path = playbackPath(row);
  if (!path) return { ...row, audio_url: null };
  return { ...row, audio_url: await createAudioReadUrl(path) };
}

/** List variant: signs every row's object in a single storage request. */
async function withPlaybackUrls<T extends Row>(rows: T[]): Promise<T[]> {
  const paths = rows.map(playbackPath).filter((path): path is string => !!path);
  const signed = await createAudioReadUrls(paths);

  return rows.map((row) => {
    const path = playbackPath(row);
    return { ...row, audio_url: (path && signed.get(path)) || null };
  });
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabase();

    let body: {
      path?: unknown;
      pathToken?: unknown;
      language?: unknown;
      sourceText?: unknown;
      englishText?: unknown;
      duration?: unknown;
      filename?: unknown;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }

    const lang = resolveLanguage(body.language);
    if (!lang) {
      return NextResponse.json({ error: "Unsupported or missing language" }, { status: 400 });
    }

    const sourceText = typeof body.sourceText === "string" ? body.sourceText : "";
    const englishText = typeof body.englishText === "string" ? body.englishText : "";

    if (!sourceText.trim()) {
      return NextResponse.json(
        { error: `${lang.name} transcription text is required and cannot be empty` },
        { status: 400 }
      );
    }
    if (!englishText.trim()) {
      return NextResponse.json(
        { error: "English translation text is required and cannot be empty" },
        { status: 400 }
      );
    }
    if (sourceText.length > MAX_TEXT_CHARS || englishText.length > MAX_TEXT_CHARS) {
      return NextResponse.json({ error: "Text is too long to save" }, { status: 413 });
    }

    // The audio is already in Storage: this route attaches it by reference and never moves bytes.
    // Keeping the audio is best-effort, as before - the transcript is the valuable part, so a
    // missing object is logged and the row is saved without audio. A reference that fails
    // verification is a different matter and is rejected outright.
    let audioPath: string | null = null;

    if (body.path !== undefined && body.path !== null) {
      let reference: Awaited<ReturnType<typeof resolveAudioReference>>;
      try {
        reference = await resolveAudioReference(body.path, body.pathToken);
      } catch (storageError) {
        // Storage being unreachable must not cost the user their transcript.
        const failure = storageError instanceof AudioStorageError ? storageError.failure : null;
        console.warn(
          `[translations POST] could not check stored audio (${failure?.code ?? "unknown"}); saving without audio:`,
          failure?.message ?? storageError
        );
        reference = { ok: false, status: 404, error: "" };
      }

      if (reference.ok) {
        audioPath = reference.path;
      } else if (reference.status === 404) {
        console.warn("[translations POST] referenced audio is not in storage; saving without audio.");
      } else {
        // A reference that fails verification, has expired, or names an oversized object is a
        // client error worth surfacing rather than silently dropping.
        return NextResponse.json({ error: reference.error }, { status: reference.status });
      }
    }

    const parsedDuration = typeof body.duration === "number" ? body.duration : Number(body.duration);
    const duration = Number.isFinite(parsedDuration) && parsedDuration >= 0 ? parsedDuration : 0;

    // Display name only: shown in history, never used to build a storage path.
    const rawFilename = typeof body.filename === "string" ? body.filename.trim() : "";
    const filename = (rawFilename || "audio.mp3").slice(0, MAX_FILENAME_CHARS);

    const { data: dbData, error: dbError } = await supabase
      .from("translations")
      .insert({
        audio_path: audioPath,
        // Nothing durable is stored: playback URLs are signed per read.
        audio_url: null,
        audio_filename: filename,
        audio_duration: duration,
        tamil_text: sourceText, // legacy column name: holds the source-language transcript
        language: lang.id,
        english_text: englishText,
        status: "completed",
      })
      .select()
      .single();

    if (dbError) {
      const failure = classifySupabaseError(dbError);
      console.error("[translations POST] insert failed:", failure.code, {
        message: dbError.message,
        code: dbError.code,
        details: dbError.details,
        hint: dbError.hint,
      });
      // The uploaded object is deliberately left in place: the browser owns the upload now, and
      // deleting it here would destroy audio the user may still save on a retry. See the orphan
      // sweep in supabase/storage-and-rls.sql.
      return NextResponse.json(
        { error: failure.message, code: failure.code },
        { status: failure.status }
      );
    }

    return NextResponse.json(await withPlaybackUrl(dbData as Row));
  } catch (error) {
    if (error instanceof UploadConfigError) {
      console.error("[translations POST] not configured:", error.message);
      return NextResponse.json({ error: error.message, code: "config" }, { status: 500 });
    }
    const failure = classifySupabaseError(error);
    console.error("[translations POST] failed:", failure.code, error);
    return NextResponse.json(
      { error: failure.message, code: failure.code },
      { status: failure.status }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search");

    let query = supabase
      .from("translations")
      .select("*")
      .order("created_at", { ascending: false });

    if (search) {
      // Quote the pattern so commas/parentheses in user input can't alter the PostgREST filter expression.
      const term = search.slice(0, MAX_SEARCH_CHARS).replace(/[\\"]/g, (ch) => `\\${ch}`);
      const pattern = `"%${term}%"`;
      query = query.or(`tamil_text.ilike.${pattern},english_text.ilike.${pattern},audio_filename.ilike.${pattern}`);
    }

    const { data, error } = await query;

    if (error) {
      const failure = classifySupabaseError(error);
      console.error("[translations GET] select failed:", failure.code, {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      return NextResponse.json(
        { error: failure.message, code: failure.code },
        { status: failure.status }
      );
    }

    return NextResponse.json(await withPlaybackUrls((data ?? []) as Row[]));
  } catch (error) {
    const failure = classifySupabaseError(error);
    console.error("[translations GET] failed:", failure.code, error);
    return NextResponse.json(
      { error: failure.message, code: failure.code },
      { status: failure.status }
    );
  }
}
