import "server-only";
import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { parseSiteKey } from "@/lib/domains/host";
import { isLearnPublicKey, type LearnPublicKey, type PublicLearn } from "./contract";

/**
 * The Learn pages' ONE anonymous read - `presby_public_learn(slug, key)` (drizzle/0087)
 * on the anonymous `db` connection with NO org context and NO session
 * (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 "API Contract"; DECISION-331/332).
 * The public route, the live slot and the `(org)` leader panel all read through here.
 *
 * Same shape as `src/lib/careers/public.ts`: one SECURITY DEFINER function that ALWAYS
 * returns exactly one row, one `try/catch`, a failure logged with the slug only (never
 * the error or its message, which embeds SQL and bound parameters).
 *
 * `failed` IS NOT `unavailable`. The definer collapses every "this organization does not
 * publish this page" reason into one `unavailable` answer, which the route renders as the
 * site's 404 and the slot renders as the notice. A read that did not complete says nothing
 * about the organization, so it must not 404 a real page: the route shows a `noindex`
 * notice for `failed`. Anything but exactly one row of a known state is `failed`.
 *
 * NO `unstable_cache` / `"use cache"`: freshness after an unpublish or a toggle rests on
 * the `force-dynamic` site layout. React `cache()` only dedupes two readers on one page
 * within one render. `getPlatformDb()` is not used anywhere here.
 */

const UNAVAILABLE: PublicLearn = { state: "unavailable" };
const FAILED: PublicLearn = { state: "failed" };

/**
 * Maps the function's rows to the union. Exported for the unit test. The only healthy
 * shape is exactly ONE row whose `state` is `available` or `unavailable`; no row, two
 * rows, an unknown state or a wrong type is `failed`, never an assumed answer.
 */
export function mapPublicLearnRow(rows: ReadonlyArray<Record<string, unknown>>): PublicLearn {
  if (rows.length !== 1) return FAILED;
  const row = rows[0];
  if (!row) return FAILED;
  if (row.state === "available") return { state: "available" };
  if (row.state === "unavailable") return UNAVAILABLE;
  return FAILED;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return ((result as { rows?: Record<string, unknown>[] } | null)?.rows ?? []) as Record<string, unknown>[];
}

/**
 * `slug` is the DATABASE-RETURNED slug (the render path's closure), never a request value;
 * a string that is not slug-shaped, or a key outside `LEARN_PUBLIC_KEYS`, is `unavailable`
 * WITHOUT a query. Never throws.
 */
export const readPublicLearn = cache(async function readPublicLearn(
  slug: string,
  key: LearnPublicKey,
): Promise<PublicLearn> {
  if (parseSiteKey(slug).kind !== "slug") return UNAVAILABLE;
  if (!isLearnPublicKey(key)) return UNAVAILABLE;
  try {
    const result = await db.execute(sql`select * from presby_public_learn(${slug}::text, ${key}::text)`);
    return mapPublicLearnRow(rowsOf(result));
  } catch {
    console.error("[public-learn] read failed", { slug });
    return FAILED;
  }
});
