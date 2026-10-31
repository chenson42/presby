/**
 * config.ts, access.ts, counts.ts and the Features-page off-warning, against a
 * REAL Postgres connection - docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * (config, P3-4, P3-15, P3-20), Copy C1, Edge Cases EC26, EC27, EC30, EC43.
 * Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/reimbursement/config.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { ReimbursementFixture } from "@/lib/testing/reimbursement-fixture";
import type { RequestActor } from "./requests";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

// access.ts -> org-features.ts -> @/lib/audit -> @/auth -> next-auth, which this
// test environment cannot resolve; the keys below are the ones these modules read.
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled",
    REIMBURSEMENT_CHARGEABLE_CHANGED: "tenant.reimbursement.chargeable_changed",
    REIMBURSEMENT_CATEGORY_CHANGED: "tenant.reimbursement.category_changed",
  },
  recordAudit: vi.fn(),
}));

// The REAL insertAuditRow, except a test can force it to throw to prove the
// whole act rolls back with it (P3-20: the audit row shares the transaction).
const auditControl = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return {
    ...actual,
    insertAuditRow: async (...args: Parameters<typeof actual.insertAuditRow>) => {
      if (auditControl.fail) throw new Error("audit insert failed (test-injected)");
      return actual.insertAuditRow(...args);
    },
  };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
const ALL_KEYS = ["reimbursement.request_for_others", "reimbursement.view", "reimbursement.pay", "reimbursement.manage"];

describe.skipIf(!hasDb)("config.ts, access.ts, counts.ts (Postgres-backed)", () => {
  let fx: ReimbursementFixture;
  let config: typeof import("./config");
  let access: typeof import("./access");
  let counts: typeof import("./counts");
  let warnings: typeof import("@/lib/org-feature-warnings");
  let requests: typeof import("./requests");
  let input: typeof import("./input");
  let reads: typeof import("./reads");

  let A: string;
  let committee: string;
  let manager: RequestActor;
  let payOnly: RequestActor;
  let plain: RequestActor;
  let featuresAdmin: RequestActor;
  let requester: RequestActor;
  let treasurer: RequestActor;

  const actor = (org: string, m: { userId: string; personId: string }): RequestActor => ({
    userId: m.userId, email: `${m.userId}@example.invalid`, personId: m.personId, organizationId: org,
  });

  const auditRows = (action: string, resourceId: string) =>
    fx.q(sql`select actor_user_id, resource_type, resource_id, metadata from audit_events where action = ${action} and resource_id = ${resourceId}`);

  beforeAll(async () => {
    const mod = await import("@/lib/testing/reimbursement-fixture");
    fx = await mod.createReimbursementFixture("config");
    config = await import("./config");
    access = await import("./access");
    counts = await import("./counts");
    warnings = await import("@/lib/org-feature-warnings");
    requests = await import("./requests");
    input = await import("./input");
    reads = await import("./reads");

    A = await fx.makeOrg("main", { toggle: true });
    committee = await fx.makeGroup(A, "Finance Committee");
    manager = actor(A, await fx.member(A, "Manager"));
    payOnly = actor(A, await fx.member(A, "PayOnly"));
    plain = actor(A, await fx.member(A, "Plain"));
    featuresAdmin = actor(A, await fx.member(A, "Features"));
    requester = actor(A, await fx.member(A, "Requester"));
    treasurer = actor(A, await fx.member(A, "Treasurer"));
    await fx.grant(A, await fx.makeRole(A, "manager_only", ["reimbursement.manage"]), manager.personId);
    await fx.grant(A, await fx.makeRole(A, "pay_only", ["reimbursement.pay"]), payOnly.personId);
    await fx.grant(A, await fx.makeRole(A, "features_admin", ["org_features.manage"]), featuresAdmin.personId); // NO money key
    await fx.grant(A, await fx.makeRole(A, "treasurer_like", ALL_KEYS), treasurer.personId);
    await fx.chargeable(A, committee, treasurer.userId);
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  // =========================================================================
  describe("setChargeable", () => {
    it("lists a group, writes one audit row in the same transaction (ids and a flag only), and is idempotent", async () => {
      const g = await fx.makeGroup(A, "Hospitality");
      expect(await config.setChargeable(manager, { groupId: g, chargeable: true })).toEqual({ kind: "ok", changed: true });
      const rows = await auditRows("tenant.reimbursement.chargeable_changed", g);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor_user_id: manager.userId,
        resource_type: "reimbursement_group",
        metadata: { organizationId: A, groupId: g, chargeable: true },
      });
      // the same again: nothing changed, so NO second audit row
      expect(await config.setChargeable(manager, { groupId: g, chargeable: true })).toEqual({ kind: "ok", changed: false });
      expect(await auditRows("tenant.reimbursement.chargeable_changed", g)).toHaveLength(1);
    });

    it("un-listing ends the row (never deletes it); listing again opens a new one; both are audited", async () => {
      const g = await fx.makeGroup(A, "Hospitality Two");
      await config.setChargeable(manager, { groupId: g, chargeable: true });
      expect(await config.setChargeable(manager, { groupId: g, chargeable: false })).toEqual({ kind: "ok", changed: true });
      const [ended] = await fx.q(sql`select ended_at is not null as ended, ended_by_user from reimbursement_chargeable_groups where group_id = ${g}`);
      expect(ended).toMatchObject({ ended: true, ended_by_user: manager.userId });
      expect(await config.setChargeable(manager, { groupId: g, chargeable: true })).toEqual({ kind: "ok", changed: true });
      expect(await fx.q(sql`select 1 from reimbursement_chargeable_groups where group_id = ${g}`)).toHaveLength(2);
      expect((await auditRows("tenant.reimbursement.chargeable_changed", g)).map((r) => (r.metadata as { chargeable: boolean }).chargeable)).toEqual([true, false, true]);
    });

    it("a derived group (the Session) may be chargeable: its requests take the treasurer path (operator Q5)", async () => {
      const session = await fx.derivedGroup(A, "session");
      expect(await config.setChargeable(manager, { groupId: session, chargeable: true })).toEqual({ kind: "ok", changed: true });
    });

    it("a group of another organization or an unknown id is group_unavailable", async () => {
      const B = await fx.makeOrg("other");
      const foreign = await fx.makeGroup(B, "Foreign");
      expect(await config.setChargeable(manager, { groupId: foreign, chargeable: true })).toEqual({ kind: "refused", outcome: "group_unavailable" });
      expect(await config.setChargeable(manager, { groupId: "99999999-9999-4999-8999-999999999999", chargeable: true })).toEqual({
        kind: "refused",
        outcome: "group_unavailable",
      });
    });

    it("needs reimbursement.manage: a pay-only holder, a features admin and a plain member are denied, and nothing is written", async () => {
      const g = await fx.makeGroup(A, "Denied Group");
      for (const who of [payOnly, featuresAdmin, plain]) {
        expect(await config.setChargeable(who, { groupId: g, chargeable: true })).toEqual({ kind: "denied" });
      }
      expect(await fx.q(sql`select 1 from reimbursement_chargeable_groups where group_id = ${g}`)).toHaveLength(0);
      expect(await auditRows("tenant.reimbursement.chargeable_changed", g)).toHaveLength(0);
    });

    it("P3-20: if the audit insert fails the change rolls back with it - there is no change without its audit row", async () => {
      const g = await fx.makeGroup(A, "Atomic Group");
      auditControl.fail = true;
      try {
        await expect(config.setChargeable(manager, { groupId: g, chargeable: true })).rejects.toThrow("audit insert failed");
      } finally {
        auditControl.fail = false;
      }
      expect(await fx.q(sql`select 1 from reimbursement_chargeable_groups where group_id = ${g}`)).toHaveLength(0);
    });
  });

  // =========================================================================
  describe("categories", () => {
    it("create, rename and retire, each audited with an id and a tag - never the name", async () => {
      const made = await config.saveCategory(manager, { categoryId: null, name: "  Flowers  ", sortOrder: 5 });
      expect(made).toMatchObject({ kind: "ok", created: true });
      if (made.kind !== "ok") return;
      const [stored] = await fx.q(sql`select name, sort_order from reimbursement_categories where id = ${made.categoryId}`);
      expect(stored).toMatchObject({ name: "Flowers", sort_order: 5 });

      const renamed = await config.saveCategory(manager, { categoryId: made.categoryId, name: "Altar flowers", sortOrder: null });
      expect(renamed).toEqual({ kind: "ok", categoryId: made.categoryId, created: false });
      expect(await config.endCategory(manager, { categoryId: made.categoryId })).toEqual({ kind: "ok" });

      const rows = await auditRows("tenant.reimbursement.category_changed", made.categoryId);
      expect(rows.map((r) => (r.metadata as { change: string }).change)).toEqual(["created", "renamed", "retired"]);
      expect(JSON.stringify(rows)).not.toMatch(/Flowers|Altar/);
    });

    it("names: 1 to 60 characters after cleaning, unique case-insensitively among live ones", async () => {
      await config.saveCategory(manager, { categoryId: null, name: "Music", sortOrder: null });
      expect(await config.saveCategory(manager, { categoryId: null, name: "music", sortOrder: null })).toEqual({ kind: "refused", outcome: "name_taken" });
      expect(await config.saveCategory(manager, { categoryId: null, name: "   ", sortOrder: null })).toEqual({ kind: "refused", outcome: "name_invalid" });
      expect(await config.saveCategory(manager, { categoryId: null, name: "x".repeat(61), sortOrder: null })).toEqual({ kind: "refused", outcome: "name_invalid" });
      expect(await config.saveCategory(manager, { categoryId: null, name: "x".repeat(60), sortOrder: null })).toMatchObject({ kind: "ok" });
    });

    it("a retired category's name can be used again; an unknown or retired id is not_found", async () => {
      const made = await config.saveCategory(manager, { categoryId: null, name: "Seasonal", sortOrder: null });
      if (made.kind !== "ok") throw new Error("setup");
      await config.endCategory(manager, { categoryId: made.categoryId });
      expect(await config.saveCategory(manager, { categoryId: null, name: "Seasonal", sortOrder: null })).toMatchObject({ kind: "ok" });
      expect(await config.saveCategory(manager, { categoryId: made.categoryId, name: "Renamed", sortOrder: null })).toEqual({ kind: "refused", outcome: "not_found" });
      expect(await config.endCategory(manager, { categoryId: made.categoryId })).toEqual({ kind: "refused", outcome: "not_found" });
      expect(await config.endCategory(manager, { categoryId: "99999999-9999-4999-8999-999999999999" })).toEqual({ kind: "refused", outcome: "not_found" });
    });

    it("needs reimbursement.manage", async () => {
      for (const who of [payOnly, plain]) {
        expect(await config.saveCategory(who, { categoryId: null, name: "Nope", sortOrder: null })).toEqual({ kind: "denied" });
      }
      expect(await config.endCategory(plain, { categoryId: "99999999-9999-4999-8999-999999999999" })).toEqual({ kind: "denied" });
    });

    it("a retired category drops off the form but stays on the request that holds it (P3-4)", async () => {
      const made = await config.saveCategory(manager, { categoryId: null, name: "Short-lived", sortOrder: null });
      if (made.kind !== "ok") throw new Error("setup");
      const today = await reads.getOrgToday(requester);
      const saved = await requests.saveRequest(requester, input.saveRequestSchema.parse({
        clientKey: `cfg${Date.now().toString(36)}xx`, kind: "reimburse", groupId: committee, amountCents: 100, expenseDate: today,
        purpose: "Held", categoryId: made.categoryId, noReceiptClaimed: true,
      }));
      if (saved.kind !== "ok") throw new Error("setup");
      await config.endCategory(manager, { categoryId: made.categoryId });
      expect((await reads.getFormOptions(requester)).categories.map((c) => c.id)).not.toContain(made.categoryId);
      const detail = await reads.getRequestDetail(requester, saved.requestId, "member");
      expect(detail.kind === "ok" && detail.detail.category).toEqual({ id: made.categoryId, name: "Short-lived", retired: true });
    });
  });

  // =========================================================================
  describe("loadReimbursementContext (the toggle is TypeScript-only, P3-15)", () => {
    const viewerOf = (a: RequestActor, organizationType: "congregation" | "presbytery" | "new_worshiping_community" = "congregation") => ({
      personId: a.personId, organizationId: a.organizationId, organizationType,
    });

    it("toggle on: the viewer's four keys, read live, none implying another", async () => {
      expect(await access.loadReimbursementContext(viewerOf(treasurer))).toEqual({
        kind: "ok", has: { requestForOthers: true, view: true, pay: true, manage: true },
      });
      expect(await access.loadReimbursementContext(viewerOf(payOnly))).toEqual({
        kind: "ok", has: { requestForOthers: false, view: false, pay: true, manage: false },
      });
      expect(await access.loadReimbursementContext(viewerOf(plain))).toEqual({
        kind: "ok", has: { requestForOthers: false, view: false, pay: false, manage: false },
      });
    });

    it("a missing toggle row is OFF, and the answer says whether this viewer may turn it on (org_features.manage)", async () => {
      const off = await fx.makeOrg("off");
      const admin = actor(off, await fx.member(off, "OffAdmin"));
      const other = actor(off, await fx.member(off, "OffMember"));
      await fx.grant(off, await fx.makeRole(off, "features_admin", ["org_features.manage"]), admin.personId);
      expect(await access.loadReimbursementContext(viewerOf(admin))).toEqual({ kind: "toggle_off", canManageFeatures: true });
      expect(await access.loadReimbursementContext(viewerOf(other))).toEqual({ kind: "toggle_off", canManageFeatures: false });
      await fx.setToggle(off, false);
      expect(await access.loadReimbursementContext(viewerOf(other))).toEqual({ kind: "toggle_off", canManageFeatures: false });
    });

    it("EC26: turning it on restores access; nothing was deleted by it being off", async () => {
      const cycle = await fx.makeOrg("cycle", { toggle: true });
      const m = actor(cycle, await fx.member(cycle, "Cycler"));
      expect((await access.loadReimbursementContext(viewerOf(m))).kind).toBe("ok");
      await fx.setToggle(cycle, false);
      expect((await access.loadReimbursementContext(viewerOf(m))).kind).toBe("toggle_off");
      await fx.setToggle(cycle, true);
      expect((await access.loadReimbursementContext(viewerOf(m))).kind).toBe("ok");
    });

    it("EC27: a presbytery, synod or GA is not_applicable no matter what row exists", async () => {
      const presbytery = await fx.makeOrg("presbytery", { type: "presbytery", toggle: true });
      const m = actor(presbytery, await fx.member(presbytery, "Moderator"));
      expect(await access.loadReimbursementContext(viewerOf(m, "presbytery"))).toEqual({ kind: "not_applicable" });
    });

    it("a new worshiping community is applicable, exactly like Giving", async () => {
      const nwc = await fx.makeOrg("nwc", { type: "new_worshiping_community", toggle: true });
      const m = actor(nwc, await fx.member(nwc, "Planter"));
      expect((await access.loadReimbursementContext(viewerOf(m, "new_worshiping_community"))).kind).toBe("ok");
    });

    it("a membership that ended between the resolve and the transaction throws (genuinely broken, not 'off')", async () => {
      const gone = await fx.makeOrg("gone", { toggle: true });
      const m = await fx.member(gone, "Departed");
      await fx.q(sql`update memberships set ended_on = current_date - 1, ended_reason = 'test' where organization_id = ${gone} and person_id = ${m.personId}`);
      await expect(access.loadReimbursementContext(viewerOf(actor(gone, m)))).rejects.toThrow();
    });
  });

  // =========================================================================
  describe("openRequestCount, payHolderCount and the Features-page off-warning (Copy C1)", () => {
    let wOrg: string;
    let wGroup: string;
    let wReq: RequestActor;
    let wAdmin: RequestActor;
    const mk = (a: RequestActor, today: string) =>
      input.saveRequestSchema.parse({
        clientKey: `wrn${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`.padEnd(10, "x"),
        kind: "reimburse", groupId: wGroup, amountCents: 100, expenseDate: today, purpose: "Stamps", noReceiptClaimed: true,
      });
    const countOpen = async (a: RequestActor) =>
      (await import("@/lib/authz")).withOrgContext(a.personId, a.organizationId, (tx) => counts.openRequestCount(tx));
    const countPay = async (a: RequestActor) =>
      (await import("@/lib/authz")).withOrgContext(a.personId, a.organizationId, (tx) => counts.payHolderCount(tx));

    beforeAll(async () => {
      wOrg = await fx.makeOrg("warn", { toggle: true });
      wGroup = await fx.makeGroup(wOrg, "Office");
      wReq = actor(wOrg, await fx.member(wOrg, "WarnRequester"));
      wAdmin = actor(wOrg, await fx.member(wOrg, "WarnAdmin"));
      await fx.grant(wOrg, await fx.makeRole(wOrg, "features_admin", ["org_features.manage"]), wAdmin.personId); // NO money key
      await fx.chargeable(wOrg, wGroup, wReq.userId);
    });

    it("an organization with no requests has no warning and no pay holder", async () => {
      expect(await countOpen(wAdmin)).toBe(0);
      expect(await countPay(wAdmin)).toBe(0);
      expect(await warnings.loadOffWarnings(wAdmin.personId, wOrg, ["org_portal.reimbursement"])).toEqual({});
    });

    it("drafts are not 'open'; a submitted request is, and the warning is readable by an org_features.manage holder with no money key", async () => {
      const today = await reads.getOrgToday(wReq);
      const draft = await requests.saveRequest(wReq, mk(wReq, today));
      const sent = await requests.saveRequest(wReq, mk(wReq, today));
      if (draft.kind !== "ok" || sent.kind !== "ok") throw new Error("setup");
      expect(await countOpen(wAdmin)).toBe(0);
      await requests.submitRequest(wReq, { requestId: sent.requestId, expectedRevision: 1 });
      expect(await countOpen(wAdmin)).toBe(1);
      expect(await warnings.loadOffWarnings(wAdmin.personId, wOrg, ["org_portal.reimbursement"])).toEqual({
        "org_portal.reimbursement": {
          title: "Reimbursement requests are still open",
          description:
            "1 request is open (waiting for approval, for the requester, or for payment). Turning this off hides the pages and nothing is deleted. Turning it back on restores everything.",
        },
      });
    });

    it("two open requests read in the plural; withdrawn ones stop counting", async () => {
      const today = await reads.getOrgToday(wReq);
      const second = await requests.saveRequest(wReq, mk(wReq, today));
      if (second.kind !== "ok") throw new Error("setup");
      await requests.submitRequest(wReq, { requestId: second.requestId, expectedRevision: 1 });
      const two = await warnings.loadOffWarnings(wAdmin.personId, wOrg, ["org_portal.reimbursement"]);
      expect(two["org_portal.reimbursement"]?.description).toMatch(/^2 requests are open \(waiting for approval, for the requester, or for payment\)\. /);
      await requests.withdrawRequest(wReq, { requestId: second.requestId, reason: null });
      expect(await countOpen(wAdmin)).toBe(1);
    });

    it("the pay-holder count is a bare count any member of the organization can read, and counts effective holders only", async () => {
      expect(await countPay(wAdmin)).toBe(0);
      const payer = actor(wOrg, await fx.member(wOrg, "WarnPayer"));
      await fx.grant(wOrg, await fx.makeRole(wOrg, "pay_only", ["reimbursement.pay"]), payer.personId);
      expect(await countPay(wAdmin)).toBe(1);
      expect(await countPay(wReq)).toBe(1);
    });

    it("a stranger to the organization is rejected, never answered with a count", async () => {
      const outsider = await fx.member(A, "Outsider");
      await expect(warnings.loadOffWarnings(outsider.personId, wOrg, ["org_portal.reimbursement"])).rejects.toThrow();
    });
  });
});
