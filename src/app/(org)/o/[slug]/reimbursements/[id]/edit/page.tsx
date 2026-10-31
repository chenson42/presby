import { notFound, redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { OrgAccessError } from "@/lib/authz";
import { gateReimbursementPage } from "@/lib/reimbursement/gate";
import { getFormOptions, getOrgToday, getRequestDetail } from "@/lib/reimbursement/reads";
import { ReimbursementLoadError, ReimbursementStatePage } from "../../reimbursement-states";
import { RequestForm } from "../../request-form";
import { detailToFormValues } from "../../request-form-model";
import { RECEIPTS_AVAILABLE } from "../../receipt-slot";

/**
 * `/o/<slug>/reimbursements/<id>/edit` - the same form, prefilled, for the
 * creator of a `draft` or `returned` request. docs/work-log/2026-10-25-treasury-
 * inc1.md, Phase 3 "Component / Page Plan".
 *
 * Who may reach it: the creator, while the request is editable
 * (`viewer.canEdit`, the database's own answer). Everyone else - another
 * member, a request that does not exist, a malformed id - gets the one neutral
 * 404 (EC16). The creator of a request that can no longer be edited (sent,
 * paid, withdrawn) is sent to its read-only page instead of a dead form.
 *
 * The form carries the revision this page read; a save made against a request
 * that has moved answers `changed_since_viewed` and keeps what was typed.
 */
export default async function EditRequestPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const gate = await gateReimbursementPage({ slug, path: `/o/${slug}/reimbursements/${id}/edit` });
  if (!gate.ok) return <ReimbursementStatePage state={gate.state} slug={slug} />;
  const { identity } = gate;

  let found: Awaited<ReturnType<typeof getRequestDetail>>;
  let options: Awaited<ReturnType<typeof getFormOptions>>;
  let today: string;
  try {
    [found, options, today] = await Promise.all([
      getRequestDetail(identity, id, "member"),
      getFormOptions(identity),
      getOrgToday(identity),
    ]);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <ReimbursementLoadError href={`/o/${slug}/reimbursements/${id}/edit`} />;
  }
  if (found.kind !== "ok" || found.detail.level !== "member") notFound();
  const detail = found.detail;
  if (detail.viewer.relation !== "creator") notFound();
  if (!detail.viewer.canEdit) redirect(`/o/${slug}/reimbursements/${detail.id}`);

  // A retired category stays on the request it was chosen for, so it must stay selectable here.
  const categories = [...options.categories];
  if (detail.category && !categories.some((c) => c.id === detail.category!.id)) {
    categories.push({ id: detail.category.id, name: detail.category.name });
  }
  // The same for a group that stopped being chargeable after the request was sent (the group is frozen anyway).
  const groups = [...options.groups];
  if (detail.group && !groups.some((g) => g.id === detail.group!.id)) groups.push(detail.group);

  return (
    <RequestForm
      slug={slug}
      initialClientKey={randomUUID()}
      orgToday={today}
      groups={groups}
      categories={categories}
      canRequestForOthers={options.canRequestForOthers}
      initialValues={detailToFormValues(detail, identity.personId)}
      existing={{
        requestId: detail.id,
        revision: detail.revision,
        frozen: detail.firstSubmittedAt !== null,
        groupName: detail.group?.name ?? null,
        payeeLabel: detail.payee.name,
        receipts: detail.receipts.map((r) => ({
          id: r.id,
          displayName: r.displayName,
          contentType: r.contentType,
          byteSize: r.byteSize,
        })),
      }}
      receiptsAvailable={RECEIPTS_AVAILABLE}
    />
  );
}
