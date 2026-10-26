import type { ReimbursementActionFailure } from "@/lib/reimbursement/action-result";

/**
 * What a refused approve / send back / withdraw does to the page. PURE.
 *
 * Four of the failure kinds mean "what you were looking at is no longer true":
 * the request changed after it was opened, was already decided, is no longer
 * available, or (for withdraw) was already paid. For those the message is
 * toasted, the dialog closes and the page is re-read so the person sees the
 * request as it now stands (which is the "Review it again" the Copy asks for).
 * Anything else keeps the dialog open with the message beside what was typed.
 */
export function failureNeedsReload(failure: ReimbursementActionFailure): boolean {
  return (
    failure.kind === "changed_since_viewed" ||
    failure.kind === "already_decided" ||
    failure.kind === "not_found"
  );
}
