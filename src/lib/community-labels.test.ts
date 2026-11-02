import { describe, expect, it } from "vitest";
import {
  CONNECTION_LABELS,
  COMMUNITY_VIEWS,
  alreadyHereSentence,
  deriveConnection,
  parseCommunityView,
  type Connection,
} from "./community-labels";

const base = { endedOn: null, endedReason: null, currentRoll: null, engagementStatus: "regular" };

describe("parseCommunityView", () => {
  it("accepts the seven views and turns anything else into 'all'", () => {
    for (const view of COMMUNITY_VIEWS) {
      expect(parseCommunityView(view)).toBe(view);
    }
    expect(parseCommunityView(undefined)).toBe("all");
    expect(parseCommunityView("")).toBe("all");
    expect(parseCommunityView("admins")).toBe("all");
    expect(parseCommunityView("MEMBERS")).toBe("all");
    expect(parseCommunityView(["visitors", "staff"])).toBe("visitors");
    expect(parseCommunityView("members; drop table")).toBe("all");
  });

  it("lists the seven views in nav order, Inactive between Visitors and Staff", () => {
    expect([...COMMUNITY_VIEWS]).toEqual([
      "all",
      "members",
      "participants",
      "visitors",
      "inactive",
      "staff",
      "former",
    ]);
    expect(parseCommunityView("inactive")).toBe("inactive");
  });
});

describe("deriveConnection precedence", () => {
  it("ended wins over everything; the removal marker makes it a former participant", () => {
    expect(
      deriveConnection({ ...base, endedOn: "2026-01-01", endedReason: "other_participant_removed", currentRoll: "active" }),
    ).toBe("former_participant");
    expect(
      deriveConnection({ ...base, endedOn: "2026-01-01", endedReason: "moved away", engagementStatus: "visitor" }),
    ).toBe("ended");
    expect(deriveConnection({ ...base, endedOn: "2026-01-01" })).toBe("ended");
  });

  it("a member roll beats a participant roll, engagement, and staff", () => {
    for (const roll of ["active", "baptized", "affiliate"]) {
      expect(deriveConnection({ ...base, currentRoll: roll, engagementStatus: "visitor" })).toBe("member");
      expect(deriveConnection({ ...base, currentRoll: roll, engagementStatus: "staff" })).toBe("member");
    }
  });

  it("the participant roll beats engagement visitor (the roll functions never write the pastoral axis)", () => {
    expect(deriveConnection({ ...base, currentRoll: "other_participant", engagementStatus: "visitor" })).toBe("participant");
  });

  it("then standing: visitor, staff, listed, inactive, moved away", () => {
    expect(deriveConnection({ ...base, engagementStatus: "visitor" })).toBe("visitor");
    expect(deriveConnection({ ...base, engagementStatus: "staff" })).toBe("staff");
    expect(deriveConnection({ ...base, engagementStatus: "regular" })).toBe("listed");
    expect(deriveConnection({ ...base, engagementStatus: "inactive" })).toBe("inactive");
    expect(deriveConnection({ ...base, engagementStatus: "moved_away" })).toBe("moved_away");
  });

  it("an unrecognised engagement with no roll is 'unclassified', never 'listed' (fails closed, F242)", () => {
    expect(deriveConnection({ ...base, engagementStatus: "anything-else" })).toBe("unclassified");
  });

  it("an inactive or moved-away person who is on the roll keeps the roll's connection (G3: Members or Participants, not Inactive)", () => {
    expect(deriveConnection({ ...base, currentRoll: "active", engagementStatus: "inactive" })).toBe("member");
    expect(deriveConnection({ ...base, currentRoll: "baptized", engagementStatus: "moved_away" })).toBe("member");
    expect(deriveConnection({ ...base, currentRoll: "other_participant", engagementStatus: "inactive" })).toBe("participant");
  });

  it("an unlisted roll counts as no roll: a visitor stays a visitor, a regular attender is listed", () => {
    expect(deriveConnection({ ...base, currentRoll: "zzz", engagementStatus: "visitor" })).toBe("visitor");
    expect(deriveConnection({ ...base, currentRoll: "zzz", engagementStatus: "regular" })).toBe("listed");
  });

  it("'listed' is returned only for standing listed with no member or participant roll (G3)", () => {
    expect(deriveConnection({ ...base, engagementStatus: "inactive" })).not.toBe("listed");
    expect(deriveConnection({ ...base, engagementStatus: "moved_away" })).not.toBe("listed");
    expect(deriveConnection({ ...base, currentRoll: "active" })).not.toBe("listed");
  });

  it("the archive marker: an archived visitor when the kept engagement is visitor, archived otherwise", () => {
    const ended = { ...base, endedOn: "2026-02-03", endedReason: "community_archived" };
    expect(deriveConnection({ ...ended, engagementStatus: "visitor" })).toBe("former_visitor");
    expect(deriveConnection({ ...ended, engagementStatus: "inactive" })).toBe("archived");
    expect(deriveConnection({ ...ended, engagementStatus: "moved_away" })).toBe("archived");
    expect(deriveConnection({ ...ended, engagementStatus: "regular" })).toBe("archived");
  });

  it("the markers are a closed pair: a lookalike reason is plain 'ended'", () => {
    for (const reason of ["community_archived_by_mistake", "Community_Archived", "other_participant_removed2", "", null]) {
      expect(deriveConnection({ ...base, endedOn: "2026-02-03", endedReason: reason, engagementStatus: "visitor" })).toBe("ended");
    }
  });
});

/**
 * The R51 matrix, connection column. The rows are the same fixtures the DB
 * matrix (`membership-standing.db.test.ts`, M1 to M16) builds; the expected
 * connection is written by hand from the Phase 3 design, section 6.2.
 */
describe("deriveConnection over the R51 matrix rows", () => {
  const live = { endedOn: null, endedReason: null };
  const rows: Array<[string, string | null, string, Connection]> = [
    ["M1 active / regular", "active", "regular", "member"],
    ["M2 active / visitor (enrolled visitor)", "active", "visitor", "member"],
    ["M3 active / inactive", "active", "inactive", "member"],
    ["M4 other_participant / regular", "other_participant", "regular", "participant"],
    ["M5 other_participant / visitor", "other_participant", "visitor", "participant"],
    ["M6 null / regular", null, "regular", "listed"],
    ["M7 null / staff", null, "staff", "staff"],
    ["M8 null / visitor", null, "visitor", "visitor"],
    ["M9 null / inactive", null, "inactive", "inactive"],
    ["M10 null / moved_away", null, "moved_away", "moved_away"],
    ["M11 unlisted roll / visitor", "zzz", "visitor", "visitor"],
    ["M12 unlisted roll / regular", "zzz", "regular", "listed"],
  ];
  it.each(rows)("%s", (_name, roll, engagement, expected) => {
    expect(deriveConnection({ ...live, currentRoll: roll, engagementStatus: engagement })).toBe(expected);
  });

  it("M13 ended with a generic reason, M14 ended with the archive marker", () => {
    expect(deriveConnection({ endedOn: "2026-01-01", endedReason: "moved", currentRoll: "active", engagementStatus: "regular" })).toBe("ended");
    expect(deriveConnection({ endedOn: "2026-01-01", endedReason: "community_archived", currentRoll: null, engagementStatus: "visitor" })).toBe("former_visitor");
  });
});

describe("labels and sentences", () => {
  const all: Connection[] = [
    "visitor",
    "participant",
    "member",
    "staff",
    "listed",
    "inactive",
    "moved_away",
    "unclassified",
    "former_participant",
    "former_visitor",
    "archived",
    "ended",
  ];

  it("every connection has a label and a sentence", () => {
    for (const connection of all) {
      expect(CONNECTION_LABELS[connection].length).toBeGreaterThan(0);
      expect(alreadyHereSentence(connection, "2026-03-04").length).toBeGreaterThan(0);
    }
  });

  it("matches the Phase 3 copy", () => {
    expect(alreadyHereSentence("visitor", null)).toBe("They're a visitor.");
    expect(alreadyHereSentence("participant", null)).toBe("They're a participant.");
    expect(alreadyHereSentence("member", null)).toBe("They're a member.");
    expect(alreadyHereSentence("staff", null)).toBe("They're on staff.");
    expect(alreadyHereSentence("listed", null)).toBe("They're listed here.");
    expect(alreadyHereSentence("former_participant", null)).toBe("They're a former participant.");
    expect(alreadyHereSentence("ended", "2026-03-04")).toBe("Their connection ended on 2026-03-04.");
  });

  it("matches the Group E copy for the five new connections", () => {
    expect(CONNECTION_LABELS.inactive).toBe("Inactive");
    expect(CONNECTION_LABELS.moved_away).toBe("Moved away");
    expect(CONNECTION_LABELS.former_visitor).toBe("Archived visitor");
    expect(CONNECTION_LABELS.archived).toBe("Archived");
    expect(CONNECTION_LABELS.unclassified).toBe("On record");
    expect(alreadyHereSentence("inactive", null)).toBe("They're marked inactive.");
    expect(alreadyHereSentence("moved_away", null)).toBe("They're marked as moved away.");
    expect(alreadyHereSentence("former_visitor", "2026-03-04")).toBe("They were archived on 2026-03-04.");
    expect(alreadyHereSentence("former_visitor", null)).toBe("They were archived.");
    expect(alreadyHereSentence("archived", "2026-03-04")).toBe("They were archived on 2026-03-04.");
    expect(alreadyHereSentence("unclassified", null)).toBe("They're already here.");
  });

  it("an inactive person is never described as listed (F242)", () => {
    expect(alreadyHereSentence("inactive", null)).not.toMatch(/listed/i);
    expect(alreadyHereSentence("moved_away", null)).not.toMatch(/listed/i);
  });
});
