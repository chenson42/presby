import { notFound } from "next/navigation";
import { BackLink } from "@/components/oversight/back-link";
import { OrgAccessError } from "@/lib/authz";
import { getCongregationOversightDetail } from "@/lib/presbytery";
import { isFlagEnabled } from "@/lib/flags";
import { isUuid } from "@/lib/is-uuid";
import { INSIGHTS_FLAG } from "@/lib/presbytery-reports/contract";
import { gateOversightPage } from "@/lib/presbytery-reports/gate";
import { mapTileConfig } from "@/lib/presbytery-reports/map-config";
import { OversightGateStateView } from "../../../oversight-gate-state";
import { OversightForbidden, OversightLoadError } from "../../../oversight-states";
import { OversightEditForm } from "./edit-form";

/**
 * `/o/<slug>/admin/oversight/<aboutOrgId>/assessment/edit` — one congregation's
 * assessment form (viability, redevelopment notes, property notes, map
 * location). Moved here from `<aboutOrgId>/` (T1, docs/work-log/
 * 2026-11-17-congregation-profile.md): the record page is now the sections page.
 *
 * ORDER: `gateOversightPage` (signed in, the Node-side second-factor recheck, the
 * four-way org miss, `assertOrgAccess`, the `org_portal.oversight` flag, the
 * presbytery type: F452), THEN `isUuid(aboutOrgId)` (a malformed id is a 404
 * before any read, not a load error), then the read.
 *
 * `getCongregationOversightDetail()`'s `invalid_target` (an `aboutOrgId` that
 * isn't an actual member congregation of THIS presbytery — the parent-path
 * check) is a real 404, same as `admin/officers/[personId]/page.tsx`'s identical
 * branch for `getOfficerHistory()`.
 */
export default async function OversightAssessmentEditPage({
  params,
}: {
  params: Promise<{ slug: string; aboutOrgId: string }>;
}) {
  const { slug, aboutOrgId } = await params;

  const gate = await gateOversightPage({ slug, path: `/o/${slug}/admin/oversight/${aboutOrgId}/assessment/edit` });
  if (!gate.ok) return <OversightGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  if (!isUuid(aboutOrgId)) notFound();

  let result;
  try {
    result = await getCongregationOversightDetail(identity.personId, identity.organizationId, aboutOrgId);
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <OversightLoadError slug={slug} />;
  }

  if (result.kind !== "ok") {
    if (result.kind === "forbidden") {
      return <OversightForbidden name={identity.organizationName} />;
    }
    if (result.kind === "invalid_target") {
      notFound();
    }
    return <OversightLoadError slug={slug} />;
  }

  // Whether the save toast may promise a place to see the pin (copy truthfulness,
  // DECISION-343): the Insights page is on AND a tile key is configured. Read only
  // after every gate above, and only to word a toast; it gates nothing.
  const mapOn = (await isFlagEnabled(INSIGHTS_FLAG)) && mapTileConfig() !== null;

  return (
    <section className="space-y-6">
      <div>
        <BackLink href={`/o/${slug}/admin/oversight/${aboutOrgId}`}>Back to {result.data.name}</BackLink>
        <h1 className="mt-3 text-2xl font-semibold">Edit assessment</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {identity.organizationName}&apos;s own oversight record for this congregation.
        </p>
      </div>
      <OversightEditForm slug={slug} aboutOrgId={aboutOrgId} row={result.data} mapOn={mapOn} />
    </section>
  );
}
