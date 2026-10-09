import { NextRequest, NextResponse } from "next/server";
import { getSupabase, classifySupabaseError } from "../../../../lib/supabase";
import { createAudioReadUrl, legacyAudioPath, removeAudioObject } from "../../../../lib/audio-storage";

type RouteParams = {
  params: Promise<{ id: string }>;
};

// PGRST116 = .single() matched no row; anything else is a real database/network failure.
function respondToError(error: { message: string; code?: string }, method: string) {
  // 22P02 = malformed uuid in the URL
  if (error.code === "PGRST116" || error.code === "22P02") {
    return NextResponse.json({ error: "Translation not found" }, { status: 404 });
  }
  const failure = classifySupabaseError(error);
  console.error(`[translations/:id ${method}] failed:`, failure.code, error);
  return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const supabase = getSupabase();
    const { id } = await params;

    const { data, error } = await supabase
      .from("translations")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      return respondToError(error, "GET");
    }

    // The bucket is private: mint a short-lived playback URL instead of returning a durable one.
    // `legacyAudioPath` keeps rows written while the bucket was public playable.
    const path = data?.audio_path || legacyAudioPath(data?.audio_url);
    return NextResponse.json({
      ...data,
      audio_url: path ? await createAudioReadUrl(path) : null,
    });
  } catch (error) {
    const failure = classifySupabaseError(error);
    console.error("[translations/:id GET] failed:", failure.code, error);
    return NextResponse.json(
      { error: failure.message, code: failure.code },
      { status: failure.status }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const supabase = getSupabase();
    const { id } = await params;

    // 1. Get the translation to find its stored audio object
    const { data: translation, error: fetchError } = await supabase
      .from("translations")
      .select("audio_url, audio_path")
      .eq("id", id)
      .single();

    if (fetchError) {
      return respondToError(fetchError, "DELETE");
    }

    // 2. Remove the audio object. Rows written by older versions carry only a public URL,
    //    so fall back to recovering the path from it.
    const path = translation?.audio_path || legacyAudioPath(translation?.audio_url);
    if (path) {
      await removeAudioObject(path);
    }

    // 3. Delete the translation record from the DB
    const { error: dbDeleteError } = await supabase
      .from("translations")
      .delete()
      .eq("id", id);

    if (dbDeleteError) {
      return respondToError(dbDeleteError, "DELETE");
    }

    return NextResponse.json({ message: "Translation deleted successfully" });
  } catch (error) {
    const failure = classifySupabaseError(error);
    console.error("[translations/:id DELETE] failed:", failure.code, error);
    return NextResponse.json(
      { error: failure.message, code: failure.code },
      { status: failure.status }
    );
  }
}
