import { describe, expect, it } from "vitest";
import {
  EDITABLE_ENGAGEMENTS,
  ENGAGEMENT_STATUSES,
  LISTED_ROLLS,
  MEMBERSHIP_STANDINGS,
  MAX_HOW_HEARD,
  isEditableEngagement,
  isEngagement,
  isListedRoll,
  isMemberStanding,
  isMemberStandingFor,
  membershipStanding,
  offeredEngagements,
  type MembershipStanding,
} from "./membership-standing";

/**
 * The pure half of the R51 pin. The DB half (`membership-standing.db.test.ts`)
 * runs the same grid through `presby_membership_standing()` and
 * `presby_standing_is_member()` and asserts equality with these functions, so a
 * change to either side fails there. The expectations below are written out by
 * hand from R50's first-match order, never computed from the function under
 * test.
 */

describe("membershipStanding: R50's first-match order", () => {
  const cases: Array<[string | null, string | null, MembershipStanding]> = [
    // a listed roll wins over any engagement, including the unclassifiable
    ["active", "regular", "listed"],
    ["active", "visitor", "listed"],
    ["active", "inactive", "listed"],
    ["active", "moved_away", "listed"],
    ["active", "staff", "listed"],
    ["baptized", "inactive", "listed"],
    ["affiliate", "visitor", "listed"],
    ["other_participant", "visitor", "listed"],
    ["other_participant", "regular", "listed"],
    ["active", null, "listed"],
    ["active", "unknown", "listed"],
    // no roll: the engagement decides
    [null, "regular", "listed"],
    [null, "staff", "staff_anchor"],
    [null, "visitor", "visitor"],
    [null, "inactive", "inactive"],
    [null, "moved_away", "inactive"],
    // an unlisted roll counts as no roll
    ["zzz", "regular", "listed"],
    ["zzz", "visitor", "visitor"],
    ["removed", "visitor", "visitor"],
    ["zzz", "inactive", "inactive"],
    ["zzz", "staff", "staff_anchor"],
    // nothing matches: fails closed
    [null, null, "unclassified"],
    [null, "unknown", "unclassified"],
    ["zzz", "unknown", "unclassified"],
    ["zzz", null, "unclassified"],
    ["", "", "unclassified"],
  ];

  it.each(cases)("roll %j, engagement %j is %s", (roll, engagement, expected) => {
    expect(membershipStanding(roll, engagement)).toBe(expected);
  });

  it("treats an undefined roll or engagement like null", () => {
    expect(membershipStanding(undefined, undefined)).toBe("unclassified");
    expect(membershipStanding(undefined, "visitor")).toBe("visitor");
    expect(membershipStanding("active", undefined)).toBe("listed");
  });

  it("returns only members of the closed vocabulary", () => {
    const rolls = [...LISTED_ROLLS, null, "removed", "zzz"];
    const engagements = [...ENGAGEMENT_STATUSES, null, "unknown"];
    for (const roll of rolls) {
      for (const engagement of engagements) {
        expect(MEMBERSHIP_STANDINGS).toContain(membershipStanding(roll, engagement));
      }
    }
  });

  it("the vocabulary lists are the ones the schema and the classifier use", () => {
    expect([...LISTED_ROLLS]).toEqual(["active", "baptized", "affiliate", "other_participant"]);
    expect([...ENGAGEMENT_STATUSES]).toEqual(["visitor", "regular", "inactive", "moved_away", "staff"]);
    expect([...MEMBERSHIP_STANDINGS]).toEqual(["listed", "staff_anchor", "visitor", "inactive", "unclassified"]);
  });
});

describe("isMemberStanding", () => {
  it.each([
    ["listed", true],
    ["staff_anchor", true],
    ["visitor", false],
    ["inactive", false],
    ["unclassified", false],
  ] as const)("%s is %s", (standing, expected) => {
    expect(isMemberStanding(standing)).toBe(expected);
  });

  it("null and undefined are not member standing (a missing standing never connects anyone)", () => {
    expect(isMemberStanding(null)).toBe(false);
    expect(isMemberStanding(undefined)).toBe(false);
  });

  it("isMemberStandingFor composes the two", () => {
    expect(isMemberStandingFor("active", "inactive")).toBe(true);
    expect(isMemberStandingFor(null, "staff")).toBe(true);
    expect(isMemberStandingFor(null, "visitor")).toBe(false);
    expect(isMemberStandingFor(null, "moved_away")).toBe(false);
    expect(isMemberStandingFor(null, null)).toBe(false);
  });
});

describe("isListedRoll", () => {
  it("accepts the four listed rolls and nothing else", () => {
    for (const roll of LISTED_ROLLS) expect(isListedRoll(roll)).toBe(true);
    for (const roll of [null, undefined, "", "removed", "zzz", "ACTIVE"]) {
      expect(isListedRoll(roll)).toBe(false);
    }
  });
});

describe("engagement vocabulary guards", () => {
  it("an administrator may set four values and never staff", () => {
    expect([...EDITABLE_ENGAGEMENTS]).toEqual(["visitor", "regular", "inactive", "moved_away"]);
    expect(isEditableEngagement("staff")).toBe(false);
    expect(isEditableEngagement("regular")).toBe(true);
    expect(isEditableEngagement(undefined)).toBe(false);
    expect(isEditableEngagement(1)).toBe(false);
  });

  it("isEngagement admits the five stored values only", () => {
    for (const value of ENGAGEMENT_STATUSES) expect(isEngagement(value)).toBe(true);
    expect(isEngagement("unknown")).toBe(false);
    expect(isEngagement(null)).toBe(false);
  });

  it("offeredEngagements never offers Visitor to a person with a roll", () => {
    expect(offeredEngagements(false)).toEqual(["visitor", "regular", "inactive", "moved_away"]);
    expect(offeredEngagements(true)).toEqual(["regular", "inactive", "moved_away"]);
  });

  it("the how-heard bound is the one the creation path used (200)", () => {
    expect(MAX_HOW_HEARD).toBe(200);
  });
});
