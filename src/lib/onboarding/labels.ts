/**
 * Copy for the invitation surfaces. PURE and client-safe. The ux-developer
 * owns final wording (Phase 3 section 6); the strings here are the contract
 * the actions return and the lists render, so a wording change is one edit.
 *
 * Nothing in this file reveals whether an address has an account: operator
 * copy describes the organization or the roster, invitee copy is shown only to
 * someone already holding a valid token.
 */
import type { AccountInvitationBlockedReason } from "@/lib/db/domain/invitations";
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
} as const;

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
};

/** The one literal for every dead state (DECISION-147 bucket). */
export const INVITATION_DEAD_LINK_COPY =
  "This link is no longer active. If you already accepted it, you can sign in. Otherwise ask whoever invited you to send a new one.";

/** One refusal literal for every durable-limit cause. */
export const INVITATION_RATE_LIMIT_COPY = "Too many invitations right now. Try again later.";
