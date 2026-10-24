/**
 * The pure invitation copy module (docs/work-log/2026-10-24-invite-accept-copy.md).
 * No database. Every row of the Phase 3 copy table is pinned as a literal here on
 * purpose: the component tests import the builders, so THIS file is where a
 * deliberate wording change is made (and noticed).
 */
import { describe, expect, it } from "vitest";
import {
  INVITATION_ROLE_WORD,
  INVITATION_WARNING_COPY,
  acceptanceSentence,
  deriveInviteeDisplayName,
  expiredInvitationLine,
  inviteeReference,
  openInvitationLine,
} from "./invitation-copy";

describe("acceptanceSentence - the copy table", () => {
  it("founding administrator, name known", () => {
    expect(acceptanceSentence({ purpose: "founding_administrator", name: "Marisol Quenby", address: "a@example.invalid" })).toBe(
      "The founding administrator designation takes effect when Marisol Quenby accepts it from the email. Until then nobody holds this role.",
    );
  });
  it("treasurer, name known", () => {
    expect(acceptanceSentence({ purpose: "treasurer", name: "Perpetua", address: "a@example.invalid" })).toBe(
      "The treasurer designation takes effect when Perpetua accepts it from the email. Until then nobody holds this access.",
    );
  });
  it("no name, address known", () => {
    expect(acceptanceSentence({ purpose: "treasurer", name: null, address: "a@example.invalid" })).toBe(
      "The treasurer designation takes effect when the person at a@example.invalid accepts it from the email. Until then nobody holds this access.",
    );
    expect(acceptanceSentence({ purpose: "founding_administrator", address: "a@example.invalid" })).toContain(
      "when the person at a@example.invalid accepts it from the email. Until then nobody holds this role.",
    );
  });
  it("no name, no address", () => {
    expect(acceptanceSentence({ purpose: "founding_administrator" })).toBe(
      "The founding administrator designation takes effect when the invitee accepts it from the email. Until then nobody holds this role.",
    );
    expect(acceptanceSentence({ purpose: "treasurer", name: "  ", address: " " })).toContain("when the invitee accepts it");
  });
  it("makes no claim about delivery (only 'from the email')", () => {
    expect(acceptanceSentence({ purpose: "treasurer", name: "Perpetua" })).not.toMatch(/inbox|delivered|received|opened/i);
  });
});

describe("inviteeReference", () => {
  it("falls back name, then the person at the address, then the invitee", () => {
    expect(inviteeReference("Marisol")).toBe("Marisol");
    expect(inviteeReference(null, "a@example.invalid")).toBe("the person at a@example.invalid");
    expect(inviteeReference(undefined, null)).toBe("the invitee");
  });
});

describe("open and expired section lines", () => {
  it("open, named", () => {
    expect(openInvitationLine("founding_administrator", "Marisol Quenby")).toBe(
      "An invitation is open for Marisol Quenby. Nobody holds this role until Marisol Quenby accepts it. Resend it if the email went astray, or revoke it to invite someone else.",
    );
    expect(openInvitationLine("treasurer", "Perpetua")).toBe(
      "An invitation is open for Perpetua. Nobody holds this access until Perpetua accepts it. Resend it if the email went astray, or revoke it to invite someone else.",
    );
  });
  it("open, no name: today's text unchanged", () => {
    expect(openInvitationLine("founding_administrator", null)).toBe(
      "An invitation is open. Nobody holds this role until it is accepted. Resend it if the email went astray, or revoke it to invite someone else.",
    );
    expect(openInvitationLine("treasurer", "")).toBe(
      "An invitation is open. Nobody holds this access until it is accepted. Resend it if the email went astray, or revoke it to invite someone else.",
    );
  });
  it("expired, named: says expired, not open", () => {
    expect(expiredInvitationLine("founding_administrator", "Marisol Quenby")).toBe(
      "The invitation for Marisol Quenby has expired. Nobody holds this role. Resend it or revoke it to invite someone else.",
    );
    expect(expiredInvitationLine("treasurer", "Perpetua")).toBe(
      "The invitation for Perpetua has expired. Nobody holds this access. Resend it or revoke it to invite someone else.",
    );
  });
  it("expired, no name: falls back to the current text", () => {
    expect(expiredInvitationLine("treasurer", null)).toBe(openInvitationLine("treasurer", null));
  });
});

describe("deriveInviteeDisplayName", () => {
  it("founding administrator: the typed first and last name", () => {
    expect(
      deriveInviteeDisplayName({ purpose: "founding_administrator", firstName: "Marisol", lastName: "Quenby", rosterFirstName: "Ignored" }),
    ).toBe("Marisol Quenby");
  });
  it("founding administrator: a missing part is skipped, nothing at all is null", () => {
    expect(deriveInviteeDisplayName({ purpose: "founding_administrator", firstName: "Marisol", lastName: null, rosterFirstName: null })).toBe("Marisol");
    expect(deriveInviteeDisplayName({ purpose: "founding_administrator", firstName: null, lastName: null, rosterFirstName: null })).toBeNull();
  });
  it("treasurer: the roster person's FIRST NAME ONLY, never a typed or stored last name", () => {
    expect(
      deriveInviteeDisplayName({ purpose: "treasurer", firstName: "Typed", lastName: "Surname", rosterFirstName: "Perpetua" }),
    ).toBe("Perpetua");
    expect(deriveInviteeDisplayName({ purpose: "treasurer", firstName: null, lastName: null, rosterFirstName: "  " })).toBeNull();
    expect(deriveInviteeDisplayName({ purpose: "treasurer", firstName: "Typed", lastName: "Surname", rosterFirstName: null })).toBeNull();
  });
});

describe("module shape", () => {
  it("has a role word per purpose and a warning sentence that says nothing about accounts elsewhere", () => {
    expect(INVITATION_ROLE_WORD).toEqual({ founding_administrator: "role", treasurer: "access" });
    expect(INVITATION_WARNING_COPY.address_on_signed_in_person).toMatch(/refused unless the invitee accepts while signed in/);
  });
});
