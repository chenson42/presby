import { buildChecklist, type ChecklistGroup, type ChecklistRow } from "./checklist";
import type { DomainState } from "./state";

/**
 * TEST SUPPORT ONLY (imported by the domains component and page tests; never by
 * application code). Builds `ChecklistGroup`s through the real, pure
 * `buildChecklist`, so a component test renders exactly the view-model the page
 * would, rather than a hand-made object that could drift from it. Hosts are
 * `*.invalid`: No Real Data.
 */

export const FIXTURE_CTX = { siteStatus: "live" as string | null, platformSiteUrl: "presbyportal.invalid/site/alder-creek" };
export const FIXTURE_TOKEN = "T0kenT0kenT0kenT0kenT0kenT0kenT0ken";

export const FIXTURE_TARGETS = { cname: "cname.vercel-dns.invalid", ipv4: ["203.0.113.9"], source: "provider" as const };

export function fixtureRow(
  over: Partial<ChecklistRow> & { hostname: string; state: DomainState },
): ChecklistRow {
  return {
    id: `id-${over.hostname}`,
    claimName: "church-one.invalid",
    purpose: "web",
    webRole: "alias",
    platformHold: null,
    proofToken: FIXTURE_TOKEN,
    lastCheckedAt: null,
    lastCheckClass: null,
    expiresAt: new Date("2030-01-08T00:00:00Z"),
    graceEndsAt: null,
    observation: {},
    ...over,
  };
}

/** The apex and its `www.` twin in one state; `www.` is the primary. */
export function fixturePair(state: DomainState, extra: Partial<ChecklistRow> = {}): ChecklistRow[] {
  return [
    fixtureRow({ hostname: "church-one.invalid", state, webRole: "alias", ...extra }),
    fixtureRow({ hostname: "www.church-one.invalid", state, webRole: "canonical", ...extra }),
  ];
}

export function fixtureGroups(
  rows: ChecklistRow[],
  ctx: { siteStatus: string | null; platformSiteUrl: string } = FIXTURE_CTX,
): ChecklistGroup[] {
  return buildChecklist(rows, ctx);
}

export function fixtureGroup(state: DomainState, extra: Partial<ChecklistRow> = {}): ChecklistGroup {
  return fixtureGroups(fixturePair(state, extra))[0]!;
}

export const observation = (extra: Record<string, unknown>) => ({ checkedAt: "2030-01-01T00:00:00.000Z", ...extra });
