/**
 * The viability map's derivation (DECISION-343, docs/work-log/
 * 2026-11-17-presbytery-dashboard-map.md). PURE: no database, no `server-only`.
 *
 * It starts from the ROSTER (a departed or closed congregation never enters, and
 * is neither a pin nor "Not on the map"), joins the selected oversight facts,
 * and decides what each row means through the one coordinate rule
 * (`src/lib/coordinates.ts`): a pin exists only when `mappablePair` accepts the
 * row's two parsed columns. The column is unconstrained `numeric`, so a stored
 * 'NaN', 'Infinity', a half-set pair, an out-of-range value or exactly 0 and 0 is
 * UNPLACED, counted in "Not on the map", never silently dropped and never drawn.
 *
 * The score-to-label table is `derive.ts`'s (no second one), and so is its
 * `RangeError` on a score outside 1 to 3: a corrupt score degrades the map's own
 * read to its error line, the same as the list's card.
 *
 * `toClientPins` is the ONLY place a pin's `href` is built, from the gate-resolved
 * slug and a database uuid; a name is never in an href. A client pin has EXACTLY
 * seven keys (pinned by test): nothing else about a congregation (notes,
 * buildings, insurance, dates) reaches the browser.
 */
import { mappablePair, parseCoordinateField } from "@/lib/coordinates";
import { VIABILITY_LABELS, VIABILITY_NOT_ASSESSED, type RosterEntry } from "./derive";

export interface MapFact {
  aboutOrgId: string;
  viabilityScore: number | null;
  latitude: string | null;
  longitude: string | null;
}

export interface MapPin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  score: 1 | 2 | 3 | null;
  label: string;
}

export interface ViabilityMapData {
  /** Every current member congregation: the roster count. */
  total: number;
  pins: MapPin[];
  /** Roster congregations with no usable location, in roster order. */
  unplaced: { id: string; name: string }[];
}

function numberOrNull(text: string | null): number | null {
  const parsed = parseCoordinateField(text);
  return parsed.kind === "number" ? parsed.value : null;
}

export function deriveViabilityMap(roster: readonly RosterEntry[], facts: readonly MapFact[]): ViabilityMapData {
  const byOrg = new Map(facts.map((f) => [f.aboutOrgId, f]));
  const pins: MapPin[] = [];
  const unplaced: { id: string; name: string }[] = [];

  for (const cong of roster) {
    const fact = byOrg.get(cong.id);
    const pair = fact ? mappablePair(numberOrNull(fact.latitude), numberOrNull(fact.longitude)) : null;
    if (!fact || !pair) {
      unplaced.push({ id: cong.id, name: cong.name });
      continue;
    }
    const score = fact.viabilityScore;
    if (score !== null && !(score in VIABILITY_LABELS)) {
      throw new RangeError(`viability score out of range: ${score}`);
    }
    pins.push({
      id: cong.id,
      name: cong.name,
      lat: pair.lat,
      lng: pair.lng,
      score: score as 1 | 2 | 3 | null,
      label: score === null ? VIABILITY_NOT_ASSESSED : VIABILITY_LABELS[score]!,
    });
  }
  return { total: roster.length, pins, unplaced };
}

/** What the browser receives. EXACTLY these seven keys. */
export interface ClientPin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  score: 1 | 2 | 3 | null;
  label: string;
  href: string | null;
}

export function toClientPins(data: ViabilityMapData, slug: string, oversightOn: boolean): ClientPin[] {
  return data.pins.map((p) => ({
    id: p.id,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    score: p.score,
    label: p.label,
    href: oversightOn ? `/o/${slug}/admin/oversight/${p.id}` : null,
  }));
}
