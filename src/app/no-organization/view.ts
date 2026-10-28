/**
 * The pure derivation behind `/no-organization` (Community Increment 2b, amendment
 * 2 section 7.6). No `server-only`, no database, no React: the page gathers the
 * facts and this decides what the page is, so the table of combinations is a unit
 * test rather than something only a browser can verify.
 *
 * A closed view model:
 *
 *   - `already_have_access`  - the person has somewhere to go (unchanged: a
 *                              sentence and a link to the chooser).
 *   - `standing`             - the page renders the existing heading block
 *                              (`pending` > `not_tenants` > `ended`, in that
 *                              precedence, unchanged), then any open
 *                              invitations below it.
 *   - `invited`              - one or more open invitations and no heading block:
 *                              the default heading, "Ask the office" and Check
 *                              again are hidden (an open invitation blocks
 *                              auto-connect, FB5).
 *   - `default`              - N0: nothing connected, nothing waiting.
 *
 * `listFailed` (N5) rides along with whichever of the last three renders and
 * never replaces the page. A failed listing means "we do not know", so it is
 * never read as "no invitation": the default view (with Check again) renders.
 */
import type { AccountInvitationPurpose } from "@/lib/db/domain/invitations";

export type StandingBlock = "pending" | "not_tenants" | "ended";

export interface InvitationInput {
  invitationId: string;
  organizationName: string;
  purpose: AccountInvitationPurpose;
  expiresAt: Date;
  personDisplayName: string | null;
}

export interface NoOrganizationFacts {
  enterable: number;
  pending: number;
  notTenants: number;
  ended: number;
  invitations: readonly InvitationInput[];
  /** The listing threw (N5). */
  invitationsFailed: boolean;
  session: { twoFactorRequired: boolean; twoFactorVerified: boolean };
  /** The account has a `user_totp` row. */
  enrolled: boolean;
}

export interface InvitationCardView extends InvitationInput {
  /**
   * Two-factor sign-in must be finished before this card can be accepted:
   * founding administrator and treasurer always; any other purpose when the
   * session's account must use it (G9 parity with the emailed-link path).
   * A `sign_in` invitation to an authority-bearing record can also come back
   * `needs_second_factor` from the definer after the click; the form handles
   * that state itself.
   */
  secondFactorNeeded: boolean;
}

export type NoOrganizationView =
  | { kind: "already_have_access"; count: number }
  | {
      kind: "standing";
      block: StandingBlock;
      cards: InvitationCardView[];
      listFailed: boolean;
      enrolled: boolean;
    }
  | { kind: "invited"; cards: InvitationCardView[]; listFailed: false; enrolled: boolean }
  | { kind: "default"; listFailed: boolean; enrolled: boolean };

const ALWAYS_SECOND_FACTOR: ReadonlySet<AccountInvitationPurpose> = new Set([
  "founding_administrator",
  "treasurer",
]);

export function secondFactorNeededFor(
  purpose: AccountInvitationPurpose,
  session: NoOrganizationFacts["session"],
): boolean {
  const required = ALWAYS_SECOND_FACTOR.has(purpose) || session.twoFactorRequired === true;
  return required && session.twoFactorVerified !== true;
}

export function deriveNoOrganizationView(facts: NoOrganizationFacts): NoOrganizationView {
  if (facts.enterable > 0) return { kind: "already_have_access", count: facts.enterable };

  const cards: InvitationCardView[] = facts.invitationsFailed
    ? []
    : facts.invitations.map((invitation) => ({
        ...invitation,
        secondFactorNeeded: secondFactorNeededFor(invitation.purpose, facts.session),
      }));

  const block: StandingBlock | null =
    facts.pending > 0 ? "pending" : facts.notTenants > 0 ? "not_tenants" : facts.ended > 0 ? "ended" : null;

  if (block) {
    return { kind: "standing", block, cards, listFailed: facts.invitationsFailed, enrolled: facts.enrolled };
  }
  if (cards.length > 0) return { kind: "invited", cards, listFailed: false, enrolled: facts.enrolled };
  return { kind: "default", listFailed: facts.invitationsFailed, enrolled: facts.enrolled };
}

/** Where the second-factor notices send the person; both come back here. */
export const NO_ORGANIZATION_PATH = "/no-organization";
export const VERIFY_HREF = "/totp?callbackUrl=%2Fno-organization";
export const ENROLL_HREF = "/account/2fa?callbackUrl=%2Fno-organization";

export function secondFactorHref(enrolled: boolean): string {
  return enrolled ? VERIFY_HREF : ENROLL_HREF;
}
