/**
 * Tests for src/lib/giving/access.ts — the giving gate (docs/work-log/
 * 2026-10-15-online-giving.md, Phase 3 "Gate order on every surface", steps
 * 3 to 5). Two suites: the pure Node-side 2FA check and redirect builder (no
 * database), and the Postgres-backed `loadGivingContext` against throwaway
 * orgs (`describe.skipIf(!hasDb)`, the `createGivingFixture()` harness).
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/giving/access.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));
// access.ts -> org-features.ts -> @/lib/audit -> @/auth -> next-auth, which this
// test environment cannot resolve; org-features.test.ts mocks it the same way.
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled" },
  recordAudit: vi.fn(),
}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

// The pure half lives in ./access-pure precisely so these tests (and CI, which
// has no DATABASE_URL) can load it; ./access re-exports it (asserted below in
// the DB-gated suite, where ./access can be imported).
describe("assertGivingSession (pure)", () => {
  async function load() {
    return import("./access-pure");
  }

  it("is unauthenticated with no session, no user, or no user id", async () => {
    const { assertGivingSession } = await load();
    expect(assertGivingSession(null)).toEqual({ kind: "unauthenticated" });
    expect(assertGivingSession(undefined)).toEqual({ kind: "unauthenticated" });
    expect(assertGivingSession({})).toEqual({ kind: "unauthenticated" });
    expect(assertGivingSession({ user: null })).toEqual({ kind: "unauthenticated" });
    expect(assertGivingSession({ user: {} })).toEqual({ kind: "unauthenticated" });
    expect(assertGivingSession({ user: { id: "" } })).toEqual({ kind: "unauthenticated" });
  });

  it("refuses 2FA-required-and-unverified: the stale-Edge-claim case this check exists for", async () => {
    const { assertGivingSession } = await load();
    expect(
      assertGivingSession({ user: { id: "u1", twoFactorRequired: true, twoFactorVerified: false } }),
    ).toEqual({ kind: "two_factor_required" });
  });

  it("fails closed on the verified half: required with a MISSING or null verified claim is refused", async () => {
    const { assertGivingSession } = await load();
    expect(assertGivingSession({ user: { id: "u1", twoFactorRequired: true } })).toEqual({
      kind: "two_factor_required",
    });
    expect(
      assertGivingSession({ user: { id: "u1", twoFactorRequired: true, twoFactorVerified: null } }),
    ).toEqual({ kind: "two_factor_required" });
  });

  it("admits required-and-verified", async () => {
    const { assertGivingSession } = await load();
    expect(
      assertGivingSession({ user: { id: "u1", twoFactorRequired: true, twoFactorVerified: true } }),
    ).toEqual({ kind: "ok", userId: "u1" });
  });

  it("admits a user who was never flagged (required false, null or missing), verified or not", async () => {
    const { assertGivingSession } = await load();
    for (const user of [
      { id: "u1", twoFactorRequired: false, twoFactorVerified: false },
      { id: "u1", twoFactorRequired: false },
      { id: "u1", twoFactorRequired: null, twoFactorVerified: null },
      { id: "u1" },
    ]) {
      expect(assertGivingSession({ user }), JSON.stringify(user)).toEqual({ kind: "ok", userId: "u1" });
    }
  });
});

describe("givingTotpRedirectUrl (pure)", () => {
  it("builds /totp?callbackUrl=<encoded path>", async () => {
    const { givingTotpRedirectUrl } = await import("./access-pure");
    expect(givingTotpRedirectUrl("/o/alder-creek/admin/giving")).toBe(
      "/totp?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fgiving",
    );
  });

  it("sanitizes the callback: an off-origin or protocol-relative value becomes /launch (open-redirect class)", async () => {
    const { givingTotpRedirectUrl } = await import("./access-pure");
    for (const evil of ["//evil.example/x", "https://evil.example/x", "/\\evil.example", "/.//evil.example"]) {
      expect(givingTotpRedirectUrl(evil), evil).toBe("/totp?callbackUrl=%2Flaunch");
    }
  });
});

describe("giving keys (pure)", () => {
  it("are the three tier-2 keys, one per capability", async () => {
    const { GIVING_KEYS, GIVING_TOGGLE_KEY } = await import("./access-pure");
    expect(GIVING_KEYS).toEqual({
      view: "giving.view",
      record: "giving.record",
      manage: "giving.manage",
    });
    expect(GIVING_TOGGLE_KEY).toBe("org_portal.giving");
  });
});

describe.skipIf(!hasDb)("loadGivingContext (Postgres-backed)", () => {
  let fx: Awaited<ReturnType<typeof import("@/lib/testing/giving-fixture").createGivingFixture>>;
  let loadGivingContext: typeof import("./access").loadGivingContext;
  let loadGivingToggle: typeof import("./access").loadGivingToggle;
  let n = 0;

  beforeAll(async () => {
    ({ loadGivingContext, loadGivingToggle } = await import("./access"));
    const { createGivingFixture } = await import("@/lib/testing/giving-fixture");
    fx = await createGivingFixture("giving-access");
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  /** An org (toggle on/off/absent) and one enrolled person holding `keys`. */
  async function scene(options: {
    type?: "congregation" | "new_worshiping_community" | "presbytery";
    toggle?: boolean | null; // null = no row
    keys?: string[];
  }) {
    n += 1;
    const type = options.type ?? "congregation";
    const organizationId = await fx.makeOrg(`s${n}`, { organizationType: type });
    if (options.toggle !== null && options.toggle !== undefined) {
      await fx.platform.execute(sql`
        insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
        values (${organizationId}, 'org_portal.giving', ${options.toggle}, null)`);
    }
    const personId = await fx.makePerson("Odalys", `Viewer${n}`);
    await fx.enroll(organizationId, personId, options.keys ?? []);
    return { organizationId, personId, organizationType: type };
  }

  it("access.ts re-exports the pure half unchanged (one import site for callers) and its toggle key is in the catalog", async () => {
    const access = await import("./access");
    const pure = await import("./access-pure");
    const { ORG_FEATURE_CATALOG } = await import("@/lib/org-features");
    expect(access.assertGivingSession).toBe(pure.assertGivingSession);
    expect(access.givingTotpRedirectUrl).toBe(pure.givingTotpRedirectUrl);
    expect(access.GIVING_KEYS).toBe(pure.GIVING_KEYS);
    expect(ORG_FEATURE_CATALOG.some((e) => e.key === access.GIVING_TOGGLE_KEY)).toBe(true);
  });

  it("not_applicable for a presbytery WITHOUT touching the database (bogus ids would throw OrgAccessError if it did)", async () => {
    const r = await loadGivingContext({
      personId: "00000000-0000-4000-8000-0000000000a1",
      organizationId: "00000000-0000-4000-8000-0000000000a2",
      organizationType: "presbytery",
    });
    expect(r).toEqual({ kind: "not_applicable" });
  });

  it.each(["synod", "general_assembly"] as const)("not_applicable for a %s", async (organizationType) => {
    const r = await loadGivingContext({
      personId: "00000000-0000-4000-8000-0000000000a1",
      organizationId: "00000000-0000-4000-8000-0000000000a2",
      organizationType,
    });
    expect(r).toEqual({ kind: "not_applicable" });
  });

  it("toggle_off when there is NO toggle row (a missing row is off), reporting canManageFeatures false for a plain member", async () => {
    const s = await scene({ toggle: null, keys: [] });
    expect(await loadGivingContext(s)).toEqual({ kind: "toggle_off", canManageFeatures: false });
  });

  it("toggle_off when the row is explicitly false; canManageFeatures true for an org_features.manage holder", async () => {
    const s = await scene({ toggle: false, keys: ["org_features.manage"] });
    expect(await loadGivingContext(s)).toEqual({ kind: "toggle_off", canManageFeatures: true });
  });

  it("the toggle comes BEFORE the permission: a manage holder at a toggle-off org still gets toggle_off, not ok", async () => {
    const s = await scene({ toggle: false, keys: ["giving.manage", "giving.view"] });
    expect(await loadGivingContext(s)).toEqual({ kind: "toggle_off", canManageFeatures: false });
  });

  it("forbidden when the toggle is on and the viewer holds none of the three keys", async () => {
    const s = await scene({ toggle: true, keys: ["directory.view"] });
    expect(await loadGivingContext(s)).toEqual({ kind: "forbidden" });
  });

  it.each([
    [["giving.view"], { view: true, record: false, manage: false }],
    [["giving.record"], { view: false, record: true, manage: false }],
    [["giving.manage"], { view: false, record: false, manage: true }],
    [["giving.view", "giving.record", "giving.manage"], { view: true, record: true, manage: true }],
  ])("ok with exactly the keys held: %j (no key implies another)", async (keys, has) => {
    const s = await scene({ toggle: true, keys });
    expect(await loadGivingContext(s)).toEqual({ kind: "ok", has });
  });

  it("works for a new worshiping community", async () => {
    const s = await scene({ type: "new_worshiping_community", toggle: true, keys: ["giving.view"] });
    expect(await loadGivingContext(s)).toEqual({
      kind: "ok",
      has: { view: true, record: false, manage: false },
    });
  });

  it("does not leak across orgs: another org's ON toggle does not turn this org's gate on", async () => {
    const on = await scene({ toggle: true, keys: ["giving.view"] });
    const off = await scene({ toggle: null, keys: ["giving.view"] });
    expect((await loadGivingContext(on)).kind).toBe("ok");
    expect((await loadGivingContext(off)).kind).toBe("toggle_off");
  });

  it("a viewer with no membership at the org is genuinely broken, not a gate answer: OrgAccessError, never toggle_off/forbidden", async () => {
    const { OrgAccessError } = await import("@/lib/authz");
    const stranger = await fx.makePerson("Talbot", "Outsider");
    const s = await scene({ toggle: true, keys: [] });
    await expect(
      loadGivingContext({
        personId: stranger, // a person with no membership at this org
        organizationId: s.organizationId,
        organizationType: "congregation",
      }),
    ).rejects.toBeInstanceOf(OrgAccessError);
  });

  describe("loadGivingToggle (the member give gate: toggle only, no key)", () => {
    it("`on` for a plain member with NO giving key - the case loadGivingContext calls forbidden", async () => {
      const s = await scene({ toggle: true, keys: [] });
      expect(await loadGivingContext(s)).toEqual({ kind: "forbidden" });
      expect(await loadGivingToggle(s)).toBe("on");
    });

    it("`toggle_off` for a missing row and for an explicit false, whatever the member holds", async () => {
      expect(await loadGivingToggle(await scene({ toggle: null, keys: [] }))).toBe("toggle_off");
      expect(await loadGivingToggle(await scene({ toggle: false, keys: ["giving.manage"] }))).toBe("toggle_off");
    });

    it("`not_applicable` for a presbytery, without touching the database", async () => {
      expect(
        await loadGivingToggle({
          personId: "00000000-0000-4000-8000-0000000000a1",
          organizationId: "00000000-0000-4000-8000-0000000000a2",
          organizationType: "presbytery",
        }),
      ).toBe("not_applicable");
    });

    it("works for a new worshiping community and does not leak across organizations", async () => {
      const on = await scene({ type: "new_worshiping_community", toggle: true, keys: [] });
      const off = await scene({ toggle: null, keys: [] });
      expect(await loadGivingToggle(on)).toBe("on");
      expect(await loadGivingToggle(off)).toBe("toggle_off");
    });

    it("a viewer with no membership is OrgAccessError, never a gate answer", async () => {
      const { OrgAccessError } = await import("@/lib/authz");
      const stranger = await fx.makePerson("Talbot", "Outsider2");
      const s = await scene({ toggle: true, keys: [] });
      await expect(
        loadGivingToggle({ personId: stranger, organizationId: s.organizationId, organizationType: "congregation" }),
      ).rejects.toBeInstanceOf(OrgAccessError);
    });
  });
});
