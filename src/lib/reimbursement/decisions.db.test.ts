/**
 * decisions.ts (approve, send back, mark not approved; the seat path and the
 * treasurer's override) and the notices it queues, against a REAL Postgres
 * connection through the application's own path (`withOrgContext` on presby_app,
 * RLS enforced) - docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 EC5, EC7,
 * EC10, EC11, EC22, EC40, EC43, P3-20. The SQL half is pinned in
 * src/lib/db/domain/reimbursement-definers.db.test.ts; THIS file proves the
 * TypeScript layer over it: the audit row in the same transaction, the notices
 * in the same transaction, who is told and who is not, the sends after commit,
 * and the result mapping. Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/reimbursement/decisions.db.test.ts
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

describe.skipIf(!hasDb)("decisions.ts and the notices it queues (Postgres-backed)", () => {
  let fx: ReimbursementFixture;
  let decisions: typeof import("./decisions");
  let requests: typeof import("./requests");
  let input: typeof import("./input");
  let reads: typeof import("./reads");

  let A: string;
  let slug: string;
  let today: string;
  let committee: string;
  let lifecycle: string;
  let category: string;
  let session: string;

  let requester: RequestActor;
  let chair: RequestActor;
  let leader: RequestActor;
  let lifeChair: RequestActor;
  let treasurer: RequestActor;
  let payer2: RequestActor;
  let plain: RequestActor;
  const mail: Record<string, string> = {};

  let keySeq = 0;
  const nextKey = () => `dk${Date.now().toString(36)}${(keySeq += 1)}`.padEnd(10, "x");
  const actor = (org: string, m: { userId: string; personId: string }): RequestActor => ({
    userId: m.userId, email: `${m.userId}@example.invalid`, personId: m.personId, organizationId: org,
  });

  function values(over: Record<string, unknown> = {}) {
    return input.saveRequestSchema.parse({
      clientKey: nextKey(),
      kind: "reimburse",
      groupId: committee,
      amountCents: 4150,
      expenseDate: today,
      purpose: "Paint for the fellowship hall",
      categoryId: category,
      noReceiptClaimed: true,
      ...over,
    });
  }

  /** A submitted request in `groupId` by `who`. Returns its id and the revision an approver would carry. */
  async function submitted(who: RequestActor = requester, groupId: string = committee, over: Record<string, unknown> = {}) {
    const saved = await requests.saveRequest(who, values({ groupId, ...over }));
    if (saved.kind !== "ok") throw new Error(`save failed: ${JSON.stringify(saved)}`);
    const sub = await requests.submitRequest(who, { requestId: saved.requestId, expectedRevision: saved.revision });
    if (sub.kind !== "ok") throw new Error(`submit failed: ${JSON.stringify(sub)}`);
    return { requestId: saved.requestId, expectedRevision: sub.revision };
  }

  const state = async (requestId: string) =>
    (await fx.q(sql`select status, approval_path, approved_at, approved_by_user, revision from reimbursement_requests where id = ${requestId}`))[0]!;
  const events = (requestId: string) =>
    fx.q(sql`select kind, from_status, to_status, note, actor_user_id from reimbursement_events where request_id = ${requestId} order by seq`);
  const auditRows = (action: string, requestId: string) =>
    fx.q(sql`select actor_user_id, resource_type, resource_id, metadata from audit_events where action = ${action} and resource_id = ${requestId}`);
  /** Queue rows for one request, by the id in the link. */
  async function noticesFor(requestId: string, templateKey?: string) {
    const rows = await fx.queued(Object.values(mail));
    return rows.filter((r) => String(r.text_body).includes(requestId) && (!templateKey || r.template_key === templateKey));
  }
  /** What the DECISION queued: everything for the request except the notices its submission sent. */
  const afterDecision = (rows: Array<Record<string, unknown>>) => rows.filter((r) => r.template_key !== "reimbursement.notice.needs_approval");
  const recipients = (rows: Array<Record<string, unknown>>) => rows.map((r) => String(r.to_email)).sort();
  const addr = (...who: string[]) => who.map((w) => mail[w]!).sort();

  beforeAll(async () => {
    const mod = await import("@/lib/testing/reimbursement-fixture");
    fx = await mod.createReimbursementFixture("decide");
    decisions = await import("./decisions");
    requests = await import("./requests");
    input = await import("./input");
    reads = await import("./reads");

    A = await fx.makeOrg("main", { timeZone: "America/New_York", toggle: true });
    [{ slug }] = (await fx.q(sql`select slug from organizations where id = ${A}`)) as Array<{ slug: string }>;
    committee = await fx.makeGroup(A, "Property Committee");
    lifecycle = await fx.makeGroup(A, "Hospitality Team");
    session = await fx.derivedGroup(A, "session");

    const r = await fx.member(A, "Requester");
    const c = await fx.member(A, "Chair");
    const l = await fx.member(A, "Leader");
    const lc = await fx.member(A, "Lifechair");
    const t = await fx.member(A, "Treasurer");
    const p2 = await fx.member(A, "Payertwo");
    const pl = await fx.member(A, "Plain");
    requester = actor(A, r);
    chair = actor(A, c);
    leader = actor(A, l);
    lifeChair = actor(A, lc);
    treasurer = actor(A, t);
    payer2 = actor(A, p2);
    plain = actor(A, pl);

    await fx.seat(A, committee, c.personId, { role: "chair" });
    await fx.seat(A, committee, l.personId, { role: "leader" });
    await fx.seat(A, lifecycle, lc.personId, { role: "chair" });
    await fx.grant(A, await fx.makeRole(A, "treasurer_like", ALL_KEYS), t.personId);
    await fx.grant(A, await fx.makeRole(A, "payer_like", PAY_KEYS), p2.personId);
    for (const g of [committee, lifecycle, session]) await fx.chargeable(A, g, t.userId);
    category = await fx.category(A, "Supplies", t.userId);

    // Everyone but the plain member has a work address (a requester is often staff).
    for (const [tag, m] of Object.entries({ requester: r, chair: c, leader: l, lifeChair: lc, treasurer: t, payer2: p2 })) {
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
  describe("approveRequest on the seat path", () => {
    it("a chair approves: the request is approved by that user on the seat path, with one history event", async () => {
      const req = await submitted();
      const result = await decisions.approveRequest(chair, { ...req, path: "seat" });
      expect(result).toMatchObject({ kind: "ok", path: "seat", decidedOn: today });
      expect(await state(req.requestId)).toMatchObject({ status: "approved", approval_path: "seat", approved_by_user: chair.userId });
      expect((await events(req.requestId)).map((e) => e.kind)).toEqual(["created", "submitted", "approved"]);
    });

    it("EC43/P3-20: writes ONE audit row in the same transaction - ids and tags only, never the purpose, a name or an amount", async () => {
      const req = await submitted();
      await decisions.approveRequest(leader, { ...req, path: "seat" });
      const rows = await auditRows("tenant.reimbursement.approved", req.requestId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actor_user_id: leader.userId, resource_type: "reimbursement_request" });
      expect(rows[0]!.metadata).toEqual({ organizationId: A, requestId: req.requestId, path: "seat" });
      expect(JSON.stringify(rows[0])).not.toMatch(/Paint|4150|41\.50|Requester|Quillfeather/);
    });

    it("EC22: tells the requester it was approved and every pay holder it is ready to pay - and never the approver", async () => {
      const req = await submitted();
      await decisions.approveRequest(chair, { ...req, path: "seat" });

      const requesterUpdate = await noticesFor(req.requestId, "reimbursement.notice.requester_update");
      expect(recipients(requesterUpdate)).toEqual(addr("requester"));
      expect(requesterUpdate[0]!.subject).toBe("Your reimbursement request was approved");
      expect(String(requesterUpdate[0]!.text_body)).toContain(`/o/${slug}/reimbursements/${req.requestId}`);
      expect(String(requesterUpdate[0]!.text_body)).not.toContain("/admin/");

      const ready = await noticesFor(req.requestId, "reimbursement.notice.ready_to_pay");
      expect(recipients(ready)).toEqual(addr("treasurer", "payer2"));
      expect(ready[0]!.subject).toBe("A reimbursement request is ready to pay");
      // the people who pay open the treasury page
      expect(String(ready[0]!.text_body)).toContain(`/o/${slug}/admin/reimbursements/${req.requestId}`);

      // the chair who approved, and the other approver, are told nothing by the approval
      expect(afterDecision(await noticesFor(req.requestId)).map((r) => r.to_email)).not.toContain(mail.chair);
      expect(afterDecision(await noticesFor(req.requestId)).map((r) => r.to_email)).not.toContain(mail.leader);
    });

    it("EC22: a notice carries no amount, purpose or name - the queue row's whole subject, html and text", async () => {
      const req = await submitted(requester, committee, { purpose: "Zebra stripes for the nursery", amountCents: 987654 });
      await decisions.approveRequest(chair, { ...req, path: "seat" });
      const rows = await noticesFor(req.requestId);
      expect(rows.length).toBeGreaterThanOrEqual(3);
      for (const r of rows) {
        for (const part of [r.subject, r.html_body, r.text_body].map(String)) {
          expect(part).not.toMatch(/Zebra|nursery|9,?876|987654|\$/);
          expect(part).not.toMatch(/Requester|Chair|Property Committee|Quillfeather/);
        }
      }
    });

    it("sends the queued rows after the commit, once each, and never before the decision is durable", async () => {
      const req = await submitted();
      sent.spy.mockClear();
      await decisions.approveRequest(chair, { ...req, path: "seat" });
      const ids = afterDecision(await noticesFor(req.requestId)).map((r) => String(r.id)).sort();
      expect(ids).toHaveLength(3);
      expect(sent.spy.mock.calls.map((c) => c[0]).sort()).toEqual(ids);
    });

    it("a send that throws does not undo the approval or reach the caller", async () => {
      const req = await submitted();
      sent.spy.mockRejectedValue(new Error("provider down"));
      try {
        expect(await decisions.approveRequest(chair, { ...req, path: "seat" })).toMatchObject({ kind: "ok" });
      } finally {
        sent.spy.mockReset();
        sent.spy.mockImplementation(async () => ({ sentInline: true }));
      }
      expect((await state(req.requestId)).status).toBe("approved");
    });

    it("EC5: an approve on a revision the request has moved past is changed_since_viewed - nothing changes, nothing is written", async () => {
      const req = await submitted();
      sent.spy.mockClear();
      const result = await decisions.approveRequest(chair, { requestId: req.requestId, expectedRevision: req.expectedRevision + 1, path: "seat" });
      expect(result).toEqual({ kind: "refused", outcome: "changed_since_viewed" });
      expect((await state(req.requestId)).status).toBe("submitted");
      expect(await auditRows("tenant.reimbursement.approved", req.requestId)).toHaveLength(0);
      expect(await noticesFor(req.requestId, "reimbursement.notice.requester_update")).toHaveLength(0);
      expect(sent.spy).not.toHaveBeenCalled();
    });

    it("EC5: a returned, edited and resubmitted request makes the OLD approve answer changed_since_viewed", async () => {
      const req = await submitted();
      expect(await decisions.returnRequest(chair, { ...req, kind: "needs_info", reason: "Add the invoice number" })).toMatchObject({ kind: "ok" });
      const edit = await requests.saveRequest(requester, values({ requestId: req.requestId, expectedRevision: req.expectedRevision, amountCents: 4250 }));
      if (edit.kind !== "ok") throw new Error("edit failed");
      const again = await requests.submitRequest(requester, { requestId: req.requestId, expectedRevision: edit.revision });
      expect(again).toMatchObject({ kind: "ok" });
      expect(await decisions.approveRequest(chair, { ...req, path: "seat" })).toEqual({ kind: "refused", outcome: "changed_since_viewed" });
      const fresh = await decisions.approveRequest(chair, { requestId: req.requestId, expectedRevision: edit.revision, path: "seat" });
      expect(fresh).toMatchObject({ kind: "ok" });
    });

    it("a second approve is already_decided with the org-local date and the status - and writes nothing more", async () => {
      const req = await submitted();
      await decisions.approveRequest(chair, { ...req, path: "seat" });
      const auditBefore = (await auditRows("tenant.reimbursement.approved", req.requestId)).length;
      const noticesBefore = (await noticesFor(req.requestId)).length;
      sent.spy.mockClear();

      const second = await decisions.approveRequest(leader, { ...req, path: "seat" });
      expect(second).toEqual({ kind: "already_decided", decidedOn: today, status: "approved" });
      expect(Object.keys(second)).not.toContain("decidedBy");
      expect((await auditRows("tenant.reimbursement.approved", req.requestId)).length).toBe(auditBefore);
      expect((await noticesFor(req.requestId)).length).toBe(noticesBefore);
      expect((await events(req.requestId)).filter((e) => e.kind === "approved")).toHaveLength(1);
      expect(sent.spy).not.toHaveBeenCalled();
    });

    it("EC40: two approvers at once - one wins, the other is already_decided, one audit row, one set of notices", async () => {
      const req = await submitted();
      const [a, b] = await Promise.all([
        decisions.approveRequest(chair, { ...req, path: "seat" }),
        decisions.approveRequest(leader, { ...req, path: "seat" }),
      ]);
      expect([a.kind, b.kind].sort()).toEqual(["already_decided", "ok"]);
      expect(await auditRows("tenant.reimbursement.approved", req.requestId)).toHaveLength(1);
      expect(await noticesFor(req.requestId, "reimbursement.notice.ready_to_pay")).toHaveLength(2);
      expect((await events(req.requestId)).filter((e) => e.kind === "approved")).toHaveLength(1);
    });

    it("EC7: a chair cannot approve their own request", async () => {
      const mine = await submitted(chair);
      expect(await decisions.approveRequest(chair, { ...mine, path: "seat" })).toEqual({ kind: "refused", outcome: "not_approvable" });
      expect((await state(mine.requestId)).status).toBe("submitted");
      // the other approver can
      expect(await decisions.approveRequest(leader, { ...mine, path: "seat" })).toMatchObject({ kind: "ok" });
    });

    it("a treasury viewer who holds no seat gets not_approvable; a member with no view and no seat gets the same neutral not_found as a stranger", async () => {
      const req = await submitted();
      expect(await decisions.approveRequest(treasurer, { ...req, path: "seat" })).toEqual({ kind: "refused", outcome: "not_approvable" });
      expect(await decisions.approveRequest(plain, { ...req, path: "seat" })).toEqual({ kind: "refused", outcome: "not_found" });
      expect(await decisions.approveRequest(plain, { requestId: "00000000-0000-4000-8000-000000000000", expectedRevision: 1, path: "seat" }))
        .toEqual({ kind: "refused", outcome: "not_found" });
      expect((await state(req.requestId)).status).toBe("submitted");
    });

    it("a withdrawn request cannot be approved: not_approvable", async () => {
      const req = await submitted();
      expect(await requests.withdrawRequest(requester, { requestId: req.requestId, reason: null })).toMatchObject({ kind: "ok" });
      const result = await decisions.approveRequest(chair, { ...req, path: "seat" });
      expect(result.kind === "refused" || result.kind === "already_decided").toBe(true);
      expect((await state(req.requestId)).status).toBe("withdrawn");
    });
  });

  // =========================================================================
  describe("EC11: a seat that ends mid-queue loses the right to approve at once", () => {
    it("the chair of a one-chair group is no longer an approver, the request now waits for a treasurer, and the override then works", async () => {
      const req = await submitted(requester, lifecycle);
      const waiting = await reads.listWaitingForMe(lifeChair);
      expect(waiting.kind === "ok" && waiting.items.map((r) => r.id)).toContain(req.requestId);

      await fx.q(sql`
        update group_memberships set ends_on = (current_date - 1)
         where organization_id = ${A} and group_id = ${lifecycle}`);

      // live: no longer in the queue, and the approve is the neutral refusal
      const after = await reads.listWaitingForMe(lifeChair);
      expect(after.kind === "ok" && after.items.map((r) => r.id)).not.toContain(req.requestId);
      expect(await decisions.approveRequest(lifeChair, { ...req, path: "seat" })).toEqual({ kind: "refused", outcome: "not_found" });
      expect((await state(req.requestId)).status).toBe("submitted");

      // nobody can approve on the seat path, so the treasurer's override is open (payer2 is the second payer)
      const override = await decisions.approveRequest(treasurer, { ...req, path: "override" });
      expect(override).toMatchObject({ kind: "ok", path: "override" });
    });
  });

  // =========================================================================
  describe("approveRequest on the override path (EC10)", () => {
    it("with a second pay holder: approved on the override path, audited as the override, and the OTHER pay holder is told", async () => {
      const req = await submitted(requester, session);
      const result = await decisions.approveRequest(treasurer, { ...req, path: "override" });
      expect(result).toMatchObject({ kind: "ok", path: "override" });
      expect(await state(req.requestId)).toMatchObject({ status: "approved", approval_path: "override", approved_by_user: treasurer.userId });
      expect((await events(req.requestId)).map((e) => e.kind)).toEqual(["created", "submitted", "override_approved"]);

      expect(await auditRows("tenant.reimbursement.approved", req.requestId)).toHaveLength(0);
      const audit = await auditRows("tenant.reimbursement.override_approved", req.requestId);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.metadata).toEqual({ organizationId: A, requestId: req.requestId, path: "override" });

      expect(recipients(await noticesFor(req.requestId, "reimbursement.notice.ready_to_pay"))).toEqual(addr("payer2"));
      expect(recipients(await noticesFor(req.requestId, "reimbursement.notice.requester_update"))).toEqual(addr("requester"));
    });

    it("a request in a group whose chair exists cannot be overridden: seat_holder_exists", async () => {
      const req = await submitted(requester, committee);
      expect(await decisions.approveRequest(treasurer, { ...req, path: "override" })).toEqual({ kind: "refused", outcome: "seat_holder_exists" });
      expect((await state(req.requestId)).status).toBe("submitted");
    });

    it("the override needs the pay key: a chair asking for it is an identity refusal (denied), and nothing changes", async () => {
      const req = await submitted(requester, session);
      expect(await decisions.approveRequest(chair, { ...req, path: "override" })).toEqual({ kind: "denied" });
      expect(await decisions.approveRequest(plain, { ...req, path: "override" })).toEqual({ kind: "denied" });
      expect((await state(req.requestId)).status).toBe("submitted");
    });

    it("a pay holder cannot override-approve a request they entered", async () => {
      const mine = await submitted(treasurer, session);
      expect(await decisions.approveRequest(treasurer, { ...mine, path: "override" })).toEqual({ kind: "refused", outcome: "not_approvable" });
      expect((await state(mine.requestId)).status).toBe("submitted");
    });

    it("EC10: with ONE pay holder in the organization the override is needs_second_payer - nothing changes, nothing is written", async () => {
      const N = await fx.makeOrg("solo", { toggle: true });
      const nGroup = await fx.makeGroup(N, "Solo Committee");
      const sole = await fx.member(N, "Soletreasurer");
      const asker = await fx.member(N, "Asker");
      await fx.grant(N, await fx.makeRole(N, "treasurer_like", ALL_KEYS), sole.personId);
      await fx.chargeable(N, nGroup, sole.userId);
      const soleActor = actor(N, sole);
      const askerActor = actor(N, asker);
      const saved = await requests.saveRequest(askerActor, input.saveRequestSchema.parse({
        clientKey: nextKey(), kind: "reimburse", groupId: nGroup, amountCents: 1000, expenseDate: today,
        purpose: "Folding chairs", noReceiptClaimed: true,
      }));
      if (saved.kind !== "ok") throw new Error("save failed");
      const sub = await requests.submitRequest(askerActor, { requestId: saved.requestId, expectedRevision: saved.revision });
      if (sub.kind !== "ok") throw new Error("submit failed");
      sent.spy.mockClear();

      const result = await decisions.approveRequest(soleActor, { requestId: saved.requestId, expectedRevision: sub.revision, path: "override" });
      expect(result).toEqual({ kind: "refused", outcome: "needs_second_payer" });
      expect((await state(saved.requestId)).status).toBe("submitted");
      expect(await auditRows("tenant.reimbursement.override_approved", saved.requestId)).toHaveLength(0);
      expect(sent.spy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  describe("returnRequest", () => {
    it("needs_info: the request is returned with the reason in its history; audited as RETURNED by the seat", async () => {
      const req = await submitted();
      const result = await decisions.returnRequest(chair, { ...req, kind: "needs_info", reason: "  Please add\tthe invoice number  " });
      expect(result).toMatchObject({ kind: "ok", returnedKind: "needs_info", decidedOn: today });
      expect(await state(req.requestId)).toMatchObject({ status: "returned" });
      const ev = (await events(req.requestId)).at(-1)!;
      expect(ev).toMatchObject({ kind: "returned", to_status: "returned", note: "Please add the invoice number", actor_user_id: chair.userId });
      const audit = await auditRows("tenant.reimbursement.returned", req.requestId);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.metadata).toEqual({ organizationId: A, requestId: req.requestId, kind: "needs_info", byRole: "seat" });
    });

    it("not_approved: the request ends; audited as NOT_APPROVED", async () => {
      const req = await submitted();
      const result = await decisions.returnRequest(leader, { ...req, kind: "not_approved", reason: "Outside this year's budget" });
      expect(result).toMatchObject({ kind: "ok", returnedKind: "not_approved" });
      expect((await state(req.requestId)).status).toBe("not_approved");
      expect(await auditRows("tenant.reimbursement.returned", req.requestId)).toHaveLength(0);
      const audit = await auditRows("tenant.reimbursement.not_approved", req.requestId);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.metadata).toEqual({ organizationId: A, requestId: req.requestId, kind: "not_approved", byRole: "seat" });
    });

    it("EC22: tells ONLY the requester - sent back / wasn't approved - and the reason is in no notice and no audit row", async () => {
      const sentBack = await submitted();
      await decisions.returnRequest(chair, { ...sentBack, kind: "needs_info", reason: "Marigold receipt is blurry" });
      const notBack = await submitted();
      await decisions.returnRequest(chair, { ...notBack, kind: "not_approved", reason: "Marigold is not in the budget" });

      const a = await noticesFor(sentBack.requestId);
      expect(a.filter((r) => r.template_key !== "reimbursement.notice.needs_approval").map((r) => [r.to_email, r.subject])).toEqual([
        [mail.requester, "Your reimbursement request was sent back"],
      ]);
      const b = await noticesFor(notBack.requestId);
      expect(b.filter((r) => r.template_key !== "reimbursement.notice.needs_approval").map((r) => [r.to_email, r.subject])).toEqual([
        [mail.requester, "Your reimbursement request wasn't approved"],
      ]);
      for (const r of [...a, ...b]) {
        for (const part of [r.subject, r.html_body, r.text_body].map(String)) expect(part).not.toMatch(/Marigold/);
      }
      for (const [action, id] of [["tenant.reimbursement.returned", sentBack.requestId], ["tenant.reimbursement.not_approved", notBack.requestId]] as const) {
        expect(JSON.stringify(await auditRows(action, id))).not.toMatch(/Marigold/);
      }
    });

    it("a missing reason is reason_required, a 301-character one reason_too_long: nothing changes, nothing is written", async () => {
      const req = await submitted();
      expect(await decisions.returnRequest(chair, { ...req, kind: "needs_info", reason: "   " })).toEqual({ kind: "refused", outcome: "reason_required" });
      expect(await decisions.returnRequest(chair, { ...req, kind: "needs_info", reason: "x".repeat(301) })).toEqual({ kind: "refused", outcome: "reason_too_long" });
      expect((await state(req.requestId)).status).toBe("submitted");
      expect(await auditRows("tenant.reimbursement.returned", req.requestId)).toHaveLength(0);
      expect(await noticesFor(req.requestId, "reimbursement.notice.requester_update")).toHaveLength(0);
    });

    it("a second send back is already_decided with the date and the status; EC40: two at once, one wins", async () => {
      const req = await submitted();
      const [a, b] = await Promise.all([
        decisions.returnRequest(chair, { ...req, kind: "needs_info", reason: "First reason" }),
        decisions.returnRequest(leader, { ...req, kind: "not_approved", reason: "Second reason" }),
      ]);
      expect([a.kind, b.kind].sort()).toEqual(["already_decided", "ok"]);
      const loser = a.kind === "already_decided" ? a : b;
      expect(loser).toMatchObject({ kind: "already_decided", decidedOn: today });
      expect(["returned", "not_approved"]).toContain((loser as { status: string }).status);
      expect((await events(req.requestId)).filter((e) => e.kind === "returned" || e.kind === "not_approved")).toHaveLength(1);
    });

    it("an approver who finds it already approved is told so (already_decided, approved), not offered a send back", async () => {
      const req = await submitted();
      await decisions.approveRequest(chair, { ...req, path: "seat" });
      expect(await decisions.returnRequest(leader, { ...req, kind: "needs_info", reason: "Too late" }))
        .toEqual({ kind: "already_decided", decidedOn: today, status: "approved" });
    });

    it("EC7: the creator cannot send back their own request; a stranger gets the neutral not_found", async () => {
      const mine = await submitted(chair);
      expect(await decisions.returnRequest(chair, { ...mine, kind: "needs_info", reason: "Self" })).toEqual({ kind: "refused", outcome: "not_returnable" });
      expect(await decisions.returnRequest(plain, { ...mine, kind: "needs_info", reason: "Nosy" })).toEqual({ kind: "refused", outcome: "not_found" });
      expect((await state(mine.requestId)).status).toBe("submitted");
    });

    it("a treasurer returns an APPROVED request for changes (byRole treasurer, approval cleared); an approver cannot, and not_approved is not allowed from approved", async () => {
      const req = await submitted();
      await decisions.approveRequest(chair, { ...req, path: "seat" });
      expect(await decisions.returnRequest(leader, { ...req, kind: "needs_info", reason: "Approver after the fact" }))
        .toMatchObject({ kind: "already_decided", status: "approved" });
      expect(await decisions.returnRequest(treasurer, { ...req, kind: "not_approved", reason: "Not allowed from approved" }))
        .toEqual({ kind: "refused", outcome: "kind_invalid" });

      const result = await decisions.returnRequest(treasurer, { ...req, kind: "needs_info", reason: "Receipt does not match" });
      expect(result).toMatchObject({ kind: "ok", returnedKind: "needs_info" });
      expect(await state(req.requestId)).toMatchObject({ status: "returned", approved_at: null, approval_path: null });
      const audit = await auditRows("tenant.reimbursement.returned", req.requestId);
      expect(audit[0]!.metadata).toMatchObject({ kind: "needs_info", byRole: "treasurer" });
    });

    it("a pay holder returns a submitted request when no one can approve it; not while a seat holder exists", async () => {
      const noSeat = await submitted(requester, session);
      expect(await decisions.returnRequest(treasurer, { ...noSeat, kind: "needs_info", reason: "Needs the minutes reference" })).toMatchObject({ kind: "ok" });
      const seated = await submitted(requester, committee);
      expect(await decisions.returnRequest(treasurer, { ...seated, kind: "needs_info", reason: "Not mine to return" })).toEqual({ kind: "refused", outcome: "not_returnable" });
    });

    it("a refused or rolled-back return writes no notice and sends nothing", async () => {
      const req = await submitted();
      sent.spy.mockClear();
      await decisions.returnRequest(chair, { ...req, kind: "needs_info", reason: "   " });
      expect(sent.spy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  describe("P3-20: the audit row and the decision commit or roll back together", () => {
    it("a failing audit insert rolls the approval back - status, event and notices - and the error reaches the caller", async () => {
      const req = await submitted();
      sent.spy.mockClear();
      auditControl.fail = true;
      await expect(decisions.approveRequest(chair, { ...req, path: "seat" })).rejects.toThrow("audit insert failed");
      auditControl.fail = false;
      expect((await state(req.requestId)).status).toBe("submitted");
      expect((await events(req.requestId)).map((e) => e.kind)).toEqual(["created", "submitted"]);
      expect(await noticesFor(req.requestId, "reimbursement.notice.ready_to_pay")).toHaveLength(0);
      expect(sent.spy).not.toHaveBeenCalled();
      // and it is still approvable afterwards
      expect(await decisions.approveRequest(chair, { ...req, path: "seat" })).toMatchObject({ kind: "ok" });
    });

    it("a failing audit insert rolls a send back back too", async () => {
      const req = await submitted();
      auditControl.fail = true;
      await expect(decisions.returnRequest(chair, { ...req, kind: "needs_info", reason: "Rolled back" })).rejects.toThrow("audit insert failed");
      auditControl.fail = false;
      expect((await state(req.requestId)).status).toBe("submitted");
      expect(await noticesFor(req.requestId, "reimbursement.notice.requester_update")).toHaveLength(0);
    });
  });

  // =========================================================================
  describe("EC22: a missing address or origin never holds a decision hostage", () => {
    it("a null platform origin writes NO notice and the approval still commits", async () => {
      const req = await submitted();
      sent.spy.mockClear();
      originControl.none = true;
      const result = await decisions.approveRequest(chair, { ...req, path: "seat" });
      originControl.none = false;
      expect(result).toMatchObject({ kind: "ok" });
      expect((await state(req.requestId)).status).toBe("approved");
      expect(await noticesFor(req.requestId, "reimbursement.notice.requester_update")).toHaveLength(0);
      expect(await noticesFor(req.requestId, "reimbursement.notice.ready_to_pay")).toHaveLength(0);
      expect(sent.spy).not.toHaveBeenCalled();
      expect(await auditRows("tenant.reimbursement.approved", req.requestId)).toHaveLength(1);
    });

    it("a requester with no deliverable address gets no row and no error; the pay holders are still told", async () => {
      const quiet = await fx.member(A, "Quietrequester");
      const quietActor = actor(A, quiet);
      const req = await submitted(quietActor);
      expect(await decisions.approveRequest(chair, { ...req, path: "seat" })).toMatchObject({ kind: "ok" });
      expect(await noticesFor(req.requestId, "reimbursement.notice.requester_update")).toHaveLength(0);
      expect(recipients(await noticesFor(req.requestId, "reimbursement.notice.ready_to_pay"))).toEqual(addr("treasurer", "payer2"));
    });

    it("a do-not-contact address is never used; a Work address wins over a personal main", async () => {
      const dnc = await fx.member(A, "Dncrequester");
      await fx.email(dnc.personId, "dnc", { doNotContact: true });
      const dncReq = await submitted(actor(A, dnc));
      await decisions.approveRequest(chair, { ...dncReq, path: "seat" });
      expect(await noticesFor(dncReq.requestId, "reimbursement.notice.requester_update")).toHaveLength(0);

      const both = await fx.member(A, "Bothaddresses");
      await fx.email(both.personId, "bothmain", { subtype: "personal" });
      const work = await fx.email(both.personId, "bothwork", { subtype: "work", main: false });
      const bothReq = await submitted(actor(A, both));
      await decisions.approveRequest(chair, { ...bothReq, path: "seat" });
      const rows = await fx.queued([work]);
      expect(rows.filter((r) => String(r.text_body).includes(bothReq.requestId)).map((r) => r.template_key)).toEqual(["reimbursement.notice.requester_update"]);
    });
  });
});
