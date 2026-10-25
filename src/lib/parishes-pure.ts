import { z } from "zod";
import type { Connection } from "@/lib/community-labels";

/**
 * Parish (deacon-district) management - the pure half
 * (docs/work-log/2026-10-25-parish-management.md, Phase 3 "API Contract";
 * DECISION-242 to 245).
 *
 * No `server-only`, no database: the client islands and the tests import it, and
 * `src/lib/parishes.ts` (the ONLY writer of `org_units` and
 * `households.org_unit_id`) builds on it. It holds the constants the surfaces
 * and the library must agree on, the district-name rule, the allowlist parser
 * for the Unassigned page's `?hide=` state, and the household bucketing.
 */

/** The per-org toggle (`ORG_FEATURE_CATALOG`). Toggle-only: no platform flag. */
export const PARISHES_FEATURE_KEY = "org_portal.parishes";

/** The seat-only permission (drizzle/0068): held only through the Moderator of
 * the Board of Deacons seat. Administrators move households with
 * `people.manage` instead. */
export const PARISH_ASSIGN_KEY = "parishes.assign";

/**
 * Permission keys that may be held only through a recorded seat. Pinned equal to
 * `presby_seat_key_group()` in drizzle/0068 by a source-scan test
 * (`parishes-boundaries.test.ts`). `role-grants.ts` and `role-definitions.ts`
 * refuse such a key with a typed result before the database does; the guard
 * triggers are the backstop.
 */
export const SEAT_ONLY_PERMISSION_KEYS: readonly string[] = [PARISH_ASSIGN_KEY];

export function isSeatOnlyPermissionKey(key: string): boolean {
  return SEAT_ONLY_PERMISSION_KEYS.includes(key);
}

/** `org_units.unit_type` values the management surfaces cover (G7). A `campus`
 * is multi-site, not deacon care, and is never a move target. */
export const MANAGEABLE_UNIT_TYPES = ["district", "parish"] as const;

/** The most households one bulk move may carry (G9). Over this: refuse, never
 * truncate. */
export const BULK_MOVE_MAX = 100;

export const DISTRICT_NAME_MAX = 80;

export const UNASSIGNED_PAGE_SIZE = 25;

/** How long the Undo toast stays up after a single move or assignment. */
export const UNDO_WINDOW_MS = 10_000;

/** The four exclusive household buckets of the Unassigned page, in precedence
 * order (G8): the first that fits wins. */
export const UNASSIGNED_GROUPS = [
  "members",
  "participants",
  "visitors",
  "others",
] as const;

export type UnassignedGroup = (typeof UNASSIGNED_GROUPS)[number];

export const UNASSIGNED_GROUP_LABELS: Record<UnassignedGroup, string> = {
  members: "Members",
  participants: "Participants",
  visitors: "Visitors",
  others: "Others",
};

// ---------------------------------------------------------------------------
// District names
// ---------------------------------------------------------------------------

export type NormalizedDistrictName =
  | { ok: true; name: string }
  | { ok: false; reason: "empty" | "too_long" };

/** More than this before cleaning is refused without running the regexes, so a
 * 5,000-character name costs nothing. */
const RAW_NAME_CEILING = 1_000;

/** Zero-width characters, the word joiner and the BOM: removed BEFORE
 * whitespace is collapsed (JavaScript's `\s` matches U+FEFF, which would
 * otherwise turn one inside a word into a space). */
const INVISIBLE_CHARS = /[\u200B-\u200D\u2060\uFEFF]/g;

/** C0 and C1 controls: removed AFTER whitespace is collapsed, so a tab or a
 * newline has already become a space and only the rest is dropped. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * The stored form of a district name, matching `org_units_name_shape`
 * (trimmed, NFC-normalized, 1 to 80 characters): every whitespace run (tabs
 * and newlines included) to one space, control and zero-width characters
 * removed, trimmed, then NFC last so the result is NFC whatever was stripped.
 * Length is counted in characters (code points), as the
 * database's `char_length` counts them. The caller compares names
 * case-insensitively; the unique index on `lower(name)` is the real guard.
 */
export function normalizeDistrictName(raw: unknown): NormalizedDistrictName {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  if (raw.length > RAW_NAME_CEILING) return { ok: false, reason: "too_long" };
  // NFC runs LAST: removing a zero-width or control character can join a base
  // letter to a combining mark that was separated by it, and the stored form
  // must be NFC (QA run 1, Finding 2).
  const name = raw
    .replace(INVISIBLE_CHARS, "")
    .replace(/\s+/g, " ")
    .replace(CONTROL_CHARS, "")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC");
  if (name.length === 0) return { ok: false, reason: "empty" };
  if ([...name].length > DISTRICT_NAME_MAX) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, name };
}

/** The client-side form schema for define and rename; the server normalizes
 * again, and the database CHECK is the last layer. */
export const districtNameFormSchema = z.object({
  name: z
    .string()
    .superRefine((value, ctx) => {
      const result = normalizeDistrictName(value);
      if (result.ok) return;
      ctx.addIssue({
        code: "custom",
        message:
          result.reason === "empty"
            ? "Enter a name for the district."
            : `Use ${DISTRICT_NAME_MAX} characters or fewer.`,
      });
    }),
});

export type DistrictNameFormValues = z.infer<typeof districtNameFormSchema>;

// ---------------------------------------------------------------------------
// The Unassigned page's URL state
// ---------------------------------------------------------------------------

/**
 * `?hide=members,visitors` parsed against the allowlist. An unknown token is
 * ignored, a repeated one collapses, and anything that is not a string is
 * treated as absent: the raw value never reaches a query branch.
 */
export function parseHide(
  raw: string | string[] | undefined | null,
): Set<UnassignedGroup> {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const hidden = new Set<UnassignedGroup>();
  if (typeof value !== "string") return hidden;
  for (const token of value.split(",")) {
    const trimmed = token.trim();
    if ((UNASSIGNED_GROUPS as readonly string[]).includes(trimmed)) {
      hidden.add(trimmed as UnassignedGroup);
    }
  }
  return hidden;
}

/** The `?hide=` value for a set, in canonical order; `null` when nothing is
 * hidden (so the param is omitted from the URL). */
export function serializeHide(hidden: ReadonlySet<UnassignedGroup>): string | null {
  const tokens = UNASSIGNED_GROUPS.filter((group) => hidden.has(group));
  return tokens.length === 0 ? null : tokens.join(",");
}

/** `?page=` as a positive integer; anything else is page 1. */
export function parsePage(raw: string | string[] | undefined | null): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value)) return 1;
  return Number(value);
}

// ---------------------------------------------------------------------------
// Household buckets
// ---------------------------------------------------------------------------

/**
 * The one bucket a household sits in, first match wins (G8): any member makes
 * it a Members household, else any participant, else any visitor, else Others
 * (listed or staff only). The person-level vocabulary is `deriveConnection()`
 * in `community-labels.ts` - there is no second copy of it.
 */
export function bucketForConnections(
  connections: readonly Connection[],
): UnassignedGroup {
  if (connections.includes("member")) return "members";
  if (connections.includes("participant")) return "participants";
  if (connections.includes("visitor")) return "visitors";
  return "others";
}
