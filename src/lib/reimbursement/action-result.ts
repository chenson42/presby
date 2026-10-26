import type { ZodError } from "zod";

/**
 * The result of every reimbursement server action - docs/work-log/2026-10-25-
 * treasury-inc1.md, Phase 3 API Contract Layer 3. PURE.
 *
 * `ok: true` carries the action's data. `ok: false` always carries a plain,
 * end-user `error` the client can toast, plus, when the form must react
 * differently from "toast the message":
 *   - `kind: "two_factor_required"` with `redirectTo` (the /totp challenge);
 *   - `kind: "changed_since_viewed"` (the revision moved while the form was
 *     open; reload);
 *   - `kind: "already_decided"` with `decidedOn` (org-local YYYY-MM-DD) and
 *     `status` - the date, never the actor, to anyone but the treasury team;
 *   - `kind: "not_found"` (the neutral: missing and forbidden look the same);
 *   - `fieldErrors`: dotted-path messages for the form's inputs.
 * A database failure is its own message and never reads as "not allowed".
 */

export type FieldErrors = Record<string, string>;

export type ReimbursementFailureKind =
  | "two_factor_required"
  | "changed_since_viewed"
  | "already_decided"
  | "not_found";

export interface ReimbursementActionFailure {
  ok: false;
  error: string;
  kind?: ReimbursementFailureKind;
  /** Where to send the user (the /totp challenge) when `kind` is `two_factor_required`. */
  redirectTo?: string;
  /** For `already_decided`: the organization-local date (YYYY-MM-DD) of the deciding event. */
  decidedOn?: string | null;
  /** For `already_decided`: the status the request is in now. */
  status?: string;
  fieldErrors?: FieldErrors;
}

export type ReimbursementActionResult<T = void> = { ok: true; data: T } | ReimbursementActionFailure;

/** First message per dotted path; a root-level issue is keyed `_form`. */
export function zodFieldErrors(error: ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length === 0 ? "_form" : issue.path.join(".");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
