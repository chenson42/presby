import { centsToInputText } from "@/lib/oversight/derive";
import type { LoanRow } from "@/lib/oversight/reads";
import type { LoanValues } from "@/lib/oversight/validate";

/** A loan row as the loan form's string values (the form's defaults, and the "Reopen this loan" payload). */
export function loanToValues(loan: LoanRow, status: "open" | "paid_off" = loan.status): LoanValues {
  return {
    kind: loan.kind,
    lender: loan.lender ?? "",
    originalAmount: centsToInputText(loan.originalAmountCents),
    currentBalance: centsToInputText(loan.currentBalanceCents),
    balanceAsOf: loan.balanceAsOf ?? "",
    grantsAmount: centsToInputText(loan.grantsAmountCents),
    guaranteeNote: loan.guaranteeNote ?? "",
    notes: loan.notes ?? "",
    status,
  };
}
