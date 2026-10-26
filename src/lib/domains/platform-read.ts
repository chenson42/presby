import "server-only";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { organizationDomains } from "@/lib/db/domain/domains";
import { organizationFeatureToggles } from "@/lib/db/domain/org-features";
import { organizationSites } from "@/lib/db/domain/sites";
import { buildChecklist, type ChecklistGroup, type ChecklistRow } from "./checklist";
import { OPERATOR_TOGGLE_KEYS } from "./toggles";
import { platformSiteAddress } from "./site-address";
import { TERMINAL_STATES, type DomainState } from "./state";

/**
 * platform-read.ts - the platform admin's READ side of the domains feature
 * (Batch 1d): the Domains section on `/admin/organizations/<id>` and the
 * cross-organization list. Reads only: every write stays in `service.ts` (A4).
 *
 * Runs on the platform connection (`getPlatformDb()`), which is correct for a
 * platform page and forbidden for anything under `(org)`. The caller has
 * already checked `FEATURES.ADMIN_ORGANIZATIONS`. No proof token ever leaves
 * this module: the checklist builder needs it to render the record the CHURCH
 * publishes, and the platform view is by design "exactly what the church sees"
 * (G31), which includes that record, so it is rendered; it is never logged,
 * audited or put in a list row.
 */

const TERMINAL: DomainState[] = [...TERMINAL_STATES];

function toChecklistRow(r: typeof organizationDomains.$inferSelect): ChecklistRow {
  return {
    id: r.id,
    hostname: r.hostname,
    claimName: r.claimName,
    purpose: r.purpose,
    webRole: r.webRole,
    state: r.state,
    platformHold: r.platformHold,
    proofToken: r.proofToken,
    lastCheckedAt: r.lastCheckedAt,
    lastCheckClass: r.lastCheckClass,
    expiresAt: r.expiresAt,
    graceEndsAt: r.graceEndsAt,
    observation: r.observation,
    providerChallenge: r.providerChallenge,
    createdAt: r.createdAt,
    stateChangedAt: r.stateChangedAt,
  };
}

export interface OrgDomainsForPlatform {
  groups: ChecklistGroup[];
  siteStatus: string | null;
  /** The two operator-enabled toggles; a missing row is OFF. */
  toggles: Record<string, boolean>;
  /** Whole days each non-terminal host has been in its current state, by row id (computed here so no page calls the clock during render). */
  daysInState: Record<string, number>;
  /** Hosts of a terminal claim, newest first, so support can see what the church released or lost. */
  history: Array<{ id: string; hostname: string; state: DomainState; releaseCause: string | null; at: string }>;
}

export async function readOrgDomainsForPlatform(
  organizationId: string,
  slug: string,
): Promise<OrgDomainsForPlatform> {
  const db = getPlatformDb();
  const rows = await db
    .select()
    .from(organizationDomains)
    .where(eq(organizationDomains.organizationId, organizationId))
    .orderBy(asc(organizationDomains.createdAt), asc(organizationDomains.hostname));
  const [site] = await db
    .select({ status: organizationSites.status })
    .from(organizationSites)
    .where(eq(organizationSites.organizationId, organizationId))
    .limit(1);
  const toggleRows = await db
    .select({ key: organizationFeatureToggles.featureKey, enabled: organizationFeatureToggles.enabled })
    .from(organizationFeatureToggles)
    .where(
      and(
        eq(organizationFeatureToggles.organizationId, organizationId),
        inArray(organizationFeatureToggles.featureKey, [...OPERATOR_TOGGLE_KEYS]),
      ),
    );
  const toggles: Record<string, boolean> = Object.fromEntries(OPERATOR_TOGGLE_KEYS.map((k) => [k, false]));
  for (const t of toggleRows) toggles[t.key] = t.enabled;

  return {
    groups: buildChecklist(rows.map(toChecklistRow), {
      siteStatus: site?.status ?? null,
      platformSiteUrl: platformSiteAddress(slug),
    }),
    siteStatus: site?.status ?? null,
    toggles,
    daysInState: Object.fromEntries(
      rows
        .filter((r) => !TERMINAL.includes(r.state))
        .map((r) => [r.id, Math.max(0, Math.floor((Date.now() - r.stateChangedAt.getTime()) / 86_400_000))]),
    ),
    history: rows
      .filter((r) => TERMINAL.includes(r.state))
      .sort((a, b) => b.stateChangedAt.getTime() - a.stateChangedAt.getTime())
      .slice(0, 10)
      .map((r) => ({
        id: r.id,
        hostname: r.hostname,
        state: r.state,
        releaseCause: r.releaseCause,
        at: r.stateChangedAt.toISOString(),
      })),
  };
}

export const PLATFORM_LIST_FILTERS = ["all", "attention", "held", "pending", "live", "lapsed", "releasing"] as const;
export type PlatformListFilter = (typeof PLATFORM_LIST_FILTERS)[number];

export function parsePlatformListFilter(value: string | undefined): PlatformListFilter {
  return (PLATFORM_LIST_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as PlatformListFilter)
    : "all";
}

export interface PlatformDomainListRow {
  id: string;
  hostname: string;
  organizationId: string;
  organizationName: string;
  purpose: "web" | "mail";
  state: DomainState;
  hold: "paused" | "disputed" | null;
  role: "canonical" | "alias" | null;
  lastCheckClass: string | null;
  lastCheckedAt: string | null;
  lastVerifiedAt: string | null;
  /** Whole days since it attached, when it is attached and has never been live. Null otherwise. */
  daysAttachedNotLive: number | null;
}

const ATTENTION_CLASSES = [
  "provider_unavailable",
  "config_error",
  "held_elsewhere",
  "provider_rejected",
  "dns_unknown",
];

/**
 * The one definition of "needs attention": a non-terminal host with a platform
 * hold, a lapse, a release in flight, or whose last check ended in a provider or
 * lookup problem. The "attention" filter of `listDomainsAcrossOrgs` and the
 * dashboard's Domains card (`countDomainsNeedingAttention`) both use it, so the
 * card and its destination list cannot disagree.
 */
function attentionCondition() {
  return and(
    notInArray(organizationDomains.state, TERMINAL),
    sql`(${organizationDomains.platformHold} is not null
         or ${organizationDomains.state} in ('lapsed','parked','release_pending')
         or ${organizationDomains.lastCheckClass} in (${sql.join(ATTENTION_CLASSES.map((c) => sql`${c}`), sql`, `)}))`,
  );
}

/** How many hostnames need attention (not organizations): one statement, no rows leave it. */
export async function countDomainsNeedingAttention(): Promise<number> {
  const [row] = await getPlatformDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(organizationDomains)
    .innerJoin(organizations, eq(organizations.id, organizationDomains.organizationId))
    .where(attentionCondition());
  return Number(row?.n ?? 0);
}

/**
 * Every non-terminal host across organizations (web, and mail once 2c writes
 * mail rows), oldest state first within a filter, capped. "Attention" means a
 * hold, a lapse, a release in flight, or the last check ended in a provider or
 * lookup problem.
 */
export async function listDomainsAcrossOrgs(
  filter: PlatformListFilter,
  limit = 200,
): Promise<{ rows: PlatformDomainListRow[]; truncated: boolean }> {
  const db = getPlatformDb();
  const live = notInArray(organizationDomains.state, TERMINAL);
  const conditions = {
    all: live,
    attention: attentionCondition(),
    held: and(live, sql`${organizationDomains.platformHold} is not null`),
    pending: and(live, inArray(organizationDomains.state, ["pending", "verified", "attach_pending", "attached"])),
    live: and(live, eq(organizationDomains.state, "live")),
    lapsed: and(live, inArray(organizationDomains.state, ["lapsed", "parked"])),
    releasing: and(live, eq(organizationDomains.state, "release_pending")),
  }[filter];

  const found = await db
    .select({
      d: organizationDomains,
      organizationName: organizations.name,
    })
    .from(organizationDomains)
    .innerJoin(organizations, eq(organizations.id, organizationDomains.organizationId))
    .where(conditions)
    .orderBy(asc(organizations.name), desc(organizationDomains.webRole), asc(organizationDomains.hostname))
    .limit(limit + 1);

  const now = Date.now();
  const rows = found.slice(0, limit).map(({ d, organizationName }): PlatformDomainListRow => ({
    id: d.id,
    hostname: d.hostname,
    organizationId: d.organizationId,
    organizationName,
    purpose: d.purpose,
    state: d.state,
    hold: d.platformHold,
    role: d.webRole,
    lastCheckClass: d.lastCheckClass,
    lastCheckedAt: d.lastCheckedAt ? d.lastCheckedAt.toISOString() : null,
    lastVerifiedAt: d.proofLastOkAt ? d.proofLastOkAt.toISOString() : null,
    daysAttachedNotLive:
      d.attachedAt !== null && d.liveAt === null && d.state !== "lapsed" && d.state !== "parked"
        ? Math.floor((now - d.attachedAt.getTime()) / 86_400_000)
        : null,
  }));
  return { rows, truncated: found.length > limit };
}
