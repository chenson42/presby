/**
 * Plain, client-safe types for the designation-holder list and revoke
 * (docs/work-log/2026-10-22-designation-revoke.md, Phase 3 "Plain props";
 * DECISION-194/195/196).
 *
 * NO IMPORTS, on purpose: the two designation sections and the revoke dialog
 * are client components, and `designation-holders.ts` (the library) is
 * `server-only` and holds the owner connection. A client component imports its
 * types from HERE, never from the library. A source scan (boundaries.test.ts)
 * holds the "no imports" line.
 *
 * Nothing in these shapes can carry an email address, and a group's members are
 * never named: `displayName` is a person's display name for a person subject
 * and the group's own name for a group subject (DECISION-195).
 */

export type DesignationSlot = "founding_administrator" | "treasurer";

export type HolderSubjectKind = "person" | "group";

/** The operator acting, from `auth()` only (the same shape as the invitation actor). */
export type HolderActor = { userId: string; email: string | null };

export type HolderRow = {
  /** `${subjectKind}:${subjectId}` */
  key: string;
  subjectKind: HolderSubjectKind;
  subjectId: string;
  /** Person: display name. Group: the group's name. Never an email. */
  displayName: string;
  /** Person: 1. Group: how many people the list attributes to it (no names). */
  holderPeopleCount: number;
  /** YYYY-MM-DD, the earliest contributing grant start. */
  since: string;
  /** `grant_reason` is the slot's designation string for at least one contributing grant. */
  provenance: "designation" | "other";
  /** The contributing roles (the ones that count toward the slot). */
  roleNames: string[];
  /** Founding-administrator person rows only: roles assigned together with the designation. */
  companionRoleNames: string[];
  /** Across the contributing and companion roles. */
  permissions: { key: string; description: string }[];
  /** Contributing + companion: exactly the dialog's expected set. */
  grantIds: string[];
  /** Person rows: the other groups the same person holds this through. */
  alsoThroughGroupNames: string[];
  /** True when ending this row would take the slot to zero people. */
  leavesNoHolders: boolean;
  /** False for a derived group (session, diaconate, active membership): D6. */
  revocable: boolean;
  /** Set when `revocable` is false. */
  derivedGroupName: string | null;
};

export type RevokeHolderActionResult =
  | { ok: true; reachedZero: boolean }
  | { ok: false; error: string; field?: "reason"; refresh?: boolean };
