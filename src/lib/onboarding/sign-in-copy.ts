/**
 * The words of the congregation's sign-in invitation, in one place (Community
 * Increment 2b, Batch B2; Phase 3 "Copy" as amended by amendment 2 section 10,
 * groups D, E, F and I). PURE and client-safe: no database, no `server-only`.
 *
 * Every string here is a string the operator read at kickoff step 5, verbatim.
 * Names, addresses, congregation names, dates and minute counts are inserted by
 * the caller (a function parameter, never string surgery in a component). An
 * implementer who needs a string that is not here stops for a ruling; nothing
 * below was written without a source line in the Copy.
 *
 * `SIGN_IN_REFUSAL_COPY` is a `Record` over the refusal codes, so a code added
 * to `SIGN_IN_REFUSALS` without a sentence is a type error and a test.
 *
 * Nothing in this file says a sender confirmed an address, that an invitation
 * is the only way to be connected, or that two-factor sign-in prevents misuse
 * of a typed address (F232, R42's honest framing).
 */
import type { DeliveryState } from "./status";
import {
  type SessionRowState,
  type SignInBlockOutcome,
  type SignInMarker,
  type SignInRefusal,
} from "./sign-in-types";

// ---------------------------------------------------------------------------
// Sender refusals (SIGN_IN_REFUSAL_COPY)
// ---------------------------------------------------------------------------

/** Values a refusal sentence may name. The action fills what it knows; a sentence without a hole ignores them. */
export interface SignInCopyContext {
  /** The person's name as the card shows it. */
  name?: string | null;
  congregation?: string | null;
  /** Whole minutes. */
  minutes?: number;
}

type CopyFn = (ctx: SignInCopyContext) => string;

const nameOf = (ctx: SignInCopyContext) => (ctx.name && ctx.name.trim() ? ctx.name.trim() : "This person");
const congregationOf = (ctx: SignInCopyContext) =>
  ctx.congregation && ctx.congregation.trim() ? ctx.congregation.trim() : "your congregation";
const minutesWord = (n: number) => `${n} minute${n === 1 ? "" : "s"}`;

/** The codes a sender can meet that are not database refusals. */
export const SIGN_IN_ACTION_CODES = [
  "forbidden",
  "totp_unavailable",
  "link_origin_unavailable",
  "db_error",
] as const;
export type SignInActionCode = (typeof SIGN_IN_ACTION_CODES)[number];

/**
 * `needs_acknowledgement` is deliberately absent: it is not an error. The
 * dialog shows the acknowledgement paragraphs (`SIGN_IN_DIALOG_COPY.send`), and
 * the action's result carries `needsAcknowledgement` with an empty `error`.
 */
export type SignInCopiedCode = Exclude<SignInRefusal, "needs_acknowledgement"> | SignInActionCode;

export const SIGN_IN_REFUSAL_COPY: Record<SignInCopiedCode, CopyFn> = {
  forbidden: () => "You don't have permission to invite people to sign in here.",
  not_found: () => "That person could not be found.",
  already_signs_in: (c) =>
    `${nameOf(c)} can already sign in. If they've forgotten their password, they can use "Forgot password" on the sign-in page.`,
  person_merged: () => "This person's record was merged into another one, so it can't be invited.",
  person_deceased: () => "This person's record can't be invited.",
  membership_ended: (c) =>
    `This person's connection to ${congregationOf(c)} has ended, so they can't be invited.`,
  needs_support: () => "This needs help from PresbyPortal support. Send us a support ticket.",
  needs_officers_permission: (c) =>
    `${nameOf(c)} holds a seat on the Session or the Board of Deacons. Only someone who can manage officers can invite them.`,
  exceeds_your_access: (c) =>
    `${nameOf(c)} holds access that you don't have yourself, so you can't invite them. Ask an administrator who does.`,
  no_email_on_file: (c) => `${nameOf(c)} has no email address on file. Add one, then come back.`,
  address_changed: () => "The address on file changed while you were looking. Check it and send again.",
  address_is_yours: () => "That's your own email address. Each person needs their own address to sign in.",
  address_shared: () =>
    "Another person at your congregation has the same email address on file. Each person needs their own address to sign in.",
  already_pending: () => "An invitation is already out. Send it again or cancel it.",
  not_open: () => "There's no open invitation to change. Reload the page.",
  cooldown: (c) =>
    `You sent this a moment ago. You can send it again in ${minutesWord(Math.max(1, c.minutes ?? 1))}.`,
  chain_cap: (c) =>
    `This has been sent several times. Ask ${nameOf(c)} to check their spam folder, or send us a support ticket.`,
  rate_limited: () => "Too many invitations right now. Try again later.",
  totp_unavailable: () => "We can't send invitations right now. Send us a support ticket.",
  link_origin_unavailable: () => "We can't send invitations right now. Send us a support ticket.",
  db_error: () => "We couldn't complete that just now. Try again.",
};

/** The refusals that need `{Name}` read from the person's own record. */
export const SIGN_IN_REFUSALS_NAMING_THE_PERSON: ReadonlySet<SignInRefusal> = new Set([
  "already_signs_in",
  "needs_officers_permission",
  "exceeds_your_access",
  "no_email_on_file",
  "chain_cap",
]);

export function signInRefusalMessage(code: SignInCopiedCode, ctx: SignInCopyContext = {}): string {
  return SIGN_IN_REFUSAL_COPY[code](ctx);
}

// ---------------------------------------------------------------------------
// The card (edit page), heading "Sign in to PresbyPortal"
// ---------------------------------------------------------------------------

export const SIGN_IN_CARD_HEADING = "Sign in to PresbyPortal";

export const SIGN_IN_CARD_COPY = {
  /** Small text under every connected line (Phase 3, kept by group D). */
  connectedSupport: "To change who signs in as this person, send us a support ticket.",
  connectedUnknown: (name: string) => `${name} is connected to a sign-in.`,
  connectedThroughSignIn: (date: string) => `Connected through sign-in on ${date}.`,
  connectedThroughInvitation: (date: string) => `Connected through an invitation on ${date}.`,
  none: (name: string, address: string) =>
    `Invite ${name} to sign in. We'll email ${address} with a link that works once. Accepting lets them sign in as themselves. It doesn't change what they can do here.`,
  noAddress: (name: string) =>
    `${name} has no email address on file. Add one under Contact & address, then come back.`,
  pending: (address: string, sent: string, expires: string) =>
    `Invitation sent to ${address} on ${sent}. It expires ${expires}.`,
  sendAgainHint: "Sending again turns off the earlier link.",
  cooldown: (minutes: number) =>
    `You sent this a moment ago. You can send it again in ${minutesWord(Math.max(1, minutes))}.`,
  expired: (address: string, date: string) => `The invitation to ${address} expired on ${date}.`,
  bounced: (address: string) =>
    `The email to ${address} bounced. Check the address on file, fix it, and send again.`,
  addressChanged: (newAddress: string) =>
    `The address on file changed after this was sent, so the earlier link no longer works. Send again to reach ${newAddress}.`,
  chainCap: (name: string) =>
    `This has been sent several times. Ask ${name} to check their spam folder, or send us a support ticket.`,
  loadFailed: "We couldn't load this just now. Reload the page.",
  buttons: {
    send: "Send invitation",
    sendAgain: "Send again",
    sendNew: "Send a new one",
    cancel: "Cancel invitation",
  },
  /** Delivery word beside a pending invitation ("Queued", "Sent", "Delivered"). */
  delivery: {
    queued: "Queued",
    sent: "Sent",
    delivered: "Delivered",
  } satisfies Partial<Record<DeliveryState, string>>,
} as const;

export function blockedCardLine(outcome: SignInBlockOutcome, name: string, congregation: string): string {
  switch (outcome) {
    case "membership_ended":
      return `This invitation couldn't be completed because ${name}'s connection to ${congregation} has ended.`;
    case "person_merged":
      return `This invitation couldn't be completed because ${name}'s record was merged into another one.`;
    case "person_deceased":
      return "This person's record can't be invited.";
    case "needs_support":
      return "This invitation couldn't be completed. Send us a support ticket and we'll look into it.";
    default: {
      const _exhaustive: never = outcome;
      throw new Error(`Unhandled block outcome: ${String(_exhaustive)}`);
    }
  }
}

/** The connect lines under the state copy (group D). */
export const CONNECT_OUTLOOK_COPY = {
  by_sign_in: (name: string, address: string) =>
    `When ${name} signs in with ${address}, PresbyPortal connects them to this record if it can. An invitation also connects them.`,
  by_sign_in_second_factor: (name: string, address: string) =>
    `${name} holds a role or a seat here. When they sign in with ${address}, PresbyPortal connects them once they have confirmed two-factor sign-in.`,
  visitor: (name: string) =>
    `${name} is a visitor, so signing in won't connect them by itself. Send an invitation if you want them to have access.`,
  shared_address: (name: string) =>
    `${name} shares this email address with someone else here, so signing in won't connect either of them by itself. Each person needs their own address.`,
  turned_off: (congregation: string) =>
    `Connecting people when they sign in is turned off for ${congregation}. An invitation still connects them.`,
  pendingInvitation: (name: string) =>
    `While this invitation is open, signing in does not connect ${name} by itself. They accept the invitation instead.`,
} as const;

// ---------------------------------------------------------------------------
// Dialogs and toasts
// ---------------------------------------------------------------------------

export const SIGN_IN_DIALOG_COPY = {
  send: {
    title: (name: string) => `Send an invitation to ${name}?`,
    body: (name: string, address: string, expires: string) =>
      `We'll email ${address}. The link works once and expires on ${expires}. Only send it if that address belongs to ${name}: whoever opens the link becomes ${name} on PresbyPortal.`,
    visitorAcknowledgement: (name: string) =>
      `${name} is recorded as a visitor. Anyone who signs in can see your member directory and your calendar, with each person's privacy settings applied. Only continue if you want ${name} to have that.`,
    doNotContactAcknowledgement: (name: string) =>
      `${name} asked not to be contacted at this address. This is a one-time account email, not marketing. Send it anyway?`,
    checkbox: "I understand, send it anyway",
    cancel: "Cancel",
    confirm: "Send invitation",
    toastSent: (address: string, expires: string) => `Invitation sent to ${address}. It expires ${expires}.`,
    toastQueued: "Invitation saved. The email will go out shortly.",
  },
  sendAgain: {
    title: "Send this invitation again?",
    body: (address: string) => `We'll email ${address} a new link. The earlier link stops working.`,
    cancel: "Cancel",
    confirm: "Send again",
    toastSent: (address: string) => `Invitation sent again to ${address}.`,
  },
  cancel: {
    title: "Cancel this invitation?",
    body: (name: string) =>
      `The link will stop working, and ${name} won't be able to sign in until you send a new one.`,
    keep: "Keep it",
    confirm: "Cancel invitation",
    toast: "Invitation cancelled.",
  },
} as const;

// ---------------------------------------------------------------------------
// Markers (group E): icon and word, never colour alone
// ---------------------------------------------------------------------------

/** Appended to "Not connected yet" when the person has no address (group E); the component joins the two. */
export const SIGN_IN_MARKER_NO_EMAIL = "No email on file";

/** The marker's main words. For `not_connected` with `noEmail`, the component adds `SIGN_IN_MARKER_NO_EMAIL`. */
export function signInMarkerLabel(marker: SignInMarker, formatDate: (date: Date) => string): string {
  switch (marker.kind) {
    case "pending":
      return `Invitation sent ${formatDate(marker.sentAt)}`;
    case "expired":
      return "Invitation expired. Send again";
    case "bounced":
      return "Email bounced. Check the address";
    case "blocked":
      return "Invitation couldn't be completed";
    case "not_connected":
      return "Not connected yet";
    default: {
      const _exhaustive: never = marker;
      throw new Error(`Unhandled marker: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// The Session banner's hand-off (group F)
// ---------------------------------------------------------------------------

export const SESSION_BANNER_COPY = {
  /** `no_sign_in`, line 1. `members` is the count of recorded Session members. */
  noSignIn: (members: number) =>
    `${members} ${members === 1 ? "member" : "members"} of the Session ${members === 1 ? "is" : "are"} recorded, but none has connected a sign-in yet, so no one can approve.`,
  /** The hand-off for a viewer with `people.manage` and `officers.manage`, while the toggle is on. */
  handOff:
    "A member of the Session is also connected when they sign in with the email address on their record, after confirming two-factor sign-in.",
  invitationsOut: (sent: number, members: number) =>
    `Invitations sent to ${sent} of the ${members} members of the Session. Waiting for them to accept.`,
  otherViewers: "Ask an administrator to invite your Session members to sign in.",
  termsNotStarted: "To approve, a member of the Session also needs to have connected a sign-in.",
  noPermission:
    "Some members of the Session have connected a sign-in, but none of them has permission to approve roll actions. This usually means the Session member role was changed. Ask an administrator to check the Session member role, or send us a support ticket.",
  officersNote:
    "Members of the Session decide who is received onto the roll. Recording a ruling elder, installed pastor, co-pastor or associate pastor here seats them on the Session. They can approve only once they have connected a sign-in, either by signing in with the email address on their record or by accepting an invitation.",
  rowLinks: { invite: "Invite", open: "Open" },
} as const;

export function sessionRowStateLabel(state: SessionRowState, formatDate: (date: Date) => string, sentAt: Date | null): string {
  switch (state) {
    case "no_email":
      return "No email on file";
    case "not_invited":
      return "Not invited yet";
    case "sent":
      return sentAt ? `Invitation sent ${formatDate(sentAt)}` : "Invitation sent";
    case "expired":
      return "Invitation expired";
    case "bounced":
      return "Email bounced";
    case "blocked":
      return "Invitation couldn't be completed";
    default: {
      const _exhaustive: never = state;
      throw new Error(`Unhandled Session row state: ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// The /invite page for a sign_in invitation (Phase 3 "The invite page")
// ---------------------------------------------------------------------------

export const SIGN_IN_INVITE_COPY = {
  summary: (congregation: string) =>
    `${congregation} invited you to sign in. Signing in lets you see what ${congregation} shares with its people. What you can do depends on your role there.`,
  /** Blocked, for the invitee (neutral, G6). */
  blockedOwnOrganization: (congregation: string) =>
    `This invitation can't be completed. Contact ${congregation}'s office.`,
  blockedSharedAddress:
    "This email address is already connected to someone else's record at this congregation, for example a family member. Each person needs their own address. Contact the person who invited you.",
  blockedOther: "This invitation can't be completed. Contact the person who invited you.",
} as const;

// ---------------------------------------------------------------------------
// The platform organization page's panel for congregation-sent invitations
// ---------------------------------------------------------------------------

export const ORG_SENT_PANEL_COPY = {
  heading: "Sign-in invitations sent by this organization",
  counts: (open: number, accepted: number, expired: number, revoked: number) =>
    `${open} open, ${accepted} accepted, ${expired} expired, ${revoked} cancelled.`,
  revokeAllButton: (n: number) => `Cancel all open sign-in invitations (${n})`,
  revokeAllConfirm:
    "This stops every open sign-in link this congregation has sent. People who already accepted keep their access. The congregation can send new ones.",
  designationsButton: (n: number) => `Cancel all open designation invitations (${n})`,
} as const;
