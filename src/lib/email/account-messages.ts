/**
 * Message builders for the two account senders (DECISION-191).
 *
 * The senders live in `'use server'` files (`(account)/account/actions.ts`,
 * `(password-reset)/actions.ts`), which may export only async functions, so the
 * messages are built here, in a flat file beside `render.ts`. Pure: no database,
 * no `server-only`, no environment. The callers build the link (that code is
 * unchanged) and pass it in; every string here is raw and `renderEmail()`
 * escapes it. Import `./render` directly, never the `@/lib/email` barrel.
 */

import { renderEmail, type RenderedEmail } from "./render";

/** The sign-in password reset link. The "expires in 60 minutes" line is true to the token the action mints. */
export function buildPasswordResetEmail(input: { resetUrl: string }): RenderedEmail {
  return renderEmail({
    subject: "Reset your password",
    heading: "Reset your password",
    blocks: [
      { kind: "p", text: "Someone asked to reset the password for your account." },
      { kind: "p", text: "This link expires in 60 minutes." },
    ],
    action: { label: "Reset your password", href: input.resetUrl },
    footnote: "If you did not request this, you can safely ignore this email.",
  });
}

/** Sent to the NEW address. `newEmail` is user input and is escaped by `renderEmail` (F161). */
export function buildEmailChangeVerifyEmail(input: {
  newEmail: string;
  verifyUrl: string;
}): RenderedEmail {
  return renderEmail({
    subject: "Confirm your new email address",
    heading: "Confirm your new email address",
    blocks: [
      { kind: "p", text: `You asked to change your sign-in email address to ${input.newEmail}.` },
      { kind: "p", text: "This link expires in 24 hours." },
    ],
    action: { label: "Confirm email change", href: input.verifyUrl },
    footnote: "If you did not request this change, you can safely ignore this email.",
  });
}
