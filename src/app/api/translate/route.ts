import { NextRequest, NextResponse } from "next/server";
import { groq } from "../../../lib/groq";

export async function POST(req: NextRequest) {
  try {
    const { tamilText } = await req.json();

    if (!tamilText || typeof tamilText !== "string") {
      return NextResponse.json(
        { error: "Tamil text is required" },
        { status: 400 }
      );
    }

    const response = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content: "You are an expert Tamil-to-English translator. Translate the following Tamil Unicode text into natural, clean English. Preserve names, numbers, dates, times, and context. Output ONLY the English translation. Do not include any explanations, extra notes, introduction, or quotes.",
        },
        {
          role: "user",
          content: tamilText,
        },
      ],
      temperature: 0.3,
    });

    const englishText = response.choices[0]?.message?.content?.trim() || "";

    return NextResponse.json({ englishText });
  } catch (error) {
    console.error("Translation API error:", error);
    return NextResponse.json(
      { error: "Failed to translate text" },
      { status: 500 }
    );
  }
}
