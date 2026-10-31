import { COPY } from "@/lib/reimbursement/copy";

/**
 * The line under a group on the settings page (Copy C9): how many chairs or
 * leaders can approve now, or that requests go to the treasurer. The count is
 * the definer's (`settings.groups[].approverCount`): seats that can approve now,
 * managed groups only. A DERIVED group (Session, Diaconate) has no chair or
 * leader by design, so its note drops "right now": nothing about it will change
 * by adding someone. PURE.
 */
export function approverNote(group: { membershipSource: string; approverCount: number }): string {
  if (group.approverCount === 1) return COPY.settings.approverNote(1);
  if (group.approverCount > 1) return COPY.settings.approversNote(group.approverCount);
  return group.membershipSource === "derived" ? COPY.settings.noApproverDerived : COPY.settings.noApproverManaged;
}
