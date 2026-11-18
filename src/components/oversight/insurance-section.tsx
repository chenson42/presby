import Link from "next/link";
import { Button } from "@/components/ui/button";
import { STATE } from "@/lib/oversight/copy";
import type { InsuranceData } from "@/lib/oversight/reads";
import { InsuranceCard } from "./insurance-card";
import { LockedSection } from "./locked-section";
import { SectionFrame } from "./section-frame";
import { SectionLoadError } from "./section-load-error";
import type { SectionState } from "./section-state";

/** The Insurance section (C7): one card per policy year, newest first, "Record a year", or "No insurance is recorded for this congregation." */
export function InsuranceSection({
  slug,
  aboutOrgId,
  state,
}: {
  slug: string;
  aboutOrgId: string;
  state: SectionState<InsuranceData>;
}) {
  const recordHref = `/o/${slug}/admin/oversight/${aboutOrgId}`;
  const action =
    state.kind === "ok" ? (
      <Button asChild variant="outline" className="min-h-11">
        <Link href={`${recordHref}/insurance/new`}>Record a year</Link>
      </Button>
    ) : undefined;
  return (
    <SectionFrame id="insurance" title="Insurance" action={action}>
      {state.kind === "locked" ? <LockedSection need="finance" /> : null}
      {state.kind === "error" ? <SectionLoadError href={recordHref} /> : null}
      {state.kind === "ok" && state.data.years.length === 0 ? (
        <p className="text-sm text-muted-foreground">{STATE.emptyInsurance}</p>
      ) : null}
      {state.kind === "ok" && state.data.years.length > 0 ? (
        <ul className="space-y-3">
          {state.data.years.map((year) => (
            <InsuranceCard key={year.id} slug={slug} aboutOrgId={aboutOrgId} year={year} today={state.data.today} />
          ))}
        </ul>
      ) : null}
    </SectionFrame>
  );
}
