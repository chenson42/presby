import { notFound } from "next/navigation";
import { OrgAccessError } from "@/lib/authz";
import { COPY } from "@/lib/reimbursement/copy";
import { gateReimbursementPage } from "@/lib/reimbursement/gate";
import { getOrgToday, getRequestDetail } from "@/lib/reimbursement/reads";
import { BackToReimbursements, ReimbursementLoadError, ReimbursementStatePage } from "../../../reimbursements/reimbursement-states";
import { TreasuryRequestDetail } from "./treasury-detail";

/**
 * `/o/<slug>/admin/reimbursements/<id>` - one request at the treasury level
 * (`reimbursement.view`). docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * "Component / Page Plan", P3-3 (the member page sends a treasury-only viewer
 * here), EC16, EC24, EC25, EC45.
 *
 * A signed-out treasurer goes through `/signin?callbackUrl=<this path>` and, when
 * the account needs it, `/totp`, and lands back here (`gateReimbursementPage`
 * builds both redirects from `path`). ONE definer call decides visibility: a
 * request that does not exist, one the viewer may not read, a draft and an id
 * that is not a uuid all read as `not_found` and render the same neutral 404
 * (`./not-found.tsx`), with the same reads either way.
 *
 * A GET: it reads and writes nothing (EC24). No `loading.tsx`: this segment calls
 * `notFound()`, and a Suspense boundary would flush a 200 first (measured
 * 2026-08-18).
 */
export default async function TreasuryRequestPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const path = `/o/${slug}/admin/reimbursements/${id}`;
  const gate = await gateReimbursementPage({ slug, path, anyOf: ["view"] });
  if (!gate.ok) {
    return (
      <ReimbursementStatePage
        state={gate.state}
        slug={slug}
        heading={COPY.queue.heading}
        retryHref={path}
        loadErrorMessage={COPY.queue.loadError}
      />
    );
  }
  const { identity } = gate;

  let found: Awaited<ReturnType<typeof getRequestDetail>>;
  let today: string;
  try {
    [found, today] = await Promise.all([getRequestDetail(identity, id, "treasury"), getOrgToday(identity)]);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <ReimbursementLoadError heading={COPY.queue.heading} message={COPY.queue.loadError} href={path} />;
  }
  // `denied` is the database refusing the caller's identity; to the visitor it is the same neutral answer.
  if (found.kind !== "ok" || found.detail.level !== "treasury") notFound();

  return (
    <div className="space-y-2">
      <BackToReimbursements slug={slug} href={`/o/${slug}/admin/reimbursements`} />
      <TreasuryRequestDetail slug={slug} detail={found.detail} orgToday={today} />
    </div>
  );
}
