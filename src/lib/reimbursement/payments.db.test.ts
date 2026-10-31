/**
 * payments.ts (record a payment, reverse it, waive the receipt, void, add a note)
 * against a REAL Postgres connection through the application's own path
 * (`withOrgContext` on presby_app, RLS enforced) - docs/work-log/2026-10-25-
 * treasury-inc1.md, Phase 3 EC8, EC9, EC12, EC22, EC32, EC43, P3-7, P3-20. The SQL
 * half (the triggers, the definers' state rules) is pinned in
 * src/lib/db/domain/reimbursement*.db.test.ts; THIS file proves the TypeScript
 * layer over it: the audit row in the same transaction, the notice in the same
 * transaction, who is told and who is not, the sends after commit, the result
 * mapping, and that the receipt requirement is enforced through the definers with
 * "who may pay" checked BEFORE "what is missing". Receipts here are
 * `reimbursement_attachments` rows made through the attach definer on a fixture
 * blob (Batch 1a's way); the blob adapter is Batch 2b's and is not used. Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/reimbursement/payments.db.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { ReimbursementFixture } from "@/lib/testing/reimbursement-fixture";
import type { RequestActor } from "./requests";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

// @/lib/audit -> @/auth -> next-auth cannot resolve in this environment; these are the real keys.
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    REIMBURSEMENT_APPROVED: "tenant.reimbursement.approved",
    REIMBURSEMENT_OVERRIDE_APPROVED: "tenant.reimbursement.override_approved",
    REIMBURSEMENT_RETURNED: "tenant.reimbursement.returned",
    REIMBURSEMENT_NOT_APPROVED: "tenant.reimbursement.not_approved",
    REIMBURSEMENT_VOIDED: "tenant.reimbursement.voided",
    REIMBURSEMENT_PAYMENT_RECORDED: "tenant.reimbursement.payment_recorded",
    REIMBURSEMENT_PAYMENT_REVERSED: "tenant.reimbursement.payment_reversed",
    REIMBURSEMENT_RECEIPT_WAIVED: "tenant.reimbursement.receipt_waived",
  },
  recordAudit: vi.fn(),
}));

// The REAL insertAuditRow, except a test can force it to throw to prove the whole act rolls back with it.
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

// The REAL queue insert; the post-commit send is a spy (nothing leaves the machine).
const sent = vi.hoisted(() => ({ spy: vi.fn(async (_id: string) => ({ sentInline: true })) }));
vi.mock("@/lib/email/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/queue")>();
  return { ...actual, attemptQueuedSend: sent.spy };
});

// The REAL platform origin, except a test can make it null (a misconfigured production).
const originControl = vi.hoisted(() => ({ none: false }));
vi.mock("@/lib/domains/host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/domains/host")>();
  return { ...actual, platformOrigin: () => (originControl.none ? null : actual.platformOrigin()) };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
const ALL_KEYS = ["reimbursement.request_for_others", "reimbursement.view", "reimbursement.pay", "reimbursement.manage"];
const PAY_KEYS = ["reimbursement.view", "reimbursement.pay"];

describe.skipIf(!hasDb)("payments.ts (Postgres-backed)", () => {
  let fx: ReimbursementFixture;
  let payments: typeof import("./payments");
  let decisions: typeof import("./decisions");
  let requests: typeof import("./requests");
  let input: typeof import("./input");
  let reads: typeof import("./reads");
  let dates: typeof import("./dates");

  let A: string;
  let committee: string;
  let category: string;
  let today: string;

  let requester: RequestActor;
  let chair: RequestActor;
  let treasurer: RequestActor;
  let payer2: RequestActor;
  let viewer: RequestActor;
  let plain: RequestActor;
  const mail: Record<string, string> = {};

  let keySeq = 0;
  const nextKey = () => `pk${Date.now().toString(36)}${(keySeq += 1)}`.padEnd(10, "x");
  const actor = (org: string, m: { userId: string; personId: string }): RequestActor => ({
    userId: m.userId, email: `${m.userId}@example.invalid`, personId: m.personId, organizationId: org,
  });

  function values(over: Record<string, unknown> = {}) {
    return input.saveRequestSchema.parse({
      clientKey: nextKey(), kind: "reimburse", groupId: committee, amountCents: 4150, expenseDate: today,
      purpose: "Paint for the fellowship hall", categoryId: category, noReceiptClaimed: true, ...over,
    });
  }

  /** A receipt the way Batch 1a's fixture makes one: a stored blob, attached through the attach definer. */
  async function attach(org: string, who: RequestActor, requestId: string): Promise<void> {
    const b = await fx.blob(org);
    const out = (await fx.app(org, sql`select * from presby_reimbursement_attach_receipt(${requestId}::uuid, ${b.id}::uuid,
      ${b.sha}, 'image/jpeg', 3, 'receipt.jpg', ${who.userId}::uuid)`))[0]!;
    expect(out.outcome, JSON.stringify(out)).toBe("ok");
  }

  /** A submitted request by `who` in `groupId`; `receipt` attaches one (else the no-receipt claim). */
  async function submitted(
    org: string, who: RequestActor, over: { groupId?: string; receipt?: boolean } & Record<string, unknown> = {},
  ) {
    const { groupId, receipt, ...rest } = over;
    const saved = await requests.saveRequest(who, values({ groupId: groupId ?? committee, noReceiptClaimed: !receipt, ...rest }));
    if (saved.kind !== "ok") throw new Error(`save failed: ${JSON.stringify(saved)}`);
    let revision = saved.revision;
    if (receipt) {
      await attach(org, who, saved.requestId);
      revision += 1;
    }
    const sub = await requests.submitRequest(who, { requestId: saved.requestId, expectedRevision: revision });
    if (sub.kind !== "ok") throw new Error(`submit failed: ${JSON.stringify(sub)}`);
    return { requestId: saved.requestId, expectedRevision: sub.revision };
  }

  /** Submitted, then approved by the group's chair on the seat path. */
  async function approvedBySeat(over: Parameters<typeof submitted>[2] = {}, who: RequestActor = requester) {
    const req = await submitted(A, who, over);
    const r = await decisions.approveRequest(chair, { ...req, path: "seat" });
    if (r.kind !== "ok") throw new Error(`approve failed: ${JSON.stringify(r)}`);
    return req;
  }

  const pay = (who: RequestActor, requestId: string, over: Partial<{ method: "check" | "ach" | "cash" | "other"; reference: string | null; paidOn: string; note: string | null }> = {}) =>
    payments.recordPayment(who, { requestId, method: "ach", reference: "conf 8841", paidOn: today, note: null, ...over });

  const state = async (requestId: string) =>
    (await fx.q(sql`select status, receipt_waived_at, approval_path from reimbursement_requests where id = ${requestId}`))[0]!;
  const events = (requestId: string) =>
    fx.q(sql`select kind, from_status, to_status, note, actor_user_id from reimbursement_events where request_id = ${requestId} order by seq`);
  const paymentRows = (requestId: string) =>
    fx.q(sql`select kind, method, reference, paid_on::text as paid_on, amount_cents, paid_by_user, self_paid, offsets_payment_id, reason, note
               from reimbursement_payments where request_id = ${requestId} order by created_at, id`);
  const auditRows = (action: string, requestId: string) =>
    fx.q(sql`select actor_user_id, resource_type, resource_id, metadata from audit_events where action = ${action} and resource_id = ${requestId}`);
  async function noticesFor(requestId: string, templateKey?: string) {
    const rows = await fx.queued(Object.values(mail));
    return rows.filter((r) => String(r.text_body).includes(requestId) && (!templateKey || r.template_key === templateKey));
  }
  const REQUESTER_UPDATE = "reimbursement.notice.requester_update";

  beforeAll(async () => {
    const mod = await import("@/lib/testing/reimbursement-fixture");
    fx = await mod.createReimbursementFixture("pay");
    payments = await import("./payments");
    decisions = await import("./decisions");
    requests = await import("./requests");
    input = await import("./input");
    reads = await import("./reads");
    dates = await import("./dates");

    A = await fx.makeOrg("main", { timeZone: "America/New_York", toggle: true });
    committee = await fx.makeGroup(A, "Property Committee");
    const r = await fx.member(A, "Requester");
    const c = await fx.member(A, "Chair");
    const t = await fx.member(A, "Treasurer");
    const p2 = await fx.member(A, "Payertwo");
    const v = await fx.member(A, "Viewer");
    const pl = await fx.member(A, "Plain");
    requester = actor(A, r);
    chair = actor(A, c);
    treasurer = actor(A, t);
    payer2 = actor(A, p2);
    viewer = actor(A, v);
    plain = actor(A, pl);

    await fx.seat(A, committee, c.personId, { role: "chair" });
    await fx.grant(A, await fx.makeRole(A, "treasurer_like", ALL_KEYS), t.personId);
    await fx.grant(A, await fx.makeRole(A, "payer_like", PAY_KEYS), p2.personId);
    await fx.grant(A, await fx.makeRole(A, "viewer_like", ["reimbursement.view"]), v.personId);
    await fx.chargeable(A, committee, t.userId);
    await fx.chargeable(A, await fx.derivedGroup(A, "session"), t.userId); // no chair or leader: the override path
    category = await fx.category(A, "Supplies", t.userId);
    for (const [tag, m] of Object.entries({ requester: r, chair: c, treasurer: t, payer2: p2, viewer: v })) {
      mail[tag] = await fx.email(m.personId, tag, { subtype: "work" });
    }
    today = await reads.getOrgToday({ userId: r.userId, personId: r.personId, organizationId: A });
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  beforeEach(() => {
    sent.spy.mockClear();
    auditControl.fail = false;
    originControl.none = false;
  });
  afterEach(() => {
    auditControl.fail = false;
    originControl.none = false;
  });

  // =========================================================================
  describe("recordPayment", () => {
    it("EC32: the payment row and the paid status arrive together, with one history event; the amount is a snapshot of the request", async () => {
      const req = await approvedBySeat({ receipt: true });
      const result = await pay(treasurer, req.requestId, { method: "check", reference: "1042", note: "Mailed Monday" });
      expect(result).toMatchObject({ kind: "ok", selfPaid: false });
      expect((await state(req.requestId)).status).toBe("paid");
      expect(await paymentRows(req.requestId)).toEqual([
        expect.objectContaining({ kind: "payment", method: "check", reference: "1042", paid_on: today, amount_cents: 4150, paid_by_user: treasurer.userId, self_paid: false, note: "Mailed Monday" }),
      ]);
      expect((await events(req.requestId)).map((e) => e.kind)).toEqual(["created", "submitted", "approved", "payment_recorded"]);
    });

    it("EC43/P3-20: writes ONE audit row in the same transaction - ids and tags only, never the reference, the note, a name or an amount", async () => {
      const req = await approvedBySeat({ receipt: true });
      await pay(treasurer, req.requestId, { method: "check", reference: "1042-secret", note: "private note" });
      const rows = await auditRows("tenant.reimbursement.payment_recorded", req.requestId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actor_user_id: treasurer.userId, resource_type: "reimbursement_request" });
      expect(rows[0]!.metadata).toEqual({ organizationId: A, requestId: req.requestId, method: "check", selfPaid: false });
      const dump = JSON.stringify(rows[0]);
      for (const secret of ["1042-secret", "private note", "4150", "41.50", "Paint", "Quillfeather"]) expect(dump).not.toContain(secret);
    });

    it("EC43: a failing audit insert rolls the payment, its status flip, its history event and its notice ALL back", async () => {
      const req = await approvedBySeat({ receipt: true });
      sent.spy.mockClear();
      auditControl.fail = true;
      await expect(pay(treasurer, req.requestId)).rejects.toThrow(/audit insert failed/);
      auditControl.fail = false;
      expect((await state(req.requestId)).status).toBe("approved");
      expect(await paymentRows(req.requestId)).toEqual([]);
      expect((await events(req.requestId)).map((e) => e.kind)).toEqual(["created", "submitted", "approved"]);
      expect(await noticesFor(req.requestId, REQUESTER_UPDATE).then((r) => r.filter((n) => String(n.subject).includes("paid")))).toEqual([]);
      expect(sent.spy).not.toHaveBeenCalled();
    });

    it("tells the requester - and only the requester - that a payment was recorded, with no money, name or date in it; the send happens after commit", async () => {
      const req = await approvedBySeat({ receipt: true });
      sent.spy.mockClear();
      await pay(treasurer, req.requestId);
      const rows = (await noticesFor(req.requestId, REQUESTER_UPDATE)).filter((r) => r.subject === "Your reimbursement request was paid");
      expect(rows.map((r) => r.to_email)).toEqual([mail.requester]);
      const body = `${rows[0]!.subject}\n${rows[0]!.html_body}\n${rows[0]!.text_body}`;
      expect(body).toContain("A payment has been recorded for it.");
      expect(body).toContain(`/o/`);
      expect(body).toContain(`/reimbursements/${req.requestId}`);
      expect(body).not.toContain("/admin/");
      for (const leak of ["41.50", "4150", "Paint", "ach", "conf 8841", "Property Committee", today]) expect(body, leak).not.toContain(leak);
      expect(sent.spy).toHaveBeenCalledTimes(1);
      expect(sent.spy).toHaveBeenCalledWith(String(rows[0]!.id));
    });

    it("EC22: a misconfigured platform origin writes no notice and the payment still commits", async () => {
      const req = await approvedBySeat({ receipt: true });
      sent.spy.mockClear();
      originControl.none = true;
      expect(await pay(treasurer, req.requestId)).toMatchObject({ kind: "ok" });
      expect((await state(req.requestId)).status).toBe("paid");
      expect(await noticesFor(req.requestId, REQUESTER_UPDATE).then((r) => r.filter((n) => n.subject === "Your reimbursement request was paid"))).toEqual([]);
      expect(sent.spy).not.toHaveBeenCalled();
    });

    it("a requester with no deliverable address gets no row and no error; the payment commits", async () => {
      const quiet = await fx.member(A, "Quietone");
      const q = actor(A, quiet);
      const req = await approvedBySeat({ receipt: true }, q);
      expect(await pay(treasurer, req.requestId)).toMatchObject({ kind: "ok" });
      expect((await state(req.requestId)).status).toBe("paid");
    });

    it("EC8: the approver cannot record the payment - and is told so BEFORE being asked for a missing receipt", async () => {
      // Override approval by the treasurer (a second pay holder, payer2, exists); no receipt, no waiver yet.
      const req = await submitted(A, requester, { groupId: await fx.derivedGroup(A, "session") });
      expect(await decisions.approveRequest(treasurer, { ...req, path: "override" })).toMatchObject({ kind: "ok", path: "override" });
      expect(await pay(treasurer, req.requestId)).toEqual({ kind: "refused", outcome: "payer_is_approver" });
      // A different pay holder is merely asked for the receipt.
      expect(await pay(payer2, req.requestId)).toEqual({ kind: "refused", outcome: "receipt_missing" });
      expect((await paymentRows(req.requestId))).toEqual([]);
      expect((await state(req.requestId)).status).toBe("approved");
    });

    it("the receipt requirement: no receipt and no waiver is receipt_missing; a waiver by another pay holder lets it through", async () => {
      const req = await approvedBySeat({ receipt: false });
      expect(await pay(treasurer, req.requestId)).toEqual({ kind: "refused", outcome: "receipt_missing" });
      expect(await payments.waiveReceipt(treasurer, { requestId: req.requestId, note: "Lost in the move" })).toEqual({ kind: "ok" });
      expect(await pay(treasurer, req.requestId)).toMatchObject({ kind: "ok" });
      expect((await state(req.requestId)).status).toBe("paid");
    });

    it("EC9: with another pay holder around, the requester who is also a pay holder gets needs_another_payer; the other holder pays", async () => {
      const req = await approvedBySeat({ receipt: true }, treasurer);
      expect(await pay(treasurer, req.requestId)).toEqual({ kind: "refused", outcome: "needs_another_payer" });
      expect(await pay(payer2, req.requestId)).toMatchObject({ kind: "ok", selfPaid: false });
      expect((await paymentRows(req.requestId))[0]).toMatchObject({ paid_by_user: payer2.userId, self_paid: false });
    });

    it("EC9: the SOLE pay holder may record payment on their own request; the row and the audit say so, and no email is sent to them about their own click", async () => {
      const B = await fx.makeOrg("sole", { timeZone: "America/New_York", toggle: true });
      const group = await fx.makeGroup(B, "Hospitality");
      const sole = await fx.member(B, "Solepayer");
      const boss = await fx.member(B, "Bosschair");
      const soleActor = actor(B, sole);
      const bossActor = actor(B, boss);
      await fx.seat(B, group, boss.personId, { role: "chair" });
      await fx.grant(B, await fx.makeRole(B, "sole_like", ALL_KEYS), sole.personId);
      await fx.chargeable(B, group, sole.userId);
      const soleMail = await fx.email(sole.personId, "sole", { subtype: "work" });
      const saved = await requests.saveRequest(soleActor, values({ groupId: group, categoryId: undefined, noReceiptClaimed: false }));
      if (saved.kind !== "ok") throw new Error(JSON.stringify(saved));
      await attach(B, soleActor, saved.requestId);
      const sub = await requests.submitRequest(soleActor, { requestId: saved.requestId, expectedRevision: saved.revision + 1 });
      if (sub.kind !== "ok") throw new Error(JSON.stringify(sub));
      expect(await decisions.approveRequest(bossActor, { requestId: saved.requestId, expectedRevision: sub.revision, path: "seat" })).toMatchObject({ kind: "ok" });

      const result = await pay(soleActor, saved.requestId);
      expect(result).toMatchObject({ kind: "ok", selfPaid: true });
      expect((await paymentRows(saved.requestId))[0]).toMatchObject({ self_paid: true });
      expect((await auditRows("tenant.reimbursement.payment_recorded", saved.requestId))[0]!.metadata).toMatchObject({ selfPaid: true });
      const told = (await fx.queued([soleMail])).filter((r) => String(r.text_body).includes(saved.requestId) && String(r.subject).includes("was paid"));
      expect(told).toEqual([]);
    });

    it("a sole pay holder cannot waive the receipt on their own request (D5), so they must attach one", async () => {
      const B = await fx.makeOrg("sole2", { timeZone: "America/New_York", toggle: true });
      const group = await fx.makeGroup(B, "Hospitality");
      const sole = await fx.member(B, "Solepayer");
      const boss = await fx.member(B, "Bosschair");
      const soleActor = actor(B, sole);
      await fx.seat(B, group, boss.personId, { role: "chair" });
      await fx.grant(B, await fx.makeRole(B, "sole_like", ALL_KEYS), sole.personId);
      await fx.chargeable(B, group, sole.userId);
      const saved = await requests.saveRequest(soleActor, values({ groupId: group, categoryId: undefined, noReceiptClaimed: true }));
      if (saved.kind !== "ok") throw new Error(JSON.stringify(saved));
      const sub = await requests.submitRequest(soleActor, { requestId: saved.requestId, expectedRevision: saved.revision });
      if (sub.kind !== "ok") throw new Error(JSON.stringify(sub));
      expect(await payments.waiveReceipt(soleActor, { requestId: saved.requestId, note: null })).toEqual({ kind: "refused", outcome: "not_waivable" });
      await decisions.approveRequest(actor(B, boss), { requestId: saved.requestId, expectedRevision: sub.revision, path: "seat" });
      expect(await pay(soleActor, saved.requestId)).toEqual({ kind: "refused", outcome: "receipt_missing" });
    });

    it("EC12: an approved request stays payable after the requester's membership ends", async () => {
      const leaving = await fx.member(A, "Leaving");
      const req = await approvedBySeat({ receipt: true }, actor(A, leaving));
      await fx.q(sql`update memberships set ended_on = current_date, ended_reason = 'moved away'
                      where person_id = ${leaving.personId} and organization_id = ${A}`);
      expect(await pay(treasurer, req.requestId)).toMatchObject({ kind: "ok" });
      expect((await state(req.requestId)).status).toBe("paid");
    });

    it("state refusals come back as outcomes, never exceptions, and write nothing", async () => {
      const submittedOnly = await submitted(A, requester, { receipt: true });
      const auditBefore = (await fx.q(sql`select count(*)::int as n from audit_events where action = 'tenant.reimbursement.payment_recorded' and resource_id = ${submittedOnly.requestId}`))[0]!.n;
      expect(await pay(treasurer, submittedOnly.requestId)).toEqual({ kind: "refused", outcome: "not_payable" });
      const approved = await approvedBySeat({ receipt: true });
      expect(await pay(treasurer, approved.requestId, { method: "check", reference: null })).toEqual({ kind: "refused", outcome: "reference_required" });
      expect(await pay(treasurer, approved.requestId, { reference: "x".repeat(41) })).toEqual({ kind: "refused", outcome: "reference_too_long" });
      expect(await pay(treasurer, approved.requestId, { note: "n".repeat(301) })).toEqual({ kind: "refused", outcome: "note_too_long" });
      expect(await pay(treasurer, approved.requestId, { paidOn: dates.addDays(today, 1) })).toEqual({ kind: "refused", outcome: "date_out_of_range" });
      expect(await pay(treasurer, approved.requestId, { paidOn: dates.addDays(today, -400) })).toEqual({ kind: "refused", outcome: "date_out_of_range" });
      expect(await pay(treasurer, "00000000-0000-4000-8000-000000000000")).toEqual({ kind: "refused", outcome: "not_found" });
      expect(await pay(treasurer, approved.requestId)).toMatchObject({ kind: "ok" });
      expect(await pay(treasurer, approved.requestId)).toEqual({ kind: "refused", outcome: "already_paid" });
      expect((await paymentRows(approved.requestId))).toHaveLength(1);
      expect((await fx.q(sql`select count(*)::int as n from audit_events where action = 'tenant.reimbursement.payment_recorded' and resource_id = ${submittedOnly.requestId}`))[0]!.n).toBe(auditBefore);
    });

    it("the paid-on date may not be earlier than the expense date", async () => {
      const req = await approvedBySeat({ receipt: true, expenseDate: dates.addDays(today, -2) });
      expect(await pay(treasurer, req.requestId, { paidOn: dates.addDays(today, -3) })).toEqual({ kind: "refused", outcome: "date_out_of_range" });
      expect(await pay(treasurer, req.requestId, { paidOn: dates.addDays(today, -2) })).toMatchObject({ kind: "ok" });
    });

    it("identity: a member without pay, a requester, and a view-only holder are denied - and a draft of someone else's is not_found for a pay holder", async () => {
      const req = await approvedBySeat({ receipt: true });
      for (const who of [plain, requester, viewer, chair]) expect(await pay(who, req.requestId), who.userId).toEqual({ kind: "denied" });
      const draft = await requests.saveRequest(requester, values());
      if (draft.kind !== "ok") throw new Error("setup");
      expect(await pay(treasurer, draft.requestId)).toEqual({ kind: "refused", outcome: "not_found" });
      expect((await state(req.requestId)).status).toBe("approved");
    });
  });

  // =========================================================================
  describe("reversePayment", () => {
    it("EC32: a reversal is its own row, both stay on record, the request is approved again, and it can be paid again", async () => {
      const req = await approvedBySeat({ receipt: true });
      await pay(treasurer, req.requestId, { method: "check", reference: "1042" });
      const result = await payments.reversePayment(payer2, { requestId: req.requestId, reason: "Check 1042 was voided at the bank" });
      expect(result).toMatchObject({ kind: "ok" });
      expect((await state(req.requestId)).status).toBe("approved");
      const rows = await paymentRows(req.requestId);
      expect(rows.map((r) => r.kind)).toEqual(["payment", "reversal"]);
      expect(rows[1]).toMatchObject({ amount_cents: 4150, reason: "Check 1042 was voided at the bank", method: null });
      expect(rows[1]!.offsets_payment_id).not.toBeNull();
      expect((await events(req.requestId)).map((e) => e.kind)).toEqual(["created", "submitted", "approved", "payment_recorded", "payment_reversed"]);
      // paid again: a second payment row; the history keeps all of it
      expect(await pay(payer2, req.requestId, { method: "check", reference: "1051" })).toMatchObject({ kind: "ok" });
      expect((await paymentRows(req.requestId)).map((r) => r.kind)).toEqual(["payment", "reversal", "payment"]);
    });

    it("audits the reversal with ids only, never the reason; the audit shares the transaction", async () => {
      const req = await approvedBySeat({ receipt: true });
      await pay(treasurer, req.requestId);
      auditControl.fail = true;
      await expect(payments.reversePayment(treasurer, { requestId: req.requestId, reason: "secret reason" })).rejects.toThrow(/audit insert failed/);
      auditControl.fail = false;
      expect((await state(req.requestId)).status).toBe("paid");
      expect((await paymentRows(req.requestId)).map((r) => r.kind)).toEqual(["payment"]);
      await payments.reversePayment(treasurer, { requestId: req.requestId, reason: "secret reason" });
      const rows = await auditRows("tenant.reimbursement.payment_reversed", req.requestId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.metadata).toMatchObject({ organizationId: A, requestId: req.requestId });
      expect(JSON.stringify(rows[0])).not.toContain("secret reason");
    });

    it("a reason is required and bounded; an unpaid request is not reversible; one reversal per payment", async () => {
      const unpaid = await approvedBySeat({ receipt: true });
      expect(await payments.reversePayment(treasurer, { requestId: unpaid.requestId, reason: "Why not" })).toEqual({ kind: "refused", outcome: "not_reversible" });
      await pay(treasurer, unpaid.requestId);
      expect(await payments.reversePayment(treasurer, { requestId: unpaid.requestId, reason: "   " })).toEqual({ kind: "refused", outcome: "reason_required" });
      expect(await payments.reversePayment(treasurer, { requestId: unpaid.requestId, reason: "r".repeat(301) })).toEqual({ kind: "refused", outcome: "reason_too_long" });
      expect(await payments.reversePayment(treasurer, { requestId: unpaid.requestId, reason: "Mistake" })).toMatchObject({ kind: "ok" });
      expect(await payments.reversePayment(treasurer, { requestId: unpaid.requestId, reason: "Mistake again" })).toEqual({ kind: "refused", outcome: "not_reversible" });
    });

    it("needs the pay key (a view-only holder and a requester are denied)", async () => {
      const req = await approvedBySeat({ receipt: true });
      await pay(treasurer, req.requestId);
      for (const who of [viewer, requester, plain]) expect(await payments.reversePayment(who, { requestId: req.requestId, reason: "No" })).toEqual({ kind: "denied" });
    });
  });

  // =========================================================================
  describe("waiveReceipt", () => {
    it("stamps the waiver once, audits it (ids only), and never waives when a receipt exists or on the actor's own request", async () => {
      const bare = await approvedBySeat({ receipt: false });
      expect(await payments.waiveReceipt(treasurer, { requestId: bare.requestId, note: "Lost in the move" })).toEqual({ kind: "ok" });
      expect((await state(bare.requestId)).receipt_waived_at).not.toBeNull();
      expect((await events(bare.requestId)).map((e) => e.kind)).toContain("receipt_waived");
      const rows = await auditRows("tenant.reimbursement.receipt_waived", bare.requestId);
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows[0])).not.toContain("Lost in the move");
      expect(await payments.waiveReceipt(treasurer, { requestId: bare.requestId, note: null })).toEqual({ kind: "refused", outcome: "not_waivable" });

      const withReceipt = await approvedBySeat({ receipt: true });
      expect(await payments.waiveReceipt(treasurer, { requestId: withReceipt.requestId, note: null })).toEqual({ kind: "refused", outcome: "receipt_present" });
      const own = await approvedBySeat({ receipt: false }, treasurer);
      expect(await payments.waiveReceipt(treasurer, { requestId: own.requestId, note: null })).toEqual({ kind: "refused", outcome: "not_waivable" });
      expect(await payments.waiveReceipt(payer2, { requestId: own.requestId, note: "n".repeat(301) })).toEqual({ kind: "refused", outcome: "note_too_long" });
      expect(await payments.waiveReceipt(payer2, { requestId: own.requestId, note: null })).toEqual({ kind: "ok" });
    });

    it("needs the pay key", async () => {
      const bare = await approvedBySeat({ receipt: false });
      for (const who of [viewer, requester, plain, chair]) expect(await payments.waiveReceipt(who, { requestId: bare.requestId, note: null })).toEqual({ kind: "denied" });
    });
  });

  // =========================================================================
  describe("voidRequest", () => {
    it("closes an unpaid request from submitted, tells the requester it was closed (no reason in the mail), and audits with ids only", async () => {
      const req = await submitted(A, requester, { receipt: true });
      sent.spy.mockClear();
      expect(await payments.voidRequest(treasurer, { requestId: req.requestId, reason: "Duplicate of an earlier request" })).toEqual({ kind: "ok" });
      expect((await state(req.requestId)).status).toBe("voided");
      const rows = (await noticesFor(req.requestId, REQUESTER_UPDATE)).filter((r) => r.subject === "Your reimbursement request was closed");
      expect(rows.map((r) => r.to_email)).toEqual([mail.requester]);
      const body = `${rows[0]!.subject}\n${rows[0]!.html_body}\n${rows[0]!.text_body}`;
      expect(body).toContain("Open it to see what happened.");
      expect(body).not.toContain("Duplicate");
      expect(sent.spy).toHaveBeenCalledWith(String(rows[0]!.id));
      const audit = await auditRows("tenant.reimbursement.voided", req.requestId);
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit[0])).not.toContain("Duplicate");
      expect((await events(req.requestId)).at(-1)).toMatchObject({ kind: "voided", note: "Duplicate of an earlier request" });
    });

    it("a failing audit insert rolls the void and its notice back", async () => {
      const req = await approvedBySeat({ receipt: true });
      auditControl.fail = true;
      await expect(payments.voidRequest(treasurer, { requestId: req.requestId, reason: "x" })).rejects.toThrow(/audit insert failed/);
      auditControl.fail = false;
      expect((await state(req.requestId)).status).toBe("approved");
      expect((await noticesFor(req.requestId, REQUESTER_UPDATE)).filter((r) => r.subject === "Your reimbursement request was closed")).toEqual([]);
    });

    it("P3-22: not from paid (only a reversal gets a request back from paid); a reason is required; a withdrawn request is not voidable", async () => {
      const paid = await approvedBySeat({ receipt: true });
      await pay(treasurer, paid.requestId);
      expect(await payments.voidRequest(treasurer, { requestId: paid.requestId, reason: "Oops" })).toEqual({ kind: "refused", outcome: "not_voidable" });
      const open = await submitted(A, requester, { receipt: true });
      expect(await payments.voidRequest(treasurer, { requestId: open.requestId, reason: "  " })).toEqual({ kind: "refused", outcome: "reason_required" });
      expect(await payments.voidRequest(treasurer, { requestId: open.requestId, reason: "r".repeat(301) })).toEqual({ kind: "refused", outcome: "reason_too_long" });
      await requests.withdrawRequest(requester, { requestId: open.requestId, reason: null });
      expect(await payments.voidRequest(treasurer, { requestId: open.requestId, reason: "Too late" })).toEqual({ kind: "refused", outcome: "not_voidable" });
    });

    it("a pay holder voiding their own request is not emailed about it; needs the pay key", async () => {
      const own = await submitted(A, treasurer, { receipt: true });
      expect(await payments.voidRequest(treasurer, { requestId: own.requestId, reason: "Changed my mind" })).toEqual({ kind: "ok" });
      expect((await noticesFor(own.requestId)).filter((r) => String(r.subject).includes("closed"))).toEqual([]);
      const other = await submitted(A, requester, { receipt: true });
      for (const who of [viewer, plain, chair, requester]) expect(await payments.voidRequest(who, { requestId: other.requestId, reason: "No" })).toEqual({ kind: "denied" });
    });
  });

  // =========================================================================
  describe("addNote", () => {
    it("a view holder adds an internal note: the history event is its record, no audit row; the requester never sees it", async () => {
      const req = await approvedBySeat({ receipt: true });
      expect(await payments.addNote(viewer, { requestId: req.requestId, note: "Will mail with the Friday batch" })).toEqual({ kind: "ok" });
      expect((await events(req.requestId)).at(-1)).toMatchObject({ kind: "note", note: "Will mail with the Friday batch", actor_user_id: viewer.userId });
      const rows = await fx.q(sql`select count(*)::int as n from audit_events where resource_id = ${req.requestId} and action like 'tenant.reimbursement.%' and action not in ('tenant.reimbursement.approved')`);
      expect(rows[0]!.n).toBe(0);
      const member = await reads.getRequestDetail({ userId: requester.userId, personId: requester.personId, organizationId: A }, req.requestId, "member");
      if (member.kind !== "ok") throw new Error("member detail");
      expect(JSON.stringify(member.detail)).not.toContain("Friday batch");
      const team = await reads.getRequestDetail({ userId: treasurer.userId, personId: treasurer.personId, organizationId: A }, req.requestId, "treasury");
      if (team.kind !== "ok") throw new Error("treasury detail");
      expect(JSON.stringify(team.detail)).toContain("Friday batch");
    });

    it("limits and identity: required, at most 500, not on a draft, and only for a view holder", async () => {
      const req = await approvedBySeat({ receipt: true });
      expect(await payments.addNote(treasurer, { requestId: req.requestId, note: "   " })).toEqual({ kind: "refused", outcome: "note_required" });
      expect(await payments.addNote(treasurer, { requestId: req.requestId, note: "n".repeat(501) })).toEqual({ kind: "refused", outcome: "note_too_long" });
      expect(await payments.addNote(treasurer, { requestId: req.requestId, note: "n".repeat(500) })).toEqual({ kind: "ok" });
      const draft = await requests.saveRequest(requester, values());
      if (draft.kind !== "ok") throw new Error("setup");
      expect(await payments.addNote(treasurer, { requestId: draft.requestId, note: "hello" })).toEqual({ kind: "refused", outcome: "not_found" });
      for (const who of [requester, plain, chair]) expect(await payments.addNote(who, { requestId: req.requestId, note: "No" })).toEqual({ kind: "denied" });
    });
  });
});
