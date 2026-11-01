/**
 * csv-export.ts and the file csv-shape.ts writes from it, against a REAL
 * Postgres connection through the application's own path - docs/work-log/
 * 2026-10-25-treasury-inc1.md, Phase 3 P3-16, DECISION-271, EC37, EC43. The SQL
 * (`presby_reimbursement_export_rows`) is the definer; THIS file proves the
 * TypeScript over it: the read and its audit row share a transaction (a failed
 * audit means no file), the audit carries a row count and the filters and nothing
 * else, the key is `view`, the filters are organization-local SUBMITTED dates, the
 * pre-approver is never in the file, and a hostile purpose is formula-safe in
 * the finished CSV. The 20,000-row cap is `csv-export.cap.db.test.ts`. Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/reimbursement/csv-export.db.test.ts
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { ReimbursementFixture } from "@/lib/testing/reimbursement-fixture";
import type { RequestActor } from "./requests";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    REIMBURSEMENT_APPROVED: "tenant.reimbursement.approved",
    REIMBURSEMENT_RECEIPT_WAIVED: "tenant.reimbursement.receipt_waived",
    REIMBURSEMENT_PAYMENT_RECORDED: "tenant.reimbursement.payment_recorded",
    REIMBURSEMENT_EXPORTED: "tenant.reimbursement.exported",
  },
  recordAudit: vi.fn(),
}));
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
vi.mock("@/lib/email/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/queue")>();
  return { ...actual, attemptQueuedSend: vi.fn(async () => ({ sentInline: true })) };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
const ALL_KEYS = ["reimbursement.request_for_others", "reimbursement.view", "reimbursement.pay", "reimbursement.manage"];
const EXPORTED = "tenant.reimbursement.exported";

describe.skipIf(!hasDb)("exportRequests (Postgres-backed)", () => {
  let fx: ReimbursementFixture;
  let exporter: typeof import("./csv-export");
  let csv: typeof import("./csv-shape");
  let requests: typeof import("./requests");
  let decisions: typeof import("./decisions");
  let payments: typeof import("./payments");
  let reads: typeof import("./reads");
  let input: typeof import("./input");

  let A: string;
  let committee: string;
  let category: string;
  let today: string;
  let requester: RequestActor;
  let chair: RequestActor;
  let t1: RequestActor;
  let payOnly: RequestActor;
  let plain: RequestActor;
  let keySeq = 0;
  const nextKey = () => `ck${Date.now().toString(36)}${(keySeq += 1)}`.padEnd(10, "x");
  const actor = (org: string, m: { userId: string; personId: string }): RequestActor => ({
    userId: m.userId, email: null, personId: m.personId, organizationId: org,
  });
  const made: Record<string, string> = {};
  const exportedRows = (orgId: string) =>
    fx.q(sql`select actor_user_id, resource_type, resource_id, metadata from audit_events
              where action = ${EXPORTED} and (metadata ->> 'organizationId') = ${orgId} order by created_at`);

  function values(over: Record<string, unknown> = {}) {
    return input.saveRequestSchema.parse({
      clientKey: nextKey(), kind: "reimburse", groupId: committee, amountCents: 4150, expenseDate: today,
      purpose: "Paint for the fellowship hall", categoryId: category, noReceiptClaimed: true, ...over,
    });
  }
  async function submit(who: RequestActor, over: Record<string, unknown> = {}) {
    const saved = await requests.saveRequest(who, values(over));
    if (saved.kind !== "ok") throw new Error(`save failed: ${JSON.stringify(saved)}`);
    const sub = await requests.submitRequest(who, { requestId: saved.requestId, expectedRevision: saved.revision });
    if (sub.kind !== "ok") throw new Error(`submit failed: ${JSON.stringify(sub)}`);
    return { requestId: saved.requestId, expectedRevision: sub.revision };
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/reimbursement-fixture");
    fx = await mod.createReimbursementFixture("csvx");
    exporter = await import("./csv-export");
    csv = await import("./csv-shape");
    requests = await import("./requests");
    decisions = await import("./decisions");
    payments = await import("./payments");
    reads = await import("./reads");
    input = await import("./input");

    A = await fx.makeOrg("main", { timeZone: "America/New_York", toggle: true });
    committee = await fx.makeGroup(A, "Property Committee");
    const r = await fx.member(A, "Requester");
    const c = await fx.member(A, "Chair");
    const t = await fx.member(A, "Treasurer");
    const po = await fx.member(A, "Payonly");
    const pl = await fx.member(A, "Plain");
    requester = actor(A, r);
    chair = actor(A, c);
    t1 = actor(A, t);
    payOnly = actor(A, po);
    plain = actor(A, pl);
    await fx.seat(A, committee, c.personId, { role: "chair" });
    await fx.grant(A, await fx.makeRole(A, "t_like", ALL_KEYS), t.personId);
    await fx.grant(A, await fx.makeRole(A, "po_like", ["reimbursement.pay"]), po.personId);
    await fx.chargeable(A, committee, t.userId);
    category = await fx.category(A, "Supplies", t.userId);
    today = await reads.getOrgToday({ userId: r.userId, personId: r.personId, organizationId: A });

    // A draft (never exported), a submitted one, and a paid one with a hostile purpose and a pre-approver.
    const draft = await requests.saveRequest(requester, values({ purpose: "Draft that must not leave" }));
    if (draft.kind !== "ok") throw new Error("setup");
    made.draft = draft.requestId;
    made.submitted = (await submit(requester, { purpose: "Plain purpose, with a comma", preApprovedBy: "Zebediah Pre-Approver" })).requestId;
    const paid = await submit(requester, { purpose: '=HYPERLINK("http://example.invalid","click")', amountCents: 12_550, preApprovedBy: "Zebediah Pre-Approver" });
    await decisions.approveRequest(chair, { ...paid, path: "seat" });
    expect(await payments.waiveReceipt(t1, { requestId: paid.requestId, note: "lost" })).toEqual({ kind: "ok" });
    expect(await payments.recordPayment(t1, { requestId: paid.requestId, method: "check", reference: "1042", paidOn: today, note: "private note" })).toMatchObject({ kind: "ok" });
    made.paid = paid.requestId;
  });

  afterAll(async () => {
    await fx?.cleanup();
  });
  afterEach(() => {
    auditControl.fail = false;
  });

  it("exports every non-draft request with its live payment, oldest first, and writes ONE audit row with the count and the filters only", async () => {
    const before = (await exportedRows(A)).length;
    const result = await exporter.exportRequests(t1, {});
    if (result.kind !== "ok") throw new Error(JSON.stringify(result));
    expect(result.rows.map((r) => r.id)).toEqual([made.submitted, made.paid]);
    expect(result.rows.map((r) => r.id)).not.toContain(made.draft);
    const paid = result.rows.find((r) => r.id === made.paid)!;
    expect(paid).toMatchObject({
      status: "paid", kind: "reimburse", submittedOn: today, expenseDate: today, groupName: "Property Committee",
      categoryName: "Supplies", amountCents: 12_550, approvalPath: "seat", paidOn: today, paymentMethod: "check",
      paymentReference: "1042", selfPaid: false,
    });
    expect(paid.payeeName).toContain("Requester");
    expect(paid.creatorName).toContain("Requester");
    expect(paid.approverName).toContain("Chair");
    expect(paid.payerName).toContain("Treasurer");
    const submitted = result.rows.find((r) => r.id === made.submitted)!;
    expect(submitted).toMatchObject({ status: "submitted", paidOn: null, paymentMethod: null, paymentReference: null, payerName: null, approverName: null, selfPaid: false });

    const rows = await exportedRows(A);
    expect(rows).toHaveLength(before + 1);
    const row = rows.at(-1)!;
    expect(row).toMatchObject({ actor_user_id: t1.userId, resource_type: "reimbursement_export", resource_id: A });
    expect(row.metadata).toEqual({ organizationId: A, rowCount: 2, from: null, to: null, status: null });
    const dump = JSON.stringify(row);
    for (const leak of ["Requester", "Paint", "HYPERLINK", "12550", "125.50", "1042", "Zebediah"]) expect(dump, leak).not.toContain(leak);
  });

  it("the audit records the filters actually applied", async () => {
    const result = await exporter.exportRequests(t1, { from: "2000-01-01", to: "2999-12-31", status: "paid" });
    if (result.kind !== "ok") throw new Error("denied");
    expect(result.rows.map((r) => r.id)).toEqual([made.paid]);
    const row = (await exportedRows(A)).at(-1)!;
    expect(row.metadata).toEqual({ organizationId: A, rowCount: 1, from: "2000-01-01", to: "2999-12-31", status: "paid" });
  });

  it("EC43: the audit row shares the read's transaction - a failing audit means NO file, and nothing was recorded", async () => {
    const before = (await exportedRows(A)).length;
    auditControl.fail = true;
    await expect(exporter.exportRequests(t1, {})).rejects.toThrow(/audit insert failed/);
    auditControl.fail = false;
    expect((await exportedRows(A)).length).toBe(before);
  });

  it("the key is `view`: pay-only, a chair, a requester and a plain member are denied and leave NO audit row", async () => {
    const before = (await exportedRows(A)).length;
    for (const who of [payOnly, chair, requester, plain]) expect(await exporter.exportRequests(who, {}), who.userId).toEqual({ kind: "denied" });
    expect((await exportedRows(A)).length).toBe(before);
  });

  it("a status filter and a date window that match nothing give an empty file (and still an audit row: the export happened)", async () => {
    const result = await exporter.exportRequests(t1, { status: "voided" });
    expect(result).toEqual({ kind: "ok", rows: [] });
    const result2 = await exporter.exportRequests(t1, { from: "2999-01-01" });
    expect(result2).toEqual({ kind: "ok", rows: [] });
  });

  it("EC37: in the finished file a hostile purpose is formula-safe and quoted, the amount is a bare decimal, the purpose is present, and the pre-approver and the note are NOT", async () => {
    const result = await exporter.exportRequests(t1, {});
    if (result.kind !== "ok") throw new Error("denied");
    const file = csv.buildRequestsCsv(result.rows);
    expect(file.split("\r\n")[0]).toBe(csv.CSV_HEADER.join(","));
    expect(file).toContain(`'=HYPERLINK(""http://example.invalid"",""click"")`);
    expect(file).not.toMatch(/(^|,|\r\n)=HYPERLINK/);
    expect(file).toContain('"Plain purpose, with a comma"');
    expect(file).toContain(",125.50,");
    expect(file).toContain(",41.50,");
    for (const absent of ["Zebediah", "Pre-Approver", "private note", "lost"]) expect(file, absent).not.toContain(absent);
    expect(file.endsWith("\r\n")).toBe(true);
  });

  it("another organization's requests are never in the file", async () => {
    const B = await fx.makeOrg("other", { timeZone: "America/New_York", toggle: true });
    const g = await fx.makeGroup(B, "Elsewhere");
    const r = await fx.member(B, "Otherrequester");
    const tb = await fx.member(B, "Othertreasurer");
    await fx.grant(B, await fx.makeRole(B, "tb_like", ALL_KEYS), tb.personId);
    await fx.chargeable(B, g, tb.userId);
    const saved = await requests.saveRequest(actor(B, r), values({ groupId: g, categoryId: undefined }));
    if (saved.kind !== "ok") throw new Error("setup");
    await requests.submitRequest(actor(B, r), { requestId: saved.requestId, expectedRevision: saved.revision });
    const mine = await exporter.exportRequests(t1, {});
    if (mine.kind !== "ok") throw new Error("denied");
    expect(mine.rows.map((x) => x.id)).not.toContain(saved.requestId);
    const theirs = await exporter.exportRequests(actor(B, tb), {});
    if (theirs.kind !== "ok") throw new Error("denied");
    expect(theirs.rows.map((x) => x.id)).toEqual([saved.requestId]);
  });

  describe("the date filters are the organization-LOCAL date a request was submitted", () => {
    it.each(["Pacific/Kiritimati", "Pacific/Pago_Pago"])("in %s", async (zone) => {
      const org = await fx.makeOrg(`tz-${zone.slice(8, 12)}`, { timeZone: zone, toggle: true });
      const g = await fx.makeGroup(org, "Zone Committee");
      const r = await fx.member(org, "Zonerequester");
      const t = await fx.member(org, "Zonetreasurer");
      await fx.grant(org, await fx.makeRole(org, "zt_like", ALL_KEYS), t.personId);
      await fx.chargeable(org, g, t.userId);
      const ra = actor(org, r);
      const ta = actor(org, t);
      const local = await reads.getOrgToday({ userId: t.userId, personId: t.personId, organizationId: org });
      const utc = (await fx.q(sql`select (now() at time zone 'UTC')::date::text as d`))[0]!.d as string;
      const saved = await requests.saveRequest(ra, values({ groupId: g, categoryId: undefined, expenseDate: local }));
      if (saved.kind !== "ok") throw new Error(JSON.stringify(saved));
      await requests.submitRequest(ra, { requestId: saved.requestId, expectedRevision: saved.revision });
      const ids = async (f: { from?: string; to?: string }) => {
        const res = await exporter.exportRequests(ta, f);
        if (res.kind !== "ok") throw new Error("denied");
        return res.rows.map((x) => x.id);
      };
      expect(await ids({ from: local, to: local })).toEqual([saved.requestId]);
      expect((await exporter.exportRequests(ta, { from: local, to: local }) as { rows: Array<{ submittedOn: string }> }).rows[0]!.submittedOn).toBe(local);
      if (utc !== local) expect(await ids({ from: utc, to: utc })).toEqual([]);
    });
  });
});
