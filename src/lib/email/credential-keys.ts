/**
 * Template keys whose stored body carries a one-time credential link
 * (DECISION-186, F154, F158). Dependency-free on purpose: queue.ts
 * (the redaction), the admin Retry action (the refusal) and the email-queue
 * page (no Retry button) all read the SAME set, and a client or a test can
 * import it without pulling `@/lib/db`.
 *
 * Today `account_invitation` (a platform designation) and
 * `account_sign_in_invitation` (a congregation's sign-in invitation, Community
 * Increment 2b). `password_reset`, `email_change_verify` and
 * `statistics_submission_grant` carry credentials too and are a tracked
 * follow-up (F154) - adding a key here redacts its bodies on send/fail AND
 * makes Retry refuse it, in one edit.
 */
export const CREDENTIAL_TEMPLATE_KEYS: ReadonlySet<string> = new Set([
  "account_invitation",
  "account_sign_in_invitation",
]);

/** What a redacted body is replaced with. */
export const REDACTED_BODY_MARKER =
  "[Removed after delivery: this message contained a one-time sign-in link.]";

export function isCredentialTemplateKey(templateKey: string): boolean {
  return CREDENTIAL_TEMPLATE_KEYS.has(templateKey);
}
