import Link from "next/link";
import { Button } from "@/components/ui/button";
import { STATE } from "@/lib/oversight/copy";
import type { LoanRow } from "@/lib/oversight/reads";
import { LoanCard } from "./loan-card";
import { LockedSection } from "./locked-section";
import { SectionFrame } from "./section-frame";
import { SectionLoadError } from "./section-load-error";
import type { SectionState } from "./section-state";

/** The Loans section (C8): open loans first, then paid off; "Record a loan"; or "No loans are recorded for this congregation." */
export function LoansSection({
  slug,
  aboutOrgId,
  state,
}: {
  slug: string;
  aboutOrgId: string;
  state: SectionState<{ loans: LoanRow[]; today: string }>;
}) {
  const recordHref = `/o/${slug}/admin/oversight/${aboutOrgId}`;
  const action =
    state.kind === "ok" ? (
      <Button asChild variant="outline" className="min-h-11">
        <Link href={`${recordHref}/loans/new`}>Record a loan</Link>
      </Button>
    ) : undefined;
  return (
    <SectionFrame id="loans" title="Loans" action={action}>
      {state.kind === "locked" ? <LockedSection need="finance" /> : null}
      {state.kind === "error" ? <SectionLoadError href={recordHref} /> : null}
      {state.kind === "ok" && state.data.loans.length === 0 ? <p className="text-sm text-muted-foreground">{STATE.emptyLoans}</p> : null}
      {state.kind === "ok" && state.data.loans.length > 0 ? (
        <ul className="space-y-3">
          {state.data.loans.map((loan) => (
            <LoanCard key={loan.id} slug={slug} aboutOrgId={aboutOrgId} loan={loan} today={state.data.today} />
          ))}
        </ul>
      ) : null}
    </SectionFrame>
  );
}
