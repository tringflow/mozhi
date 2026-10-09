import "server-only";
import { getSupabase, AUDIO_BUCKET } from "./supabase";
import { AUDIO_PATH_PATTERN, PATH_TOKEN_TTL_MS } from "./upload-token";
import { removeAudioObjects, legacyAudioPath } from "./audio-storage";

/**
 * Deletes audio objects that no history row references and that no client can still reach.
 *
 * Direct-to-Storage uploads can be abandoned: a tab closes between the upload and the save, or
 * the insert fails. Those objects would otherwise accumulate forever. Nothing is deleted on the
 * request path, because an object a user could still save must survive.
 *
 * WHY THE GRACE PERIOD IS SAFE
 * An object is reachable only by quoting its path together with the HMAC issued for it, and that
 * token expires after PATH_TOKEN_TTL_MS (2 hours). Both /api/transcribe and /api/translations
 * reject an expired token, so once the token is dead the object can never be referenced again by
 * any client. That makes "older than the token lifetime, and unreferenced" a sound definition of
 * dead, and it covers all three cases that must be protected:
 *   - active processing - a pipeline run completes in minutes, far inside the token window;
 *   - saved history - excluded explicitly by the reference check below;
 *   - a valid retry - a retry reuses the same reference, which only works while the token lives.
 * The default grace is 24 hours, an order of magnitude beyond the token lifetime.
 */

/** Hard floor on the grace period, so a misconfigured value can never reach a live upload. */
export const MIN_GRACE_MS = 2 * PATH_TOKEN_TTL_MS;
export const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000;

/** Objects examined per run. Bounds both the storage listing and the database lookup. */
export const MAX_OBJECTS_PER_RUN = 1000;

/** Reads ORPHAN_GRACE_HOURS if set, clamped so it can never drop below the safe floor. */
export function resolveGraceMs(raw = process.env.ORPHAN_GRACE_HOURS): number {
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_GRACE_MS;
  return Math.max(MIN_GRACE_MS, hours * 60 * 60 * 1000);
}

export interface StorageObject {
  name: string;
  created_at?: string | null;
}

export type OrphanDecision = {
  /** Paths safe to delete. */
  deletable: string[];
  /** Paths left alone, with the reason, for the run's log. */
  kept: { path: string; reason: string }[];
};

/**
 * Decides which listed objects may be deleted. Pure: no I/O, so the safety rules are directly
 * testable. Every rule fails closed - anything it cannot positively clear is kept.
 *
 * @param objects   entries from the `uploads/` prefix, names relative to that prefix
 * @param referenced object paths (bucket-relative) that a history row points at
 * @param cutoff    objects created at or after this instant are too new to touch
 */
export function selectOrphans(
  objects: StorageObject[],
  referenced: ReadonlySet<string>,
  cutoff: Date
): OrphanDecision {
  const deletable: string[] = [];
  const kept: { path: string; reason: string }[] = [];

  for (const object of objects) {
    const path = `uploads/${object.name}`;

    // 1. Only ever touch objects whose path this app minted. Anything else - a legacy
    //    root-level file, a manual upload, an unexpected folder - is out of scope.
    if (!AUDIO_PATH_PATTERN.test(path)) {
      kept.push({ path, reason: "not a minted upload path" });
      continue;
    }

    // 2. A referenced object belongs to saved history, however old it is.
    if (referenced.has(path)) {
      kept.push({ path, reason: "referenced by a history row" });
      continue;
    }

    // 3. Age must be positively established. A missing or unparseable timestamp is not
    //    evidence of age, so the object is kept and will be reconsidered next run.
    const createdAt = object.created_at ? Date.parse(object.created_at) : Number.NaN;
    if (!Number.isFinite(createdAt)) {
      kept.push({ path, reason: "no usable creation timestamp" });
      continue;
    }
    if (createdAt >= cutoff.getTime()) {
      kept.push({ path, reason: "within the grace period" });
      continue;
    }

    deletable.push(path);
  }

  return { deletable, kept };
}

export interface CleanupReport {
  scanned: number;
  deleted: number;
  keptCount: number;
  dryRun: boolean;
  graceHours: number;
  /** True when the listing filled up, so another run has more to do. */
  more: boolean;
}

/**
 * Looks up which of these candidate paths a history row still points at.
 *
 * Only the candidates are queried, so the cost does not grow with history. Rows written before
 * `audio_path` existed are not consulted: their objects sit at the bucket root, so they never
 * match AUDIO_PATH_PATTERN and rule 1 of `selectOrphans` already excludes them. The second
 * query is a narrow defensive net for the one shape that could slip past that reasoning - a
 * legacy-style URL that happens to point inside `uploads/`.
 */
async function referencedPaths(candidates: string[]): Promise<Set<string>> {
  const referenced = new Set<string>();
  if (candidates.length === 0) return referenced;

  const supabase = getSupabase();

  // `.in()` parameterises the list itself, and every candidate has already been matched against
  // AUDIO_PATH_PATTERN, so no path can alter the filter expression.
  const { data, error } = await supabase
    .from("translations")
    .select("audio_path")
    .in("audio_path", candidates);

  if (error) throw error;
  for (const row of data ?? []) {
    if (row.audio_path) referenced.add(row.audio_path);
  }

  const { data: legacyRows, error: legacyError } = await supabase
    .from("translations")
    .select("audio_url")
    .like("audio_url", "%/uploads/%");

  if (legacyError) throw legacyError;
  for (const row of legacyRows ?? []) {
    const legacy = legacyAudioPath(row.audio_url);
    if (legacy) referenced.add(legacy);
  }

  return referenced;
}

/**
 * One cleanup pass. Idempotent, so a duplicated or missed cron invocation is harmless: deleting
 * an already-deleted object is a no-op, and the next run picks up whatever was left.
 */
export async function cleanupOrphans(options: { dryRun?: boolean } = {}): Promise<CleanupReport> {
  const dryRun = options.dryRun === true;
  const graceMs = resolveGraceMs();
  const cutoff = new Date(Date.now() - graceMs);

  const { data: objects, error } = await getSupabase()
    .storage.from(AUDIO_BUCKET)
    .list("uploads", {
      limit: MAX_OBJECTS_PER_RUN,
      // Oldest first, so a backlog is worked through across runs instead of being re-scanned.
      sortBy: { column: "created_at", order: "asc" },
    });

  if (error) throw error;

  const listed = (objects ?? []).filter((entry) => entry.name);
  // Only ask the database about paths this app could have minted; `selectOrphans` enforces the
  // same rule again, so an object outside the pattern is never deleted even if listed here.
  const candidates = listed
    .map((entry) => `uploads/${entry.name}`)
    .filter((path) => AUDIO_PATH_PATTERN.test(path));
  const referenced = await referencedPaths(candidates);

  const { deletable, kept } = selectOrphans(listed, referenced, cutoff);

  // Batched, so a large backlog does not spend the run's time budget on round-trips.
  const removed = dryRun ? 0 : await removeAudioObjects(deletable);

  const report: CleanupReport = {
    scanned: listed.length,
    deleted: removed,
    keptCount: kept.length,
    dryRun,
    graceHours: graceMs / (60 * 60 * 1000),
    more: listed.length >= MAX_OBJECTS_PER_RUN,
  };

  console.info("[orphan-cleanup]", {
    ...report,
    candidates: deletable.length,
    cutoff: cutoff.toISOString(),
  });

  return report;
}
