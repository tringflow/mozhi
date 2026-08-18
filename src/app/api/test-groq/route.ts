import { NextResponse } from "next/server";
import { groq } from "../../../lib/groq";

export async function GET() {
  try {
    const response = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "user",
          content: "Reply with exactly: Groq connected successfully!",
        },
      ],
    });

    return NextResponse.json({
      message: response.choices[0]?.message?.content,
    });
  } catch (error) {
    console.error("Groq error:", error);

    return NextResponse.json(
      { error: "Groq connection failed" },
      { status: 500 }
    );
  }
}