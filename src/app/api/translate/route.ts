import { NextRequest, NextResponse } from "next/server";
import { translateTamilLongText } from "../../../lib/sarvam";

export async function POST(req: NextRequest) {
  try {
    const { tamilText } = await req.json();

    if (!tamilText || typeof tamilText !== "string") {
      return NextResponse.json(
        { error: "Tamil text is required" },
        { status: 400 }
      );
    }

    
    const englishText = await translateTamilLongText(tamilText);

    return NextResponse.json({ englishText });
  } catch (error) {
    console.error("Translation API error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to translate text: ${errorMessage}` },
      { status: 500 }
    );
  }
}
