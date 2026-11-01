/**
 * gate.ts - the three gates (page, action, route), with the session, the org
 * resolver and the context loader mocked. docs/work-log/2026-10-25-treasury-
 * inc1.md, Phase 3 gate order, P3-3 and EC25. The order is the property under
 * test: the Node-side 2FA check runs on EVERY surface and BEFORE anything reads
 * the organization, and a database blip is never an "off" or "not allowed".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  FakeOrgAccessError: class FakeOrgAccessError extends Error {},
  auth: vi.fn(),
  cachedAuth: vi.fn(),
  resolveOrgContext: vi.fn(),
  assertOrgAccess: vi.fn(),
  loadReimbursementContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: mocks.cachedAuth }));
vi.mock("@/lib/authz", () => ({
  OrgAccessError: mocks.FakeOrgAccessError,
  resolveOrgContext: mocks.resolveOrgContext,
  assertOrgAccess: mocks.assertOrgAccess,
}));
vi.mock("./access", () => ({ loadReimbursementContext: mocks.loadReimbursementContext }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));

import { gateReimbursementAction, gateReimbursementPage, gateReimbursementRoute } from "./gate";

const ORG = {
  organizationId: "org-1",
  personId: "person-1",
  name: "Alder Creek Church",
  organizationType: "congregation",
  slug: "alder",
  platformStatus: "managed",
};
const signedIn = { user: { id: "user-1", email: "pat@example.invalid" } };
const stale2fa = { user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: false } };
const NO_KEYS = { requestForOthers: false, view: false, pay: false, manage: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(signedIn);
  mocks.cachedAuth.mockResolvedValue(signedIn);
  mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: ORG });
  mocks.assertOrgAccess.mockResolvedValue(undefined);
  mocks.loadReimbursementContext.mockResolvedValue({ kind: "ok", has: NO_KEYS });
});

describe("gateReimbursementAction", () => {
  it("is open to any member on the member surface (no key named)", async () => {
    const gate = await gateReimbursementAction("alder");
    expect(gate).toMatchObject({ ok: true, userId: "user-1", personId: "person-1", organizationId: "org-1", slug: "alder" });
  });

  it("refuses a signed-out caller before reading anything", async () => {
    mocks.auth.mockResolvedValue(null);
    expect(await gateReimbursementAction("alder")).toEqual({ ok: false, error: "You must be signed in to do that." });
    expect(mocks.resolveOrgContext).not.toHaveBeenCalled();
  });

  it("2FA first (P3-3): a stale claim is refused on the MEMBER surface too, before the org is resolved, with the /totp redirect", async () => {
    mocks.auth.mockResolvedValue(stale2fa);
    const gate = await gateReimbursementAction("alder");
    expect(gate).toEqual({
      ok: false,
      kind: "two_factor_required",
      error: "Please confirm your two-factor code to continue.",
      redirectTo: "/totp?callbackUrl=%2Fo%2Falder%2Freimbursements",
    });
    expect(mocks.resolveOrgContext).not.toHaveBeenCalled();
    expect(mocks.loadReimbursementContext).not.toHaveBeenCalled();
  });

  it("returns a treasury caller to the admin tree after the challenge", async () => {
    mocks.auth.mockResolvedValue(stale2fa);
    const gate = await gateReimbursementAction("alder", { anyOf: ["view"] });
    expect(gate).toMatchObject({ redirectTo: "/totp?callbackUrl=%2Fo%2Falder%2Fadmin%2Freimbursements" });
  });

  it("a relationship that is missing, ended or forbidden is one message", async () => {
    for (const kind of ["not-found", "forbidden", "ended"]) {
      mocks.resolveOrgContext.mockResolvedValue({ kind, name: "X", endedOn: "2026-01-01", organizationType: "congregation" });
      expect(await gateReimbursementAction("alder")).toEqual({ ok: false, error: "You don't have access to that organization." });
    }
    expect(mocks.loadReimbursementContext).not.toHaveBeenCalled();
  });

  it("applicability and the toggle are honest states with their own Copy (the toggle names the organization)", async () => {
    mocks.loadReimbursementContext.mockResolvedValue({ kind: "not_applicable" });
    expect(await gateReimbursementAction("alder")).toEqual({
      ok: false,
      error: "Reimbursements aren't available for this kind of organization.",
    });
    mocks.loadReimbursementContext.mockResolvedValue({ kind: "toggle_off", canManageFeatures: true });
    expect(await gateReimbursementAction("alder")).toEqual({
      ok: false,
      error: "Reimbursements aren't turned on for Alder Creek Church.",
    });
  });

  it("a database failure reading the gate is its own message, never 'off' and never 'not allowed'", async () => {
    mocks.loadReimbursementContext.mockRejectedValue(new Error("connection reset"));
    expect(await gateReimbursementAction("alder")).toEqual({
      ok: false,
      error: "We couldn't check your access just now. Try again in a moment.",
    });
  });

  it("a membership that ended between resolve and the transaction is no-access", async () => {
    mocks.loadReimbursementContext.mockRejectedValue(new mocks.FakeOrgAccessError());
    expect(await gateReimbursementAction("alder")).toEqual({ ok: false, error: "You don't have access to that organization." });
  });

  it("when a key is named, holding ANY of them admits and holding none refuses", async () => {
    expect(await gateReimbursementAction("alder", { anyOf: ["view", "pay"] })).toEqual({ ok: false, error: "You don't have permission to do that." });
    mocks.loadReimbursementContext.mockResolvedValue({ kind: "ok", has: { ...NO_KEYS, pay: true } });
    expect(await gateReimbursementAction("alder", { anyOf: ["view", "pay"] })).toMatchObject({ ok: true, has: { pay: true } });
    // a key the caller does not hold is not implied by one they do
    expect(await gateReimbursementAction("alder", { anyOf: ["manage"] })).toMatchObject({ ok: false });
  });

  it("takes the slug, never an organization id: the organization comes from the caller's own resolved memberships", async () => {
    await gateReimbursementAction("alder");
    expect(mocks.resolveOrgContext).toHaveBeenCalledWith("user-1", "alder");
  });
});

describe("gateReimbursementPage", () => {
  const page = { slug: "alder", path: "/o/alder/reimbursements/abc" };

  it("a signed-out visitor keeps the deep link (the proxy's callbackUrl shape)", async () => {
    mocks.cachedAuth.mockResolvedValue(null);
    await expect(gateReimbursementPage(page)).rejects.toThrow("REDIRECT:/signin?callbackUrl=%2Fo%2Falder%2Freimbursements%2Fabc");
  });

  it("a stale 2FA claim redirects to /totp with this page as the callback", async () => {
    mocks.cachedAuth.mockResolvedValue(stale2fa);
    await expect(gateReimbursementPage(page)).rejects.toThrow("REDIRECT:/totp?callbackUrl=%2Fo%2Falder%2Freimbursements%2Fabc");
    expect(mocks.resolveOrgContext).not.toHaveBeenCalled();
  });

  it("an unknown slug is a 404; a forbidden or ended relationship is a named state", async () => {
    mocks.resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    await expect(gateReimbursementPage(page)).rejects.toThrow("NOT_FOUND");
    mocks.resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "Alder Creek Church", organizationType: "congregation" });
    expect(await gateReimbursementPage(page)).toEqual({
      ok: false,
      state: { kind: "org_forbidden", name: "Alder Creek Church", organizationType: "congregation" },
    });
    mocks.resolveOrgContext.mockResolvedValue({ kind: "ended", name: "Alder Creek Church", endedOn: "2026-01-01" });
    expect(await gateReimbursementPage(page)).toEqual({
      ok: false,
      state: { kind: "org_ended", name: "Alder Creek Church", endedOn: "2026-01-01" },
    });
  });

  it("not applicable, toggle off (with canManageFeatures), forbidden for a treasury page, and a load error are states at 200", async () => {
    mocks.loadReimbursementContext.mockResolvedValue({ kind: "not_applicable" });
    expect(await gateReimbursementPage(page)).toEqual({ ok: false, state: { kind: "not_applicable", name: "Alder Creek Church" } });
    mocks.loadReimbursementContext.mockResolvedValue({ kind: "toggle_off", canManageFeatures: true });
    expect(await gateReimbursementPage(page)).toEqual({
      ok: false,
      state: { kind: "toggle_off", name: "Alder Creek Church", canManageFeatures: true },
    });
    mocks.loadReimbursementContext.mockResolvedValue({ kind: "ok", has: NO_KEYS });
    expect(await gateReimbursementPage({ ...page, anyOf: ["view"] })).toEqual({
      ok: false,
      state: { kind: "forbidden", name: "Alder Creek Church" },
    });
    mocks.loadReimbursementContext.mockRejectedValue(new Error("boom"));
    expect(await gateReimbursementPage(page)).toEqual({ ok: false, state: { kind: "load_error" } });
  });

  it("an OrgAccessError is rethrown to the segment's error boundary, not turned into a state", async () => {
    mocks.loadReimbursementContext.mockRejectedValue(new mocks.FakeOrgAccessError());
    await expect(gateReimbursementPage(page)).rejects.toBeInstanceOf(mocks.FakeOrgAccessError);
  });

  it("passes a plain member on the member surface and hands back the live keys", async () => {
    const gate = await gateReimbursementPage(page);
    expect(gate).toMatchObject({ ok: true, identity: { userId: "user-1", organizationName: "Alder Creek Church", has: NO_KEYS } });
    mocks.loadReimbursementContext.mockResolvedValue({ kind: "ok", has: { ...NO_KEYS, manage: true } });
    expect(await gateReimbursementPage({ ...page, anyOf: ["manage"] })).toMatchObject({ ok: true });
  });
});

describe("gateReimbursementRoute", () => {
  const request = (path = "/o/alder/reimbursements/abc/receipts/def") => new Request(`https://app.example.invalid${path}?x=1`);
  const route = (opts: { anyOf?: Array<"view" | "pay" | "manage" | "requestForOthers"> } = {}) =>
    gateReimbursementRoute({ request: request(), slug: "alder", ...opts });

  it("signed out is a 307 to /signin carrying this URL; a stale 2FA claim is a 307 to /totp", async () => {
    mocks.auth.mockResolvedValue(null);
    let result = await route();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(307);
      expect(result.response.headers.get("location")).toContain("/signin?callbackUrl=%2Fo%2Falder%2Freimbursements%2Fabc%2Freceipts%2Fdef%3Fx%3D1");
    }
    mocks.auth.mockResolvedValue(stale2fa);
    result = await route();
    if (!result.ok) {
      expect(result.response.status).toBe(307);
      expect(result.response.headers.get("location")).toContain("/totp?callbackUrl=");
    }
    expect(mocks.resolveOrgContext).not.toHaveBeenCalled();
  });

  it("an unknown organization is 404; a forbidden or ended relationship is one 403 body", async () => {
    mocks.resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    let result = await route();
    if (!result.ok) expect(result.response.status).toBe(404);
    const bodies: string[] = [];
    for (const kind of ["forbidden", "ended"]) {
      mocks.resolveOrgContext.mockResolvedValue({ kind, name: "X", endedOn: "2026-01-01", organizationType: "congregation" });
      result = await route();
      if (!result.ok) {
        expect(result.response.status).toBe(403);
        bodies.push(await result.response.text());
      }
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("toggle off and not applicable are the same 404 body as a missing resource; a missing key is 403; a blip is 503", async () => {
    mocks.loadReimbursementContext.mockResolvedValue({ kind: "toggle_off", canManageFeatures: false });
    let result = await route();
    if (!result.ok) {
      expect(result.response.status).toBe(404);
      expect(await result.response.text()).toBe("Not found");
    }
    mocks.loadReimbursementContext.mockResolvedValue({ kind: "not_applicable" });
    result = await route();
    if (!result.ok) expect(result.response.status).toBe(404);
    mocks.loadReimbursementContext.mockResolvedValue({ kind: "ok", has: NO_KEYS });
    result = await route({ anyOf: ["view"] });
    if (!result.ok) expect(result.response.status).toBe(403);
    mocks.loadReimbursementContext.mockRejectedValue(new Error("boom"));
    result = await route();
    if (!result.ok) expect(result.response.status).toBe(503);
  });

  it("passes an identity through when every step holds", async () => {
    mocks.loadReimbursementContext.mockResolvedValue({ kind: "ok", has: { ...NO_KEYS, view: true } });
    expect(await route({ anyOf: ["view"] })).toMatchObject({ ok: true, userId: "user-1", has: { view: true } });
  });
});
