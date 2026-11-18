import { notFound, redirect } from "next/navigation";
import { OrgAccessError } from "@/lib/authz";
import { isUuid } from "@/lib/is-uuid";
import { readOversightAccess } from "@/lib/oversight/reads";
import { gateOversightPage } from "@/lib/presbytery-reports/gate";
import { OversightGateStateView } from "../oversight-gate-state";
import { OversightForbidden, OversightLoadError } from "../oversight-states";

/**
 * `/o/<slug>/admin/oversight/<aboutOrgId>` — the record page.
 *
 * INTERIM (Batch B2 of docs/work-log/2026-11-17-congregation-profile-inc1.md):
 * T1 moved the assessment form to `assessment/edit/`, so this URL needs a page
 * that is not the old form. Batch B3 replaces this file with the sections page
 * (Profile, Assessment, Buildings, Insurance, Loans). Until then it runs the real
 * front door (`gateOversightPage`, `isUuid`, the either-key `readOversightAccess`)
 * and sends a holder of the assessment key to the assessment form, so the list's
 * link still lands somewhere that works.
 */
export default async function OversightRecordPage({
  params,
}: {
  params: Promise<{ slug: string; aboutOrgId: string }>;
}) {
  const { slug, aboutOrgId } = await params;

  const gate = await gateOversightPage({ slug, path: `/o/${slug}/admin/oversight/${aboutOrgId}` });
  if (!gate.ok) return <OversightGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  if (!isUuid(aboutOrgId)) notFound();

  let access;
  try {
    access = await readOversightAccess(identity, aboutOrgId);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <OversightLoadError slug={slug} />;
  }
  if (access.kind === "forbidden") return <OversightForbidden name={identity.organizationName} />;
  if (access.kind === "not_found") notFound();

  redirect(`/o/${slug}/admin/oversight/${aboutOrgId}/assessment/edit`);
}
