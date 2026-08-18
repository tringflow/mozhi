import { NextRequest, NextResponse } from "next/server";
import { groq } from "../../../lib/groq";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audio = formData.get("audio");

    if (!audio || !(audio instanceof File)) {
      return NextResponse.json(
        { error: "Audio file is required" },
        { status: 400 }
      );
    }

    const transcription = await groq.audio.transcriptions.create({
      file: audio,
      model: "whisper-large-v3-turbo",
      language: "ta",
      prompt: "தமிழ் transcription. Please output in Tamil Unicode script only. (e.g. நாளைக்கு காலை பத்து மணிக்கு எனக்கு மீட்டிங் இருக்கு)",
      response_format: "json",
    });

    return NextResponse.json({
      tamilText: transcription.text,
    });
  } catch (error) {
    console.error("Transcription error:", error);

    return NextResponse.json(
      { error: "Failed to transcribe Tamil audio" },
      { status: 500 }
    );
  }
}