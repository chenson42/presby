/**
 * The operator-facing copy for a sent, resent or open account invitation
 * (docs/work-log/2026-10-24-invite-accept-copy.md, Phase 3 "Copy"). A PLAIN
 * module with no imports at all (nothing from the database, the server runtime
 * or the issue library), so the server action, the client notice, the two section components and the tests all import the one
 * text. A copy edit therefore fails a test loudly instead of drifting from a
 * copied literal.
 *
 * The notice claims only what the system knows: that the email was handed to
 * the provider ("sent") or is being retried ("queued"), never that it arrived or
 * was opened. "From the email" is accurate in both states.
 */

/** The two designation purposes an invitation can carry. */
export type InvitationCopyPurpose = "founding_administrator" | "treasurer";

/** The word "nobody holds this ..." takes: a role for the founding administrator, access for the treasurer. */
export const INVITATION_ROLE_WORD: Record<InvitationCopyPurpose, "role" | "access"> = {
  founding_administrator: "role",
  treasurer: "access",
};

/** What the designation is called inside a sentence. */
const DESIGNATION_NAME: Record<InvitationCopyPurpose, string> = {
  founding_administrator: "founding administrator",
  treasurer: "treasurer",
};

/** A non-blocking note on a SENT invitation. Mirrors `InvitationWarning` in issue.ts. */
export type InvitationWarningCode = "address_on_signed_in_person";

/**
 * The copy for each warning. Describes this organization's roster only, never
 * whether the address has an account anywhere (`users` is not read).
 */
export const INVITATION_WARNING_COPY: Record<InvitationWarningCode, string> = {
  address_on_signed_in_person:
    "That address is already on file for a person here who signs in. The invitation was sent, but it will be refused unless the invitee accepts while signed in to that person's own account.",
};

/**
 * The server-derived display name of the person an invitation is for.
 *
 * - Founding administrator: the typed first and last name already stored on the
 *   row (the same name the list shows as "For").
 * - Treasurer: the roster person's FIRST NAME ONLY. No name is typed for a
 *   treasurer; it is resolved from the address on the roster. First name is the
 *   minimum that identifies the invitee and is what the email greeting already
 *   uses; a platform operator holds no tenant authority, so the full name is not
 *   surfaced (orchestrator default on the Phase 1 open question, 2026-10-24).
 *
 * Null when there is nothing to show (missing or legacy data); callers fall back.
 */
export function deriveInviteeDisplayName(input: {
  purpose: InvitationCopyPurpose;
  /** The founding administrator's typed first name (stored on the invitation). */
  firstName: string | null | undefined;
  /** The founding administrator's typed last name (stored on the invitation). */
  lastName: string | null | undefined;
  /** The treasurer's first name, read from the roster person. */
  rosterFirstName: string | null | undefined;
}): string | null {
  const clean = (v: string | null | undefined) => (typeof v === "string" ? v.trim() : "");
  if (input.purpose === "treasurer") return clean(input.rosterFirstName) || null;
  const full = [clean(input.firstName), clean(input.lastName)].filter(Boolean).join(" ");
  return full || null;
}

/** Who the sentence names: the name, else "the person at {address}", else "the invitee". */
export function inviteeReference(name: string | null | undefined, address?: string | null): string {
  const n = typeof name === "string" ? name.trim() : "";
  if (n) return n;
  const a = typeof address === "string" ? address.trim() : "";
  if (a) return `the person at ${a}`;
  return "the invitee";
}

/**
 * The success-notice sentence that replaces "Nobody holds this {role} until it
 * is accepted." It states when the designation takes effect and that nobody
 * holds it until then.
 */
export function acceptanceSentence(input: {
  purpose: InvitationCopyPurpose;
  name?: string | null;
  address?: string | null;
}): string {
  const who = inviteeReference(input.name, input.address);
  return (
    `The ${DESIGNATION_NAME[input.purpose]} designation takes effect when ${who} accepts it from the email. ` +
    `Until then nobody holds this ${INVITATION_ROLE_WORD[input.purpose]}.`
  );
}

/** The section's standing line while a pending invitation is open. */
export function openInvitationLine(purpose: InvitationCopyPurpose, name: string | null | undefined): string {
  const n = typeof name === "string" ? name.trim() : "";
  const word = INVITATION_ROLE_WORD[purpose];
  if (!n) {
    return `An invitation is open. Nobody holds this ${word} until it is accepted. Resend it if the email went astray, or revoke it to invite someone else.`;
  }
  return `An invitation is open for ${n}. Nobody holds this ${word} until ${n} accepts it. Resend it if the email went astray, or revoke it to invite someone else.`;
}

/**
 * The section's standing line while the open invitation has EXPIRED (it still
 * holds the slot until it is resent or revoked). Without a name it falls back to
 * the pre-existing "open" wording, which the Phase 1 review recorded as a small
 * untruth for an expired row; a name is always present in practice (a founding
 * administrator's is typed, a treasurer's comes from the roster).
 */
export function expiredInvitationLine(purpose: InvitationCopyPurpose, name: string | null | undefined): string {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) return openInvitationLine(purpose, null);
  return `The invitation for ${n} has expired. Nobody holds this ${INVITATION_ROLE_WORD[purpose]}. Resend it or revoke it to invite someone else.`;
}
