import { Badge } from "@/components/ui/badge";
import { COPY } from "@/lib/reimbursement/copy";
import type { RequestStatus } from "@/lib/reimbursement/states";

/**
 * A request's status in the words of Copy C2. `audience` picks "Sent back to you"
 * (the requester and the person being paid) or "Sent back" (approvers and the
 * treasury team). The label is always text, so colour never carries the meaning
 * alone. `text-sm` overrides the badge primitive's 12px: nothing under 14px on a
 * member-facing surface (docs/ui-standards.md, Type Scale). Server-renderable.
 */

const VARIANT: Record<RequestStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  submitted: "secondary",
  returned: "default",
  not_approved: "destructive",
  approved: "secondary",
  paid: "default",
  withdrawn: "outline",
  voided: "outline",
};

export function StatusBadge({
  status,
  audience = "requester",
}: {
  status: RequestStatus;
  audience?: "requester" | "staff";
}) {
  const label = COPY.statusLabels[audience][status];
  return (
    <Badge variant={VARIANT[status]} className="text-sm" data-testid="status-badge" data-status={status}>
      {label}
    </Badge>
  );
}
