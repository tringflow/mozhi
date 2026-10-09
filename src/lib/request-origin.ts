/**
 * Same-origin enforcement for the write routes.
 *
 * Mozhi's API is only ever called by its own pages. Requiring that closes the cheapest abuse
 * route - another site, or a page in someone's browser, driving these endpoints - and costs
 * nothing. It does NOT stop a direct caller such as curl, which can set any header it likes;
 * that is what the rate limits and platform-level protection are for.
 *
 * Pure and header-only, so it is directly testable.
 */

/** Browsers send this on every fetch; it cannot be set by page JavaScript. */
type FetchSite = "same-origin" | "same-site" | "cross-site" | "none";

const ACCEPTED_SITES: FetchSite[] = ["same-origin", "same-site"];

export type OriginCheck = { ok: true } | { ok: false; reason: string };

/**
 * Accepts the request when it demonstrably comes from the app's own origin.
 *
 * Two independent signals are consulted, because neither is universal:
 *  - `Sec-Fetch-Site`, sent by current browsers and not forgeable from page script. When
 *    present it is authoritative.
 *  - `Origin` compared against the request's own `Host`, for clients that omit the former.
 *
 * When neither header is present the request is allowed through: non-browser callers (curl,
 * server-to-server, uptime checks) legitimately send neither, and blocking on absence would
 * break them without stopping an attacker, who would simply add the headers.
 */
export function checkSameOrigin(headers: Headers): OriginCheck {
  const fetchSite = headers.get("sec-fetch-site") as FetchSite | null;
  if (fetchSite) {
    return ACCEPTED_SITES.includes(fetchSite)
      ? { ok: true }
      : { ok: false, reason: `cross-origin request (Sec-Fetch-Site: ${fetchSite})` };
  }

  const origin = headers.get("origin");
  if (!origin) return { ok: true };

  // `Origin: null` is sent by sandboxed iframes and some privacy tooling; treat it as untrusted.
  if (origin === "null") {
    return { ok: false, reason: "opaque origin" };
  }

  const host = headers.get("host");
  if (!host) return { ok: true };

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return { ok: false, reason: "malformed Origin header" };
  }

  return originHost === host
    ? { ok: true }
    : { ok: false, reason: `Origin ${originHost} does not match host ${host}` };
}
