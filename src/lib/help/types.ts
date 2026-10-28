/**
 * The help registry's types (DECISION-293/294, Increment 1 Phase 3 "API Contract").
 *
 * PURE and RELATIVE-IMPORT ONLY: next.config.ts loads types.ts, registry.ts and
 * select.ts outside the `@/` alias (it spreads helpRedirects() into redirects()),
 * so nothing here may import through `@/` or reach a server module.
 * config-imports.test.ts pins that.
 */

export const HELP_AUDIENCES = ["prospective", "everyone", "administrator", "treasurer"] as const;
export type HelpAudience = (typeof HELP_AUDIENCES)[number];

/** The index's group headings (Copy C1). A group with no published page is omitted. */
export const HELP_AUDIENCE_LABELS: Record<HelpAudience, string> = {
  prospective: "Thinking about PresbyPortal",
  everyone: "Everyone who signs in",
  administrator: "Church administrators",
  treasurer: "Treasurers",
};

/** The `[help:<token>]` on exactly one docs/TODO.md line. */
export type HelpToken = string;
export type HelpVersion = `${number}.${number}.${number}`;

export interface HelpNeeds {
  /** The role in the UI's own words, never a permission key (H11). */
  who: string;
  /** `name` must equal the catalog name; `defaultOn` equals its `provisionedOn` (coverage.test.ts). */
  turnOn?: { toggleKey: string; name: string; defaultOn: boolean };
  /** Must equal the catalog's `orgTypes` (coverage.test.ts). */
  appliesTo?: "all" | "congregations" | "congregations-and-nwcs" | "presbyteries";
  /** Must equal the catalog's `operatorEnabled`. */
  operatorEnabled?: boolean;
}

interface HelpBase {
  /** Permanent; kebab-case; never "planned" or "contact". */
  slug: string;
  /** The page's only <h1>; a content file may not contain a level-1 heading. */
  title: string;
  /** One sentence, shown under the h1 and in the index. */
  summary: string;
  /** Unique within its audience group. */
  order: number;
  /** Old slugs; each becomes a 308 on platform hosts. */
  aliases?: readonly string[];
}

export interface HelpContentEntry extends HelpBase {
  status: "published" | "pending";
  audience: HelpAudience;
  needs?: HelpNeeds;
  /** "org_portal.<toggle>", "tile:<key>", "flag:<key>" or "route:/<path>". */
  covers: readonly string[];
  /** Exact UI strings the page quotes (no interpolation). */
  labels: readonly string[];
  /** Heading slugs other code links to (declared, checked). */
  anchors?: readonly string[];
  /** A claim that someone re-walked the page; null only while pending. */
  verifiedIn: HelpVersion | null;
  /** Pending: required. Published: optional (its token line must then be Done). */
  requires?: HelpToken;
  /** The prose states a limit that an in-flight feature removes (P3-6). */
  limitationUntil?: HelpToken | readonly HelpToken[];
  // One token, or several when a page works around more than one open item (integration 0.50.0).
  /** Planned slugs this page retires (P3-7). */
  replaces?: readonly string[];
  /** Counts as coverage only for its own tile, never for a toggle key (P3-16). */
  overview?: true;
}

/** A labelled placeholder; its slug IS its `[help:<slug>]` token. No markdown file. */
export interface HelpPlannedEntry extends HelpBase {
  status: "planned";
  forWhom: string;
  /** The "Today:" line. */
  today: string;
  /** ISO date the operator last said "still planned". */
  confirmedOn: string;
}

export type HelpEntry = HelpContentEntry | HelpPlannedEntry;

/** One manifest entry of screenshots-data.ts (pure, hand-edited; P3-14). */
export interface HelpShot {
  id: string;
  /** The default alt; the markdown carries the alt actually rendered. */
  alt: string;
  route: string;
  /** The fixture user it is captured as. */
  user: string;
  viewport: number;
  /** The PNG's own pixel size; H17 compares it with the file header. */
  width: number;
  height: number;
  /** The release the capture spec last ran against. */
  capturedIn: HelpVersion;
}
