import { PARTICIPANT_REMOVAL_ENDED_REASON } from "@/lib/roll-action-kinds";

/**
 * Community vocabulary shared by the admin Community page, the edit page's
 * Connection card, the list badges and the wizard's "already here" step
 * (docs/work-log/2026-10-22-founding-admin-directory.md, Phase 3 "Pure shared
 * modules"; DECISION-200, DECISION-201).
 *
 * Plain module, no `server-only` and no database: the client wizard imports it
 * and the lib (`people.ts`'s `matchPerson()`) imports it too, so there is one
 * derivation of "how is this person connected to this organization" and it
 * cannot drift between the server and the page.
 */

/** The six admin Community views, in nav order. `parseCommunityView` is the
 * only place a `?view=` value is trusted. */
export const COMMUNITY_VIEWS = [
  "all",
  "members",
  "participants",
  "visitors",
  "staff",
  "former",
] as const;

export type CommunityView = (typeof COMMUNITY_VIEWS)[number];

/** Anything that is not one of the six becomes `'all'` (never an error, never
 * an unvalidated string reaching a query branch). */
export function parseCommunityView(raw: string | string[] | undefined | null): CommunityView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (COMMUNITY_VIEWS as readonly string[]).includes(value ?? "")
    ? (value as CommunityView)
    : "all";
}

/** How a person is connected to THIS organization, derived (never stored). */
export type Connection =
  | "visitor"
  | "participant"
  | "member"
  | "staff"
  | "listed"
  | "former_participant"
  | "ended";

export const CONNECTION_LABELS: Record<Connection, string> = {
  visitor: "Visitor",
  participant: "Participant",
  member: "Member",
  staff: "Staff",
  listed: "Listed",
  former_participant: "Former participant",
  ended: "Connection ended",
};

export interface ConnectionRow {
  /** 'YYYY-MM-DD' or null. */
  endedOn: string | null;
  endedReason: string | null;
  currentRoll: string | null;
  engagementStatus: string;
}

const MEMBER_ROLLS = ["active", "baptized", "affiliate"] as const;

/**
 * Precedence, first match wins:
 *   1. ended (a former participant when `ended_reason` is the removal marker),
 *   2. a member roll (active, baptized, affiliate),
 *   3. the participant roll,
 *   4. engagement `visitor`,
 *   5. engagement `staff` (the DECISION-129 anchor),
 *   6. otherwise `listed` (engagement `regular` with no roll yet).
 *
 * The roll comes before engagement on purpose: the roll functions never write
 * the pastoral axis (DECISION-200), so an enrolled visitor keeps engagement
 * `visitor` and is a participant here until the enrolment is undone.
 */
export function deriveConnection(row: ConnectionRow): Connection {
  if (row.endedOn !== null) {
    return row.endedReason === PARTICIPANT_REMOVAL_ENDED_REASON
      ? "former_participant"
      : "ended";
  }
  if (row.currentRoll !== null && (MEMBER_ROLLS as readonly string[]).includes(row.currentRoll)) {
    return "member";
  }
  if (row.currentRoll === "other_participant") return "participant";
  if (row.engagementStatus === "visitor") return "visitor";
  if (row.engagementStatus === "staff") return "staff";
  return "listed";
}

/**
 * The wizard's "already here" sentence for a match candidate that already has
 * a membership at this organization (F178). `endedOn` is only read for the
 * `ended` connection. Constant copy per connection, so the sentence never
 * varies with anything but the connection.
 */
export function alreadyHereSentence(
  connection: Connection,
  endedOn: string | null,
): string {
  switch (connection) {
    case "visitor":
      return "They're a visitor.";
    case "participant":
      return "They're a participant.";
    case "member":
      return "They're a member.";
    case "staff":
      return "They're on staff.";
    case "listed":
      return "They're listed here.";
    case "former_participant":
      return "They're a former participant.";
    case "ended":
      return endedOn ? `Their connection ended on ${endedOn}.` : "Their connection has ended.";
  }
}
