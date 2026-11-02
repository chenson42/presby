/**
 * Membership standing: the ONE TypeScript definition of "is this person listed
 * in the member directory", and the vocabulary around it (Community Increment
 * 3a, DECISION-233, R50/R51; docs/work-log/2026-10-22-founding-admin-directory-
 * inc3.md, Phase 3 section 6.1).
 *
 * This file is the TypeScript half of a pair. The SQL half is
 * `presby_membership_standing(text, text)` (drizzle/0065) and, on top of it,
 * `presby_standing_is_member(text)` and `presby_membership_is_member_standing(
 * text, text)` (drizzle/0066 section 2). The two halves are pinned equal over
 * the whole value grid by `membership-standing.db.test.ts`, and a source scan
 * (`membership-standing.source.test.ts`) bars every other non-test module from
 * re-coding the roll list or the engagement test. A consumer that needs the
 * answer calls one of these functions (client or server) or the SQL classifier
 * (a query); nothing else spells it out.
 *
 * Plain module on purpose: no `server-only`, no database, no imports. The
 * client wizard and the engagement dialog import it, and so does the lib.
 *
 * FIRST MATCH WINS, in R50's order:
 *   listed        a roll in LISTED_ROLLS, or engagement `regular`
 *   staff_anchor  engagement `staff` (the DECISION-129 anchor)
 *   visitor       engagement `visitor`
 *   inactive      engagement `inactive` or `moved_away`
 *   unclassified  anything else (an unknown roll or engagement): fails closed
 *
 * MEMBER STANDING is `listed` or `staff_anchor`. It decides who gets the
 * directory (the Active Membership derived row, which carries the `member`
 * role) and who auto-connects at sign-in (R55). "Listed in the member
 * directory" is the narrower `listed` alone.
 */

/** The four rolls that make a person listed whatever their engagement. */
export const LISTED_ROLLS = ["active", "baptized", "affiliate", "other_participant"] as const;

/**
 * The stored engagement vocabulary. Pinned to the CHECK
 * `memberships_engagement_status_allowed` (drizzle/0066 section 8, F243) by a
 * source-scan test: a sixth value is a migration, and a test fails until both
 * sides agree.
 */
export const ENGAGEMENT_STATUSES = ["visitor", "regular", "inactive", "moved_away", "staff"] as const;
export type Engagement = (typeof ENGAGEMENT_STATUSES)[number];

/**
 * What an administrator may set (never `staff`: that is written only when the
 * staff anchor is created, and the engagement guard refuses a transition into
 * or out of it).
 */
export const EDITABLE_ENGAGEMENTS = ["visitor", "regular", "inactive", "moved_away"] as const;
export type EditableEngagement = (typeof EDITABLE_ENGAGEMENTS)[number];

/**
 * `presby_membership_standing()`'s closed result. 2b named this vocabulary
 * `MEMBERSHIP_STANDINGS` / `MembershipStanding` and `sign-in-types.ts`
 * re-exports these names, so there is one list, not two (D13 (c)).
 */
export const MEMBERSHIP_STANDINGS = ["listed", "staff_anchor", "visitor", "inactive", "unclassified"] as const;
export type MembershipStanding = (typeof MEMBERSHIP_STANDINGS)[number];
/** The 3a design's name for the same type. */
export type Standing = MembershipStanding;

/** True for a roll that makes the person listed. Any other value (null, a retired roll, junk) is false. */
export function isListedRoll(roll: string | null | undefined): boolean {
  return roll !== null && roll !== undefined && (LISTED_ROLLS as readonly string[]).includes(roll);
}

/**
 * The standing of one membership, from its cached roll and its engagement.
 * Mirrors `presby_membership_standing()` exactly, including null inputs (a null
 * engagement with no roll is `unclassified`; with a listed roll, `listed`).
 */
export function membershipStanding(
  roll: string | null | undefined,
  engagement: string | null | undefined,
): MembershipStanding {
  if (isListedRoll(roll) || engagement === "regular") return "listed";
  if (engagement === "staff") return "staff_anchor";
  if (engagement === "visitor") return "visitor";
  if (engagement === "inactive" || engagement === "moved_away") return "inactive";
  return "unclassified";
}

/** Member standing: `listed` or `staff_anchor`. Mirrors `presby_standing_is_member()`. Null in, false out. */
export function isMemberStanding(standing: MembershipStanding | null | undefined): boolean {
  return standing === "listed" || standing === "staff_anchor";
}

/** Convenience: `isMemberStanding(membershipStanding(roll, engagement))`. Mirrors `presby_membership_is_member_standing()`. */
export function isMemberStandingFor(
  roll: string | null | undefined,
  engagement: string | null | undefined,
): boolean {
  return isMemberStanding(membershipStanding(roll, engagement));
}

/** True when the value is one of the five stored engagements. */
export function isEngagement(value: unknown): value is Engagement {
  return typeof value === "string" && (ENGAGEMENT_STATUSES as readonly string[]).includes(value);
}

/** True when the value is one an administrator may set. */
export function isEditableEngagement(value: unknown): value is EditableEngagement {
  return typeof value === "string" && (EDITABLE_ENGAGEMENTS as readonly string[]).includes(value);
}

/**
 * What the engagement control offers. A person with a roll is never offered
 * Visitor (the engagement guard refuses it, and a rolled person is not a
 * visitor); everyone else is offered all four.
 */
export function offeredEngagements(hasRoll: boolean): EditableEngagement[] {
  return EDITABLE_ENGAGEMENTS.filter((value) => !(hasRoll && value === "visitor"));
}

/** The longest "how they heard" text, shared by the creation path, the edit writer and the form. */
export const MAX_HOW_HEARD = 200;

/** The earliest first-visit date an edit accepts (D7: a floor on edit only). */
export const FIRST_VISIT_FLOOR = "1900-01-01";
