import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audio = formData.get("audio") as File | null;
    const tamilText = formData.get("tamilText") as string | null;
    const englishText = formData.get("englishText") as string | null;
    const durationStr = formData.get("duration") as string | null;
    const filename = formData.get("filename") as string | null;

    console.log("Translations POST request fields:", {
      hasAudio: !!audio,
      audioName: audio instanceof File ? audio.name : null,
      audioSize: audio instanceof File ? audio.size : null,
      tamilText,
      englishText,
    });

    if (!audio || !(audio instanceof File)) {
      return NextResponse.json(
        { error: "A valid audio file is required" },
        { status: 400 }
      );
    }

    if (tamilText === null || tamilText === undefined || tamilText.trim() === "") {
      return NextResponse.json(
        { error: "Tamil transcription text is required and cannot be empty" },
        { status: 400 }
      );
    }

    if (englishText === null || englishText === undefined || englishText.trim() === "") {
      return NextResponse.json(
        { error: "English translation text is required and cannot be empty" },
        { status: 400 }
      );
    }

    const duration = durationStr ? parseFloat(durationStr) : 0;
    const finalFilename = filename || audio.name || "audio.mp3";
    const fileExt = finalFilename.split(".").pop() || "mp3";
    const storagePath = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}.${fileExt}`;

    // Convert file to Buffer
    const arrayBuffer = await audio.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Supabase storage 'audio' bucket
    let uploadResult = await supabase.storage
      .from("audio")
      .upload(storagePath, buffer, {
        contentType: audio.type || "audio/mpeg",
        upsert: true,
      });

    // Check if upload failed because the bucket doesn't exist, and attempt to create it
    if (uploadResult.error && (uploadResult.error.message.includes("not found") || uploadResult.error.message.toLowerCase().includes("bucket"))) {
      console.log("Bucket 'audio' not found. Attempting to create bucket dynamically...");
      const { error: createError } = await supabase.storage.createBucket("audio", {
        public: true,
      });

      if (!createError) {
        // Retry upload after bucket creation
        uploadResult = await supabase.storage
          .from("audio")
          .upload(storagePath, buffer, {
            contentType: audio.type || "audio/mpeg",
            upsert: true,
          });
      } else {
        console.error("Failed to create bucket dynamically:", createError);
      }
    }

    let audioUrl: string | null = null;

    if (uploadResult.error) {
      console.warn("Storage upload failed (proceeding without audio file):", uploadResult.error.message);
    } else {
      // Get public URL
      const { data: urlData } = supabase.storage
        .from("audio")
        .getPublicUrl(storagePath);
      audioUrl = urlData.publicUrl;
    }

    // Save metadata and transcriptions to the translations table
    const { data: dbData, error: dbError } = await supabase
      .from("translations")
      .insert({
        audio_url: audioUrl,
        audio_filename: finalFilename,
        audio_duration: duration,
        tamil_text: tamilText,
        english_text: englishText,
        status: "completed",
      })
      .select()
      .single();

    if (dbError) {
      console.error("Database insert error:", dbError);
      // Clean up uploaded storage file if db fails
      if (!uploadResult.error) {
        await supabase.storage.from("audio").remove([storagePath]);
      }
      return NextResponse.json(
        { error: `Failed to save translation: ${dbError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(dbData);
  } catch (error) {
    console.error("Save translation error:", error);
    return NextResponse.json(
      { error: "Failed to process translation request" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search");

    let query = supabase
      .from("translations")
      .select("*")
      .order("created_at", { ascending: false });

    if (search) {
      query = query.or(`tamil_text.ilike.%${search}%,english_text.ilike.%${search}%,audio_filename.ilike.%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Database fetch error:", error);
      return NextResponse.json(
        { error: `Failed to fetch history: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Get translations error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve translation history" },
      { status: 500 }
    );
  }
}
