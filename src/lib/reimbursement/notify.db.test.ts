/**
 * The notices a SUBMISSION queues (notify.ts over requests.ts), against a REAL
 * Postgres connection - docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 Copy
 * C10, P3-1, P3-11, EC2, EC22, EC28. The decision-time notices (approve, send
 * back) are pinned in decisions.db.test.ts. Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/reimbursement/notify.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  },
  recordAudit: vi.fn(),
}));

const sent = vi.hoisted(() => ({ spy: vi.fn(async (_id: string) => ({ sentInline: true })) }));
vi.mock("@/lib/email/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/queue")>();
  return { ...actual, attemptQueuedSend: sent.spy };
});
const originControl = vi.hoisted(() => ({ none: false }));
vi.mock("@/lib/domains/host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/domains/host")>();
  return { ...actual, platformOrigin: () => (originControl.none ? null : actual.platformOrigin()) };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
const ALL_KEYS = ["reimbursement.request_for_others", "reimbursement.view", "reimbursement.pay", "reimbursement.manage"];

describe.skipIf(!hasDb)("the notices a submission queues (Postgres-backed)", () => {
  let fx: ReimbursementFixture;
  let requests: typeof import("./requests");
  let decisions: typeof import("./decisions");
  let input: typeof import("./input");
  let reads: typeof import("./reads");

  let A: string;
  let slug: string;
  let today: string;
  let committee: string;
  let session: string;
  let category: string;
  let requester: RequestActor;
  let chair: RequestActor;
  let treasurer: RequestActor;
  let payer2: RequestActor;
  const mail: Record<string, string> = {};
  let keySeq = 0;
  const nextKey = () => `nk${Date.now().toString(36)}${(keySeq += 1)}`.padEnd(10, "x");
  const actor = (org: string, m: { userId: string; personId: string }): RequestActor => ({
    userId: m.userId, email: null, personId: m.personId, organizationId: org,
  });

  const draft = async (who: RequestActor, groupId: string, org = A, cat: string | null = category) => {
    const saved = await requests.saveRequest(who, input.saveRequestSchema.parse({
      clientKey: nextKey(), kind: "reimburse", groupId, amountCents: 2500, expenseDate: today,
      purpose: "Hymnal repair", categoryId: cat, noReceiptClaimed: true,
    }));
    if (saved.kind !== "ok") throw new Error(`save failed ${JSON.stringify(saved)} in ${org}`);
    return saved;
  };
  const rowsFor = async (requestId: string, addresses: string[]) =>
    (await fx.queued(addresses)).filter((r) => String(r.text_body).includes(requestId));

  beforeAll(async () => {
    const mod = await import("@/lib/testing/reimbursement-fixture");
    fx = await mod.createReimbursementFixture("notify");
    requests = await import("./requests");
    decisions = await import("./decisions");
    input = await import("./input");
    reads = await import("./reads");

    A = await fx.makeOrg("main", { timeZone: "America/New_York", toggle: true });
    [{ slug }] = (await fx.q(sql`select slug from organizations where id = ${A}`)) as Array<{ slug: string }>;
    committee = await fx.makeGroup(A, "Music Committee");
    session = await fx.derivedGroup(A, "session");
    const r = await fx.member(A, "Requester");
    const c = await fx.member(A, "Chair");
    const t = await fx.member(A, "Treasurer");
    const p2 = await fx.member(A, "Payertwo");
    requester = actor(A, r);
    chair = actor(A, c);
    treasurer = actor(A, t);
    payer2 = actor(A, p2);
    await fx.seat(A, committee, c.personId, { role: "chair" });
    await fx.grant(A, await fx.makeRole(A, "treasurer_like", ALL_KEYS), t.personId);
    await fx.grant(A, await fx.makeRole(A, "payer_like", ["reimbursement.view", "reimbursement.pay"]), p2.personId);
    for (const g of [committee, session]) await fx.chargeable(A, g, t.userId);
    category = await fx.category(A, "Music", t.userId);
    for (const [tag, m] of Object.entries({ requester: r, chair: c, treasurer: t, payer2: p2 })) {
      mail[tag] = await fx.email(m.personId, tag, { subtype: "work" });
    }
    today = await reads.getOrgToday({ userId: r.userId, personId: r.personId, organizationId: A });
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  beforeEach(() => {
    sent.spy.mockClear();
    originControl.none = false;
  });

  it("route seat: the eligible approvers are told, at the member link, and the requester is not", async () => {
    const saved = await draft(requester, committee);
    const result = await requests.submitRequest(requester, { requestId: saved.requestId, expectedRevision: saved.revision });
    expect(result).toMatchObject({ kind: "ok", route: "seat", already: false });
    const rows = await rowsFor(saved.requestId, Object.values(mail));
    expect(rows.map((r) => [r.to_email, r.template_key, r.subject])).toEqual([
      [mail.chair, "reimbursement.notice.needs_approval", "A reimbursement request needs your approval"],
    ]);
    expect(String(rows[0]!.text_body)).toContain(`\nhttp`);
    expect(String(rows[0]!.text_body)).toContain(`/o/${slug}/reimbursements/${saved.requestId}\n`);
    expect(String(rows[0]!.text_body)).not.toContain("/admin/");
    expect(sent.spy.mock.calls.map((c) => c[0])).toEqual([String(rows[0]!.id)]);
  });

  it("route treasurer: every pay holder is told, at the treasury link, with the treasurer wording", async () => {
    const saved = await draft(requester, session);
    const result = await requests.submitRequest(requester, { requestId: saved.requestId, expectedRevision: saved.revision });
    expect(result).toMatchObject({ kind: "ok", route: "treasurer" });
    const rows = await rowsFor(saved.requestId, Object.values(mail));
    expect(rows.map((r) => r.to_email).sort()).toEqual([mail.payer2, mail.treasurer].sort());
    for (const r of rows) {
      expect(r.template_key).toBe("reimbursement.notice.needs_treasurer");
      expect(r.subject).toBe("A reimbursement request needs a treasurer's approval");
      expect(String(r.text_body)).toContain(`/o/${slug}/admin/reimbursements/${saved.requestId}\n`);
    }
  });

  it("route treasurer: a pay holder who entered the request is not told about their own", async () => {
    const saved = await draft(treasurer, session);
    await requests.submitRequest(treasurer, { requestId: saved.requestId, expectedRevision: saved.revision });
    const rows = await rowsFor(saved.requestId, Object.values(mail));
    expect(rows.map((r) => r.to_email)).toEqual([mail.payer2]);
  });

  it("route nobody (EC28): saved and waiting, no one to tell, no row and no send", async () => {
    const N = await fx.makeOrg("quiet", { toggle: true });
    const nGroup = await fx.makeGroup(N, "Quiet Committee");
    const lonely = await fx.member(N, "Lonely");
    const lonelyActor = actor(N, lonely);
    await fx.chargeable(N, nGroup, lonely.userId);
    const addrs = [await fx.email(lonely.personId, "lonely", { subtype: "work" })];
    const saved = await draft(lonelyActor, nGroup, N, null);
    const result = await requests.submitRequest(lonelyActor, { requestId: saved.requestId, expectedRevision: saved.revision });
    expect(result).toMatchObject({ kind: "ok", route: "nobody", notifyPersonIds: [] });
    expect(await rowsFor(saved.requestId, addrs)).toHaveLength(0);
    expect(sent.spy).not.toHaveBeenCalled();
  });

  it("EC2: a second tap on Send (already_submitted) is a success that queues and sends nothing more", async () => {
    const saved = await draft(requester, committee);
    await requests.submitRequest(requester, { requestId: saved.requestId, expectedRevision: saved.revision });
    sent.spy.mockClear();
    const again = await requests.submitRequest(requester, { requestId: saved.requestId, expectedRevision: saved.revision });
    expect(again).toMatchObject({ kind: "ok", already: true, notifyPersonIds: [] });
    expect(await rowsFor(saved.requestId, Object.values(mail))).toHaveLength(1);
    expect(sent.spy).not.toHaveBeenCalled();
  });

  it("a resubmission after a send back tells the approvers again", async () => {
    const saved = await draft(requester, committee);
    const first = await requests.submitRequest(requester, { requestId: saved.requestId, expectedRevision: saved.revision });
    if (first.kind !== "ok") throw new Error("submit failed");
    const back = await decisions.returnRequest(chair, { requestId: saved.requestId, expectedRevision: first.revision, kind: "needs_info", reason: "One more detail" });
    expect(back.kind).toBe("ok");
    const edit = await requests.saveRequest(requester, input.saveRequestSchema.parse({
      clientKey: nextKey(), requestId: saved.requestId, expectedRevision: first.revision, kind: "reimburse", groupId: committee,
      amountCents: 2600, expenseDate: today, purpose: "Hymnal repair", categoryId: category, noReceiptClaimed: true,
    }));
    if (edit.kind !== "ok") throw new Error("edit failed");
    await requests.submitRequest(requester, { requestId: saved.requestId, expectedRevision: edit.revision });
    const rows = (await rowsFor(saved.requestId, [mail.chair])).filter((r) => r.template_key === "reimbursement.notice.needs_approval");
    expect(rows).toHaveLength(2);
  });

  it("two approvers who share one inbox are told once", async () => {
    const O = await fx.makeOrg("shared", { toggle: true });
    const g = await fx.makeGroup(O, "Shared Inbox Committee");
    const one = await fx.member(O, "Onechair");
    const two = await fx.member(O, "Twochair");
    const filer = await fx.member(O, "Filer");
    await fx.seat(O, g, one.personId, { role: "chair" });
    await fx.seat(O, g, two.personId, { role: "leader" });
    await fx.chargeable(O, g, one.userId);
    const shared = await fx.email(one.personId, "shared", { subtype: "work" });
    await fx.email(two.personId, "shared2", { subtype: "work", address: shared });
    const filerActor = actor(O, filer);
    const saved = await draft(filerActor, g, O, null);
    const result = await requests.submitRequest(filerActor, { requestId: saved.requestId, expectedRevision: saved.revision });
    expect(result).toMatchObject({ kind: "ok", route: "seat" });
    expect((result as { notifyPersonIds: string[] }).notifyPersonIds).toHaveLength(2);
    expect(await rowsFor(saved.requestId, [shared])).toHaveLength(1);
  });

  it("EC22: with no safe origin nothing is queued and the submission still commits", async () => {
    const saved = await draft(requester, committee);
    originControl.none = true;
    const result = await requests.submitRequest(requester, { requestId: saved.requestId, expectedRevision: saved.revision });
    originControl.none = false;
    expect(result).toMatchObject({ kind: "ok", route: "seat" });
    expect(await rowsFor(saved.requestId, Object.values(mail))).toHaveLength(0);
    expect(sent.spy).not.toHaveBeenCalled();
    const [row] = await fx.q(sql`select status from reimbursement_requests where id = ${saved.requestId}`);
    expect(row!.status).toBe("submitted");
  });

  it("an incomplete or refused submission queues nothing", async () => {
    const saved = await requests.saveRequest(requester, input.saveRequestSchema.parse({
      clientKey: nextKey(), kind: "reimburse", groupId: committee, amountCents: 100, expenseDate: today, purpose: "No receipt", categoryId: category,
    }));
    if (saved.kind !== "ok") throw new Error("save failed");
    const result = await requests.submitRequest(requester, { requestId: saved.requestId, expectedRevision: saved.revision });
    expect(result).toMatchObject({ kind: "incomplete" });
    expect(await rowsFor(saved.requestId, Object.values(mail))).toHaveLength(0);
    expect(sent.spy).not.toHaveBeenCalled();
  });
});
