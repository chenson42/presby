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
  it("accepts the six views and turns anything else into 'all'", () => {
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

  it("then visitor, staff, and listed", () => {
    expect(deriveConnection({ ...base, engagementStatus: "visitor" })).toBe("visitor");
    expect(deriveConnection({ ...base, engagementStatus: "staff" })).toBe("staff");
    expect(deriveConnection({ ...base, engagementStatus: "regular" })).toBe("listed");
    expect(deriveConnection({ ...base, engagementStatus: "anything-else" })).toBe("listed");
  });
});

describe("labels and sentences", () => {
  const all: Connection[] = ["visitor", "participant", "member", "staff", "listed", "former_participant", "ended"];

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
});
