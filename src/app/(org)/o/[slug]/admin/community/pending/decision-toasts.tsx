"use client";

import { toast } from "sonner";
import { FormattedDate } from "@/components/shared/formatted-date";
import { DECISION_SUCCESS_COPY } from "./decision-copy";
import type {
  ApproveRollActionData,
  ApproveRollActionsData,
} from "./actions";

/**
 * The toasts for a decided roll action, in one place so the queue's row dialog,
 * the bulk dialog and any other caller cannot invent a second wording. A
 * future-dated approval says when it takes effect (the cache projects on that
 * day, F29); a shadowed approval and a filed-period approval each add a second,
 * warning toast.
 */
export function toastApproved(name: string, data: ApproveRollActionData) {
  if (data.futureDated) {
    toast.success(
      <span>
        {DECISION_SUCCESS_COPY.approvedFutureLead(name)}
        <FormattedDate value={data.effectiveDate} mode="date" />.
      </span>,
    );
  } else {
    toast.success(DECISION_SUCCESS_COPY.approved(name));
  }
  if (data.shadowed) {
    toast.warning(DECISION_SUCCESS_COPY.shadowed(name));
  }
  if (data.affectsFiledPeriod) {
    toast.warning(DECISION_SUCCESS_COPY.filedPeriod);
  }
}

export function toastBulk(data: ApproveRollActionsData) {
  const failed = data.failed.length;
  if (failed === 0) {
    toast.success(DECISION_SUCCESS_COPY.bulkApproved(data.approved));
  } else if (data.approved > 0) {
    toast.warning(DECISION_SUCCESS_COPY.bulkPartial(data.approved, failed));
  }
  if (data.shadowedCount > 0) {
    toast.warning(DECISION_SUCCESS_COPY.bulkShadowed);
  }
  if (data.affectsFiledPeriod) {
    toast.warning(DECISION_SUCCESS_COPY.filedPeriod);
  }
}
