"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { TOAST } from "@/lib/oversight/copy";
import type { OversightActionResult } from "@/lib/oversight/contract";
import { removeAppraisalAction } from "@/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/buildings/[buildingId]/appraisals/actions";
import { removeBuildingAction } from "@/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/buildings/actions";
import { removeInsuranceAction } from "@/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/insurance/actions";
import { removeLoanAction } from "@/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/loans/actions";

type Target =
  | { kind: "building"; buildingId: string }
  | { kind: "appraisal"; buildingId: string; appraisalId: string }
  | { kind: "insurance"; recordId: string }
  | { kind: "loan"; loanId: string };

/** The Copy section's strings (C5 to C8): one dialog, four removals. */
const COPY = {
  building: {
    trigger: "Remove (entered by mistake)",
    title: "Remove this building?",
    body: "Use this only for a building entered by mistake. It will no longer be listed, and neither will its appraisals or photos. This can't be undone here.",
    confirm: "Remove building",
    done: TOAST.buildingRemoved,
  },
  appraisal: {
    trigger: "Remove",
    title: "Remove this appraisal?",
    body: "Use this for an appraisal entered by mistake. To correct an amount, remove the appraisal and record it again.",
    confirm: "Remove appraisal",
    done: TOAST.appraisalRemoved,
  },
  insurance: {
    trigger: "Remove",
    title: "Remove this year's insurance?",
    body: "Use this for a record entered by mistake. You can then record that year again.",
    confirm: "Remove insurance record",
    done: TOAST.insuranceRemoved,
  },
  loan: {
    trigger: "Remove",
    title: "Remove this loan?",
    body: "Use this for a loan entered by mistake. It will no longer be listed. This can't be undone here.",
    confirm: "Remove loan",
    done: TOAST.loanRemoved,
  },
} as const;

function run(slug: string, aboutOrgId: string, target: Target): Promise<OversightActionResult> {
  switch (target.kind) {
    case "building":
      return removeBuildingAction(slug, aboutOrgId, target.buildingId);
    case "appraisal":
      return removeAppraisalAction(slug, aboutOrgId, target.buildingId, target.appraisalId);
    case "insurance":
      return removeInsuranceAction(slug, aboutOrgId, target.recordId);
    case "loan":
      return removeLoanAction(slug, aboutOrgId, target.loanId);
  }
}

/**
 * The one destructive confirmation for the four removals (an `AlertDialog`,
 * never a native confirm: Workflow Rule 2). Removal is one-way in the product, so
 * the body says so for a building and a loan. A removed building's own page no
 * longer exists, so that removal returns to the record page; the others stay put
 * and refresh.
 */
export function ConfirmRemoveDialog({
  slug,
  aboutOrgId,
  srContext,
  ...target
}: { slug: string; aboutOrgId: string; /** Said to a screen reader after the trigger, e.g. "appraisal for 2024". */ srContext?: string } & Target) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const copy = COPY[target.kind];

  async function onConfirm() {
    setPending(true);
    const result = await run(slug, aboutOrgId, target as Target);
    setPending(false);
    if (result.ok) {
      toast.success(copy.done);
      if (target.kind === "building") router.push(`/o/${slug}/admin/oversight/${aboutOrgId}`);
      else router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11">
          {copy.trigger}
          {srContext ? (
            <>
              {" "}
              <span className="sr-only">{srContext}</span>
            </>
          ) : null}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" className="min-h-11" onClick={onConfirm} disabled={pending}>
            {copy.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
