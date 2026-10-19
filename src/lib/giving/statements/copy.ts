import type { IssueFailureReason } from "./pure";

/**
 * Plain-language copy for the statements page: why a donor's statement could
 * not be issued. One place, no jargon, never a Postgres message. Pure.
 */
export const ISSUE_FAILURE_TEXT: Record<IssueFailureReason, string> = {
  donor_unavailable:
    "This donor record was merged or changed while the run was going. Reload, then issue this donor's statement again.",
  consistency:
    "The statement did not match the gift records, so nothing was saved for this donor. Try again; if it keeps happening, tell support.",
  render_failed: "The PDF could not be produced. Nothing was saved for this donor; try again.",
  store_failed: "The PDF could not be saved. Nothing was saved for this donor; try again.",
  forbidden: "Your access to issue statements changed during the run.",
  unknown: "Something went wrong. Nothing was saved for this donor; try again.",
};

export function issueFailureText(reason: IssueFailureReason): string {
  return ISSUE_FAILURE_TEXT[reason] ?? ISSUE_FAILURE_TEXT.unknown;
}

export const FILTER_LABELS = {
  all: "Current statements",
  stale: "Out of date",
  not_delivered: "Not sent or mailed yet",
  earlier: "Earlier versions",
} as const;
