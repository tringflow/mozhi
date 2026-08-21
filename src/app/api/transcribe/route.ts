import { NextRequest, NextResponse } from "next/server";
import { transcribeTamil } from "../../../lib/sarvam";
import { groq } from "../../../lib/groq";

export async function POST(request: NextRequest) {
  let audio: any = null;
  try {
    const formData = await request.formData();
    audio = formData.get("audio");

    if (!(audio instanceof File)) {
      return NextResponse.json(
        { error: "Audio file is required" },
        { status: 400 }
      );
    }

    const result = await transcribeTamil(audio);

    // Return both 'transcription' (user request) and 'tamilText' (compatibility with frontend client service)
    return NextResponse.json({
      success: true,
      transcription: result.transcript,
      tamilText: result.transcript,
    });
  } catch (error) {
    console.warn("Sarvam transcription failed, falling back to Groq Whisper:", error);
    
    if (audio instanceof File) {
      try {
        const transcription = await groq.audio.transcriptions.create({
          file: audio,
          model: "whisper-large-v3-turbo",
          language: "ta",
          prompt: "தமிழ் transcription. Please output in Tamil Unicode script only. (e.g. நாளைக்கு காலை பத்து மணிக்கு எனக்கு மீட்டிங் இருக்கு)",
          response_format: "json",
        });

        return NextResponse.json({
          success: true,
          transcription: transcription.text,
          tamilText: transcription.text,
          fallbackUsed: true,
        });
      } catch (groqError) {
        console.error("Groq fallback transcription error:", groqError);
        const errorMessage = groqError instanceof Error ? groqError.message : String(groqError);
        return NextResponse.json(
          { error: `Transcription failed on both Sarvam and Groq Whisper: ${errorMessage}` },
          { status: 500 }
        );
      }
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Transcription error: ${errorMessage}` },
      { status: 500 }
    );
  }
}