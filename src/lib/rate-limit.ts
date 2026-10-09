import "server-only";
import { getSupabase } from "./supabase";

/**
 * Fixed-window rate limiting for the write routes, counted in Postgres (see
 * supabase/migrations/20261010_rate_limit.sql).
 *
 * This is a throttle, not an authorization check. Mozhi has no accounts, so it cannot tell one
 * caller from another beyond their address; what it can do is bound the cost of abuse - a filled
 * Storage bucket and a Sarvam bill. Real access control belongs at the platform edge.
 */

export interface RateLimitRule {
  /** Short name used in the counter key and in logs, e.g. "uploads". */
  name: string;
  /** Maximum requests allowed per window. */
  max: number;
  windowSeconds: number;
  /**
   * "caller" counts each address separately; "global" counts every request together, as a
   * ceiling on the whole deployment.
   */
  scope: "caller" | "global";
}

/** Per-caller limits. One pipeline run makes one request to each of these. */
export const UPLOAD_RATE_LIMIT: RateLimitRule = { name: "uploads", max: 20, windowSeconds: 600, scope: "caller" };
export const TRANSCRIBE_RATE_LIMIT: RateLimitRule = { name: "transcribe", max: 20, windowSeconds: 600, scope: "caller" };

/**
 * A ceiling on the whole deployment, so rotating addresses cannot multiply the per-caller limit.
 * Set generously: it is a circuit breaker, not the primary control.
 */
export const GLOBAL_UPLOAD_RATE_LIMIT: RateLimitRule = { name: "uploads:all", max: 300, windowSeconds: 3600, scope: "global" };

/**
 * Best-effort caller identity. On Vercel the client address arrives in `x-forwarded-for`, whose
 * first entry is the original client; later entries are proxies. These headers are trivially
 * forged by a direct caller, which is precisely why this is a throttle and not a security
 * boundary - a determined attacker rotates them, and only the global ceiling then applies.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    // Cap the length so a long forged header cannot bloat the key, and keep it printable.
    if (first) return first.slice(0, 64);
  }
  return headers.get("x-real-ip")?.slice(0, 64) || "unknown";
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window rolls over, for the Retry-After header. */
  retryAfterSeconds: number;
};

const ALLOWED: RateLimitResult = { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfterSeconds: 0 };

/**
 * Records one hit and reports whether the caller may proceed.
 *
 * Fails OPEN. If the counter store is unreachable the request is allowed and the problem is
 * logged, because a database blip should not stop someone transcribing audio. The trade-off is
 * deliberate: this protects against cost, and an outage is not an attack.
 */
export async function enforceRateLimit(rule: RateLimitRule, caller: string): Promise<RateLimitResult> {
  try {
    const { data, error } = await getSupabase().rpc("mozhi_rate_limit", {
      p_key: `${rule.name}:${caller}`,
      p_max: rule.max,
      p_window: rule.windowSeconds,
    });

    if (error || !data) {
      console.warn(`[rate-limit] counter unavailable for ${rule.name}; allowing request:`, error?.message);
      return ALLOWED;
    }

    const result = data as { allowed?: boolean; remaining?: number; reset_at?: string };
    const resetAt = result.reset_at ? Date.parse(result.reset_at) : Number.NaN;
    const retryAfterSeconds = Number.isFinite(resetAt)
      ? Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
      : rule.windowSeconds;

    return {
      allowed: result.allowed !== false,
      remaining: typeof result.remaining === "number" ? result.remaining : 0,
      retryAfterSeconds,
    };
  } catch (err) {
    console.warn(`[rate-limit] counter threw for ${rule.name}; allowing request:`, err);
    return ALLOWED;
  }
}

/** Applies several rules to one caller, stopping at the first that rejects. */
export async function enforceRateLimits(
  rules: RateLimitRule[],
  caller: string
): Promise<{ rule: RateLimitRule; result: RateLimitResult } | null> {
  for (const rule of rules) {
    // A global rule is shared by every caller, so it is counted under one fixed key.
    const result = await enforceRateLimit(rule, rule.scope === "global" ? "all" : caller);
    if (!result.allowed) return { rule, result };
  }
  return null;
}
