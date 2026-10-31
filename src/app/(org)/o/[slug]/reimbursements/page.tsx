import Link from "next/link";
import { OrgAccessError } from "@/lib/authz";
import { Button } from "@/components/ui/button";
import { COPY } from "@/lib/reimbursement/copy";
import { gateReimbursementPage } from "@/lib/reimbursement/gate";
import { getFormOptions, listMyRequests, listWaitingForMe } from "@/lib/reimbursement/reads";
import { ReimbursementLoadError, ReimbursementStatePage } from "./reimbursement-states";
import { MyRequestsList, WaitingList } from "./request-list";

/**
 * `/o/<slug>/reimbursements` - the member's page: requests waiting for their
 * approval (only if there are any), their own requests, "New request", and, for a
 * holder of a treasury key, a link to the treasurer view. docs/work-log/
 * 2026-10-25-treasury-inc1.md, Phase 3 "Component / Page Plan" and Copy C2.
 *
 * The whole gate (sign-in, the Node-side 2FA check, the four-way org miss,
 * applicability, the toggle) is `gateReimbursementPage` with no `anyOf`: any
 * member passes, WHO MAY FILE is the database's (`mayFile` from the form
 * options), and a member who may not file still sees the list. A read failure is
 * a load error, never an empty list (an empty list would read as lost requests).
 *
 * Read-only: opening this page writes nothing (EC24). No `loading.tsx`: the
 * segment can 404 on the four-way miss and a Suspense boundary would flush a 200
 * first (CLAUDE.md).
 */
export default async function ReimbursementsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gate = await gateReimbursementPage({ slug, path: `/o/${slug}/reimbursements` });
  if (!gate.ok) return <ReimbursementStatePage state={gate.state} slug={slug} />;
  const { identity } = gate;

  let options: Awaited<ReturnType<typeof getFormOptions>>;
  let mine: Awaited<ReturnType<typeof listMyRequests>>;
  let waiting: Awaited<ReturnType<typeof listWaitingForMe>>;
  try {
    [options, mine, waiting] = await Promise.all([
      getFormOptions(identity),
      listMyRequests(identity),
      listWaitingForMe(identity),
    ]);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <ReimbursementLoadError href={`/o/${slug}/reimbursements`} />;
  }
  // `denied` after the gate passed means the database no longer recognizes the
  // caller as a live member here: the same honest "couldn't load", not an empty page.
  if (mine.kind === "denied" || waiting.kind === "denied") {
    return <ReimbursementLoadError href={`/o/${slug}/reimbursements`} />;
  }

  const holdsTreasuryKey = identity.has.view || identity.has.pay || identity.has.manage;

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{COPY.page.heading}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{COPY.page.lead(identity.organizationName)}</p>
        {(options.mayFile || holdsTreasuryKey) && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            {options.mayFile && (
              <Button asChild className="min-h-11">
                <Link href={`/o/${slug}/reimbursements/new`}>{COPY.page.newRequest}</Link>
              </Button>
            )}
            {holdsTreasuryKey && (
              <Button asChild variant="outline" className="min-h-11">
                <Link href={`/o/${slug}/admin/reimbursements`}>{COPY.page.treasurerView}</Link>
              </Button>
            )}
          </div>
        )}
        {!options.mayFile && (
          <p className="mt-4 text-base" data-testid="cannot-file">
            {COPY.page.cannotFile(identity.organizationName)}
          </p>
        )}
      </div>

      {waiting.items.length > 0 && (
        <section aria-labelledby="waiting-heading" className="space-y-3">
          <h2 id="waiting-heading" className="text-xl font-semibold">
            {COPY.page.waitingHeading(waiting.items.length)}
          </h2>
          <WaitingList slug={slug} items={waiting.items} />
        </section>
      )}

      <section aria-labelledby="mine-heading" className="space-y-3">
        <h2 id="mine-heading" className="text-xl font-semibold">
          {COPY.page.yourRequests}
        </h2>
        {mine.items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-base text-muted-foreground" data-testid="no-requests">
            {COPY.page.noRequestsYet}
          </p>
        ) : (
          <MyRequestsList slug={slug} items={mine.items} />
        )}
      </section>
    </div>
  );
}
