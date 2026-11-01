import { describe, expect, it } from "vitest";
import { derivedGroupManagedFromText, grantFormGroupLabel } from "./derived-group-labels";

describe("derivedGroupManagedFromText (Group H)", () => {
  it("names who the two baseline groups hold", () => {
    expect(derivedGroupManagedFromText("active_membership")).toBe("Members, regular attenders and staff");
    expect(derivedGroupManagedFromText("all_memberships")).toBe("Everyone with a current record here");
  });

  it("is null for the officer-driven groups, which link to the officers page", () => {
    for (const kind of ["session", "diaconate", "deacons_moderator"] as const) {
      expect(derivedGroupManagedFromText(kind)).toBeNull();
    }
  });
});

describe("grantFormGroupLabel (S15)", () => {
  it("a managed group is its bare name", () => {
    expect(grantFormGroupLabel({ name: "Altar Guild", derived: false, derivedFrom: null })).toBe("Altar Guild");
  });

  it("a derived group says (derived)", () => {
    for (const derivedFrom of ["session", "diaconate", "deacons_moderator", "active_membership"] as const) {
      expect(grantFormGroupLabel({ name: "X", derived: true, derivedFrom })).toBe("X (derived)");
    }
    // A caller that predates the field still gets the old text.
    expect(grantFormGroupLabel({ name: "Session", derived: true })).toBe("Session (derived)");
  });

  it("All Current Records says it includes visitors and inactive people, so a role bound to it is understood to reach them", () => {
    expect(grantFormGroupLabel({ name: "All Current Records", derived: true, derivedFrom: "all_memberships" })).toBe(
      "All Current Records (derived; includes visitors and inactive people)",
    );
  });

  it("keys the sentence on the kind, never on the name", () => {
    expect(grantFormGroupLabel({ name: "Renamed", derived: true, derivedFrom: "all_memberships" })).toContain("includes visitors");
    expect(grantFormGroupLabel({ name: "All Current Records", derived: true, derivedFrom: "active_membership" })).not.toContain("visitors");
    expect(grantFormGroupLabel({ name: "All Current Records", derived: false, derivedFrom: null })).toBe("All Current Records");
  });
});
