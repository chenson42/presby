import {
  COMMUNITY_ARCHIVE_ENDED_REASON,
  PARTICIPANT_REMOVAL_ENDED_REASON,
} from "@/lib/roll-action-kinds";
import { membershipStanding } from "@/lib/membership-standing";

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

/** The seven admin Community views, in nav order. `parseCommunityView` is the
 * only place a `?view=` value is trusted. `inactive` (Increment 3a) is the
 * people marked inactive or moved away who are not on the roll; it is an
 * administrator-only view, like `visitors`, `staff` and `former`. */
export const COMMUNITY_VIEWS = [
  "all",
  "members",
  "participants",
  "visitors",
  "inactive",
  "staff",
  "former",
] as const;

export type CommunityView = (typeof COMMUNITY_VIEWS)[number];

/** Anything that is not one of the seven becomes `'all'` (never an error, never
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
  | "inactive"
  | "moved_away"
  | "unclassified"
  | "former_participant"
  | "former_visitor"
  | "archived"
  | "ended";

export const CONNECTION_LABELS: Record<Connection, string> = {
  visitor: "Visitor",
  participant: "Participant",
  member: "Member",
  staff: "Staff",
  listed: "Listed",
  inactive: "Inactive",
  moved_away: "Moved away",
  unclassified: "On record",
  former_participant: "Former participant",
  former_visitor: "Archived visitor",
  archived: "Archived",
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
 * Precedence, first match wins (DECISION-233; the standing comes from
 * `membershipStanding`, the one TypeScript definition of it, never re-coded):
 *   1. ended: the participant-removal marker is a former participant; the
 *      archive marker is an archived visitor when the engagement kept on the row
 *      is `visitor` and plain archived otherwise; any other reason is `ended`;
 *   2. standing `listed`: a member roll is a member, the participant roll a
 *      participant, and anyone else (engagement `regular`, no roll) is `listed`;
 *   3. standing `staff_anchor` is staff (the DECISION-129 anchor);
 *   4. standing `visitor`;
 *   5. standing `inactive`: `moved_away` when that is the engagement, else
 *      `inactive`;
 *   6. otherwise `unclassified`, unreachable from stored rows once the
 *      engagement CHECK holds (D3) and kept as the fail-closed arm.
 *
 * The roll comes before engagement on purpose: the roll functions never write
 * the pastoral axis (DECISION-200), so an enrolled visitor keeps engagement
 * `visitor` and is a participant here until the enrolment is undone. `listed`
 * is returned ONLY for standing `listed` with no member or participant roll
 * (G3), so an inactive person is no longer called "Listed" (F242).
 */
export function deriveConnection(row: ConnectionRow): Connection {
  if (row.endedOn !== null) {
    if (row.endedReason === PARTICIPANT_REMOVAL_ENDED_REASON) return "former_participant";
    if (row.endedReason === COMMUNITY_ARCHIVE_ENDED_REASON) {
      return row.engagementStatus === "visitor" ? "former_visitor" : "archived";
    }
    return "ended";
  }
  const standing = membershipStanding(row.currentRoll, row.engagementStatus);
  switch (standing) {
    case "listed":
      if (row.currentRoll !== null && (MEMBER_ROLLS as readonly string[]).includes(row.currentRoll)) {
        return "member";
      }
      if (row.currentRoll === "other_participant") return "participant";
      return "listed";
    case "staff_anchor":
      return "staff";
    case "visitor":
      return "visitor";
    case "inactive":
      return row.engagementStatus === "moved_away" ? "moved_away" : "inactive";
    case "unclassified":
      return "unclassified";
  }
}

/**
 * The wizard's "already here" sentence for a match candidate that already has
 * a membership at this organization (F178). `endedOn` is read for the
 * connections that ended. Constant copy per connection, so the sentence never
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
    case "inactive":
      return "They're marked inactive.";
    case "moved_away":
      return "They're marked as moved away.";
    case "unclassified":
      return "They're already here.";
    case "former_participant":
      return "They're a former participant.";
    case "former_visitor":
    case "archived":
      return endedOn ? `They were archived on ${endedOn}.` : "They were archived.";
    case "ended":
      return endedOn ? `Their connection ended on ${endedOn}.` : "Their connection has ended.";
  }
}
