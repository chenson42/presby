import { LIMITS, type TeamKind } from "./vocab";

/**
 * The ready-made position sets "New team" offers - docs/work-log/2026-11-04-
 * worship-inc1.md, Phase 3 Copy G3 ("Starter sets"). PURE.
 *
 * A starter is a convenience, never a catalog: the positions it creates are
 * ordinary rows the team can rename, resize and retire. `none` creates no
 * positions.
 */

export interface StarterPosition {
  name: string;
  slots: number;
}

export const STARTER_KEYS = [
  "praise_band",
  "choir",
  "liturgical",
  "ushers",
  "greeters",
  "sound",
  "none",
] as const;
export type StarterKey = (typeof STARTER_KEYS)[number];

export interface StarterSet {
  key: StarterKey;
  label: string;
  positions: readonly StarterPosition[];
}

const p = (name: string, slots = 1): StarterPosition => ({ name, slots });

export const STARTER_SETS: readonly StarterSet[] = [
  {
    key: "praise_band",
    label: "Praise band",
    positions: [
      p("Worship leader"),
      p("Vocals", 2),
      p("Acoustic guitar"),
      p("Electric guitar"),
      p("Bass"),
      p("Drums"),
      p("Keys"),
    ],
  },
  {
    key: "choir",
    label: "Choir",
    positions: [p("Director"), p("Accompanist"), p("Soprano"), p("Alto"), p("Tenor"), p("Bass")],
  },
  {
    key: "liturgical",
    label: "Liturgical team",
    positions: [p("Liturgist"), p("Scripture reader"), p("Preacher"), p("Children's message")],
  },
  { key: "ushers", label: "Ushers", positions: [p("Head usher"), p("Usher", 2)] },
  { key: "greeters", label: "Greeters", positions: [p("Greeter", 2)] },
  { key: "sound", label: "Sound and projection", positions: [p("Sound"), p("Projection")] },
  { key: "none", label: "None, I'll add my own", positions: [] },
];

export function isStarterKey(value: unknown): value is StarterKey {
  return typeof value === "string" && (STARTER_KEYS as readonly string[]).includes(value);
}

/** The positions for a starter key, or an empty list for `none` or an unknown key. */
export function startersFor(key: StarterKey | undefined | null): readonly StarterPosition[] {
  if (!key) return [];
  return STARTER_SETS.find((set) => set.key === key)?.positions ?? [];
}

/** The kind a starter suggests (the form pre-selects it; the viewer can change it). */
export function suggestedKind(key: StarterKey): TeamKind {
  return key === "choir" ? "choir" : "team";
}

export const STARTER_POSITION_LIMIT = LIMITS.positionsPerTeam;
