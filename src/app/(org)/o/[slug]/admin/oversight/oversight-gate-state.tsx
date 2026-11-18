import { PlaceholderFlagOff, PlaceholderNotAvailable } from "@/components/org-portal/coming-soon";
import type { ReportGateState } from "@/lib/presbytery-reports/gate";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";

/**
 * Renders the four whole-page answers an oversight page can give instead of its
 * content (the sibling of `../reports/report-gate-state.tsx`): the byte-identical
 * org denial (DECISION-040), the ended notice, and the flag-off and
 * not-a-presbytery placeholders, all with the area name the flag controls.
 */
export const OVERSIGHT_AREA = "Congregation Oversight";

export function OversightGateStateView({ state, slug }: { state: ReportGateState; slug: string }) {
  switch (state.kind) {
    case "org_forbidden":
      return <OrgAccessDenied name={state.name} organizationType={state.organizationType} slug={slug} />;
    case "org_ended":
      return <OrgAccessEnded name={state.name} endedOn={state.endedOn} slug={slug} />;
    case "flag_off":
      return <PlaceholderFlagOff area={OVERSIGHT_AREA} orgName={state.name} />;
    case "not_applicable":
      return <PlaceholderNotAvailable area={OVERSIGHT_AREA} orgName={state.name} />;
  }
}
