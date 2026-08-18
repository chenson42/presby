import { describe, it, expect } from "vitest";
import { organizationTypeLabel } from "./org-display";

describe("organizationTypeLabel", () => {
  it("labels every organization type in the enum", () => {
    expect(organizationTypeLabel("general_assembly")).toBe("General Assembly");
    expect(organizationTypeLabel("synod")).toBe("Synod");
    expect(organizationTypeLabel("presbytery")).toBe("Presbytery");
    expect(organizationTypeLabel("congregation")).toBe("Congregation");
    expect(organizationTypeLabel("new_worshiping_community")).toBe(
      "New Worshiping Community",
    );
  });

  it("carries no membership or roll language (DECISION-039)", () => {
    // A card is a RELATIONSHIP, not a roll status: the secretary who worships
    // elsewhere and the elder on a presbytery committee both get one, and
    // "member of" is wrong for both. The label vocabulary is the place that
    // would most easily reintroduce it.
    const forbidden = /member|active|baptized|affiliate|roll/i;
    for (const type of [
      "general_assembly",
      "synod",
      "presbytery",
      "congregation",
      "new_worshiping_community",
    ] as const) {
      expect(organizationTypeLabel(type)).not.toMatch(forbidden);
    }
  });

  it("falls back to the raw value for an unknown type rather than blanking", () => {
    // A type added to the pgEnum before this table is updated should read
    // slightly wrong on a card, not render an empty badge.
    expect(organizationTypeLabel("mid_council")).toBe("mid_council");
  });
});
