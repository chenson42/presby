/**
 * `/no-organization`'s words (Community Increment 2b, Batch B2; amendment 2
 * section 10, groups A, B and C). Exact text, transcribed from the operator's
 * Copy. The product's word is "two-factor sign-in", never the analyst's
 * "two-step".
 */
import { describe, expect, it } from "vitest";
import { INVITATION_DEAD_IN_PLACE_COPY, INVITATION_DEAD_LINK_COPY } from "./labels";
import { NO_ORG_COPY, NO_ORG_INVITATION_COPY, NO_ORG_SECOND_FACTOR_COPY } from "./no-organization-copy";

describe("group A: nothing connected, no open invitation (N0)", () => {
  it("the heading, bodies, doors and buttons", () => {
    expect(NO_ORG_COPY.heading).toBe("You're not connected to a congregation yet");
    expect(NO_ORG_COPY.body("w@example.invalid")).toBe(
      "You're signed in as w@example.invalid. This sign-in isn't connected to a congregation's records yet.",
    );
    expect(NO_ORG_COPY.bodyNoAddress).toBe("You're signed in. This sign-in isn't connected to a congregation's records yet.");
    expect(NO_ORG_COPY.secondLine).toBe(
      "A congregation can connect you by the email address on your record. If yours has added you, it needs the exact address you signed in with.",
    );
    expect(NO_ORG_COPY.officeHeading).toBe("Ask the office that keeps your records");
    expect(NO_ORG_COPY.officeBody("w@example.invalid")).toBe(
      "Ask them to check that w@example.invalid is on your record, or to invite you. Then check again.",
    );
    expect(NO_ORG_COPY.invitationLine).toBe(
      "If you were invited, the invitation should appear here once it was sent to this address. You can also open the link in your invitation email. If it was sent to a different address, or has expired, ask the person who invited you to send it again.",
    );
    expect(NO_ORG_COPY.buttons).toEqual({ checkAgain: "Check again", switchAccount: "Sign in with a different account" });
    expect(NO_ORG_COPY.nothingNew).toBe("Nothing new yet.");
    expect(NO_ORG_COPY.listingFailed).toBe("We couldn't check for invitations just now. Reload the page.");
  });

  it("the stale lines are gone: 'Only an invitation link does' (false once auto-connect exists) and 'ask your church administrator'", () => {
    const all = JSON.stringify(NO_ORG_COPY);
    expect(all).not.toMatch(/Only an invitation link does/i);
    expect(all).not.toMatch(/church administrator/i);
    expect(all).not.toMatch(/doesn't connect you to a congregation by itself/i);
  });

  it("the hedge stays: a congregation CAN connect you, nothing promises it", () => {
    expect(NO_ORG_COPY.secondLine).toMatch(/\bcan connect you\b/);
  });
});

describe("group B: the connect line and the second-factor notice", () => {
  it("enrolled and not enrolled", () => {
    expect(NO_ORG_SECOND_FACTOR_COPY.enrolled).toEqual({
      body: "One more step: confirm two-factor sign-in to finish connecting. Then come back here and select Check again.",
      button: "Continue to verification",
    });
    expect(NO_ORG_SECOND_FACTOR_COPY.notEnrolled).toEqual({
      body: "One more step: set up two-factor sign-in to finish connecting. Then come back here and select Check again.",
      button: "Set up two-factor sign-in",
    });
  });

  it("says nothing about two-factor sign-in preventing misuse of a typed address (R42's honest framing)", () => {
    expect(JSON.stringify(NO_ORG_SECOND_FACTOR_COPY)).not.toMatch(/prevent|protect|safe|secure|misuse/i);
  });
});

describe("group C: open invitations and accepting in place", () => {
  it("headings, cards, expiry, button", () => {
    const c = NO_ORG_INVITATION_COPY;
    expect(c.headingOne("Quillhaven Fellowship")).toBe("You're invited to Quillhaven Fellowship");
    expect(c.headingMany(3)).toBe("You have 3 invitations");
    expect(c.cardSignIn("Quillhaven Fellowship", "Wendeline Ashgrove")).toBe(
      "Quillhaven Fellowship invited you to sign in. Accepting connects this sign-in to your record there as Wendeline Ashgrove. What you can do depends on your role at Quillhaven Fellowship.",
    );
    expect(c.cardDesignation("Quillhaven Fellowship", "founding_administrator")).toBe(
      "Quillhaven Fellowship invited you to be its founding administrator. Accepting gives you that role.",
    );
    expect(c.cardDesignation("Quillhaven Fellowship", "treasurer")).toBe(
      "Quillhaven Fellowship invited you to be its treasurer. Accepting gives you that access.",
    );
    expect(c.expires("October 27, 2026")).toBe("This invitation expires October 27, 2026.");
    expect(c.accept).toBe("Accept the invitation");
  });

  it("the second-factor lines", () => {
    expect(NO_ORG_INVITATION_COPY.secondFactor.enrolled).toEqual({
      body: "Accepting this invitation needs two-factor sign-in. Finish verification, then accept.",
      button: "Continue to verification",
    });
    expect(NO_ORG_INVITATION_COPY.secondFactor.notEnrolled).toEqual({
      body: "Accepting this invitation needs two-factor sign-in. Set up two-factor sign-in, then accept.",
      button: "Set up two-factor sign-in",
    });
  });

  it("dead, database error, rate limited, signed out", () => {
    expect(NO_ORG_INVITATION_COPY.dead).toBe(
      "This invitation is no longer active. Reload the page to see what is current, or ask whoever invited you to send a new one.",
    );
    expect(NO_ORG_INVITATION_COPY.dbError).toBe("Your invitation is still good. Try again.");
    expect(NO_ORG_INVITATION_COPY.rateLimited(5)).toBe("Too many attempts. Try again in 5 minutes.");
    expect(NO_ORG_INVITATION_COPY.rateLimited(1)).toBe("Too many attempts. Try again in 1 minute.");
    expect(NO_ORG_INVITATION_COPY.signedOut).toBe("Sign in to accept this invitation.");
  });

  it("the in-place dead sentence is its own constant: the link page's wording is untouched and neither drifts into the other's noun", () => {
    expect(NO_ORG_INVITATION_COPY.dead).toBe(INVITATION_DEAD_IN_PLACE_COPY);
    expect(INVITATION_DEAD_IN_PLACE_COPY).not.toBe(INVITATION_DEAD_LINK_COPY);
    expect(INVITATION_DEAD_LINK_COPY).toBe(
      "This link is no longer active. If you already accepted it, you can sign in. Otherwise ask whoever invited you to send a new one.",
    );
    expect(INVITATION_DEAD_IN_PLACE_COPY).not.toMatch(/\blink\b/i);
  });
});
