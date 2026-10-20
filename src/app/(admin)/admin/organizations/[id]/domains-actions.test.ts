/**
 * Orchestration tests for the platform domain actions (Q1 toggles, Q2
 * on-behalf web claim), mocked at the service and toggles boundaries; the real
 * behaviour is proven in src/lib/domains/service.db.test.ts and
 * src/lib/domains/toggles.db.test.ts. Proves: the ADMIN_ORGANIZATIONS gate
 * runs first and is the ONLY authorization, the actor handed to the service is
 * the PLATFORM actor (never a tenant one), a malformed organization id never
 * reaches the service, and the on-behalf claim is web-only by construction.
 */
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockClaim = vi.hoisted(() => vi.fn());
const mockCheck = vi.hoisted(() => vi.fn());
const mockHold = vi.hoisted(() => vi.fn());
const mockForce = vi.hoisted(() => vi.fn());
vi.mock("@/lib/domains/service", () => ({
  claimDomain: mockClaim,
  checkDomainPlatform: mockCheck,
  setDomainHold: mockHold,
  forceReleaseDomain: mockForce,
}));

const mockSetToggle = vi.hoisted(() => vi.fn());
vi.mock("@/lib/domains/toggles", () => ({
  OPERATOR_TOGGLE_KEYS: ["org_portal.domains", "org_portal.mail_domain"],
  setOperatorOrgToggle: mockSetToggle,
}));

const mockRevalidate = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => mockRevalidate(...a) }));

import { afterEach, describe, expect, it, vi } from "vitest";
import { FEATURES } from "@/lib/permissions";
import {
  checkDomainPlatformAction,
  claimDomainForOrgAction,
  forceReleaseDomainAction,
  setDomainHoldAction,
  setOrgDomainFeatureAction,
} from "./domains-actions";

const ORG = "11111111-1111-4111-8111-111111111111";
const DOMAIN = "22222222-2222-4222-8222-222222222222";
const ADMIN = { user: { id: "op-1", email: "operator@example.invalid", features: [FEATURES.ADMIN_ORGANIZATIONS] } };
const NOT_ADMIN = { user: { id: "u-2", email: "x@example.invalid", features: [FEATURES.ADMIN_TICKETS] } };
const INPUT = { domain: "church-one.invalid", canonical: "www" as const };

afterEach(() => vi.clearAllMocks());

describe.each([
  ["claimDomainForOrgAction", () => claimDomainForOrgAction(ORG, INPUT), mockClaim],
  ["setOrgDomainFeatureAction", () => setOrgDomainFeatureAction(ORG, "org_portal.domains", true), mockSetToggle],
  ["checkDomainPlatformAction", () => checkDomainPlatformAction(DOMAIN), mockCheck],
  ["setDomainHoldAction", () => setDomainHoldAction(DOMAIN, "paused", "A perfectly good reason."), mockHold],
  ["forceReleaseDomainAction", () => forceReleaseDomainAction(DOMAIN, { reason: "A perfectly good reason." }), mockForce],
] as const)("%s - the platform gate", (_name, call, service) => {
  it("unauthenticated: unauthorized, no service call", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect(await call()).toMatchObject({ ok: false, code: "unauthorized" });
    expect(service).not.toHaveBeenCalled();
  });

  it("a signed-in user WITHOUT admin.organizations is forbidden, no service call", async () => {
    mockAuth.mockResolvedValueOnce(NOT_ADMIN);
    expect(await call()).toMatchObject({ ok: false, code: "forbidden" });
    expect(service).not.toHaveBeenCalled();
  });

  it("holding domains.manage at some org confers nothing here (a tenant permission is not a platform one)", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "u-3", email: "t@example.invalid", features: [] } });
    expect(await call()).toMatchObject({ ok: false, code: "forbidden" });
    expect(service).not.toHaveBeenCalled();
  });
});

describe("claimDomainForOrgAction (Q2)", () => {
  it("hands the service a PLATFORM actor and the org id from the argument; success revalidates the org page", async () => {
    mockAuth.mockResolvedValueOnce(ADMIN);
    mockClaim.mockResolvedValueOnce({
      kind: "ok",
      claimName: "church-one.invalid",
      displayName: "church-one.invalid",
      created: [{ hostname: "church-one.invalid" }],
      proof: { type: "TXT", name: "_presby-challenge.church-one.invalid", value: "presby-verify=abc" },
    });
    const r = await claimDomainForOrgAction(ORG, INPUT);
    expect(r).toMatchObject({ ok: true, data: { claimName: "church-one.invalid", hostnames: ["church-one.invalid"] } });
    expect(mockClaim).toHaveBeenCalledWith(
      { kind: "platform", userId: "op-1", email: "operator@example.invalid" },
      ORG,
      INPUT,
    );
    expect(mockRevalidate).toHaveBeenCalledWith(`/admin/organizations/${ORG}`);
  });

  it("is web-only by construction: the input has no purpose, and a purpose smuggled in is not forwarded", async () => {
    mockAuth.mockResolvedValueOnce(ADMIN);
    mockClaim.mockResolvedValueOnce({ kind: "forbidden" });
    await claimDomainForOrgAction(ORG, { ...INPUT, purpose: "mail" } as never);
    expect(mockClaim.mock.calls[0]![2]).toEqual(INPUT);
  });

  it("a malformed organization id never reaches the service", async () => {
    mockAuth.mockResolvedValueOnce(ADMIN);
    expect(await claimDomainForOrgAction("not-a-uuid", INPUT)).toMatchObject({ ok: false, code: "not_found" });
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("malformed input is a field error without a service call", async () => {
    mockAuth.mockResolvedValueOnce(ADMIN);
    expect(await claimDomainForOrgAction(ORG, { domain: 7, canonical: "www" } as never)).toMatchObject({
      ok: false,
      code: "invalid",
      field: "domain",
    });
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid", { kind: "invalid", reason: "reserved" }, "invalid", /can't be connected/],
    ["exists", { kind: "exists", parked: false }, "exists", /already has that domain/],
    ["cap_reached", { kind: "cap_reached" }, "cap_reached", /limit/],
    ["feature_off", { kind: "feature_off" }, "feature_off", /Turn on Website domain/],
    ["not_found", { kind: "not_found" }, "not_found", /doesn't exist/],
    ["rate_limited", { kind: "rate_limited", retryAfterSeconds: 30 }, "rate_limited", /Too many/],
  ])("%s", async (_n, result, code, copy) => {
    mockAuth.mockResolvedValueOnce(ADMIN);
    mockClaim.mockResolvedValueOnce(result);
    const r = (await claimDomainForOrgAction(ORG, INPUT)) as { ok: false; code: string; error: string };
    expect(r.code).toBe(code);
    expect(r.error).toMatch(copy);
    expect(mockRevalidate).not.toHaveBeenCalled();
  });
});

describe("setOrgDomainFeatureAction (Q1)", () => {
  it("flips one of the two operator keys as the platform actor, and revalidates", async () => {
    mockAuth.mockResolvedValueOnce(ADMIN);
    mockSetToggle.mockResolvedValueOnce({ kind: "ok", changed: true });
    expect(await setOrgDomainFeatureAction(ORG, "org_portal.mail_domain", true)).toEqual({ ok: true, data: { changed: true } });
    expect(mockSetToggle).toHaveBeenCalledWith(
      { userId: "op-1", email: "operator@example.invalid" },
      ORG,
      "org_portal.mail_domain",
      true,
    );
    expect(mockRevalidate).toHaveBeenCalledWith(`/admin/organizations/${ORG}`);
  });

  it("refuses any other key (the tenant toggles stay tenant-owned) without a service call", async () => {
    for (const key of ["org_portal.calendar", "org_portal.giving", "", "org_portal.domains ", "__proto__"]) {
      mockAuth.mockResolvedValueOnce(ADMIN);
      expect(await setOrgDomainFeatureAction(ORG, key, true)).toMatchObject({ ok: false, code: "invalid_key" });
    }
    expect(mockSetToggle).not.toHaveBeenCalled();
  });

  it("refuses a non-boolean enabled and a malformed organization id", async () => {
    mockAuth.mockResolvedValueOnce(ADMIN);
    expect(await setOrgDomainFeatureAction(ORG, "org_portal.domains", "yes" as never)).toMatchObject({ code: "invalid_key" });
    mockAuth.mockResolvedValueOnce(ADMIN);
    expect(await setOrgDomainFeatureAction("nope", "org_portal.domains", true)).toMatchObject({ code: "not_found" });
    expect(mockSetToggle).not.toHaveBeenCalled();
  });

  it("an unknown organization is not_found", async () => {
    mockAuth.mockResolvedValueOnce(ADMIN);
    mockSetToggle.mockResolvedValueOnce({ kind: "not_found" });
    expect(await setOrgDomainFeatureAction(ORG, "org_portal.domains", true)).toMatchObject({ ok: false, code: "not_found" });
    expect(mockRevalidate).not.toHaveBeenCalled();
  });
});

const PLATFORM = { kind: "platform", userId: "op-1", email: "operator@example.invalid" };

describe("checkDomainPlatformAction (Batch 1b)", () => {
  it("hands the service the PLATFORM actor and the domain id, and revalidates the admin tree", async () => {
    mockAuth.mockResolvedValueOnce(ADMIN);
    mockCheck.mockResolvedValueOnce({ kind: "ok", outcome: "attached", proof: "present", checkedAt: "2030-01-01T00:00:00.000Z" });
    expect(await checkDomainPlatformAction(DOMAIN)).toEqual({ ok: true, data: { outcome: "attached", checkedAt: "2030-01-01T00:00:00.000Z" } });
    expect(mockCheck).toHaveBeenCalledWith(PLATFORM, DOMAIN);
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/organizations", "layout");
  });

  it("a malformed id never reaches the service", async () => {
    mockAuth.mockResolvedValueOnce(ADMIN);
    expect(await checkDomainPlatformAction("nope")).toMatchObject({ ok: false, code: "not_found" });
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "rate_limited", retryAfterSeconds: 90 }, "rate_limited"],
    [{ kind: "feature_off" }, "feature_off"],
    [{ kind: "forbidden" }, "forbidden"],
    [{ kind: "not_found" }, "not_found"],
  ])("maps %j to %s without revalidating", async (result, code) => {
    mockAuth.mockResolvedValueOnce(ADMIN);
    mockCheck.mockResolvedValueOnce(result);
    const r = await checkDomainPlatformAction(DOMAIN);
    expect(r).toMatchObject({ ok: false, code });
    if (code === "rate_limited") expect(r).toMatchObject({ retryAfterSeconds: 90 });
    expect(mockRevalidate).not.toHaveBeenCalled();
  });
});

describe("setDomainHoldAction (Batch 1b)", () => {
  it("forwards a pause with its reason as the platform actor", async () => {
    mockAuth.mockResolvedValueOnce(ADMIN);
    mockHold.mockResolvedValueOnce({ kind: "ok", changed: true, domain: {} });
    expect(await setDomainHoldAction(DOMAIN, "paused", "Paused for a support review.")).toEqual({ ok: true, data: { changed: true } });
    expect(mockHold).toHaveBeenCalledWith(PLATFORM, DOMAIN, "paused", "Paused for a support review.");
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/organizations", "layout");
  });

  it("resumes with null and no reason", async () => {
    mockAuth.mockResolvedValueOnce(ADMIN);
    mockHold.mockResolvedValueOnce({ kind: "ok", changed: false, domain: {} });
    expect(await setDomainHoldAction(DOMAIN, null, null)).toEqual({ ok: true, data: { changed: false } });
    expect(mockHold).toHaveBeenCalledWith(PLATFORM, DOMAIN, null, null);
  });

  it("an unknown hold kind, a non-string reason and a malformed id never reach the service", async () => {
    for (const call of [
      () => setDomainHoldAction(DOMAIN, "frozen" as never, "A perfectly good reason."),
      () => setDomainHoldAction(DOMAIN, "paused", 7 as never),
      () => setDomainHoldAction(DOMAIN, "paused", "x".repeat(1001)),
      () => setDomainHoldAction("nope", "paused", "A perfectly good reason."),
    ]) {
      mockAuth.mockResolvedValueOnce(ADMIN);
      expect((await call()).ok).toBe(false);
    }
    expect(mockHold).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "invalid_reason" }, "invalid_reason", /10 to 500/],
    [{ kind: "terminal" }, "terminal", /already been released/],
    [{ kind: "forbidden" }, "forbidden", /Forbidden/],
    [{ kind: "not_found" }, "not_found", /doesn't exist/],
  ])("maps %j", async (result, code, copy) => {
    mockAuth.mockResolvedValueOnce(ADMIN);
    mockHold.mockResolvedValueOnce(result);
    const r = (await setDomainHoldAction(DOMAIN, "paused", "A perfectly good reason.")) as { ok: false; code: string; error: string };
    expect(r.code).toBe(code);
    expect(r.error).toMatch(copy);
    expect(mockRevalidate).not.toHaveBeenCalled();
  });
});

describe("forceReleaseDomainAction (Batch 1b)", () => {
  it("forwards the reason and the cause as the platform actor, returns the new state", async () => {
    mockAuth.mockResolvedValueOnce(ADMIN);
    mockForce.mockResolvedValueOnce({ kind: "ok", domain: { state: "release_pending" } });
    expect(await forceReleaseDomainAction(DOMAIN, { reason: "Evicted after the dispute.", cause: "evicted" })).toEqual({
      ok: true,
      data: { state: "release_pending" },
    });
    expect(mockForce).toHaveBeenCalledWith(PLATFORM, DOMAIN, { reason: "Evicted after the dispute.", cause: "evicted" });
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/organizations", "layout");
  });

  it("an unknown cause (a tenant-side cause smuggled in), a missing reason and a malformed id never reach the service", async () => {
    for (const call of [
      () => forceReleaseDomainAction(DOMAIN, { reason: "A perfectly good reason.", cause: "removed" as never }),
      () => forceReleaseDomainAction(DOMAIN, {} as never),
      () => forceReleaseDomainAction(DOMAIN, { reason: 5 } as never),
      () => forceReleaseDomainAction("nope", { reason: "A perfectly good reason." }),
    ]) {
      mockAuth.mockResolvedValueOnce(ADMIN);
      expect((await call()).ok).toBe(false);
    }
    expect(mockForce).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "invalid_reason" }, "invalid_reason"],
    [{ kind: "already_final" }, "already_final"],
    [{ kind: "already_releasing" }, "already_releasing"],
    [{ kind: "forbidden" }, "forbidden"],
    [{ kind: "not_found" }, "not_found"],
  ])("maps %j to %s", async (result, code) => {
    mockAuth.mockResolvedValueOnce(ADMIN);
    mockForce.mockResolvedValueOnce(result);
    expect(await forceReleaseDomainAction(DOMAIN, { reason: "A perfectly good reason." })).toMatchObject({ ok: false, code });
    expect(mockRevalidate).not.toHaveBeenCalled();
  });
});
