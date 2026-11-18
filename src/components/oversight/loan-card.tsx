import { FormattedDate } from "@/components/shared/formatted-date";
import { Badge } from "@/components/ui/badge";
import { LOAN_KINDS } from "@/lib/oversight/contract";
import { formatMoney } from "@/lib/oversight/derive";
import type { LoanRow } from "@/lib/oversight/reads";
import { FactList } from "./fact-list";
import { ImportedNote } from "./imported-note";
import { LoanActions } from "./loan-actions";

const money = (cents: number | null) => (cents === null ? null : formatMoney(cents));

/** One loan. A figure that was not recorded reads "Not recorded", never $0. */
export function LoanCard({
  slug,
  aboutOrgId,
  loan,
  today,
}: {
  slug: string;
  aboutOrgId: string;
  loan: LoanRow;
  today: string;
}) {
  const kindLabel = LOAN_KINDS.find((k) => k.value === loan.kind)?.label ?? loan.kind;
  return (
    <li className="space-y-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-medium">{kindLabel}</h3>
        {loan.status === "paid_off" ? (
          <Badge variant="secondary">
            Paid off{loan.paidOffOn ? <> <FormattedDate value={loan.paidOffOn} mode="date" /></> : null}
          </Badge>
        ) : (
          <Badge>Open</Badge>
        )}
      </div>
      <FactList
        facts={[
          { label: "Lender", value: loan.lender },
          { label: "Original amount", value: money(loan.originalAmountCents) },
          {
            label: "Current balance",
            value:
              loan.currentBalanceCents === null ? null : (
                <span>
                  {formatMoney(loan.currentBalanceCents)}
                  {loan.balanceAsOf ? (
                    <>
                      {" "}as of <FormattedDate value={loan.balanceAsOf} mode="date" />
                    </>
                  ) : null}
                </span>
              ),
          },
          { label: "Grants", value: money(loan.grantsAmountCents) },
          { label: "Guarantee", value: loan.guaranteeNote },
          { label: "Notes", value: loan.notes },
        ]}
      />
      <ImportedNote provenance={loan.provenance} />
      <LoanActions slug={slug} aboutOrgId={aboutOrgId} loan={loan} today={today} />
    </li>
  );
}
