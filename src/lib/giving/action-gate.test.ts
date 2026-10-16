/**
 * The shared server-action gate (docs/work-log/2026-10-15-online-giving.md,
 * Phase 3 "Gate order on every surface"): sign-in -> Node-side 2FA -> four-way
 * org resolve -> applicability/toggle -> key. Mocked at the boundaries; the
 * database halves are proven by access.test.ts and the *.db.test.ts suites.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const resolveOrgContext = vi.hoisted(() => vi.fn());
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...a: unknown[]) => resolveOrgContext(...a),
  OrgAccessError,
}));

const loadGivingContext = vi.hoisted(() => vi.fn());
vi.mock("./access", async () => {
  const pure = await import("./access-pure");
  return { ...pure, loadGivingContext: (...a: unknown[]) => loadGivingContext(...a) };
});

import { gateGivingAction, invalidInput } from "./action-gate";

const OK_ORG = {
  kind: "ok" as const,
  org: { personId: "person-1", organizationId: "org-1", organizationType: "congregation" as const, name: "Alder", slug: "alder-creek", platformStatus: "managed" as const },
};
const signedIn = () => mockAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: false } });

afterEach(() => {
  mockAuth.mockReset();
  resolveOrgContext.mockReset();
  loadGivingContext.mockReset();
});

describe("gateGivingAction", () => {
  it("refuses a signed-out caller before resolving anything", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await gateGivingAction("alder-creek", ["manage"])).toEqual({ ok: false, error: "You must be signed in to do that." });
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("returns two_factor_required with a /totp redirect when the claim says required and unverified - and reads nothing else", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: false } });
    const result = await gateGivingAction("alder-creek", ["manage"]);
    expect(result).toMatchObject({ ok: false, kind: "two_factor_required" });
    expect((result as { redirectTo?: string }).redirectTo).toBe("/totp?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fgiving");
    expect(resolveOrgContext).not.toHaveBeenCalled();
    expect(loadGivingContext).not.toHaveBeenCalled();
  });

  it("admits a required-and-verified session", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: true } });
    resolveOrgContext.mockResolvedValue(OK_ORG);
    loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: true, record: false, manage: true } });
    expect(await gateGivingAction("alder-creek", ["manage"])).toMatchObject({ ok: true });
  });

  it("takes the organization from the slug, never from the client: resolveOrgContext(session user id, slug)", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue(OK_ORG);
    loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: false, record: true, manage: false } });
    const result = await gateGivingAction("alder-creek", ["record"]);
    expect(resolveOrgContext).toHaveBeenCalledWith("user-1", "alder-creek");
    expect(loadGivingContext).toHaveBeenCalledWith({ personId: "person-1", organizationId: "org-1", organizationType: "congregation" });
    expect(result).toEqual({
      ok: true, userId: "user-1", email: null, personId: "person-1", organizationId: "org-1",
      has: { view: false, record: true, manage: false },
    });
  });

  it("refuses every kind of org miss with one message", async () => {
    signedIn();
    for (const kind of ["not-found", "forbidden", "ended"]) {
      resolveOrgContext.mockResolvedValue({ kind });
      expect(await gateGivingAction("x", ["manage"])).toEqual({ ok: false, error: "You don't have access to that organization." });
    }
    expect(loadGivingContext).not.toHaveBeenCalled();
  });

  it("maps not_applicable, toggle_off and forbidden to honest, different messages", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue(OK_ORG);
    loadGivingContext.mockResolvedValue({ kind: "not_applicable" });
    expect(await gateGivingAction("x", ["manage"])).toEqual({ ok: false, error: "Giving isn't available for this organization." });
    loadGivingContext.mockResolvedValue({ kind: "toggle_off", canManageFeatures: true });
    expect(await gateGivingAction("x", ["manage"])).toEqual({ ok: false, error: "Giving isn't turned on for this organization." });
    loadGivingContext.mockResolvedValue({ kind: "forbidden" });
    expect(await gateGivingAction("x", ["manage"])).toEqual({ ok: false, error: "You don't have permission to do that." });
  });

  it("requires the specific key: holding SOME giving key is not enough (no key implies another)", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue(OK_ORG);
    loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: true, record: true, manage: false } });
    expect(await gateGivingAction("x", ["manage"])).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(await gateGivingAction("x", ["manage", "record"])).toMatchObject({ ok: true });
  });

  it("a database blip is its own honest message - never 'not allowed' and never an exception", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue(OK_ORG);
    loadGivingContext.mockRejectedValue(new Error("connection reset"));
    expect(await gateGivingAction("x", ["manage"])).toEqual({
      ok: false,
      error: "We couldn't check your access just now. Try again in a moment.",
    });
  });

  it("a membership that ended mid-request is an access refusal", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue(OK_ORG);
    loadGivingContext.mockRejectedValue(new OrgAccessError("gone"));
    expect(await gateGivingAction("x", ["manage"])).toEqual({ ok: false, error: "You don't have access to that organization." });
  });
});

describe("invalidInput", () => {
  it("turns a zod failure into the form's inline field errors", () => {
    const parsed = z.object({ a: z.string().min(2, "too short"), b: z.object({ c: z.number() }) }).safeParse({ a: "x", b: { c: "y" } });
    if (parsed.success) throw new Error("expected failure");
    expect(invalidInput(parsed.error)).toMatchObject({
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: { a: "too short", "b.c": expect.any(String) },
    });
  });
});
