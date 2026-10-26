import { describe, expect, it } from "vitest";
import { assertGivingSession, givingTotpRedirectUrl } from "@/lib/giving/access-pure";
import { assertTreasurySession, treasuryTotpRedirectUrl } from "./session";
import { TREASURY_MODULES } from "./modules";

describe("assertTreasurySession (the Node-side 2FA check, P3-3)", () => {
  it("is unauthenticated with no session, no user, or no user id", () => {
    expect(assertTreasurySession(null)).toEqual({ kind: "unauthenticated" });
    expect(assertTreasurySession(undefined)).toEqual({ kind: "unauthenticated" });
    expect(assertTreasurySession({})).toEqual({ kind: "unauthenticated" });
    expect(assertTreasurySession({ user: null })).toEqual({ kind: "unauthenticated" });
    expect(assertTreasurySession({ user: { id: "" } })).toEqual({ kind: "unauthenticated" });
  });

  it("refuses 2FA-required-and-unverified: the stale-Edge-claim case a just-granted treasurer would otherwise slip through", () => {
    expect(assertTreasurySession({ user: { id: "u1", twoFactorRequired: true, twoFactorVerified: false } })).toEqual({
      kind: "two_factor_required",
    });
  });

  it("fails closed on the verified half: required with a MISSING or null verified claim is refused", () => {
    expect(assertTreasurySession({ user: { id: "u1", twoFactorRequired: true } })).toEqual({ kind: "two_factor_required" });
    expect(assertTreasurySession({ user: { id: "u1", twoFactorRequired: true, twoFactorVerified: null } })).toEqual({
      kind: "two_factor_required",
    });
  });

  it("is a no-op for a requester or approver whose claim does not require 2FA", () => {
    expect(assertTreasurySession({ user: { id: "u1" } })).toEqual({ kind: "ok", userId: "u1" });
    expect(assertTreasurySession({ user: { id: "u1", twoFactorRequired: false } })).toEqual({ kind: "ok", userId: "u1" });
    expect(assertTreasurySession({ user: { id: "u1", twoFactorRequired: true, twoFactorVerified: true } })).toEqual({
      kind: "ok",
      userId: "u1",
    });
  });
});

describe("treasuryTotpRedirectUrl", () => {
  it("returns /totp with the sanitized callback", () => {
    expect(treasuryTotpRedirectUrl("/o/alder/admin/reimbursements/abc")).toBe(
      "/totp?callbackUrl=%2Fo%2Falder%2Fadmin%2Freimbursements%2Fabc",
    );
  });

  it("sends an off-origin callback to /launch (the open-redirect sanitizer applies)", () => {
    expect(treasuryTotpRedirectUrl("https://evil.example/x")).toBe("/totp?callbackUrl=%2Flaunch");
  });
});

describe("the giving names are aliases of the shared functions (so every giving import and test is unchanged)", () => {
  it("are the same function objects", () => {
    expect(assertGivingSession).toBe(assertTreasurySession);
    expect(givingTotpRedirectUrl).toBe(treasuryTotpRedirectUrl);
  });
});

describe("TREASURY_MODULES", () => {
  it("is exactly the two money modules (adding one is a security decision: it needs F301 downward guards, pinned by team.db.test.ts)", () => {
    expect([...TREASURY_MODULES]).toEqual(["giving", "reimbursement"]);
  });
});
