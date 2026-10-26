/**
 * The words of `/no-organization` (Community Increment 2b, Batch B2; amendment
 * 2 section 10, groups A, B and C). PURE and client-safe.
 *
 * Batch B2 owns this file because the two server actions return some of these
 * strings (rate limited, signed out, dead, database error, the second-factor
 * notice) and a string returned by an action is a contract; Batch C wires the
 * rest into the page. Every string is the operator-read Copy, verbatim. Person
 * names, addresses, congregation names, dates and minute counts are parameters.
 *
 * The product's word is "two-factor sign-in" (`/totp`, `/account/2fa`), not the
 * analyst's "two-step". "A congregation *can* connect you" is hedged on purpose:
 * visitors, shared addresses, people at two congregations, an off toggle and a
 * missing proof all decline, so nothing here promises a connection, and nothing
 * says two-factor sign-in prevents misuse of a typed address (R42's honest
 * framing; F232).
 */
import { INVITATION_ROLE_WORD, DESIGNATION_NAME } from "./invitation-copy";
import { INVITATION_DEAD_IN_PLACE_COPY } from "./labels";

// ---------------------------------------------------------------------------
// Group A: nothing connected, no open invitation (N0) and its controls
// ---------------------------------------------------------------------------

export const NO_ORG_COPY = {
  heading: "You're not connected to a congregation yet",
  /** With the session's address. */
  body: (address: string) =>
    `You're signed in as ${address}. This sign-in isn't connected to a congregation's records yet.`,
  /** No address on the session. */
  bodyNoAddress: "You're signed in. This sign-in isn't connected to a congregation's records yet.",
  secondLine:
    "A congregation can connect you by the email address on your record. If yours has added you, it needs the exact address you signed in with.",
  officeHeading: "Ask the office that keeps your records",
  officeBody: (address: string) =>
    `Ask them to check that ${address} is on your record, or to invite you. Then check again.`,
  invitationLine:
    "If you were invited, the invitation should appear here once it was sent to this address. You can also open the link in your invitation email. If it was sent to a different address, or has expired, ask the person who invited you to send it again.",
  buttons: {
    checkAgain: "Check again",
    switchAccount: "Sign in with a different account",
  },
  nothingNew: "Nothing new yet.",
  /** N5: shown above whichever block renders; never replaces the page. */
  listingFailed: "We couldn't check for invitations just now. Reload the page.",
  /** Check again's database error: the button's failure, so "try again", not the page-load "reload". */
  checkFailed: "We couldn't check just now. Try again.",
} as const;

// ---------------------------------------------------------------------------
// Group B: the connect line and the second-factor notice
// ---------------------------------------------------------------------------

export const NO_ORG_SECOND_FACTOR_COPY = {
  /** After Check again, the account is enrolled. */
  enrolled: {
    body: "One more step: confirm two-factor sign-in to finish connecting. Then come back here and select Check again.",
    button: "Continue to verification",
  },
  /** After Check again, the account is not enrolled. */
  notEnrolled: {
    body: "One more step: set up two-factor sign-in to finish connecting. Then come back here and select Check again.",
    button: "Set up two-factor sign-in",
  },
} as const;

// ---------------------------------------------------------------------------
// Group C: open invitations (N1) and accepting in place
// ---------------------------------------------------------------------------

export const NO_ORG_INVITATION_COPY = {
  headingOne: (congregation: string) => `You're invited to ${congregation}`,
  headingMany: (n: number) => `You have ${n} invitations`,
  /** `sign_in`. */
  cardSignIn: (congregation: string, name: string) =>
    `${congregation} invited you to sign in. Accepting connects this sign-in to your record there as ${name}. What you can do depends on your role at ${congregation}.`,
  /** `founding_administrator` / `treasurer`. Built from the existing role words. */
  cardDesignation: (congregation: string, purpose: "founding_administrator" | "treasurer") =>
    `${congregation} invited you to be its ${DESIGNATION_NAME[purpose]}. Accepting gives you that ${INVITATION_ROLE_WORD[purpose]}.`,
  expires: (date: string) => `This invitation expires ${date}.`,
  accept: "Accept the invitation",
  /** The card before or after the click, account enrolled / not enrolled. */
  secondFactor: {
    enrolled: {
      body: "Accepting this invitation needs two-factor sign-in. Finish verification, then accept.",
      button: "Continue to verification",
    },
    notEnrolled: {
      body: "Accepting this invitation needs two-factor sign-in. Set up two-factor sign-in, then accept.",
      button: "Set up two-factor sign-in",
    },
  },
  /** N4: the invitation is no longer active (`INVITATION_DEAD_IN_PLACE_COPY`, a separate constant from the link page's). */
  dead: INVITATION_DEAD_IN_PLACE_COPY,
  /** The accept's database error. True: a `db_error` rolls the whole transaction back. */
  dbError: "Your invitation is still good. Try again.",
  rateLimited: (minutes: number) => `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
  signedOut: "Sign in to accept this invitation.",
} as const;
