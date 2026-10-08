import { NextRequest, NextResponse } from "next/server";
import { getSupabase, classifySupabaseError, classifyStorageError, AUDIO_BUCKET } from "../../../lib/supabase";
import { resolveLanguage } from "../../../lib/languages";
import { validateAudioFile, getAudioExtension, ALLOWED_AUDIO_EXTENSIONS } from "../../../lib/audio";

export const maxDuration = 30;

const MAX_TEXT_CHARS = 100_000;
const MAX_SEARCH_CHARS = 100;

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const formData = await req.formData();
    const audio = formData.get("audio") as File | null;
    const lang = resolveLanguage(formData.get("language"));
    const sourceText = formData.get("sourceText") as string | null;
    const englishText = formData.get("englishText") as string | null;
    const durationStr = formData.get("duration") as string | null;
    const filename = formData.get("filename") as string | null;

    if (!audio || !(audio instanceof File)) {
      return NextResponse.json(
        { error: "A valid audio file is required" },
        { status: 400 }
      );
    }

    if (!lang) {
      return NextResponse.json(
        { error: "Unsupported or missing language" },
        { status: 400 }
      );
    }

    if (sourceText === null || sourceText === undefined || sourceText.trim() === "") {
      return NextResponse.json(
        { error: `${lang.name} transcription text is required and cannot be empty` },
        { status: 400 }
      );
    }

    if (englishText === null || englishText === undefined || englishText.trim() === "") {
      return NextResponse.json(
        { error: "English translation text is required and cannot be empty" },
        { status: 400 }
      );
    }

    const invalidAudio = validateAudioFile(audio);
    if (invalidAudio) {
      return NextResponse.json(
        { error: invalidAudio },
        { status: invalidAudio.includes("size limit") ? 413 : 400 }
      );
    }

    if (sourceText.length > MAX_TEXT_CHARS || englishText.length > MAX_TEXT_CHARS) {
      return NextResponse.json({ error: "Text is too long to save" }, { status: 413 });
    }

    const parsedDuration = durationStr ? parseFloat(durationStr) : 0;
    const duration = Number.isFinite(parsedDuration) && parsedDuration >= 0 ? parsedDuration : 0;
    const finalFilename = (filename || audio.name || "audio.mp3").slice(0, 255);
    // Extension was validated above against a whitelist, so the generated path is always safe.
    const fileExt = getAudioExtension(audio.name) ?? ALLOWED_AUDIO_EXTENSIONS[0];
    const storagePath = `${crypto.randomUUID()}.${fileExt}`;

    // Convert file to Buffer
    const arrayBuffer = await audio.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload the original audio. This is best-effort: the transcript/translation is the
    // valuable part, so a storage failure is logged and the record is saved without audio.
    // The bucket must already exist; the app never creates it.
    let audioUrl: string | null = null;
    let uploaded = false;

    const { error: uploadError } = await supabase.storage
      .from(AUDIO_BUCKET)
      .upload(storagePath, buffer, {
        contentType: audio.type || "audio/mpeg",
        upsert: false,
      });

    if (uploadError) {
      const err = uploadError as { message: string; statusCode?: string };
      const failure = classifyStorageError(err);
      console.warn(`[translations POST] audio upload failed (${failure.code}); saving without audio:`, {
        bucket: AUDIO_BUCKET,
        status: err.statusCode,
        message: err.message,
        hint: failure.message,
      });
    } else {
      uploaded = true;
      const { data: urlData } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(storagePath);
      audioUrl = urlData.publicUrl;
    }

    // Save metadata and transcriptions to the translations table
    const { data: dbData, error: dbError } = await supabase
      .from("translations")
      .insert({
        audio_url: audioUrl,
        audio_filename: finalFilename,
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
      // Clean up uploaded storage file if db fails
      if (uploaded) {
        await supabase.storage.from(AUDIO_BUCKET).remove([storagePath]);
      }
      return NextResponse.json(
        { error: failure.message, code: failure.code },
        { status: failure.status }
      );
    }

    return NextResponse.json(dbData);
  } catch (error) {
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

    return NextResponse.json(data);
  } catch (error) {
    const failure = classifySupabaseError(error);
    console.error("[translations GET] failed:", failure.code, error);
    return NextResponse.json(
      { error: failure.message, code: failure.code },
      { status: failure.status }
    );
  }
}
