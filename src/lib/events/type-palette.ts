/**
 * The closed palette and icon vocabulary for event types (DECISION-161).
 *
 * PURE AND CLIENT-SAFE: the only import is the zero-runtime-import brand
 * contract, so this file can be read by a client component (the picker, the
 * manager's colour grid), by the Drizzle domain file (which builds its CHECK
 * lists from the arrays below), and by a vitest run with no database. The
 * `event_types_color_allowed` / `event_types_icon_allowed` CHECKs in
 * drizzle/0054 are a THIRD copy of these two lists; type-palette.test.ts reads
 * the migration and fails if any of the three drift.
 */
import { CATEGORY_KEYS, type CategoryKey } from "../brand/contract";

/** The nine palette keys - exactly CATEGORY_KEYS; `neutral` is the fallback's. */
export const EVENT_TYPE_COLORS = CATEGORY_KEYS;
export type EventTypeColor = CategoryKey;

/** What an admin may pick for a NEW or RE-COLOURED type. Neutral is reserved. */
export const SELECTABLE_EVENT_TYPE_COLORS = EVENT_TYPE_COLORS.filter(
  (color): color is Exclude<EventTypeColor, "neutral"> => color !== "neutral",
);

/**
 * Lucide icon names, every one verified present in the installed lucide-react
 * (1.16.0). Closed on purpose: a misspelled name fails `tsc` in the static
 * import map (event-type-icon.tsx), never at render time. Icon COMPONENTS never
 * cross the server->client boundary - pass the key.
 */
export const EVENT_TYPE_ICONS = [
  "Church",
  "Sparkles",
  "Music",
  "BookOpen",
  "Backpack",
  "Utensils",
  "HeartHandshake",
  "Gavel",
  "CalendarDays",
  "HandHeart",
  "HandHelping",
  "Users",
  "Coffee",
  "Baby",
  "Mic",
] as const;
export type EventTypeIcon = (typeof EVENT_TYPE_ICONS)[number];

export const DEFAULT_EVENT_TYPE_ICON: EventTypeIcon = "CalendarDays";

/** Plain-language labels for the manager's pickers (no jargon, ui-standards). */
export const EVENT_TYPE_COLOR_LABELS: Record<EventTypeColor, string> = {
  rose: "Rose",
  orange: "Orange",
  amber: "Amber",
  lime: "Lime",
  teal: "Teal",
  sky: "Sky blue",
  violet: "Violet",
  fuchsia: "Fuchsia",
  neutral: "Neutral",
};

export const EVENT_TYPE_ICON_LABELS: Record<EventTypeIcon, string> = {
  Church: "Church",
  Sparkles: "Sparkles",
  Music: "Music",
  BookOpen: "Open book",
  Backpack: "Backpack",
  Utensils: "Meal",
  HeartHandshake: "Service",
  Gavel: "Meeting",
  CalendarDays: "Calendar",
  HandHeart: "Care",
  HandHelping: "Helping hand",
  Users: "People",
  Coffee: "Coffee",
  Baby: "Nursery",
  Mic: "Microphone",
};

export interface TypeColorClasses {
  /** Tint surface + ink text: an entry chip or a pill. */
  readonly chip: string;
  /** Ink as text/icon colour only. */
  readonly ink: string;
  /** Ink as the left rule of an entry. */
  readonly rule: string;
  /** Ink as an all-sides border (a pill). */
  readonly border: string;
  /** Ink as a solid fill (a swatch). */
  readonly swatch: string;
}

/**
 * STATIC class lookup. Tailwind finds class names by scanning source for
 * literal strings, so these are written out in full - never built by
 * interpolating the key (`bg-category-${key}` would generate nothing).
 */
export const TYPE_COLOR_CLASSES: Record<EventTypeColor, TypeColorClasses> = {
  rose: { chip: "bg-category-rose text-category-rose-foreground", ink: "text-category-rose-foreground", rule: "border-l-category-rose-foreground", border: "border-category-rose-foreground", swatch: "bg-category-rose-foreground" },
  orange: { chip: "bg-category-orange text-category-orange-foreground", ink: "text-category-orange-foreground", rule: "border-l-category-orange-foreground", border: "border-category-orange-foreground", swatch: "bg-category-orange-foreground" },
  amber: { chip: "bg-category-amber text-category-amber-foreground", ink: "text-category-amber-foreground", rule: "border-l-category-amber-foreground", border: "border-category-amber-foreground", swatch: "bg-category-amber-foreground" },
  lime: { chip: "bg-category-lime text-category-lime-foreground", ink: "text-category-lime-foreground", rule: "border-l-category-lime-foreground", border: "border-category-lime-foreground", swatch: "bg-category-lime-foreground" },
  teal: { chip: "bg-category-teal text-category-teal-foreground", ink: "text-category-teal-foreground", rule: "border-l-category-teal-foreground", border: "border-category-teal-foreground", swatch: "bg-category-teal-foreground" },
  sky: { chip: "bg-category-sky text-category-sky-foreground", ink: "text-category-sky-foreground", rule: "border-l-category-sky-foreground", border: "border-category-sky-foreground", swatch: "bg-category-sky-foreground" },
  violet: { chip: "bg-category-violet text-category-violet-foreground", ink: "text-category-violet-foreground", rule: "border-l-category-violet-foreground", border: "border-category-violet-foreground", swatch: "bg-category-violet-foreground" },
  fuchsia: { chip: "bg-category-fuchsia text-category-fuchsia-foreground", ink: "text-category-fuchsia-foreground", rule: "border-l-category-fuchsia-foreground", border: "border-category-fuchsia-foreground", swatch: "bg-category-fuchsia-foreground" },
  neutral: { chip: "bg-category-neutral text-category-neutral-foreground", ink: "text-category-neutral-foreground", rule: "border-l-category-neutral-foreground", border: "border-category-neutral-foreground", swatch: "bg-category-neutral-foreground" },
};

export function isEventTypeColor(value: unknown): value is EventTypeColor {
  return typeof value === "string" && (EVENT_TYPE_COLORS as readonly string[]).includes(value);
}

export function isEventTypeIcon(value: unknown): value is EventTypeIcon {
  return typeof value === "string" && (EVENT_TYPE_ICONS as readonly string[]).includes(value);
}

/** Unknown or missing -> neutral, so a bad stored value degrades, never throws. */
export function typeColorClasses(token: string | null | undefined): TypeColorClasses {
  return isEventTypeColor(token) ? TYPE_COLOR_CLASSES[token] : TYPE_COLOR_CLASSES.neutral;
}
