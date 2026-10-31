import { notFound, redirect } from "next/navigation";
import { OrgAccessError } from "@/lib/authz";
import { gateReimbursementPage } from "@/lib/reimbursement/gate";
import { getRequestDetail } from "@/lib/reimbursement/reads";
import { BackToReimbursements, ReimbursementLoadError, ReimbursementStatePage } from "../reimbursement-states";
import { RequestDetail } from "../request-detail";

/**
 * `/o/<slug>/reimbursements/<id>` - one request, read-only, with the buttons its
 * viewer may press. docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * "Component / Page Plan", P3-1 (the emailed link lands here), P3-3, EC16, EC24,
 * EC25.
 *
 * The emailed link is a bare path, so a signed-out approver goes through
 * `/signin?callbackUrl=<this path>` (and `/totp` when the account requires it)
 * and lands back here: `gateReimbursementPage` builds both redirects from `path`.
 *
 * ONE definer call decides everything about visibility: a request that does not
 * exist, one the viewer may not see, and an id that is not a uuid all read as
 * `not_found` and render the same neutral 404 (`./not-found.tsx`), with the same
 * reads either way. A viewer who is ONLY a treasury-key holder (not the
 * requester, the person being paid, or an approver of the group) belongs on the
 * treasurer's page, so they are sent to it (P3-3).
 *
 * A GET: it reads and writes nothing else - no view is recorded, no state moves.
 * No `loading.tsx`: this segment calls `notFound()`, and a Suspense boundary
 * would flush a 200 first (measured 2026-08-18).
 */
export default async function RequestDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const gate = await gateReimbursementPage({ slug, path: `/o/${slug}/reimbursements/${id}` });
  if (!gate.ok) return <ReimbursementStatePage state={gate.state} slug={slug} />;

  let found: Awaited<ReturnType<typeof getRequestDetail>>;
  try {
    found = await getRequestDetail(gate.identity, id, "member");
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <ReimbursementLoadError href={`/o/${slug}/reimbursements/${id}`} />;
  }
  // `denied` is the database refusing the caller's identity; to the visitor it is the same neutral answer.
  if (found.kind !== "ok" || found.detail.level !== "member") notFound();

  const detail = found.detail;
  if (detail.viewer.relation === "treasury") redirect(`/o/${slug}/admin/reimbursements/${detail.id}`);

  return (
    <div className="space-y-2">
      <BackToReimbursements slug={slug} />
      <RequestDetail slug={slug} detail={detail} />
    </div>
  );
}
