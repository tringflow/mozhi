import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const { data, error } = await supabase
      .from("translations")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      console.error("Fetch translation details error:", error);
      return NextResponse.json(
        { error: `Translation not found: ${error.message}` },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Get translation details error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve translation details" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // 1. Get the translation to retrieve the audio URL
    const { data: translation, error: fetchError } = await supabase
      .from("translations")
      .select("audio_url")
      .eq("id", id)
      .single();

    if (fetchError) {
      console.error("Fetch before delete error:", fetchError);
      return NextResponse.json(
        { error: `Translation not found: ${fetchError.message}` },
        { status: 404 }
      );
    }

    // 2. Remove the audio file from Storage if URL is available
    if (translation?.audio_url) {
      const parts = translation.audio_url.split("/public/audio/");
      if (parts.length > 1) {
        const filePath = parts[1];
        const { error: storageDeleteError } = await supabase.storage
          .from("audio")
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
      console.error("Database deletion error:", dbDeleteError);
      return NextResponse.json(
        { error: `Failed to delete record: ${dbDeleteError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: "Translation deleted successfully" });
  } catch (error) {
    console.error("Delete translation error:", error);
    return NextResponse.json(
      { error: "Failed to delete translation" },
      { status: 500 }
    );
  }
}
