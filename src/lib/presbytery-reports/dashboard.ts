import "server-only";
import { OrgAccessError, withOrgContext } from "@/lib/authz";
import { DASHBOARD_REPORT_KEYS, type ReportKey, type ReportRead, type ReportViewer } from "./contract";
import {
  summarizePerCapita,
  summarizeTrend,
  summarizeVacant,
  toViabilityList,
  type PerCapitaSummary,
  type TrendSummary,
  type VacantSummary,
  type ViabilityList,
} from "./dashboard-derive";
import { getReportsHub } from "./hub";
import { getMembershipTrend } from "./membership-trend";
import { defaultBillingYear, defaultTrendWindow } from "./params";
import { getPerCapita } from "./per-capita";
import { readRoster } from "./roster";
import type { ViabilityMapData } from "./map-derive";
import { getVacantPulpits } from "./vacant-pulpits";
import { getViability } from "./viability";
import { getViabilityMap } from "./viability-map";

/**
 * The presbytery dashboard's composition (DECISION-342, docs/work-log/
 * 2026-11-17-presbytery-dashboard.md Phase 3). READ-ONLY: it writes nothing,
 * records no audit event and has no export (DECISION-339 audits exports only;
 * the `exportFunctionNames` pin in `boundaries.test.ts` stops one appearing
 * unreviewed).
 *
 *   1. ONE hub read first (`getReportsHub`: a live `presby_has_permission` per
 *      key). No key held is `forbidden` BEFORE any data read, so the roster
 *      count, which has no key of its own, is never reached by a keyless viewer.
 *   2. Then ONE TRANSACTION PER HELD READER plus one for the roster count, plus
 *      one for the map's pins (DECISION-343) when the viability key is held AND the
 *      caller says a tile key is configured (`options.map`; the page asks
 *      `mapTileConfig()`, this file stays a function of its arguments). All
 *      started together and settled independently (`Promise.allSettled`): a
 *      reader that throws (including `deriveViability`'s `RangeError` on an
 *      out-of-range score) degrades its own card and nothing else, and one
 *      aborted statement cannot poison another card's transaction.
 *   3. An `OrgAccessError` (membership ended mid-request) is RETHROWN to
 *      `[slug]/error.tsx`, never shown as a card error; any other rejection is
 *      that card's `error`. A reader's own `forbidden` (the key was revoked
 *      between the hub read and the read) is that card `locked`.
 *
 * The map is NOT a card: `map` sits beside `cards`. It is a sibling read (never
 * folded into the viability list's transaction, which feeds the CSV and must stay
 * "coordinates are never read", and so a failing map query cannot take the list
 * down). With `options.map` false, or the viability key not held, it is `off` and
 * NOTHING is read, so coordinates are never fetched for a viewer who cannot see
 * them or for an environment with no tile key. Its own `forbidden` is `locked`;
 * any other rejection is `error`; an `OrgAccessError` is rethrown like the others.
 *
 * Each reader still checks its own key inside its own transaction, so the hub
 * read only sequences the work; it is not the authority. `now` is read once by
 * the caller, and the trend window, the billing year and the vacant "today" are
 * all derived from it, so every card and its report link use the same explicit
 * year.
 */

export type CardResult<T> = { kind: "ok"; data: T } | { kind: "locked" } | { kind: "error" };

export interface DashboardCards {
  membership_trend: CardResult<TrendSummary>;
  vacant_pulpits: CardResult<VacantSummary>;
  per_capita: CardResult<PerCapitaSummary>;
  viability: CardResult<ViabilityList>;
}

/** The map's pins: `off` = not asked for or not allowed (nothing was read). */
export type MapResult = { kind: "off" } | { kind: "locked" } | { kind: "error" } | { kind: "ok"; data: ViabilityMapData };

export type PresbyteryDashboard =
  | { kind: "forbidden" }
  | { kind: "error" }
  | { kind: "ok"; roster: { kind: "ok"; count: number } | { kind: "error" }; cards: DashboardCards; map: MapResult };

/** The current member congregations: the one roster read (`roster.ts`), counted. Its own transaction. */
export function getRosterCount(viewer: ReportViewer): Promise<number> {
  return withOrgContext(viewer.personId, viewer.organizationId, async (tx) => {
    return (await readRoster(tx, viewer.organizationId)).length;
  });
}

const LOCKED = { kind: "locked" } as const;

async function card<D, S>(read: () => Promise<ReportRead<D>>, summarize: (data: D) => S): Promise<CardResult<S>> {
  const result = await read();
  if (result.kind === "forbidden") return LOCKED;
  return { kind: "ok", data: summarize(result.data) };
}

async function readMap(viewer: ReportViewer): Promise<MapResult> {
  const result = await getViabilityMap(viewer);
  return result.kind === "forbidden" ? { kind: "locked" } : { kind: "ok", data: result.data };
}

export async function getPresbyteryDashboard(
  viewer: ReportViewer,
  now: Date = new Date(),
  options: { map?: boolean } = {},
): Promise<PresbyteryDashboard> {
  let held: Record<ReportKey, boolean>;
  try {
    held = (await getReportsHub(viewer)).held;
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return { kind: "error" };
  }
  // The four dashboard keys only: Buildings shares the viability key, and the finance key has no card here.
  if (!DASHBOARD_REPORT_KEYS.some((key) => held[key])) return { kind: "forbidden" };

  const window = defaultTrendWindow(now);
  const billingYear = defaultBillingYear(now);

  const idle = <T>(): Promise<CardResult<T>> => Promise.resolve(LOCKED);
  const mapOff: Promise<MapResult> = Promise.resolve({ kind: "off" });
  const [roster, trend, vacant, perCapita, viability, mapPins] = await Promise.allSettled([
    getRosterCount(viewer),
    held.membership_trend ? card(() => getMembershipTrend(viewer, window), summarizeTrend) : idle<TrendSummary>(),
    held.vacant_pulpits ? card(() => getVacantPulpits(viewer, now), summarizeVacant) : idle<VacantSummary>(),
    held.per_capita
      ? card(() => getPerCapita(viewer, { kind: "year", billingYear }), summarizePerCapita)
      : idle<PerCapitaSummary>(),
    held.viability ? card(() => getViability(viewer), toViabilityList) : idle<ViabilityList>(),
    held.viability && options.map === true ? readMap(viewer) : mapOff,
  ]);

  for (const settled of [roster, trend, vacant, perCapita, viability, mapPins]) {
    if (settled.status === "rejected" && settled.reason instanceof OrgAccessError) throw settled.reason;
  }

  const cardOf = <T>(settled: PromiseSettledResult<CardResult<T>>): CardResult<T> =>
    settled.status === "fulfilled" ? settled.value : { kind: "error" };

  return {
    kind: "ok",
    roster: roster.status === "fulfilled" ? { kind: "ok", count: roster.value } : { kind: "error" },
    cards: {
      membership_trend: cardOf(trend),
      vacant_pulpits: cardOf(vacant),
      per_capita: cardOf(perCapita),
      viability: cardOf(viability),
    },
    map: mapPins.status === "fulfilled" ? mapPins.value : { kind: "error" },
  };
}
