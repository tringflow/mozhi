import { NextRequest, NextResponse } from "next/server";
import { resolveLanguage } from "../../../lib/languages";
import { getErrorMessage } from "../../../lib/errors";
import { translateLongText } from "../../../lib/sarvam";

export const maxDuration = 60;

// Translation is sequential per ~1800-char chunk; cap input so one request can't run unbounded.
const MAX_TEXT_CHARS = 50_000;

export async function POST(req: NextRequest) {
  try {
    let body: { text?: unknown; language?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }

    const lang = resolveLanguage(body.language);

    if (!lang) {
      return NextResponse.json(
        { error: "Unsupported or missing language" },
        { status: 400 }
      );
    }

    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!text) {
      return NextResponse.json(
        { error: "Text to translate is required" },
        { status: 400 }
      );
    }

    if (text.length > MAX_TEXT_CHARS) {
      return NextResponse.json(
        { error: `Text exceeds the ${MAX_TEXT_CHARS} character limit` },
        { status: 413 }
      );
    }

    const englishText = await translateLongText(text, lang);

    return NextResponse.json({ englishText });
  } catch (error) {
    console.error("Translation API error:", error);
    return NextResponse.json(
      { error: `Failed to translate text: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
