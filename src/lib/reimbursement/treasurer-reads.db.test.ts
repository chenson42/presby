/**
 * The treasurer queue reader (`listTreasurerRequests`, `getPayHolderCount`)
 * against a REAL Postgres connection through the application's own path -
 * docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 Copy C7, EC11, EC13, EC16,
 * EC28 and the operator ruling that the date filters mean the organization-local
 * SUBMITTED date. The SQL (tabs, ordering, the key check) is pinned in
 * src/lib/db/domain/reimbursement-definers.db.test.ts; THIS file proves the
 * TypeScript reader over it: the parameters reach the right place, the rows map
 * to the documented shape, a page past the end is empty, and the filters really
 * are organization-local (two organizations 25 hours apart). Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/reimbursement/treasurer-reads.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { ReimbursementFixture } from "@/lib/testing/reimbursement-fixture";
import type { RequestActor } from "./requests";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    REIMBURSEMENT_APPROVED: "tenant.reimbursement.approved",
    REIMBURSEMENT_OVERRIDE_APPROVED: "tenant.reimbursement.override_approved",
    REIMBURSEMENT_RETURNED: "tenant.reimbursement.returned",
    REIMBURSEMENT_NOT_APPROVED: "tenant.reimbursement.not_approved",
    REIMBURSEMENT_PAYMENT_RECORDED: "tenant.reimbursement.payment_recorded",
    REIMBURSEMENT_RECEIPT_WAIVED: "tenant.reimbursement.receipt_waived",
  },
  recordAudit: vi.fn(),
}));
vi.mock("@/lib/email/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/queue")>();
  return { ...actual, attemptQueuedSend: vi.fn(async () => ({ sentInline: true })) };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
const ALL_KEYS = ["reimbursement.request_for_others", "reimbursement.view", "reimbursement.pay", "reimbursement.manage"];

describe.skipIf(!hasDb)("listTreasurerRequests and getPayHolderCount (Postgres-backed)", () => {
  let fx: ReimbursementFixture;
  let reads: typeof import("./reads");
  let requests: typeof import("./requests");
  let decisions: typeof import("./decisions");
  let payments: typeof import("./payments");
  let input: typeof import("./input");

  let A: string;
  let committee: string;
  let session: string;
  let category: string;
  let today: string;
  let requester: RequestActor;
  let beneficiary: { userId: string; personId: string };
  let clerk: RequestActor;
  let chair: RequestActor;
  let t1: RequestActor;
  let t2: RequestActor;
  let payOnly: RequestActor;
  let plain: RequestActor;
  let keySeq = 0;
  const nextKey = () => `tk${Date.now().toString(36)}${(keySeq += 1)}`.padEnd(10, "x");
  const actor = (org: string, m: { userId: string; personId: string }): RequestActor => ({
    userId: m.userId, email: null, personId: m.personId, organizationId: org,
  });
  const ident = (a: RequestActor) => ({ userId: a.userId, personId: a.personId, organizationId: a.organizationId });
  const QUERY = { tab: "all" as const, groupId: null, from: null, to: null, page: 1 };

  function values(over: Record<string, unknown> = {}) {
    return input.saveRequestSchema.parse({
      clientKey: nextKey(), kind: "reimburse", groupId: committee, amountCents: 4150, expenseDate: today,
      purpose: "Paint for the fellowship hall", categoryId: category, noReceiptClaimed: true, ...over,
    });
  }
  async function submit(org: string, who: RequestActor, over: Record<string, unknown> = {}) {
    const saved = await requests.saveRequest(who, values(over));
    if (saved.kind !== "ok") throw new Error(`save failed: ${JSON.stringify(saved)}`);
    const sub = await requests.submitRequest(who, { requestId: saved.requestId, expectedRevision: saved.revision });
    if (sub.kind !== "ok") throw new Error(`submit failed: ${JSON.stringify(sub)}`);
    void org;
    return { requestId: saved.requestId, expectedRevision: sub.revision };
  }
  async function waive(requestId: string) {
    expect(await payments.waiveReceipt(t2, { requestId, note: null })).toEqual({ kind: "ok" });
  }
  const ids = (r: Awaited<ReturnType<typeof reads.listTreasurerRequests>>) => (r.kind === "ok" ? r.items.map((i) => i.id) : []);

  // The ids by role in this fixture.
  const made: Record<string, string> = {};

  beforeAll(async () => {
    const mod = await import("@/lib/testing/reimbursement-fixture");
    fx = await mod.createReimbursementFixture("treads");
    reads = await import("./reads");
    requests = await import("./requests");
    decisions = await import("./decisions");
    payments = await import("./payments");
    input = await import("./input");

    A = await fx.makeOrg("main", { timeZone: "America/New_York", toggle: true });
    committee = await fx.makeGroup(A, "Property Committee");
    session = await fx.derivedGroup(A, "session");
    const people = {
      requester: await fx.member(A, "Requester"),
      beneficiary: await fx.member(A, "Beneficiary"),
      clerk: await fx.member(A, "Clerk"),
      chair: await fx.member(A, "Chair"),
      t1: await fx.member(A, "TreasurerOne"),
      t2: await fx.member(A, "TreasurerTwo"),
      payOnly: await fx.member(A, "Payonly"),
      plain: await fx.member(A, "Plain"),
    };
    requester = actor(A, people.requester);
    beneficiary = people.beneficiary;
    clerk = actor(A, people.clerk);
    chair = actor(A, people.chair);
    t1 = actor(A, people.t1);
    t2 = actor(A, people.t2);
    payOnly = actor(A, people.payOnly);
    plain = actor(A, people.plain);
    await fx.seat(A, committee, people.chair.personId, { role: "chair" });
    await fx.grant(A, await fx.makeRole(A, "t1_like", ALL_KEYS), people.t1.personId);
    await fx.grant(A, await fx.makeRole(A, "t2_like", ["reimbursement.view", "reimbursement.pay"]), people.t2.personId);
    await fx.grant(A, await fx.makeRole(A, "payonly_like", ["reimbursement.pay"]), people.payOnly.personId);
    await fx.grant(A, await fx.makeRole(A, "clerk_like", ["reimbursement.request_for_others"]), people.clerk.personId);
    await fx.chargeable(A, committee, people.t1.userId);
    await fx.chargeable(A, session, people.t1.userId);
    category = await fx.category(A, "Supplies", people.t1.userId);
    today = await reads.getOrgToday(ident(requester));

    // draft (never listed)
    const draft = await requests.saveRequest(requester, values({ purpose: "A draft nobody else may see" }));
    if (draft.kind !== "ok") throw new Error("setup draft");
    made.draft = draft.requestId;
    // progress: submitted with a chair; and returned
    made.progress = (await submit(A, requester, { purpose: "Progress one" })).requestId;
    const ret = await submit(A, requester, { purpose: "Returned one" });
    await decisions.returnRequest(chair, { requestId: ret.requestId, expectedRevision: ret.expectedRevision, kind: "needs_info", reason: "Add the invoice" });
    made.returned = ret.requestId;
    // override: submitted where nobody can approve
    made.override = (await submit(A, requester, { groupId: session, purpose: "Override one" })).requestId;
    // pay: approved by the chair, in order (oldest approved first)
    const first = await submit(A, requester, { purpose: "Pay first" });
    await decisions.approveRequest(chair, { ...first, path: "seat" });
    await new Promise((r) => setTimeout(r, 30));
    const second = await submit(A, requester, { purpose: "Pay second" });
    await decisions.approveRequest(chair, { ...second, path: "seat" });
    made.payFirst = first.requestId;
    made.paySecond = second.requestId;
    // paid
    const paid = await submit(A, requester, { purpose: "Paid one", noReceiptClaimed: true });
    await decisions.approveRequest(chair, { ...paid, path: "seat" });
    await waive(paid.requestId);
    expect(await payments.recordPayment(t1, { requestId: paid.requestId, method: "check", reference: "1042", paidOn: today, note: null })).toMatchObject({ kind: "ok" });
    made.paid = paid.requestId;
    // on behalf, approved by override-ish path is covered in the bundle test; here a clerk entry
    const onBehalf = await submit(A, clerk, { purpose: "Entered by the clerk", beneficiaryPersonId: beneficiary.personId });
    made.onBehalf = onBehalf.requestId;
    // withdrawn (listed in "all" only)
    const gone = await submit(A, requester, { purpose: "Withdrawn one" });
    await requests.withdrawRequest(requester, { requestId: gone.requestId, reason: null });
    made.withdrawn = gone.requestId;
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("the pay tab is approved requests only, OLDEST APPROVED FIRST, with the approval path and names", async () => {
    const r = await reads.listTreasurerRequests(ident(t1), { ...QUERY, tab: "pay" });
    expect(ids(r)).toEqual([made.payFirst, made.paySecond]);
    if (r.kind !== "ok") throw new Error("denied");
    expect(r.total).toBe(2);
    expect(r.items[0]).toMatchObject({
      status: "approved", kind: "reimburse", amountCents: 4150, expenseDate: today, groupName: "Property Committee",
      categoryName: "Supplies", purposeExcerpt: "Pay first", approvalPath: "seat", paidOn: null, enteredOnBehalf: false, revision: expect.any(Number),
    });
    expect(r.items[0]!.payeeLabel).toContain("Requester");
    expect(r.items[0]!.creatorName).toContain("Requester");
    expect(r.items[0]!.approverName).toContain("Chair");
    expect(r.items[0]!.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(r.items[0]!.submittedAt).toMatch(/Z$/);
  });

  it("the override tab is submitted requests with NO eligible approver, computed live; the progress tab is submitted-with-an-approver plus returned", async () => {
    expect(ids(await reads.listTreasurerRequests(ident(t1), { ...QUERY, tab: "override" }))).toEqual([made.override]);
    const progress = ids(await reads.listTreasurerRequests(ident(t1), { ...QUERY, tab: "progress" }));
    expect(new Set(progress)).toEqual(new Set([made.progress, made.returned, made.onBehalf]));
  });

  it("EC11: a seat that ends moves a request from progress to override at once (no stored flag)", async () => {
    const q = await submit(A, requester, { purpose: "Seat will end" });
    expect(ids(await reads.listTreasurerRequests(ident(t1), { ...QUERY, tab: "progress" }))).toContain(q.requestId);
    await fx.q(sql`update group_memberships set ends_on = current_date - 1 where group_id = ${committee} and person_id = ${chair.personId}`);
    try {
      expect(ids(await reads.listTreasurerRequests(ident(t1), { ...QUERY, tab: "override" }))).toContain(q.requestId);
      expect(ids(await reads.listTreasurerRequests(ident(t1), { ...QUERY, tab: "progress" }))).not.toContain(q.requestId);
    } finally {
      await fx.q(sql`update group_memberships set ends_on = null where group_id = ${committee} and person_id = ${chair.personId}`);
    }
    await requests.withdrawRequest(requester, { requestId: q.requestId, reason: null });
  });

  it("the paid tab shows the live payment's date; the all tab is every non-draft request and never a draft", async () => {
    const paid = await reads.listTreasurerRequests(ident(t1), { ...QUERY, tab: "paid" });
    expect(ids(paid)).toEqual([made.paid]);
    if (paid.kind === "ok") expect(paid.items[0]).toMatchObject({ paidOn: today, status: "paid" });
    const all = ids(await reads.listTreasurerRequests(ident(t1), QUERY));
    expect(all).toEqual(expect.arrayContaining([made.progress, made.returned, made.override, made.payFirst, made.paySecond, made.paid, made.onBehalf, made.withdrawn]));
    expect(all).not.toContain(made.draft);
  });

  it("a request entered on someone's behalf carries the badge fact and the clerk's name as creator", async () => {
    const r = await reads.listTreasurerRequests(ident(t1), { ...QUERY, tab: "all" });
    if (r.kind !== "ok") throw new Error("denied");
    const item = r.items.find((i) => i.id === made.onBehalf)!;
    expect(item.enteredOnBehalf).toBe(true);
    expect(item.creatorName).toContain("Clerk");
    expect(item.payeeLabel).toContain("Beneficiary");
  });

  it("a group filter narrows to that group", async () => {
    const r = await reads.listTreasurerRequests(ident(t1), { ...QUERY, groupId: session });
    expect(ids(r)).toEqual([made.override]);
  });

  it("a page past the end is empty with a total of 0; page 1 reports the full filtered total", async () => {
    const first = await reads.listTreasurerRequests(ident(t1), QUERY);
    if (first.kind !== "ok") throw new Error("denied");
    expect(first.total).toBeGreaterThanOrEqual(8);
    expect(first.items.length).toBe(first.total);
    expect(await reads.listTreasurerRequests(ident(t1), { ...QUERY, page: 2 })).toEqual({ kind: "ok", items: [], total: 0 });
  });

  it("the key is `view`: a pay-only holder, a clerk, a chair, a requester and a plain member are denied", async () => {
    for (const who of [payOnly, clerk, chair, requester, plain]) {
      expect(await reads.listTreasurerRequests(ident(who), QUERY), who.userId).toEqual({ kind: "denied" });
    }
  });

  it("a request in another organization never appears (RLS plus the definer's own predicate)", async () => {
    const B = await fx.makeOrg("other", { timeZone: "America/New_York", toggle: true });
    const g = await fx.makeGroup(B, "Elsewhere");
    const r = await fx.member(B, "Otherrequester");
    const tb = await fx.member(B, "Othertreasurer");
    await fx.grant(B, await fx.makeRole(B, "tb_like", ALL_KEYS), tb.personId);
    await fx.chargeable(B, g, tb.userId);
    const saved = await requests.saveRequest(actor(B, r), values({ groupId: g, categoryId: undefined }));
    if (saved.kind !== "ok") throw new Error("setup");
    await requests.submitRequest(actor(B, r), { requestId: saved.requestId, expectedRevision: saved.revision });
    const mine = ids(await reads.listTreasurerRequests(ident(t1), QUERY));
    expect(mine).not.toContain(saved.requestId);
    expect(ids(await reads.listTreasurerRequests(ident(actor(B, tb)), QUERY))).toEqual([saved.requestId]);
  });

  it("EC28: the pay-holder count is the effective holders of `pay` (t1, t2, payOnly) and is a bare number any gated viewer may read", async () => {
    expect(await reads.getPayHolderCount(ident(t1))).toBe(3);
    expect(await reads.getPayHolderCount(ident(plain))).toBe(3);
    const empty = await fx.makeOrg("nopay", { toggle: true });
    const m = await fx.member(empty, "Lonely");
    expect(await reads.getPayHolderCount(ident(actor(empty, m)))).toBe(0);
  });

  describe("the date filters are the organization-LOCAL date a request was submitted", () => {
    // Two organizations 25 hours apart: their local dates always differ, so at
    // least one differs from the UTC date, and a UTC-based filter would miss it.
    const ZONES = ["Pacific/Kiritimati", "Pacific/Pago_Pago"] as const;
    it.each(ZONES)("in %s", async (zone) => {
      const org = await fx.makeOrg(`tz-${zone.slice(8, 12)}`, { timeZone: zone, toggle: true });
      const g = await fx.makeGroup(org, "Zone Committee");
      const r = await fx.member(org, "Zonerequester");
      const t = await fx.member(org, "Zonetreasurer");
      await fx.grant(org, await fx.makeRole(org, "zt_like", ALL_KEYS), t.personId);
      await fx.chargeable(org, g, t.userId);
      const ra = actor(org, r);
      const ta = actor(org, t);
      const local = await reads.getOrgToday(ident(ta));
      const utc = (await fx.q(sql`select (now() at time zone 'UTC')::date::text as d`))[0]!.d as string;
      const saved = await requests.saveRequest(ra, values({ groupId: g, categoryId: undefined, expenseDate: local }));
      if (saved.kind !== "ok") throw new Error(JSON.stringify(saved));
      await requests.submitRequest(ra, { requestId: saved.requestId, expectedRevision: saved.revision });

      expect(ids(await reads.listTreasurerRequests(ident(ta), { ...QUERY, from: local, to: local }))).toEqual([saved.requestId]);
      expect(ids(await reads.listTreasurerRequests(ident(ta), { ...QUERY, from: local }))).toEqual([saved.requestId]);
      const dayBefore = new Date(Date.parse(`${local}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      const dayAfter = new Date(Date.parse(`${local}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      expect(ids(await reads.listTreasurerRequests(ident(ta), { ...QUERY, to: dayBefore }))).toEqual([]);
      expect(ids(await reads.listTreasurerRequests(ident(ta), { ...QUERY, from: dayAfter }))).toEqual([]);
      if (utc !== local) {
        // The UTC date is NOT this organization's submitted date.
        expect(ids(await reads.listTreasurerRequests(ident(ta), { ...QUERY, from: utc, to: utc }))).toEqual([]);
      }
    });
  });
});
