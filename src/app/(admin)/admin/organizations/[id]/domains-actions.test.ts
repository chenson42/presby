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
vi.mock("@/lib/domains/service", () => ({ claimDomain: mockClaim }));

const mockSetToggle = vi.hoisted(() => vi.fn());
vi.mock("@/lib/domains/toggles", () => ({
  OPERATOR_TOGGLE_KEYS: ["org_portal.domains", "org_portal.mail_domain"],
  setOperatorOrgToggle: mockSetToggle,
}));

const mockRevalidate = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => mockRevalidate(...a) }));

import { afterEach, describe, expect, it, vi } from "vitest";
import { FEATURES } from "@/lib/permissions";
import { claimDomainForOrgAction, setOrgDomainFeatureAction } from "./domains-actions";

const ORG = "11111111-1111-4111-8111-111111111111";
const ADMIN = { user: { id: "op-1", email: "operator@example.invalid", features: [FEATURES.ADMIN_ORGANIZATIONS] } };
const NOT_ADMIN = { user: { id: "u-2", email: "x@example.invalid", features: [FEATURES.ADMIN_TICKETS] } };
const INPUT = { domain: "church-one.invalid", canonical: "www" as const };

afterEach(() => vi.clearAllMocks());

describe.each([
  ["claimDomainForOrgAction", () => claimDomainForOrgAction(ORG, INPUT), mockClaim],
  ["setOrgDomainFeatureAction", () => setOrgDomainFeatureAction(ORG, "org_portal.domains", true), mockSetToggle],
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
