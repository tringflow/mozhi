import { NextRequest, NextResponse } from "next/server";
import { getSupabase, classifySupabaseError, AUDIO_BUCKET } from "../../../../lib/supabase";

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

    return NextResponse.json(data);
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

    // 1. Get the translation to retrieve the audio URL
    const { data: translation, error: fetchError } = await supabase
      .from("translations")
      .select("audio_url")
      .eq("id", id)
      .single();

    if (fetchError) {
      return respondToError(fetchError, "DELETE");
    }

    // 2. Remove the audio file from Storage if URL is available
    if (translation?.audio_url) {
      const parts = translation.audio_url.split(`/public/${AUDIO_BUCKET}/`);
      if (parts.length > 1) {
        const filePath = parts[1];
        const { error: storageDeleteError } = await supabase.storage
          .from(AUDIO_BUCKET)
          .remove([filePath]);
        if (storageDeleteError) {
          console.warn("Storage deletion warning:", storageDeleteError);
        }
      }
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
