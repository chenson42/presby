/**
 * Copy for the invitation surfaces. PURE and client-safe. The ux-developer
 * owns final wording (Phase 3 section 6); the strings here are the contract
 * the actions return and the lists render, so a wording change is one edit.
 *
 * Nothing in this file reveals whether an address has an account: operator
 * copy describes the organization or the roster, invitee copy is shown only to
 * someone already holding a valid token.
 */
import type {
  AccountInvitationBlockedReason,
  AccountInvitationPurpose,
} from "@/lib/db/domain/invitations";
import { SIGN_IN_INVITE_COPY } from "./sign-in-copy";
import type { DeliveryState, InvitationStatus } from "./status";

export const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  expired: "Expired",
  revoked: "Revoked",
  blocked: "Couldn't be completed",
};

export const DELIVERY_STATE_LABEL: Record<DeliveryState, string> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  bounced: "Bounced. Check the address",
  failed: "Failed to send",
  cancelled: "Cancelled",
  unknown: "Unknown",
};

export const PURPOSE_LABEL = {
  founding_administrator: "founding administrator",
  treasurer: "treasurer",
  // A sign_in invitation carries no role. The label exists so the record is
  // total (the invite page writes its own sentence for this purpose).
  sign_in: "sign-in",
} as const satisfies Record<AccountInvitationPurpose, string>;

/** What the platform operator reads when an acceptance was blocked. */
export const BLOCKED_REASON_OPERATOR_COPY: Record<AccountInvitationBlockedReason, string> = {
  has_holders:
    "Someone else gained this access before the invitation was accepted. Nothing was changed.",
  person_elsewhere:
    "The invitee's account is already linked to a person at a different organization. Nothing was changed.",
  membership_ended:
    "The person's relationship with this organization has ended. Nothing was changed.",
  person_merged: "The person's record was merged into another record. Nothing was changed.",
  person_linked_elsewhere:
    "The person's record is already linked to a different login. Nothing was changed.",
  ambiguous_person:
    "More than one person at this organization has that email on file. Nothing was changed.",
  not_applicable: "This role does not apply to this type of organization. Nothing was changed.",
  provisioning_incomplete:
    "This organization is missing its baseline setup. Contact an engineer. Nothing was changed.",
  // Reachable only for a sign_in invitation, which the platform panel never
  // lists (platform rows only); present so the table is total.
  person_deceased: "This person's record can't be invited. Nothing was changed.",
};

/** What the invitee reads, once their token is proven. */
export const INVITEE_BLOCKED_COPY: Record<AccountInvitationBlockedReason, string> = {
  has_holders:
    "This invitation can no longer be accepted because someone else now holds this access. Contact the person who invited you.",
  person_elsewhere:
    "This account is already linked to a person at another congregation, so this invitation can't be completed. Contact the person who invited you.",
  membership_ended:
    "Your relationship with this congregation has ended, so this invitation can't be completed. Contact the person who invited you.",
  person_merged:
    "Your record was merged into another one, so this invitation can't be completed. Contact the person who invited you.",
  person_linked_elsewhere:
    "That record is already linked to a different sign-in, so this invitation can't be completed. Contact the person who invited you.",
  ambiguous_person:
    "More than one person at this congregation has your email on file, so this invitation can't be completed. Contact the person who invited you.",
  not_applicable:
    "This invitation doesn't apply to this organization and can't be completed. Contact the person who invited you.",
  provisioning_incomplete:
    "This organization isn't fully set up yet, so this invitation can't be completed. Contact the person who invited you.",
  // Reachable only for a sign_in invitation (see inviteeBlockedCopy); total here.
  person_deceased: SIGN_IN_INVITE_COPY.blockedOther,
};

/**
 * What the invitee reads when an acceptance was blocked, by PURPOSE (G6). The
 * founding administrator and treasurer keep their existing strings; a sign_in
 * invitation reads the neutral variants, which never name why a record is in
 * the state it is in. `congregation` names the office to contact; the invitee
 * already holds a proven invitation to that congregation, so naming it tells
 * them nothing new.
 */
export function inviteeBlockedCopy(
  purpose: AccountInvitationPurpose,
  reason: AccountInvitationBlockedReason,
  congregation: string | null = null,
): string {
  switch (purpose) {
    case "founding_administrator":
    case "treasurer":
      return INVITEE_BLOCKED_COPY[reason];
    case "sign_in":
      switch (reason) {
        case "membership_ended":
        case "person_merged":
        case "person_deceased":
          return SIGN_IN_INVITE_COPY.blockedOwnOrganization(
            congregation && congregation.trim() ? congregation.trim() : "your congregation",
          );
        case "ambiguous_person":
        case "person_linked_elsewhere":
          return SIGN_IN_INVITE_COPY.blockedSharedAddress;
        case "person_elsewhere":
        case "has_holders":
        case "not_applicable":
        case "provisioning_incomplete":
          // The last three cannot occur for a sign_in invitation (its branch
          // commits only the six reasons above); the neutral sentence keeps the
          // table total without inventing a reason-specific one.
          return SIGN_IN_INVITE_COPY.blockedOther;
        default: {
          const _exhaustive: never = reason;
          throw new Error(`Unhandled blocked reason: ${String(_exhaustive)}`);
        }
      }
    default: {
      const _exhaustive: never = purpose;
      throw new Error(`Unhandled invitation purpose: ${String(_exhaustive)}`);
    }
  }
}

/** The one literal for every dead state (DECISION-147 bucket). */
export const INVITATION_DEAD_LINK_COPY =
  "This link is no longer active. If you already accepted it, you can sign in. Otherwise ask whoever invited you to send a new one.";

/**
 * N4: an in-place invitation that is no longer active. A SEPARATE constant from
 * `INVITATION_DEAD_LINK_COPY` above (which says "link" and stays byte-identical
 * on `/invite`), so neither can drift into the other's noun.
 */
export const INVITATION_DEAD_IN_PLACE_COPY =
  "This invitation is no longer active. Reload the page to see what is current, or ask whoever invited you to send a new one.";

/** One refusal literal for every durable-limit cause. */
export const INVITATION_RATE_LIMIT_COPY = "Too many invitations right now. Try again later.";
