import { describe, expect, it } from "vitest";
import { assertOrgSession, orgTotpRedirectUrl } from "./session-check";
import { assertTreasurySession, treasuryTotpRedirectUrl } from "@/lib/treasury/session";

describe("assertOrgSession (the Node-side 2FA check, DECISION-338)", () => {
  it("is unauthenticated with no session, no user, or no user id", () => {
    expect(assertOrgSession(null)).toEqual({ kind: "unauthenticated" });
    expect(assertOrgSession(undefined)).toEqual({ kind: "unauthenticated" });
    expect(assertOrgSession({})).toEqual({ kind: "unauthenticated" });
    expect(assertOrgSession({ user: null })).toEqual({ kind: "unauthenticated" });
    expect(assertOrgSession({ user: { id: "" } })).toEqual({ kind: "unauthenticated" });
  });

  it("refuses 2FA-required-and-unverified (the stale-Edge-claim case)", () => {
    expect(assertOrgSession({ user: { id: "u1", twoFactorRequired: true, twoFactorVerified: false } })).toEqual({
      kind: "two_factor_required",
    });
  });

  it("fails closed on the verified half: required with a MISSING or null verified claim is refused", () => {
    expect(assertOrgSession({ user: { id: "u1", twoFactorRequired: true } })).toEqual({ kind: "two_factor_required" });
    expect(assertOrgSession({ user: { id: "u1", twoFactorRequired: true, twoFactorVerified: null } })).toEqual({
      kind: "two_factor_required",
    });
  });

  it("is a no-op for a user whose claim does not require 2FA", () => {
    expect(assertOrgSession({ user: { id: "u1" } })).toEqual({ kind: "ok", userId: "u1" });
    expect(assertOrgSession({ user: { id: "u1", twoFactorRequired: false } })).toEqual({ kind: "ok", userId: "u1" });
    expect(assertOrgSession({ user: { id: "u1", twoFactorRequired: true, twoFactorVerified: true } })).toEqual({
      kind: "ok",
      userId: "u1",
    });
  });
});

describe("orgTotpRedirectUrl", () => {
  it("returns /totp with the sanitized callback, keeping the query", () => {
    expect(orgTotpRedirectUrl("/o/alder/admin/reports/per-capita/export?billingYear=2025")).toBe(
      "/totp?callbackUrl=%2Fo%2Falder%2Fadmin%2Freports%2Fper-capita%2Fexport%3FbillingYear%3D2025",
    );
  });

  it("sends an off-origin callback to /launch (the open-redirect sanitizer applies)", () => {
    expect(orgTotpRedirectUrl("https://evil.example/x")).toBe("/totp?callbackUrl=%2Flaunch");
  });
});

describe("the treasury names are aliases of the shared functions", () => {
  it("are the same function objects", () => {
    expect(assertTreasurySession).toBe(assertOrgSession);
    expect(treasuryTotpRedirectUrl).toBe(orgTotpRedirectUrl);
  });
});
