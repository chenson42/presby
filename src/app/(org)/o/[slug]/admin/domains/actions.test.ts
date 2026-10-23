/**
 * Orchestration tests for the tenant domain actions, mocked at the service
 * boundary - the same principle as admin/features/actions.test.ts: the SQL
 * correctness, the gate (permission, toggle, membership) and the audit rows are
 * proven against a real database in src/lib/domains/service.db.test.ts. This
 * file proves the plumbing: that every action authenticates, resolves the org
 * from the URL slug inside the user's own membership set, NEVER takes an
 * organization id from the client, maps each service outcome to end-user copy
 * with a stable code, and revalidates only on success.
 */
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

const svc = vi.hoisted(() => ({
  claimDomain: vi.fn(),
  checkClaim: vi.fn(),
  changeCanonical: vi.fn(),
  removeClaim: vi.fn(),
  reconnectClaim: vi.fn(),
}));
vi.mock("@/lib/domains/service", () => svc);

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a) }));

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  changeCanonicalAction,
  checkDomainAction,
  claimDomainAction,
  reconnectClaimAction,
  removeClaimAction,
} from "./actions";

const SESSION = { user: { id: "user-1", email: "clerk@example.invalid" } };
const RESOLVED_OK = {
  kind: "ok" as const,
  org: {
    organizationId: "org-1",
    personId: "person-1",
    name: "Alder Creek Presbyterian Church",
    organizationType: "congregation" as const,
    slug: "alder-creek",
    platformStatus: "managed" as const,
  },
};
const ACTOR = { kind: "tenant", userId: "user-1", email: "clerk@example.invalid", personId: "person-1" };
const UUID = "11111111-1111-4111-8111-111111111111";

function signedIn() {
  mockAuth.mockResolvedValueOnce(SESSION);
  mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
}

afterEach(() => {
  vi.clearAllMocks();
});

type Call = () => Promise<unknown>;
const ACTIONS: Array<[string, Call, keyof typeof svc]> = [
  ["claimDomainAction", () => claimDomainAction("alder-creek", { domain: "church-one.invalid", canonical: "www" }), "claimDomain"],
  ["checkDomainAction", () => checkDomainAction("alder-creek", "church-one.invalid"), "checkClaim"],
  ["changeCanonicalAction", () => changeCanonicalAction("alder-creek", UUID), "changeCanonical"],
  ["removeClaimAction", () => removeClaimAction("alder-creek", "church-one.invalid"), "removeClaim"],
  ["reconnectClaimAction", () => reconnectClaimAction("alder-creek", "church-one.invalid"), "reconnectClaim"],
];

describe.each(ACTIONS)("%s - identity", (_name, call, fn) => {
  it("not signed in: an error, no org resolution, no service call", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect(await call()).toEqual({ ok: false, code: "unauthenticated", error: "You must be signed in to do that." });
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
    expect(svc[fn]).not.toHaveBeenCalled();
  });

  it("a slug the user cannot enter (any non-ok resolution): no_access, no service call", async () => {
    for (const kind of ["forbidden", "not-found", "ended"] as const) {
      mockAuth.mockResolvedValueOnce(SESSION);
      mockResolveOrgContext.mockResolvedValueOnce({ kind });
      expect(await call()).toEqual({ ok: false, code: "no_access", error: "You don't have access to that organization." });
    }
    expect(svc[fn]).not.toHaveBeenCalled();
  });

  it("resolves the slug INSIDE the signed-in user's membership set (users.id, then the slug)", async () => {
    signedIn();
    svc[fn].mockResolvedValueOnce({ kind: "forbidden" });
    await call();
    expect(mockResolveOrgContext).toHaveBeenCalledWith("user-1", "alder-creek");
  });

  it("passes the SERVER's tenant actor and organization id to the service, never a client value", async () => {
    signedIn();
    svc[fn].mockResolvedValueOnce({ kind: "forbidden" });
    await call();
    const [actor, organizationId] = svc[fn].mock.calls[0]!;
    expect(actor).toEqual(ACTOR);
    expect(organizationId).toBe("org-1");
  });

  it("the service's forbidden and feature_off become permission and toggle copy, with stable codes, and never revalidate", async () => {
    signedIn();
    svc[fn].mockResolvedValueOnce({ kind: "forbidden" });
    expect(await call()).toEqual({
      ok: false,
      code: "forbidden",
      error: "You don't have permission to manage this organization's domains.",
    });
    signedIn();
    svc[fn].mockResolvedValueOnce({ kind: "feature_off" });
    expect(await call()).toEqual({
      ok: false,
      code: "feature_off",
      error: "Website domains aren't turned on for your organization.",
    });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("claimDomainAction", () => {
  const input = { domain: "church-one.invalid", canonical: "www" as const };

  it("success: returns the TXT record and hostnames, revalidates the domains page", async () => {
    signedIn();
    svc.claimDomain.mockResolvedValueOnce({
      kind: "ok",
      claimName: "church-one.invalid",
      displayName: "church-one.invalid",
      created: [{ hostname: "church-one.invalid" }, { hostname: "www.church-one.invalid" }],
      proof: { type: "TXT", name: "_presby-challenge.church-one.invalid", value: "presby-verify=abc" },
    });
    expect(await claimDomainAction("alder-creek", input)).toEqual({
      ok: true,
      data: {
        claimName: "church-one.invalid",
        displayName: "church-one.invalid",
        hostnames: ["church-one.invalid", "www.church-one.invalid"],
        proof: { type: "TXT", name: "_presby-challenge.church-one.invalid", value: "presby-verify=abc" },
      },
    });
    expect(svc.claimDomain.mock.calls[0]![2]).toEqual(input);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/admin/domains");
  });

  it("an invalid name is a field error on 'domain', with the refusal's own copy", async () => {
    signedIn();
    svc.claimDomain.mockResolvedValueOnce({ kind: "invalid", reason: "ip_address" });
    expect(await claimDomainAction("alder-creek", { domain: "203.0.113.9", canonical: "www" })).toEqual({
      ok: false,
      code: "invalid",
      field: "domain",
      error: "Enter a domain name, not an IP address.",
    });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("malformed client input (wrong types, an unknown canonical, an oversize string) is invalid without reaching the service", async () => {
    for (const bad of [
      { domain: 5, canonical: "www" },
      { domain: "x.invalid", canonical: "root" },
      { domain: "a".repeat(5000), canonical: "www" },
      { canonical: "www" },
      null,
    ]) {
      signedIn();
      const r = await claimDomainAction("alder-creek", bad as never);
      expect(r).toMatchObject({ ok: false, code: "invalid", field: "domain" });
    }
    expect(svc.claimDomain).not.toHaveBeenCalled();
  });

  it("an organizationId smuggled in the input is ignored: the service gets the server's", async () => {
    signedIn();
    svc.claimDomain.mockResolvedValueOnce({ kind: "forbidden" });
    await claimDomainAction("alder-creek", { ...input, organizationId: "org-evil" } as never);
    expect(svc.claimDomain.mock.calls[0]![1]).toBe("org-1");
    expect(svc.claimDomain.mock.calls[0]![2]).toEqual(input);
  });

  it.each([
    ["exists", { kind: "exists", parked: false }, /already has this domain/],
    ["exists", { kind: "exists", parked: true }, /Reconnect it/],
    ["cap_reached", { kind: "cap_reached" }, /limit of domains/],
    ["conflict", { kind: "conflict" }, /Try again/],
  ])("%s maps to a coded error", async (code, result, copy) => {
    signedIn();
    svc.claimDomain.mockResolvedValueOnce(result);
    const r = (await claimDomainAction("alder-creek", input)) as { ok: false; code: string; error: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe(code);
    expect(r.error).toMatch(copy);
  });

  it("rate_limited carries retryAfterSeconds and says how long", async () => {
    signedIn();
    svc.claimDomain.mockResolvedValueOnce({ kind: "rate_limited", retryAfterSeconds: 190 });
    expect(await claimDomainAction("alder-creek", input)).toEqual({
      ok: false,
      code: "rate_limited",
      retryAfterSeconds: 190,
      error: "You've done that a lot just now. Try again in 4 minutes.",
    });
  });

  it("never reveals another organization: the 'not_found' a platform org lookup could return reads as no access", async () => {
    signedIn();
    svc.claimDomain.mockResolvedValueOnce({ kind: "not_found" });
    expect(await claimDomainAction("alder-creek", input)).toMatchObject({ ok: false, code: "no_access" });
  });
});

describe("checkDomainAction", () => {
  it("is a FORCED check (a person's click), and returns the outcome", async () => {
    signedIn();
    svc.checkClaim.mockResolvedValueOnce({ kind: "ok", outcome: "verified", proof: "present", checkedAt: "2030-01-01T00:00:00.000Z" });
    expect(await checkDomainAction("alder-creek", "church-one.invalid")).toEqual({
      ok: true,
      data: { outcome: "verified", checkedAt: "2030-01-01T00:00:00.000Z" },
    });
    expect(svc.checkClaim).toHaveBeenCalledWith(ACTOR, "org-1", "church-one.invalid", { forced: true });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/admin/domains");
  });

  it("rate_limited reads in minutes and carries the retry", async () => {
    signedIn();
    svc.checkClaim.mockResolvedValueOnce({ kind: "rate_limited", retryAfterSeconds: 45 });
    expect(await checkDomainAction("alder-creek", "church-one.invalid")).toEqual({
      ok: false,
      code: "rate_limited",
      retryAfterSeconds: 45,
      error: "You've done that a lot just now. Try again in 1 minute.",
    });
  });

  it("an unknown claim and an invalid name are not_found, the latter without a service call", async () => {
    signedIn();
    svc.checkClaim.mockResolvedValueOnce({ kind: "not_found" });
    expect(await checkDomainAction("alder-creek", "nothing.invalid")).toMatchObject({ ok: false, code: "not_found" });
    signedIn();
    expect(await checkDomainAction("alder-creek", "")).toMatchObject({ ok: false, code: "not_found" });
    signedIn();
    expect(await checkDomainAction("alder-creek", "a".repeat(300))).toMatchObject({ ok: false, code: "not_found" });
    expect(svc.checkClaim).toHaveBeenCalledTimes(1);
  });
});

describe("changeCanonicalAction", () => {
  it("success revalidates; not_live explains", async () => {
    signedIn();
    svc.changeCanonical.mockResolvedValueOnce({ kind: "ok", changed: true });
    expect(await changeCanonicalAction("alder-creek", UUID)).toEqual({ ok: true });
    expect(svc.changeCanonical).toHaveBeenCalledWith(ACTOR, "org-1", UUID);
    expect(mockRevalidatePath).toHaveBeenCalledTimes(1);

    signedIn();
    svc.changeCanonical.mockResolvedValueOnce({ kind: "not_live" });
    expect(await changeCanonicalAction("alder-creek", UUID)).toMatchObject({ ok: false, code: "not_live" });
    expect(mockRevalidatePath).toHaveBeenCalledTimes(1);
  });

  it("a non-uuid id is not_found without a service call", async () => {
    signedIn();
    expect(await changeCanonicalAction("alder-creek", "not-a-uuid")).toMatchObject({ ok: false, code: "not_found" });
    expect(svc.changeCanonical).not.toHaveBeenCalled();
  });
});

describe("removeClaimAction", () => {
  it("success revalidates and forwards the promotion target", async () => {
    signedIn();
    svc.removeClaim.mockResolvedValueOnce({ kind: "ok", removed: [], promoted: null });
    expect(await removeClaimAction("alder-creek", "church-one.invalid", UUID)).toEqual({ ok: true });
    expect(svc.removeClaim).toHaveBeenCalledWith(ACTOR, "org-1", "church-one.invalid", UUID);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/admin/domains");
  });

  it("needs_canonical and invalid_target are explained", async () => {
    signedIn();
    svc.removeClaim.mockResolvedValueOnce({ kind: "needs_canonical", candidates: [] });
    expect(await removeClaimAction("alder-creek", "church-one.invalid")).toMatchObject({ ok: false, code: "needs_canonical" });
    signedIn();
    svc.removeClaim.mockResolvedValueOnce({ kind: "invalid_target" });
    expect(await removeClaimAction("alder-creek", "church-one.invalid", UUID)).toMatchObject({ ok: false, code: "invalid_target" });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("a non-uuid promotion target is refused without a service call", async () => {
    signedIn();
    expect(await removeClaimAction("alder-creek", "church-one.invalid", "nope")).toMatchObject({ ok: false, code: "invalid_target" });
    expect(svc.removeClaim).not.toHaveBeenCalled();
  });
});

describe("reconnectClaimAction", () => {
  it("success revalidates", async () => {
    signedIn();
    svc.reconnectClaim.mockResolvedValueOnce({ kind: "ok", reconnected: [] });
    expect(await reconnectClaimAction("alder-creek", "church-one.invalid")).toEqual({ ok: true });
    expect(svc.reconnectClaim).toHaveBeenCalledWith(ACTOR, "org-1", "church-one.invalid");
    expect(mockRevalidatePath).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["proof_missing", { kind: "proof_missing", proof: "absent" }, /can't find your ownership record/],
    ["dns_unknown", { kind: "dns_unknown" }, /couldn't check right now/],
    ["not_parked", { kind: "not_parked" }, /isn't waiting/],
    ["stale", { kind: "stale" }, /Refresh/],
    ["not_found", { kind: "not_found" }, /couldn't find/],
  ])("%s", async (code, result, copy) => {
    signedIn();
    svc.reconnectClaim.mockResolvedValueOnce(result);
    const r = (await reconnectClaimAction("alder-creek", "church-one.invalid")) as { ok: false; code: string; error: string };
    expect(r.code).toBe(code);
    expect(r.error).toMatch(copy);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("rate_limited", async () => {
    signedIn();
    svc.reconnectClaim.mockResolvedValueOnce({ kind: "rate_limited", retryAfterSeconds: 600 });
    expect(await reconnectClaimAction("alder-creek", "church-one.invalid")).toMatchObject({
      ok: false,
      code: "rate_limited",
      retryAfterSeconds: 600,
    });
  });
});

describe("no end-user copy leaks provider text, a token, or another organization", () => {
  it("every message the actions can produce is free of provider vocabulary", async () => {
    const outputs: string[] = [];
    const gather = (r: unknown) => outputs.push(JSON.stringify(r));
    for (const reason of [
      "empty", "too_long", "invalid_characters", "invalid_format", "credentials", "wildcard", "ip_address", "too_few_labels", "reserved", "mixed_script",
    ]) {
      signedIn();
      svc.claimDomain.mockResolvedValueOnce({ kind: "invalid", reason });
      gather(await claimDomainAction("alder-creek", { domain: "x.invalid", canonical: "www" }));
    }
    for (const out of outputs) expect(out).not.toMatch(/vercel|resend|cloudflare|token|presby-verify/i);
    expect(outputs).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// zod 4 characterization (docs/work-log/2026-10-23-zod-4.md, Phase 3 "Tests" 2):
// the id schema accepts the project's non-RFC ids (the built-in role ids in
// shipped migrations and the seeded fixtures) and rejects a malformed one. The
// refusal text is the action's fixed copy, pinned exactly.
// ---------------------------------------------------------------------------
describe("id inputs accept non-RFC ids and refuse malformed ones", () => {
  const NON_RFC = ["00000000-0000-0000-0000-000000000005", "d9100000-0000-0000-0000-000000000010"];

  it.each(NON_RFC)("changeCanonicalAction passes %s to the service", async (id) => {
    signedIn();
    svc.changeCanonical.mockResolvedValueOnce({ kind: "ok", changed: true });
    expect(await changeCanonicalAction("alder-creek", id)).toEqual({ ok: true });
    expect(svc.changeCanonical).toHaveBeenCalledWith(ACTOR, "org-1", id);
  });

  it.each(NON_RFC)("removeClaimAction forwards %s as the promotion target", async (id) => {
    signedIn();
    svc.removeClaim.mockResolvedValueOnce({ kind: "ok", removed: [], promoted: null });
    expect(await removeClaimAction("alder-creek", "church-one.invalid", id)).toEqual({ ok: true });
    expect(svc.removeClaim).toHaveBeenCalledWith(ACTOR, "org-1", "church-one.invalid", id);
  });

  it("refuses a malformed id with the fixed copy and no service call", async () => {
    signedIn();
    expect(await changeCanonicalAction("alder-creek", "not-a-uuid")).toEqual({
      ok: false,
      code: "not_found",
      error: "We couldn't find that domain.",
    });
    signedIn();
    expect(await removeClaimAction("alder-creek", "church-one.invalid", "not-a-uuid")).toEqual({
      ok: false,
      code: "invalid_target",
      error: "Choose one of your live addresses as the new main address.",
    });
    expect(svc.changeCanonical).not.toHaveBeenCalled();
    expect(svc.removeClaim).not.toHaveBeenCalled();
  });
});
