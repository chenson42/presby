/**
 * `deriveNoOrganizationView` over every combination (amendment 2 section 7.6,
 * E-21): the pure decision behind `/no-organization`, so the table is a unit
 * test and not something only a browser can check.
 */
import { describe, expect, it } from "vitest";
import {
  ENROLL_HREF,
  VERIFY_HREF,
  deriveNoOrganizationView,
  secondFactorHref,
  secondFactorNeededFor,
  type InvitationInput,
  type NoOrganizationFacts,
} from "./view";

const EXPIRES = new Date("2026-11-01T00:00:00Z");

function inv(id: string, purpose: InvitationInput["purpose"] = "sign_in"): InvitationInput {
  return {
    invitationId: id,
    organizationName: `Congregation ${id}`,
    purpose,
    expiresAt: EXPIRES,
    personDisplayName: purpose === "sign_in" ? "Nora Ashgrove" : null,
  };
}

function facts(over: Partial<NoOrganizationFacts> = {}): NoOrganizationFacts {
  return {
    enterable: 0,
    pending: 0,
    notTenants: 0,
    ended: 0,
    invitations: [],
    invitationsFailed: false,
    session: { twoFactorRequired: false, twoFactorVerified: false },
    enrolled: false,
    ...over,
  };
}

describe("deriveNoOrganizationView", () => {
  it("already have access wins over everything and reads no listing", () => {
    const v = deriveNoOrganizationView(
      facts({ enterable: 2, pending: 1, invitations: [inv("a")], invitationsFailed: true }),
    );
    expect(v).toEqual({ kind: "already_have_access", count: 2 });
  });

  it("nothing at all is N0, with Check again's enrolment variant", () => {
    expect(deriveNoOrganizationView(facts())).toEqual({ kind: "default", listFailed: false, enrolled: false });
    expect(deriveNoOrganizationView(facts({ enrolled: true }))).toEqual({
      kind: "default",
      listFailed: false,
      enrolled: true,
    });
  });

  it("an open invitation makes the page the invitations (default heading and Check again are hidden)", () => {
    const v = deriveNoOrganizationView(facts({ invitations: [inv("a"), inv("b")] }));
    expect(v.kind).toBe("invited");
    if (v.kind !== "invited") throw new Error("unreachable");
    expect(v.cards.map((c) => c.invitationId)).toEqual(["a", "b"]);
  });

  it.each([
    ["pending", { pending: 1, notTenants: 1, ended: 1 }],
    ["not_tenants", { pending: 0, notTenants: 1, ended: 1 }],
    ["ended", { pending: 0, notTenants: 0, ended: 1 }],
  ] as const)("the standing block precedence is pending > not_tenants > ended (%s)", (block, counts) => {
    const v = deriveNoOrganizationView(facts(counts));
    expect(v).toMatchObject({ kind: "standing", block, cards: [], listFailed: false });
  });

  it("invitations render below a standing block, not instead of it", () => {
    const v = deriveNoOrganizationView(facts({ ended: 1, invitations: [inv("a")] }));
    expect(v).toMatchObject({ kind: "standing", block: "ended" });
    if (v.kind !== "standing") throw new Error("unreachable");
    expect(v.cards).toHaveLength(1);
  });

  describe("N5, the listing failed", () => {
    it("on N0 it is a line above the default view, which still renders (a failure is 'we don't know', not 'nothing')", () => {
      expect(deriveNoOrganizationView(facts({ invitationsFailed: true }))).toEqual({
        kind: "default",
        listFailed: true,
        enrolled: false,
      });
    });

    it("on a standing block it rides along and the block keeps its precedence", () => {
      expect(deriveNoOrganizationView(facts({ pending: 1, invitationsFailed: true }))).toMatchObject({
        kind: "standing",
        block: "pending",
        listFailed: true,
        cards: [],
      });
    });

    it("never shows cards it did not get", () => {
      const v = deriveNoOrganizationView(facts({ invitations: [inv("a")], invitationsFailed: true }));
      expect(v.kind).toBe("default");
    });
  });

  describe("each card's second-factor flag (G9 parity)", () => {
    const cases: Array<[InvitationInput["purpose"], boolean, boolean, boolean]> = [
      // purpose, twoFactorRequired, twoFactorVerified, expected
      ["founding_administrator", false, false, true],
      ["founding_administrator", false, true, false],
      ["treasurer", false, false, true],
      ["treasurer", true, true, false],
      ["sign_in", false, false, false],
      ["sign_in", true, false, true],
      ["sign_in", true, true, false],
      ["sign_in", false, true, false],
    ];
    it.each(cases)("%s required=%s verified=%s -> %s", (purpose, twoFactorRequired, twoFactorVerified, expected) => {
      expect(secondFactorNeededFor(purpose, { twoFactorRequired, twoFactorVerified })).toBe(expected);
      const v = deriveNoOrganizationView(
        facts({ invitations: [inv("a", purpose)], session: { twoFactorRequired, twoFactorVerified } }),
      );
      if (v.kind !== "invited") throw new Error("unreachable");
      expect(v.cards[0].secondFactorNeeded).toBe(expected);
    });
  });

  it("the enrolment variant rides on whichever view renders", () => {
    expect(deriveNoOrganizationView(facts({ enrolled: true, invitations: [inv("a")] }))).toMatchObject({ enrolled: true });
    expect(deriveNoOrganizationView(facts({ enrolled: true, ended: 1 }))).toMatchObject({ enrolled: true });
  });
});

describe("the second-factor links", () => {
  it("enrolled goes to the challenge, not enrolled to enrolment, both returning here", () => {
    expect(secondFactorHref(true)).toBe(VERIFY_HREF);
    expect(secondFactorHref(false)).toBe(ENROLL_HREF);
    expect(VERIFY_HREF).toBe("/totp?callbackUrl=%2Fno-organization");
    expect(ENROLL_HREF).toBe("/account/2fa?callbackUrl=%2Fno-organization");
  });
});
