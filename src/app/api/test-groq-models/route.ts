import { NextResponse } from "next/server";
import { groq } from "../../../lib/groq";

export async function GET() {
  try {
    const models = await groq.models.list();

    return NextResponse.json({
      models: models.data.map((model) => model.id),
    });
  } catch (error) {
    console.error("Groq models error:", error);

    return NextResponse.json(
      { error: "Failed to fetch Groq models" },
      { status: 500 }
    );
  }
}