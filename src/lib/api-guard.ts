import "server-only";
import { checkSameOrigin } from "./request-origin";
import { clientKey, enforceRateLimits, type RateLimitRule } from "./rate-limit";

/**
 * The gate in front of the routes that cost something: /api/uploads mints Storage capacity and
 * /api/transcribe spends Sarvam credit. Mozhi has no accounts, so this cannot authenticate
 * anyone; it rejects the obviously illegitimate and throttles the rest.
 *
 * Returned as a plain shape rather than a Response so this module stays framework-free and
 * testable; the routes turn it into a NextResponse.
 */

export type GuardRejection = {
  status: number;
  error: string;
  headers?: Record<string, string>;
};

export async function guardWriteRoute(
  headers: Headers,
  rules: RateLimitRule[]
): Promise<GuardRejection | null> {
  const origin = checkSameOrigin(headers);
  if (!origin.ok) {
    console.warn(`[api-guard] rejected: ${origin.reason}`);
    // Deliberately vague to the caller; the specific reason goes to the server log only.
    return { status: 403, error: "This endpoint may only be called by the Mozhi app." };
  }

  const exceeded = await enforceRateLimits(rules, clientKey(headers));
  if (exceeded) {
    console.warn(`[api-guard] rate limit "${exceeded.rule.name}" exceeded`);
    return {
      status: 429,
      error: `Too many requests. Please wait ${exceeded.result.retryAfterSeconds} seconds and try again.`,
      headers: { "Retry-After": String(exceeded.result.retryAfterSeconds) },
    };
  }

  return null;
}
