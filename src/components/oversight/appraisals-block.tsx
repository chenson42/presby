import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STATE } from "@/lib/oversight/copy";
import { formatMoney } from "@/lib/oversight/derive";
import type { AppraisalsData } from "@/lib/oversight/reads";
import { ConfirmRemoveDialog } from "./confirm-remove-dialog";
import { ImportedNote } from "./imported-note";
import { LockedSection } from "./locked-section";
import { SectionFrame } from "./section-frame";
import { SectionLoadError } from "./section-load-error";
import type { SectionState } from "./section-state";

/**
 * The "Appraisals" block on a building's page (C6, finance): each row a year and
 * a dollar amount, the newest tagged "Current", with "Remove" (an appraisal is
 * never edited: remove and record again). Locked for a viewer without the finance key.
 */
export function AppraisalsBlock({
  slug,
  aboutOrgId,
  buildingId,
  state,
  pageHref,
}: {
  slug: string;
  aboutOrgId: string;
  buildingId: string;
  state: SectionState<AppraisalsData>;
  /** This page, for "Try again". */
  pageHref: string;
}) {
  const action =
    state.kind === "ok" ? (
      <Button asChild variant="outline" className="min-h-11">
        <Link href={`${pageHref}/appraisals/new`}>Record an appraisal</Link>
      </Button>
    ) : undefined;
  return (
    <SectionFrame id="appraisals" title="Appraisals" action={action}>
      {state.kind === "locked" ? <LockedSection need="finance" /> : null}
      {state.kind === "error" ? <SectionLoadError href={pageHref} /> : null}
      {state.kind === "ok" && state.data.appraisals.length === 0 ? (
        <p className="text-sm text-muted-foreground">{STATE.emptyAppraisals}</p>
      ) : null}
      {state.kind === "ok" && state.data.appraisals.length > 0 ? (
        <ul className="space-y-3">
          {state.data.appraisals.map((appraisal) => (
            <li key={appraisal.id} className="space-y-2 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-medium">{appraisal.assessedYear}</h3>
                <span className="text-base">{formatMoney(appraisal.amountCents)}</span>
                {appraisal.id === state.data.latestId ? <Badge>Current</Badge> : null}
              </div>
              {appraisal.notes ? <p className="whitespace-pre-line break-words text-sm text-muted-foreground">{appraisal.notes}</p> : null}
              <ImportedNote provenance={appraisal.provenance} />
              <ConfirmRemoveDialog
                kind="appraisal"
                slug={slug}
                aboutOrgId={aboutOrgId}
                buildingId={buildingId}
                appraisalId={appraisal.id}
                srContext={`appraisal for ${appraisal.assessedYear}`}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </SectionFrame>
  );
}
