import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { cleanupOrphans } from "../../../../lib/orphan-cleanup";
import { AudioStorageError } from "../../../../lib/audio-storage";
import { classifySupabaseError, SupabaseConfigError } from "../../../../lib/supabase";

/**
 * Scheduled cleanup of abandoned uploads. Invoked by Vercel Cron (see vercel.json), which sends
 * `Authorization: Bearer $CRON_SECRET`, or by hand with the same header for other hosts.
 *
 * GET, because that is what Vercel Cron issues. It is a mutating endpoint behind a secret, so
 * nothing may cache it.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Compares without leaking length or content through timing. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  // Fail closed: with no secret configured the endpoint stays shut rather than becoming a
  // world-callable delete button.
  if (!secret) {
    console.error("[cron/cleanup-orphans] CRON_SECRET is not set; refusing to run.");
    return NextResponse.json(
      { error: "Cleanup is not configured. Set CRON_SECRET." },
      { status: 503 }
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

  if (!provided || !secretMatches(provided, secret)) {
    console.warn("[cron/cleanup-orphans] rejected an unauthorised invocation.");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // `?dryRun=1` reports what would be removed without removing it, for verifying a new setup.
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  try {
    const report = await cleanupOrphans({ dryRun });
    return NextResponse.json({ ok: true, ...report });
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      console.error("[cron/cleanup-orphans] not configured:", error.message);
      return NextResponse.json({ error: error.message, code: "config" }, { status: 500 });
    }
    if (error instanceof AudioStorageError) {
      console.error("[cron/cleanup-orphans] storage failure:", error.failure.code, error.failure.message);
      return NextResponse.json({ error: error.failure.message, code: error.failure.code }, { status: 502 });
    }
    const failure = classifySupabaseError(error);
    console.error("[cron/cleanup-orphans] failed:", failure.code, error);
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
}
