import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormattedDate } from "@/components/shared/formatted-date";
import { expiryState, formatTriState } from "@/lib/oversight/derive";
import type { InsuranceRow } from "@/lib/oversight/reads";
import { ConfirmRemoveDialog } from "./confirm-remove-dialog";
import { FactList } from "./fact-list";
import { ImportedNote } from "./imported-note";

/** One policy year. "Expired" is said in words (never colour alone), against the organization's local date. */
export function InsuranceCard({
  slug,
  aboutOrgId,
  year,
  today,
}: {
  slug: string;
  aboutOrgId: string;
  year: InsuranceRow;
  today: string;
}) {
  const expired = expiryState(year.policyExpiresOn, today) === "expired";
  return (
    <li className="space-y-3 rounded-md border border-border p-4">
      <h3 className="text-base font-medium">{year.policyYear}</h3>
      <FactList
        facts={[
          { label: "Carrier", value: year.carrier },
          { label: "Policy number", value: year.policyNumber },
          {
            label: "Policy expires",
            value:
              year.policyExpiresOn === null ? null : (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <FormattedDate value={year.policyExpiresOn} mode="date" />
                  {expired ? <Badge variant="destructive">Expired</Badge> : null}
                </span>
              ),
          },
          { label: "Recent claims", value: formatTriState(year.recentClaims) },
          { label: "Interested in the insurance pool", value: formatTriState(year.poolInterest) },
          { label: "Notes", value: year.notes },
        ]}
      />
      <ImportedNote provenance={year.provenance} />
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="min-h-11">
          <Link href={`/o/${slug}/admin/oversight/${aboutOrgId}/insurance/${year.id}/edit`}>
            Edit <span className="sr-only">insurance for {year.policyYear}</span>
          </Link>
        </Button>
        <ConfirmRemoveDialog kind="insurance" slug={slug} aboutOrgId={aboutOrgId} recordId={year.id} srContext={`insurance for ${year.policyYear}`} />
      </div>
    </li>
  );
}
