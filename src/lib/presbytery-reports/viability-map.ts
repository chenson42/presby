import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { congregationOversight } from "@/lib/db/domain/presbytery";
import { holdsPermissions } from "@/lib/org-portal/permission-check";
import { reportByKey, type ReportRead, type ReportViewer } from "./contract";
import { readRoster } from "./roster";
import { deriveViabilityMap, type ViabilityMapData } from "./map-derive";

const REPORT = reportByKey("viability");

/**
 * The map's pin read (DECISION-343, docs/work-log/2026-11-17-presbytery-dashboard-map.md).
 * A SIBLING of `readViability`, never folded into it: `readViability` feeds the
 * CSV export and its contract is "coordinates are never read", and a shared
 * transaction would let a failing map query abort the list's transaction (the
 * list is "the complete answer"; an enhancement must never take it down).
 *
 * In order: the viability key, checked LIVE in this reader's own transaction
 * (the page never decides it) -> `forbidden`; then the roster (a departed
 * congregation never appears); then ONE select of exactly four columns: the
 * about-org id, the score, the latitude and the longitude. Never notes, buildings,
 * insurance or dates. Read-only: no export, no CSV, no audit event (the
 * coordinate WRITE already records `CONGREGATION_OVERSIGHT_SET`, and coordinates
 * never enter its metadata). It exports no `export*` function, so the
 * `exportFunctionNames` pin stays at four.
 */
export async function readViabilityMap(tx: OrgTx, viewer: ReportViewer): Promise<ReportRead<ViabilityMapData>> {
  const [held] = await holdsPermissions(tx, viewer, [REPORT.permission]);
  if (!held) return { kind: "forbidden" };

  const roster = await readRoster(tx, viewer.organizationId);
  if (roster.length === 0) return { kind: "ok", data: deriveViabilityMap([], []) };

  const facts = await tx
    .select({
      aboutOrgId: congregationOversight.aboutOrgId,
      viabilityScore: congregationOversight.viabilityScore,
      latitude: congregationOversight.latitude,
      longitude: congregationOversight.longitude,
    })
    .from(congregationOversight)
    .where(
      and(
        eq(congregationOversight.organizationId, viewer.organizationId),
        inArray(
          congregationOversight.aboutOrgId,
          roster.map((r) => r.id),
        ),
      ),
    );
  return { kind: "ok", data: deriveViabilityMap(roster, facts) };
}

export function getViabilityMap(viewer: ReportViewer): Promise<ReportRead<ViabilityMapData>> {
  return withOrgContext(viewer.personId, viewer.organizationId, (tx) => readViabilityMap(tx, viewer));
}
