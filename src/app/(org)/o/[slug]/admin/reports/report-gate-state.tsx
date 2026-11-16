import { PlaceholderFlagOff, PlaceholderNotAvailable } from "@/components/org-portal/coming-soon";
import type { ReportGateState } from "@/lib/presbytery-reports/gate";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";

/**
 * Renders the four whole-page answers a report page can give instead of its
 * content: the byte-identical org denial (DECISION-040), the ended notice, and
 * the flag-off and not-a-presbytery placeholders, with the area name the flag
 * controls ("Per-Capita, SASR & Imports") so the sentence is true on every
 * sub-page.
 */
export const REPORTS_AREA = "Per-Capita, SASR & Imports";

export function ReportGateStateView({ state, slug }: { state: ReportGateState; slug: string }) {
  switch (state.kind) {
    case "org_forbidden":
      return <OrgAccessDenied name={state.name} organizationType={state.organizationType} slug={slug} />;
    case "org_ended":
      return <OrgAccessEnded name={state.name} endedOn={state.endedOn} slug={slug} />;
    case "flag_off":
      return <PlaceholderFlagOff area={REPORTS_AREA} orgName={state.name} />;
    case "not_applicable":
      return <PlaceholderNotAvailable area={REPORTS_AREA} orgName={state.name} />;
  }
}
