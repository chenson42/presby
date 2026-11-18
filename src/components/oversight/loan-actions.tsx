"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateLoanAction } from "@/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/loans/actions";
import { TOAST } from "@/lib/oversight/copy";
import type { LoanRow } from "@/lib/oversight/reads";
import { ConfirmRemoveDialog } from "./confirm-remove-dialog";
import { loanToValues } from "./loan-values";
import { PaidOffDialog } from "./paid-off-dialog";

/** A loan card's controls: edit, mark paid off (or reopen), remove. */
export function LoanActions({
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
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function reopen() {
    setPending(true);
    const result = await updateLoanAction(slug, aboutOrgId, loan.id, loanToValues(loan, "open"), loan.rowVersion);
    setPending(false);
    if (result.ok) {
      toast.success(TOAST.loanReopened);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <Button asChild variant="outline" className="min-h-11">
        <Link href={`/o/${slug}/admin/oversight/${aboutOrgId}/loans/${loan.id}/edit`}>
          Edit <span className="sr-only">loan</span>
        </Link>
      </Button>
      {loan.status === "open" ? (
        <PaidOffDialog slug={slug} aboutOrgId={aboutOrgId} loanId={loan.id} env={{ year: Number(today.slice(0, 4)), today }} />
      ) : (
        <Button type="button" variant="outline" className="min-h-11" onClick={reopen} disabled={pending}>
          Reopen this loan
        </Button>
      )}
      <ConfirmRemoveDialog kind="loan" slug={slug} aboutOrgId={aboutOrgId} loanId={loan.id} srContext="loan" />
    </div>
  );
}
