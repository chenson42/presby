import { randomUUID } from "node:crypto";
import { OrgAccessError } from "@/lib/authz";
import { COPY } from "@/lib/reimbursement/copy";
import { gateReimbursementPage } from "@/lib/reimbursement/gate";
import { getFormOptions, getOrgToday } from "@/lib/reimbursement/reads";
import { BackToReimbursements, ReimbursementLoadError, ReimbursementStatePage } from "../reimbursement-states";
import { RequestForm } from "../request-form";
import { emptyFormValues } from "../request-form-model";
import { RECEIPTS_AVAILABLE } from "../receipt-slot";

/**
 * `/o/<slug>/reimbursements/new` - a blank request form. docs/work-log/
 * 2026-10-25-treasury-inc1.md, Phase 3 "Component / Page Plan". The gate is the
 * member gate; WHO MAY FILE is the database's `mayFile` from the form options,
 * and a member who may not is told so in Copy C2's words instead of being shown a
 * form that would refuse them.
 *
 * The idempotency key (`clientKey`) is minted here, once per page load, so a
 * double tap, a retry after a lost reply and a second tab on the same load all
 * find the one request. No `loading.tsx` (this segment's neighbours 404).
 */
export default async function NewRequestPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gate = await gateReimbursementPage({ slug, path: `/o/${slug}/reimbursements/new` });
  if (!gate.ok) return <ReimbursementStatePage state={gate.state} slug={slug} />;
  const { identity } = gate;

  let options: Awaited<ReturnType<typeof getFormOptions>>;
  let today: string;
  try {
    [options, today] = await Promise.all([getFormOptions(identity), getOrgToday(identity)]);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <ReimbursementLoadError href={`/o/${slug}/reimbursements/new`} />;
  }

  if (!options.mayFile) {
    return (
      <div className="max-w-2xl space-y-4">
        <BackToReimbursements slug={slug} />
        <h1 className="text-2xl font-semibold">{COPY.form.createHeading}</h1>
        <p className="text-base" data-testid="cannot-file">
          {COPY.page.cannotFile(identity.organizationName)}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <BackToReimbursements slug={slug} />
      <RequestForm
        slug={slug}
        initialClientKey={randomUUID()}
        orgToday={today}
        groups={options.groups}
        categories={options.categories}
        canRequestForOthers={options.canRequestForOthers}
        initialValues={emptyFormValues()}
        receiptsAvailable={RECEIPTS_AVAILABLE}
      />
    </div>
  );
}
