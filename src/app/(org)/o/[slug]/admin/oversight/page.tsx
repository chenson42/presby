import { OrgAccessError } from "@/lib/authz";
import { getCongregationOversightList } from "@/lib/presbytery";
import { gateOversightPage } from "@/lib/presbytery-reports/gate";
import { OversightGateStateView, OVERSIGHT_AREA } from "./oversight-gate-state";
import { OversightForbidden, OversightLoadError } from "./oversight-states";
import { OversightList } from "./oversight-list";

const AREA = OVERSIGHT_AREA;

/**
 * `/o/<slug>/admin/oversight` — Presbytery program Increments 3/3b Phase 3
 * design (`docs/work-log/2026-08-27-presbytery-program.md`, DECISION-118
 * through 121), now behind `gateOversightPage` (DECISION-347, F452): signed in,
 * the Node-side second-factor recheck, the four-way org miss, `assertOrgAccess`,
 * the `org_portal.oversight` flag, then the organization type (presbytery), in
 * that order. The key is each reader's own business, inside its own transaction.
 * A congregation/synod/GA org with the flag ON still lands on
 * `PlaceholderNotAvailable`, never `OversightForbidden` — the latter reads as
 * "ask your administrator", which is wrong at an organization where no key can
 * exist.
 */
export default async function OversightPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const gate = await gateOversightPage({ slug, path: `/o/${slug}/admin/oversight` });
  if (!gate.ok) return <OversightGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  let result;
  try {
    result = await getCongregationOversightList(identity.personId, identity.organizationId);
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
    return <OversightLoadError slug={slug} />;
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{AREA}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{identity.organizationName}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The presbytery&apos;s own record of each member congregation&apos;s
          viability, buildings, and insurance — never the congregation&apos;s
          own data.
        </p>
      </div>
      <OversightList entries={result.data} slug={slug} />
    </section>
  );
}
