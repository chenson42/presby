/**
 * Query-string parsing and href building for the member calendar. Pure.
 *
 * Every parser here is total: a hostile or garbled `?month=`, `?types=` or
 * `?view=` becomes the default and never throws, because the page renders on
 * whatever the URL says. `?types=` is untrusted twice over — it is shape-
 * checked here and then intersected with the org's own ACTIVE type ids inside
 * the read transaction (an id from another org is dropped by that
 * intersection, not merely hidden by RLS).
 */
import { isUuidShaped } from "@/lib/shared/uuid";
import { monthKey, type MonthRef } from "./month";

export { isUuidShaped };

export type CalendarView = "month" | "list";

export const MAX_TYPES_PARAM_ENTRIES = 50;
export const MAX_TYPES_PARAM_CHARS = 2000;

function firstString(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : null;
}

/** Only "list" is the list view; anything else is the month grid. */
export function parseViewParam(raw: string | string[] | undefined): CalendarView {
  return firstString(raw) === "list" ? "list" : "month";
}

/**
 * Slice to 2,000 chars, split on commas, keep UUID-shaped tokens only
 * (lower-cased, de-duplicated, order kept), first 50. Arrays use their first
 * element. NEVER throws.
 */
export function parseTypesParam(raw: string | string[] | undefined): string[] {
  const value = firstString(raw);
  if (value === null) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const token of value.slice(0, MAX_TYPES_PARAM_CHARS).split(",")) {
    const candidate = token.trim().toLowerCase();
    if (!isUuidShaped(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    ids.push(candidate);
    if (ids.length >= MAX_TYPES_PARAM_ENTRIES) break;
  }
  return ids;
}

/** Normalise a candidate selection against the active set: [] means "All". */
function normalizeSelection(
  selection: readonly string[],
  activeTypeIds: readonly string[],
): string[] {
  const active = new Set(activeTypeIds.map((id) => id.toLowerCase()));
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const id of selection) {
    const lower = id.toLowerCase();
    if (!active.has(lower) || seen.has(lower)) continue;
    seen.add(lower);
    kept.push(lower);
  }
  // Nothing valid -> All. Every active type selected -> All as well, so
  // "Filters: 5 active" is never shown for a filter that filters nothing.
  if (kept.length === 0 || kept.length === active.size) return [];
  return kept;
}

/**
 * Intersect with the org's ACTIVE type ids. [] means "All" and is returned
 * when nothing valid remains OR when the valid set covers every active type.
 */
export function sanitizeTypeFilter(
  requested: readonly string[],
  activeTypeIds: readonly string[],
): string[] {
  return normalizeSelection(requested, activeTypeIds);
}

/**
 * The pill semantics: selected = [] is All; clicking a pill from All starts a
 * one-item list; clicking a selected pill removes it; empty OR covering every
 * active type -> [].
 */
export function toggleTypeSelection(
  selected: readonly string[],
  id: string,
  activeTypeIds: readonly string[],
): string[] {
  const lower = id.toLowerCase();
  const current = normalizeSelection(selected, activeTypeIds);
  if (!activeTypeIds.some((a) => a.toLowerCase() === lower)) return current;
  if (current.length === 0) return normalizeSelection([lower], activeTypeIds);
  return normalizeSelection(
    current.includes(lower) ? current.filter((x) => x !== lower) : [...current, lower],
    activeTypeIds,
  );
}

/** "Worship only" / "3 event types" / null (All). */
export function describeTypeFilter(selectedNames: readonly string[]): string | null {
  if (selectedNames.length === 0) return null;
  if (selectedNames.length === 1) return `${selectedNames[0]} only`;
  return `${selectedNames.length} event types`;
}

export interface CalendarHrefState {
  month: MonthRef | null;
  types: readonly string[];
  view: CalendarView;
}

/**
 * /o/<slug>/calendar[?month=YYYY-MM][&types=a,b][&view=list] — that parameter
 * order; month null / types [] / view "month" are omitted. No encoding needed:
 * a UUID is [0-9a-f-].
 */
export function buildCalendarHref(slug: string, state: CalendarHrefState): string {
  const params: string[] = [];
  if (state.month) params.push(`month=${monthKey(state.month)}`);
  if (state.types.length > 0) params.push(`types=${state.types.join(",")}`);
  if (state.view === "list") params.push("view=list");
  const base = `/o/${slug}/calendar`;
  return params.length > 0 ? `${base}?${params.join("&")}` : base;
}

const BACK_QUERY_RE = /^[A-Za-z0-9=&,_.%-]{0,300}$/;

/**
 * Validate a `?from=`. Accepts exactly /o/<slug> (the portal home), or
 * /o/<slug>/calendar optionally followed by ?<[A-Za-z0-9=&,_.%-]{0,300}>.
 * Anything else — another prefix, //, a backslash, a fragment, a non-string, a
 * longer query — yields the hardcoded default. The value is never reflected
 * raw: an accepted `from` is returned only after matching this allow-list.
 */
export function safeCalendarBackHref(
  slug: string,
  from: unknown,
): { href: string; label: "calendar" | "home" } {
  const fallback = { href: `/o/${slug}/calendar`, label: "calendar" as const };
  if (typeof from !== "string") return fallback;

  const home = `/o/${slug}`;
  const calendar = `/o/${slug}/calendar`;
  if (from === home) return { href: home, label: "home" };
  if (from === calendar) return fallback;
  if (from.startsWith(`${calendar}?`)) {
    const query = from.slice(calendar.length + 1);
    if (BACK_QUERY_RE.test(query)) {
      return { href: from, label: "calendar" };
    }
  }
  return fallback;
}
