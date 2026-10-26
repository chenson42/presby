/**
 * drizzle/0073_presby_reimbursements.sql, the DEFINER half, proven through
 * the presby_app connection (RLS enforced, NOBYPASSRLS) - the path the
 * application uses. docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 API
 * Contract Layer 1 and Edge Cases EC1-EC3, EC5, EC7, EC9-EC12, EC14-EC17
 * (SQL half), EC21, EC28, EC35, EC38, EC40, EC41.
 *
 * Every call commits (as the application's would); the fixture organizations'
 * teardown cascade removes the rows. Owner-connection writes appear only to
 * set up a state no definer offers (a seat that ends, a membership that ends,
 * a date that has aged).
 *
 * The outcome strings asserted here are the closed lists in 0073's section 7
 * comments; src/lib/reimbursement/outcomes.ts (Batch 2a) pins them to
 * TypeScript.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/reimbursement-definers.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { ReimbursementFixture, Row } from "@/lib/testing/reimbursement-fixture";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
const DENY = "reimbursement: not permitted";
const KEYS = ["reimbursement.request_for_others", "reimbursement.view", "reimbursement.pay", "reimbursement.manage"];

interface Actor { userId: string; personId: string }
interface Fields {
  key?: string; kind?: string; group?: string | null; beneficiary?: string | null; vendor?: string | null;
  amount?: number | null; date?: string | null; purpose?: string | null; category?: string | null;
  pre?: string | null; noReceipt?: boolean;
}

describe.skipIf(!hasDb)("drizzle/0073 reimbursement definers through presby_app (Postgres-backed)", () => {
  let fx: ReimbursementFixture;
  let pgError: (e: unknown) => { code: string | undefined; message: string };
  let keySeq = 0;
  const nextKey = () => `dk${Date.now().toString(36)}${(keySeq += 1)}`.padEnd(10, "x");

  // Main organization
  let A: string;
  let today: string;
  let committee: string; // managed, chargeable, seats: chair, leader
  let quiet: string; // managed, chargeable, no seat: the treasurer route
  let unlisted: string; // managed, NOT chargeable
  let categoryA: string;
  let requester: Actor; let staff: Actor; let visitor: Actor; let clerk: Actor;
  let chair: Actor; let leader: Actor; let t1: Actor; let t2: Actor;
  let beneficiaryNoLogin: Actor; let beneficiaryWithLogin: Actor;
  // Solo organization: one pay holder at first
  let S: string; let soloGroup: string; let soloSeated: string;
  let p1: Actor; let soloMember: Actor; let soloChair: Actor;
  // No pay holder, no seat
  let N: string; let nGroup: string; let nMember: Actor;
  // Isolation
  let B: string; let bGroup: string; let bMember: Actor;

  function day(offset: number): string {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  }
  const one = (rows: Row[]) => {
    expect(rows).toHaveLength(1);
    return rows[0]!;
  };

  async function save(org: string, actor: Actor, f: Fields = {}): Promise<Row> {
    return one(await fx.app(org, sql`select * from presby_reimbursement_save_draft(
      ${f.key ?? nextKey()}, ${f.kind ?? "reimburse"}, ${f.group === undefined ? committee : f.group}::uuid,
      ${f.beneficiary ?? null}::uuid, ${f.vendor ?? null}, ${f.amount === undefined ? 1250 : f.amount}::integer,
      ${f.date === undefined ? day(-3) : f.date}::date, ${f.purpose === undefined ? "Fixture purchase" : f.purpose},
      ${f.category === undefined ? categoryA : f.category}::uuid, ${f.pre ?? null}, ${f.noReceipt ?? true}, ${actor.userId}::uuid)`));
  }
  async function update(org: string, actor: Actor, id: string, rev: number, f: Fields = {}): Promise<Row> {
    return one(await fx.app(org, sql`select * from presby_reimbursement_update_request(
      ${id}::uuid, ${rev}::integer, ${f.kind ?? "reimburse"}, ${f.group === undefined ? committee : f.group}::uuid,
      ${f.beneficiary ?? null}::uuid, ${f.vendor ?? null}, ${f.amount === undefined ? 1250 : f.amount}::integer,
      ${f.date === undefined ? day(-3) : f.date}::date, ${f.purpose === undefined ? "Fixture purchase" : f.purpose},
      ${f.category === undefined ? categoryA : f.category}::uuid, ${f.pre ?? null}, ${f.noReceipt ?? true}, ${actor.userId}::uuid)`));
  }
  const submit = async (org: string, actor: Actor, id: string, rev: number) =>
    one(await fx.app(org, sql`select * from presby_reimbursement_submit(${id}::uuid, ${rev}::integer, ${actor.userId}::uuid)`));
  const approve = async (org: string, actor: Actor, id: string, rev: number, path = "seat") =>
    one(await fx.app(org, sql`select * from presby_reimbursement_approve(${id}::uuid, ${rev}::integer, ${path}, ${actor.userId}::uuid)`));
  const sendBack = async (org: string, actor: Actor, id: string, rev: number, kind: string, reason: string | null) =>
    one(await fx.app(org, sql`select * from presby_reimbursement_return(${id}::uuid, ${rev}::integer, ${kind}, ${reason}, ${actor.userId}::uuid)`));
  const withdraw = async (org: string, actor: Actor, id: string, reason: string | null = null) =>
    one(await fx.app(org, sql`select * from presby_reimbursement_withdraw(${id}::uuid, ${reason}, ${actor.userId}::uuid)`));
  const recordPayment = async (org: string, actor: Actor, id: string,
    opts: { method?: string; reference?: string | null; paidOn?: string; note?: string | null } = {}) =>
    one(await fx.app(org, sql`select * from presby_reimbursement_record_payment(${id}::uuid, ${opts.method ?? "check"},
      ${opts.reference === undefined ? "3001" : opts.reference}, ${opts.paidOn ?? today}::date, ${opts.note ?? null}, ${actor.userId}::uuid)`));
  const reverse = async (org: string, actor: Actor, id: string, reason: string | null) =>
    one(await fx.app(org, sql`select * from presby_reimbursement_reverse_payment(${id}::uuid, ${reason}, ${actor.userId}::uuid)`));
  const waive = async (org: string, actor: Actor, id: string, note: string | null = null) =>
    one(await fx.app(org, sql`select * from presby_reimbursement_waive_receipt(${id}::uuid, ${note}, ${actor.userId}::uuid)`));
  const voidIt = async (org: string, actor: Actor, id: string, reason: string | null) =>
    one(await fx.app(org, sql`select * from presby_reimbursement_void(${id}::uuid, ${reason}, ${actor.userId}::uuid)`));
  const detail = async (org: string, actor: Actor, id: string, level = "member") =>
    one(await fx.app(org, sql`select presby_reimbursement_detail(${id}::uuid, ${actor.userId}::uuid, ${level}) as d`)).d as
      Record<string, unknown> | null;

  /** Draft (no receipt claimed) and submit; returns id and revision. */
  async function filed(org: string, actor: Actor, f: Fields = {}): Promise<{ id: string; rev: number }> {
    const s = await save(org, actor, f);
    expect(s.outcome, JSON.stringify(s)).toBe("ok");
    const sub = await submit(org, actor, String(s.request_id), Number(s.revision));
    expect(sub.outcome, JSON.stringify(sub)).toBe("ok");
    return { id: String(s.request_id), rev: Number(sub.revision) };
  }

  /** Draft, a stored receipt attached, submit. */
  async function filedWithReceipt(org: string, actor: Actor, f: Fields = {}): Promise<{ id: string; rev: number }> {
    const s = await save(org, actor, { ...f, noReceipt: false });
    expect(s.outcome, JSON.stringify(s)).toBe("ok");
    const b = await fx.blob(org);
    const a = one(await fx.app(org, sql`select * from presby_reimbursement_attach_receipt(${s.request_id}::uuid, ${b.id}::uuid,
      ${b.sha}, 'image/jpeg', 3, 'receipt.jpg', ${actor.userId}::uuid)`));
    expect(a.outcome).toBe("ok");
    const sub = await submit(org, actor, String(s.request_id), 2);
    expect(sub.outcome, JSON.stringify(sub)).toBe("ok");
    return { id: String(s.request_id), rev: Number(sub.revision) };
  }

  async function expectDeny(run: () => Promise<unknown>) {
    let caught: unknown;
    try {
      await run();
    } catch (err) {
      caught = err;
    }
    const e = pgError(caught);
    expect(e.code).toBe("42501");
    expect(e.message).toBe(DENY);
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/reimbursement-fixture");
    pgError = mod.pgError;
    fx = await mod.createReimbursementFixture("def");

    A = await fx.makeOrg("main", { timeZone: "America/Chicago" });
    committee = await fx.makeGroup(A, "Finance Committee");
    quiet = await fx.makeGroup(A, "Quiet Committee");
    unlisted = await fx.makeGroup(A, "Unlisted Committee");
    requester = await fx.member(A, "Requester");
    staff = await fx.member(A, "Staffer", { engagement: "staff", roll: null });
    visitor = await fx.member(A, "Visitor", { engagement: "visitor", roll: null });
    clerk = await fx.member(A, "Clerk");
    chair = await fx.member(A, "Chair");
    leader = await fx.member(A, "Leader");
    t1 = await fx.member(A, "TreasurerOne");
    t2 = await fx.member(A, "TreasurerTwo");
    beneficiaryNoLogin = await fx.member(A, "Nologin", { withUser: false });
    beneficiaryWithLogin = await fx.member(A, "Withlogin");
    await fx.seat(A, committee, chair.personId, { role: "chair" });
    await fx.seat(A, committee, leader.personId, { role: "leader" });
    await fx.seat(A, quiet, requester.personId, { role: "member" }); // a plain member row is no seat
    const treasurerA = await fx.makeRole(A, "treasurer_like", KEYS);
    await fx.grant(A, treasurerA, t1.personId);
    await fx.grant(A, treasurerA, t2.personId);
    const clerkRole = await fx.makeRole(A, "clerk_like", ["reimbursement.request_for_others"]);
    await fx.grant(A, clerkRole, clerk.personId);
    await fx.chargeable(A, committee, t1.userId);
    await fx.chargeable(A, quiet, t1.userId);
    categoryA = await fx.category(A, "Supplies", t1.userId);
    today = String(one(await fx.q(sql`select presby_reimbursement__local_date(${A}, now())::text as d`)).d);

    S = await fx.makeOrg("solo");
    soloGroup = await fx.makeGroup(S, "Solo Unseated");
    soloSeated = await fx.makeGroup(S, "Solo Seated");
    p1 = await fx.member(S, "PayerOne");
    soloMember = await fx.member(S, "SoloMember");
    soloChair = await fx.member(S, "SoloChair");
    await fx.seat(S, soloSeated, soloChair.personId);
    const treasurerS = await fx.makeRole(S, "treasurer_like", KEYS);
    await fx.grant(S, treasurerS, p1.personId);
    await fx.chargeable(S, soloGroup, p1.userId);
    await fx.chargeable(S, soloSeated, p1.userId);

    N = await fx.makeOrg("none");
    nGroup = await fx.makeGroup(N, "Nobody Committee");
    nMember = await fx.member(N, "Lonely");
    await fx.chargeable(N, nGroup, nMember.userId);

    B = await fx.makeOrg("other");
    bGroup = await fx.makeGroup(B, "Other Committee");
    bMember = await fx.member(B, "Elsewhere");
    await fx.chargeable(B, bGroup, bMember.userId);
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  // =========================================================================
  describe("save_draft and update_request", () => {
    it("EC1 (P3-5): one client key is one request; the second save returns it untouched", async () => {
      const key = nextKey();
      const first = await save(A, requester, { key, amount: 500 });
      expect(first).toMatchObject({ outcome: "ok", created: true, revision: 1 });
      const second = await save(A, requester, { key, amount: 999, purpose: "Different" });
      expect(second).toMatchObject({ outcome: "ok", created: false, request_id: first.request_id, revision: 1 });
      expect((await detail(A, requester, String(first.request_id)))!.amountCents).toBe(500);
    });

    it("refuses a malformed client key, an ineligible requester, and an unknown kind", async () => {
      expect((await save(A, requester, { key: "short" })).outcome).toBe("invalid_shape");
      expect((await save(A, visitor)).outcome).toBe("not_eligible");
      expect((await save(A, staff)).outcome).toBe("ok"); // staff anchors file (DECISION-269)
      expect((await save(A, requester, { kind: "loan" })).outcome).toBe("kind_invalid");
    });

    it("EC3: the amount is an integer 1..10,000,000 cents; nothing outside it is saved", async () => {
      expect((await save(A, requester, { amount: 0 })).outcome).toBe("amount_out_of_range");
      expect((await save(A, requester, { amount: 10_000_001 })).outcome).toBe("amount_out_of_range");
      expect((await save(A, requester, { amount: -5 })).outcome).toBe("amount_out_of_range");
      expect((await save(A, requester, { amount: 10_000_000 })).outcome).toBe("ok");
      expect((await save(A, requester, { amount: null })).outcome).toBe("ok"); // a draft may lack it
    });

    it("EC35 (P3-18): the expense date is org-local, not in the future, not more than 365 days back", async () => {
      expect((await save(A, requester, { date: day(1) })).outcome).toBe("date_out_of_range");
      expect((await save(A, requester, { date: day(-366) })).outcome).toBe("date_out_of_range");
      expect((await save(A, requester, { date: day(-365) })).outcome).toBe("ok");
      expect((await save(A, requester, { date: day(0) })).outcome).toBe("ok");
    });

    it("EC35: an unchanged old date is not re-checked on update; a changed one is", async () => {
      const s = await save(A, requester);
      const id = String(s.request_id);
      await fx.q(sql`update reimbursement_requests set expense_date = ${day(-400)}::date where id = ${id}`);
      const unchanged = await update(A, requester, id, 2, { date: day(-400), amount: 1300 });
      expect(unchanged).toMatchObject({ outcome: "ok", revision: 3 });
      expect((await update(A, requester, id, 3, { date: day(-401) })).outcome).toBe("date_out_of_range");
    });

    it("text bounds are named outcomes after cleaning; cleaning removes control, bidi and zero-width characters", async () => {
      expect((await save(A, requester, { purpose: "p".repeat(501) })).outcome).toBe("purpose_too_long");
      expect((await save(A, requester, { pre: "n".repeat(81) })).outcome).toBe("pre_approved_too_long");
      expect((await save(A, requester, { kind: "vendor", vendor: "v".repeat(121) })).outcome).toBe("vendor_too_long");
      const s = await save(A, requester, { purpose: "  Paint​ for‮ the\n\nhall\u0007 ", pre: "⁦Pat⁩" });
      const d = await detail(A, requester, String(s.request_id));
      expect(d!.purpose).toBe("Paint for the hall");
      expect(d!.preApprovedByName).toBe("Pat");
    });

    it("groups and categories: chargeable and live when set; vendor requests carry no person", async () => {
      expect((await save(A, requester, { group: unlisted })).outcome).toBe("group_not_chargeable");
      expect((await save(A, requester, { group: bGroup })).outcome).toBe("group_not_chargeable");
      const retired = await fx.category(A, `Retired ${nextKey()}`, t1.userId);
      await fx.q(sql`update reimbursement_categories set ended_at = now(), ended_by_user = ${t1.userId} where id = ${retired}`);
      expect((await save(A, requester, { category: retired })).outcome).toBe("category_unavailable");
      expect((await save(A, requester, { kind: "vendor", beneficiary: requester.personId, vendor: "Shop" })).outcome)
        .toBe("invalid_shape");
      expect((await save(A, requester, { kind: "reimburse", vendor: "Shop" })).outcome).toBe("invalid_shape");
      expect((await save(A, requester, { kind: "vendor", vendor: null })).outcome).toBe("ok");
    });

    it("EC15: naming someone else needs request_for_others, checked before the person (who must be a live member)", async () => {
      expect((await save(A, requester, { beneficiary: beneficiaryNoLogin.personId })).outcome).toBe("not_allowed_for_others");
      expect((await save(A, requester, { beneficiary: bMember.personId })).outcome).toBe("not_allowed_for_others");
      expect((await save(A, clerk, { beneficiary: bMember.personId })).outcome).toBe("beneficiary_unavailable");
      const s = await save(A, clerk, { beneficiary: beneficiaryNoLogin.personId });
      expect(s.outcome).toBe("ok");
      const d = await detail(A, clerk, String(s.request_id));
      expect(d!.enteredOnBehalf).toBe(true);
      expect((d!.payee as Row).personId).toBe(beneficiaryNoLogin.personId);
    });

    it("EC41: 20 open drafts per user, the 21st is too_many_drafts", async () => {
      const busy = await fx.member(A, "Busy");
      for (let i = 0; i < 20; i += 1) expect((await save(A, busy)).outcome).toBe("ok");
      expect((await save(A, busy)).outcome).toBe("too_many_drafts");
    });

    it("update: only the creator, only while draft or returned, on the revision seen; frozen fields after the first submit", async () => {
      const s = await save(A, requester);
      const id = String(s.request_id);
      expect((await update(A, chair, id, 1)).outcome).toBe("not_found");
      expect((await update(A, requester, id, 9)).outcome).toBe("changed_since_viewed");
      expect(await update(A, requester, id, 1, { amount: 1400 })).toMatchObject({ outcome: "ok", revision: 2 });
      expect(await update(A, requester, id, 2, { amount: 1400 })).toMatchObject({ outcome: "ok", revision: 2 }); // no change, no bump
      const sub = await submit(A, requester, id, 2);
      expect(sub.outcome).toBe("ok");
      expect((await update(A, requester, id, 2)).outcome).toBe("not_editable");
      expect((await sendBack(A, chair, id, 2, "needs_info", "Which store?")).outcome).toBe("ok");
      expect((await update(A, requester, id, 2, { amount: 1400, group: quiet })).outcome).toBe("invalid_shape");
      expect(await update(A, requester, id, 2, { amount: 1450 })).toMatchObject({ outcome: "ok", revision: 3 });
    });
  });

  // =========================================================================
  describe("submit and withdraw", () => {
    it("incomplete names every missing piece; the receipt counts only without no_receipt_claimed", async () => {
      const s = await save(A, requester, { amount: null, date: null, purpose: null, category: null, noReceipt: false });
      const r = await submit(A, requester, String(s.request_id), 1);
      expect(r.outcome).toBe("incomplete");
      expect(r.missing).toEqual(["amount", "date", "purpose", "category", "receipt"]);
    });

    it("EC38: a vendor request needs the vendor's name at submit", async () => {
      const s = await save(A, requester, { kind: "vendor", vendor: null });
      expect((await submit(A, requester, String(s.request_id), 1)).missing).toEqual(["payee"]);
    });

    it("EC2: submit is idempotent; the route is computed live (EC28: seat, treasurer, nobody)", async () => {
      const s = await save(A, requester);
      const first = await submit(A, requester, String(s.request_id), 1);
      expect(first.route).toBe("seat");
      expect([...(first.notify_person_ids as string[])].sort()).toEqual([chair.personId, leader.personId].sort());
      expect((await submit(A, requester, String(s.request_id), 1)).outcome).toBe("already_submitted");

      const q = await save(A, requester, { group: quiet });
      const qr = await submit(A, requester, String(q.request_id), 1);
      expect(qr.route).toBe("treasurer");
      expect([...(qr.notify_person_ids as string[])].sort()).toEqual([t1.personId, t2.personId].sort());

      const n = await save(N, nMember, { group: nGroup, category: null });
      expect(await submit(N, nMember, String(n.request_id), 1)).toMatchObject({ outcome: "ok", route: "nobody", notify_person_ids: [] });
      expect(one(await fx.app(N, sql`select presby_reimbursement_pay_holder_count() as n`)).n).toBe(0);
    });

    it("EC14: a group no longer chargeable refuses a first submit but keeps the requests it already took", async () => {
      const g = await fx.makeGroup(A, `Ending ${nextKey()}`);
      await fx.seat(A, g, chair.personId);
      const row = await fx.chargeable(A, g, t1.userId);
      const taken = await filed(A, requester, { group: g });
      expect((await sendBack(A, chair, taken.id, taken.rev, "needs_info", "Fix it")).outcome).toBe("ok");
      const fresh = await save(A, requester, { group: g });
      await fx.q(sql`update reimbursement_chargeable_groups set ended_at = now(), ended_by_user = ${t1.userId} where id = ${row}`);
      expect((await submit(A, requester, String(fresh.request_id), 1)).outcome).toBe("group_not_chargeable");
      expect((await submit(A, requester, taken.id, taken.rev)).outcome).toBe("ok");
    });

    it("EC12: a requester who is no longer eligible cannot file or submit", async () => {
      const lapsing = await fx.member(A, "Lapsing");
      const s = await save(A, lapsing);
      await fx.q(sql`update memberships set engagement_status = 'visitor', current_roll = null
                      where person_id = ${lapsing.personId} and organization_id = ${A}`);
      expect((await submit(A, lapsing, String(s.request_id), 1)).outcome).toBe("not_eligible");
      expect((await save(A, lapsing)).outcome).toBe("not_eligible");
    });

    it("withdraw: the creator, or the beneficiary with a login once submitted; never from paid", async () => {
      const s = await save(A, clerk, { beneficiary: beneficiaryWithLogin.personId });
      const id = String(s.request_id);
      expect((await withdraw(A, beneficiaryWithLogin, id)).outcome).toBe("not_found"); // a draft is the creator's alone
      expect((await submit(A, clerk, id, 1)).outcome).toBe("ok");
      expect((await withdraw(A, chair, id)).outcome).toBe("not_found"); // a seat is not a party
      expect((await withdraw(A, beneficiaryWithLogin, id, "x".repeat(301))).outcome).toBe("reason_too_long");
      expect((await withdraw(A, beneficiaryWithLogin, id, "Not needed")).outcome).toBe("ok");
      expect((await withdraw(A, clerk, id)).outcome).toBe("not_withdrawable");
      expect((await submit(A, clerk, id, 1)).outcome).toBe("not_editable");
    });
  });

  // =========================================================================
  describe("approve and send back", () => {
    it("EC5, EC7: the requester cannot approve; a stale revision is changed_since_viewed; twice is already_decided", async () => {
      const r = await filed(A, requester);
      expect((await approve(A, requester, r.id, r.rev)).outcome).toBe("not_approvable");
      expect((await approve(A, chair, r.id, r.rev + 1)).outcome).toBe("changed_since_viewed");
      const ok = await approve(A, chair, r.id, r.rev);
      expect(ok).toMatchObject({ outcome: "ok", current_status: "approved", decided_on: today,
        notify_requester_person_id: requester.personId });
      expect([...(ok.notify_pay_person_ids as string[])].sort()).toEqual([t1.personId, t2.personId].sort());
      expect(await approve(A, leader, r.id, r.rev)).toMatchObject({ outcome: "already_decided", current_status: "approved", decided_on: today });
      expect((await approve(A, beneficiaryWithLogin, r.id, r.rev)).outcome).toBe("not_found"); // no relation
    });

    it("EC5: an approve on the revision seen before a return-edit-resubmit is changed_since_viewed", async () => {
      const r = await filed(A, requester);
      expect((await sendBack(A, chair, r.id, r.rev, "needs_info", "Receipt total?")).outcome).toBe("ok");
      expect((await update(A, requester, r.id, r.rev, { amount: 1999 })).outcome).toBe("ok");
      expect((await submit(A, requester, r.id, r.rev + 1)).outcome).toBe("ok");
      expect((await approve(A, chair, r.id, r.rev)).outcome).toBe("changed_since_viewed");
      expect((await approve(A, chair, r.id, r.rev + 1)).outcome).toBe("ok");
    });

    it("EC11: a seat that ends mid-queue loses the queue row and the right to approve at once", async () => {
      const g = await fx.makeGroup(A, `Mid ${nextKey()}`);
      await fx.chargeable(A, g, t1.userId);
      const seatRow = await fx.seat(A, g, leader.personId, { role: "leader" });
      const r = await filed(A, requester, { group: g });
      const queued = await fx.app(A, sql`select id from presby_reimbursement_waiting_for_me(${leader.userId}::uuid)`);
      expect(queued.map((x) => x.id)).toContain(r.id);
      await fx.q(sql`update group_memberships set ends_on = current_date where id = ${seatRow}`);
      const after = await fx.app(A, sql`select id from presby_reimbursement_waiting_for_me(${leader.userId}::uuid)`);
      expect(after.map((x) => x.id)).not.toContain(r.id);
      expect((await approve(A, leader, r.id, r.rev)).outcome).toBe("not_found");
    });

    it("EC10: override needs pay, no eligible seat, and a second pay holder; it is stamped override", async () => {
      const r = await filed(S, soloMember, { group: soloGroup, category: null });
      expect((await approve(S, p1, r.id, r.rev, "override")).outcome).toBe("needs_second_payer");
      await expectDeny(() => approve(S, soloMember, r.id, r.rev, "override"));
      const seated = await filed(A, requester);
      expect((await approve(A, t1, seated.id, seated.rev, "override")).outcome).toBe("seat_holder_exists");
      const q = await filed(A, requester, { group: quiet });
      expect(await approve(A, t1, q.id, q.rev, "override")).toMatchObject({ outcome: "ok", current_status: "approved" });
      const d = await detail(A, t2, q.id, "treasury");
      expect((d!.approval as Row).path).toBe("override");
      expect((d!.history as Row[]).map((h) => h.kind)).toContain("override_approved");
      const asMember = await detail(A, requester, q.id, "member");
      expect((asMember!.history as Row[]).map((h) => h.kind)).toEqual(["created", "submitted", "approved"]);
    });

    it("override by the creator's own side is not_approvable", async () => {
      const q = await filed(A, t1, { group: quiet });
      expect((await approve(A, t1, q.id, q.rev, "override")).outcome).toBe("not_approvable");
    });

    it("send back: reasons are required and bounded; kinds are closed; a pay holder may send back an approved request", async () => {
      const r = await filed(A, requester);
      expect((await sendBack(A, chair, r.id, r.rev, "needs_info", "   ")).outcome).toBe("reason_required");
      expect((await sendBack(A, chair, r.id, r.rev, "needs_info", "x".repeat(301))).outcome).toBe("reason_too_long");
      expect((await sendBack(A, chair, r.id, r.rev, "maybe", "x")).outcome).toBe("kind_invalid");
      expect((await sendBack(A, t1, r.id, r.rev, "not_approved", "No")).outcome).toBe("not_returnable"); // a seat exists
      expect(await sendBack(A, chair, r.id, r.rev, "not_approved", "Not a church expense"))
        .toMatchObject({ outcome: "ok", current_status: "not_approved" });
      expect((await sendBack(A, leader, r.id, r.rev, "needs_info", "x")).outcome).toBe("already_decided");
      expect((await detail(A, requester, r.id))!.latestReason).toBe("Not a church expense");

      const a = await filed(A, requester);
      expect((await approve(A, chair, a.id, a.rev)).outcome).toBe("ok");
      expect((await sendBack(A, chair, a.id, a.rev, "needs_info", "x")).outcome).toBe("already_decided");
      expect((await sendBack(A, t1, a.id, a.rev, "not_approved", "x")).outcome).toBe("kind_invalid");
      expect(await sendBack(A, t1, a.id, a.rev, "needs_info", "Wrong group")).toMatchObject({ outcome: "ok", current_status: "returned" });
      expect((await detail(A, requester, a.id))!.approvedOn).toBeNull();
    });

    it("EC40: two approvers at once - exactly one wins, the other is already_decided", async () => {
      const r = await filed(A, requester);
      const results = await Promise.all([approve(A, chair, r.id, r.rev), approve(A, leader, r.id, r.rev)]);
      expect(results.map((x) => x.outcome).sort()).toEqual(["already_decided", "ok"]);
      const events = await fx.q(sql`select count(*)::int as n from reimbursement_events where request_id = ${r.id} and kind = 'approved'`);
      expect(events[0]!.n).toBe(1);
    });
  });

  // =========================================================================
  describe("payments, waiver, void, notes", () => {
    it("EC8, D6: the approver cannot pay; another pay holder can", async () => {
      const q = await filedWithReceipt(A, requester, { group: quiet });
      expect((await approve(A, t1, q.id, q.rev, "override")).outcome).toBe("ok");
      expect((await recordPayment(A, t1, q.id)).outcome).toBe("payer_is_approver");
      expect(await recordPayment(A, t2, q.id)).toMatchObject({ outcome: "ok", self_paid: false,
        notify_requester_person_id: requester.personId });
      expect((await recordPayment(A, t2, q.id)).outcome).toBe("already_paid");
    });

    it("EC9: a requester who is the sole effective pay holder may pay, stamped self_paid; with another holder, needs_another_payer", async () => {
      // Nobody else can waive a sole holder's own receipt (D5), so it is attached.
      const first = await filedWithReceipt(S, p1, { group: soloSeated, category: null });
      expect((await approve(S, soloChair, first.id, first.rev)).outcome).toBe("ok");
      expect(await recordPayment(S, p1, first.id)).toMatchObject({ outcome: "ok", self_paid: true });

      const p2 = await fx.member(S, "PayerTwo");
      const role = await fx.makeRole(S, "second_payer", ["reimbursement.pay"]);
      await fx.grant(S, role, p2.personId);
      const second = await filedWithReceipt(S, p1, { group: soloSeated, category: null });
      expect((await approve(S, soloChair, second.id, second.rev)).outcome).toBe("ok");
      expect((await recordPayment(S, p1, second.id)).outcome).toBe("needs_another_payer");
      expect(await recordPayment(S, p2, second.id)).toMatchObject({ outcome: "ok", self_paid: false });
      expect(one(await fx.app(S, sql`select presby_reimbursement_pay_holder_count() as n`)).n).toBe(2);
    });

    it("payment input outcomes, in order", async () => {
      const r = await filed(A, requester);
      expect((await recordPayment(A, t2, r.id)).outcome).toBe("not_payable");
      expect((await approve(A, chair, r.id, r.rev)).outcome).toBe("ok");
      expect((await recordPayment(A, t2, r.id, { method: "wire" })).outcome).toBe("method_invalid");
      expect((await recordPayment(A, t2, r.id, { reference: null })).outcome).toBe("reference_required");
      expect((await recordPayment(A, t2, r.id, { reference: "9".repeat(41) })).outcome).toBe("reference_too_long");
      expect((await recordPayment(A, t2, r.id, { paidOn: day(1) })).outcome).toBe("date_out_of_range");
      expect((await recordPayment(A, t2, r.id, { paidOn: day(-30) })).outcome).toBe("date_out_of_range"); // before the expense
      expect((await recordPayment(A, t2, r.id, { note: "n".repeat(301) })).outcome).toBe("note_too_long");
      expect((await recordPayment(A, chair, r.id).catch((e) => pgError(e).message))).toBe(DENY); // no pay key: identity
      expect((await recordPayment(A, t2, r.id)).outcome).toBe("receipt_missing");
      await expectDeny(() => waive(A, requester, r.id)); // not a pay holder: identity
    });

    it("waiver: once, not on one's own request, not with a live receipt", async () => {
      const r = await filed(A, requester);
      expect((await approve(A, chair, r.id, r.rev)).outcome).toBe("ok");
      const own = await filed(A, t1, { group: committee });
      expect((await waive(A, t1, own.id)).outcome).toBe("not_waivable");
      expect((await waive(A, t1, r.id, "n".repeat(301))).outcome).toBe("note_too_long");
      expect((await waive(A, t1, r.id, "Lost at the store")).outcome).toBe("ok");
      expect((await waive(A, t2, r.id)).outcome).toBe("not_waivable");
      expect((await recordPayment(A, t2, r.id, { method: "cash", reference: null })).outcome).toBe("ok");
      const d = await detail(A, requester, r.id);
      expect(d).toMatchObject({ status: "paid", receiptWaived: true, paidOn: today });
      expect(d).not.toHaveProperty("waiver");
    });

    it("EC32: reverse returns the request to approved and keeps both rows; void and notes", async () => {
      const r = await filed(A, requester);
      expect((await approve(A, chair, r.id, r.rev)).outcome).toBe("ok");
      expect((await waive(A, t1, r.id)).outcome).toBe("ok");
      expect((await reverse(A, t1, r.id, "x")).outcome).toBe("not_reversible");
      expect((await recordPayment(A, t1, r.id)).outcome).toBe("ok");
      expect((await reverse(A, t2, r.id, " ")).outcome).toBe("reason_required");
      expect((await voidIt(A, t2, r.id, "x")).outcome).toBe("not_voidable");
      expect((await reverse(A, t2, r.id, "Bounced check")).outcome).toBe("ok");
      const d = await detail(A, t1, r.id, "treasury");
      expect(d!.status).toBe("approved");
      expect((d!.payments as Row[]).map((p) => p.kind)).toEqual(["payment", "reversal"]);
      expect((await voidIt(A, t2, r.id, null)).outcome).toBe("reason_required");
      expect(await voidIt(A, t2, r.id, "Paid from petty cash instead")).toMatchObject({ outcome: "ok" });
      const note = one(await fx.app(A, sql`select * from presby_reimbursement_add_note(${r.id}::uuid, 'Filed with Q3', ${t1.userId}::uuid)`));
      expect(note.outcome).toBe("ok");
      const empty = one(await fx.app(A, sql`select * from presby_reimbursement_add_note(${r.id}::uuid, ' ', ${t1.userId}::uuid)`));
      expect(empty.outcome).toBe("note_required");
      const member = await detail(A, requester, r.id);
      expect(member!.status).toBe("voided");
      expect((member!.history as Row[]).some((h) => h.kind === "note")).toBe(false);
      expect((member!.history as Row[]).find((h) => h.kind === "voided")).not.toHaveProperty("note");
      const treasury = await detail(A, t1, r.id, "treasury");
      expect((treasury!.history as Row[]).find((h) => h.kind === "note")).toMatchObject({ note: "Filed with Q3" });
    });

    it("EC12: an approved request stays payable after the requester's membership ends", async () => {
      const leaving = await fx.member(A, "Leaving");
      const r = await filed(A, leaving);
      expect((await approve(A, chair, r.id, r.rev)).outcome).toBe("ok");
      expect((await waive(A, t1, r.id)).outcome).toBe("ok");
      await fx.q(sql`update memberships set ended_on = current_date, ended_reason = 'moved away'
                      where person_id = ${leaving.personId} and organization_id = ${A}`);
      await expectDeny(() => detail(A, leaving, r.id));
      expect((await recordPayment(A, t2, r.id, { method: "ach", reference: null })).outcome).toBe("ok");
    });
  });

  // =========================================================================
  describe("receipts", () => {
    it("preflight, attach and detach: creator only, draft or returned, five at most, one hash once, the blob at this org", async () => {
      const s = await save(A, requester, { noReceipt: false });
      const id = String(s.request_id);
      const pre = one(await fx.app(A, sql`select * from presby_reimbursement_receipt_preflight(${id}::uuid, ${requester.userId}::uuid)`));
      expect(pre).toMatchObject({ outcome: "ok", live_count: 0 });
      expect(one(await fx.app(A, sql`select * from presby_reimbursement_receipt_preflight(${id}::uuid, ${chair.userId}::uuid)`)).outcome)
        .toBe("not_found");
      const attach = async (blobId: string, sha: string, type = "image/jpeg", size = 3) =>
        one(await fx.app(A, sql`select * from presby_reimbursement_attach_receipt(${id}::uuid, ${blobId}::uuid, ${sha},
          ${type}, ${size}::integer, 'receipt.jpg', ${requester.userId}::uuid)`));
      const foreign = await fx.blob(B);
      expect((await attach(foreign.id, foreign.sha)).outcome).toBe("invalid_shape");
      const local = await fx.blob(A);
      expect((await attach(local.id, local.sha, "application/pdf")).outcome).toBe("invalid_shape");
      expect((await attach(local.id, local.sha, "image/jpeg", 4)).outcome).toBe("invalid_shape");
      const first = await attach(local.id, local.sha);
      expect(first.outcome).toBe("ok");
      expect((await attach(local.id, local.sha)).outcome).toBe("duplicate_in_request");
      for (let i = 0; i < 4; i += 1) {
        const b = await fx.blob(A);
        expect((await attach(b.id, b.sha)).outcome).toBe("ok");
      }
      const extra = await fx.blob(A);
      expect((await attach(extra.id, extra.sha)).outcome).toBe("too_many_receipts");
      expect(one(await fx.app(A, sql`select * from presby_reimbursement_receipt_preflight(${id}::uuid, ${requester.userId}::uuid)`)))
        .toMatchObject({ outcome: "too_many_receipts", live_count: 5 });
      const detach = async (attachmentId: string, actor: Actor = requester) =>
        one(await fx.app(A, sql`select * from presby_reimbursement_detach_receipt(${id}::uuid, ${attachmentId}::uuid, ${actor.userId}::uuid)`));
      expect((await detach(String(first.attachment_id), chair)).outcome).toBe("not_found");
      expect((await detach(String(first.attachment_id))).outcome).toBe("ok");
      expect((await detach(String(first.attachment_id))).outcome).toBe("not_found");
      const lookup = await fx.app(A, sql`select * from presby_reimbursement_attachment_lookup(${id}::uuid,
        ${first.attachment_id}::uuid, ${requester.userId}::uuid)`);
      expect(lookup).toHaveLength(0); // detached
      const sub = await submit(A, requester, id, Number(one(await fx.q(sql`select revision from reimbursement_requests where id = ${id}`)).revision));
      expect(sub.outcome).toBe("ok");
      expect(one(await fx.app(A, sql`select * from presby_reimbursement_receipt_preflight(${id}::uuid, ${requester.userId}::uuid)`)).outcome)
        .toBe("not_editable");
    });

    it("EC21 (P3-21): the duplicate flag reaches seats and treasury, never the requester; treasury also gets the earlier id", async () => {
      const shared = await fx.blob(A);
      const attachTo = async (actor: Actor, id: string) =>
        one(await fx.app(A, sql`select * from presby_reimbursement_attach_receipt(${id}::uuid, ${shared.id}::uuid, ${shared.sha},
          'image/jpeg', 3, 'same.jpg', ${actor.userId}::uuid)`));
      const earlier = await save(A, requester, { noReceipt: false });
      expect((await attachTo(requester, String(earlier.request_id))).outcome).toBe("ok");
      expect((await submit(A, requester, String(earlier.request_id), 2)).outcome).toBe("ok");
      const later = await save(A, staff, { noReceipt: false });
      expect((await attachTo(staff, String(later.request_id))).outcome).toBe("ok");
      expect((await submit(A, staff, String(later.request_id), 2)).outcome).toBe("ok");
      expect((await detail(A, staff, String(later.request_id)))!.duplicateReceipt).toBeNull();
      expect((await detail(A, chair, String(later.request_id)))!.duplicateReceipt).toBe(true);
      const t = await detail(A, t1, String(later.request_id), "treasury");
      expect(t).toMatchObject({ duplicateReceipt: true, duplicateRequestIds: [earlier.request_id] });
      expect((await detail(A, t1, String(earlier.request_id), "treasury"))!.duplicateReceipt).toBe(false);
      const look = await fx.app(A, sql`select * from presby_reimbursement_attachment_lookup(${later.request_id}::uuid,
        ${(t!.receipts as Row[])[0]!.id}::uuid, ${chair.userId}::uuid)`);
      expect(one(look)).toMatchObject({ blob_key: shared.id, viewer_is_creator: false });
    });
  });

  // =========================================================================
  describe("reads", () => {
    it("EC16: missing, foreign and forbidden ids are the same null / zero rows / not_found", async () => {
      const foreign = await filed(B, bMember, { group: bGroup, category: null });
      const othersDraft = await save(A, staff);
      for (const id of [crypto.randomUUID(), foreign.id, String(othersDraft.request_id)]) {
        expect(await detail(A, requester, id)).toBeNull();
        expect(await fx.app(A, sql`select * from presby_reimbursement_attachment_lookup(${id}::uuid, ${crypto.randomUUID()}::uuid,
          ${requester.userId}::uuid)`)).toHaveLength(0);
        expect((await approve(A, requester, id, 1)).outcome).toBe("not_found");
        expect((await withdraw(A, requester, id)).outcome).toBe("not_found");
        expect((await recordPayment(A, t1, id)).outcome).toBe("not_found");
      }
    });

    it("the treasury projection needs reimbursement.view; the member projection carries no names or payments", async () => {
      const r = await filed(A, requester);
      expect(await detail(A, chair, r.id, "treasury")).toBeNull();
      const m = await detail(A, chair, r.id, "member");
      expect(m).toMatchObject({ viewer: { relation: "seat", canDecide: true } });
      expect(m).not.toHaveProperty("creatorName");
      expect(m).not.toHaveProperty("payments");
      expect((m!.history as Row[]).every((h) => !("actorName" in h))).toBe(true);
      const t = await detail(A, t1, r.id, "treasury");
      expect(t).toMatchObject({ viewer: { relation: "treasury" }, treasuryViewer: { holdsPay: true, seatHolderExists: true } });
      expect(String(t!.creatorName)).toContain("Requester");
    });

    it("lists and counts: mine, waiting for me, the treasurer tabs, the export, settings and form options", async () => {
      const fresh = await fx.member(A, "Lister");
      const mine = await filed(A, fresh);
      const myList = await fx.app(A, sql`select id, is_creator from presby_reimbursement_my_requests(${fresh.userId}::uuid, 50, 0)`);
      expect(myList.map((x) => x.id)).toEqual([mine.id]);
      const counts = one(await fx.app(A, sql`select * from presby_reimbursement_counts(${t1.userId}::uuid)`));
      expect(Number(counts.waiting_for_me)).toBe(0);
      expect(counts.waiting_for_payment).not.toBeNull();
      const memberCounts = one(await fx.app(A, sql`select * from presby_reimbursement_counts(${chair.userId}::uuid)`));
      expect(Number(memberCounts.waiting_for_me)).toBeGreaterThan(0);
      expect(memberCounts.needs_treasurer).toBeNull();
      for (const tab of ["pay", "override", "progress", "paid", "all"]) {
        const rows = await fx.app(A, sql`select * from presby_reimbursement_treasurer_list(${t1.userId}::uuid, ${tab}, null, null, null, 200, 0)`);
        if (rows.length > 0) expect(Number(rows[0]!.total_count)).toBeGreaterThanOrEqual(rows.length);
      }
      const progress = await fx.app(A, sql`select id from presby_reimbursement_treasurer_list(${t1.userId}::uuid, 'progress', ${committee}::uuid, ${day(-1)}::date, ${today}::date, 200, 0)`);
      expect(progress.map((x) => x.id)).toContain(mine.id);
      const exportRows = await fx.app(A, sql`select * from presby_reimbursement_export_rows(${t1.userId}::uuid, null, null, 'paid', 20001)`);
      expect(exportRows.length).toBeGreaterThan(0);
      expect(Object.keys(exportRows[0]!)).not.toContain("pre_approved_by_name");
      const settings = one(await fx.app(A, sql`select presby_reimbursement_settings(${t1.userId}::uuid) as s`)).s as Row;
      const committeeRow = (settings.groups as Row[]).find((g) => g.id === committee)!;
      expect(committeeRow).toMatchObject({ chargeable: true, approverCount: 2 });
      expect(settings.payHolderCount).toBe(2);
      const opts = one(await fx.app(A, sql`select presby_reimbursement_form_options(${clerk.userId}::uuid) as o`)).o as Row;
      expect(opts).toMatchObject({ mayFile: true, canRequestForOthers: true });
      expect((opts.groups as Row[]).map((g) => g.id)).not.toContain(unlisted);
      const visitorOpts = one(await fx.app(A, sql`select presby_reimbursement_form_options(${visitor.userId}::uuid) as o`)).o as Row;
      expect(visitorOpts).toMatchObject({ mayFile: false, groups: [], categories: [], canRequestForOthers: false });
      expect(one(await fx.app(A, sql`select presby_reimbursement_may_file(${visitor.userId}::uuid) as m`)).m).toBe(false);
      expect(Number(one(await fx.app(A, sql`select presby_reimbursement_open_count() as n`)).n)).toBeGreaterThan(0);
    });

    it("an unknown treasurer tab or detail level is a parameter error, not a silent empty list", async () => {
      let caught: unknown;
      try {
        await fx.app(A, sql`select * from presby_reimbursement_treasurer_list(${t1.userId}::uuid, 'everything', null, null, null, 10, 0)`);
      } catch (err) {
        caught = err;
      }
      expect(pgError(caught).code).toBe("22023");
    });
  });

  // =========================================================================
  describe("configuration definers", () => {
    it("chargeable groups and categories: manage only, with closed outcomes", async () => {
      const g = await fx.makeGroup(A, `Config ${nextKey()}`);
      const setC = async (on: boolean, group = g) =>
        one(await fx.app(A, sql`select * from presby_reimbursement_set_chargeable(${group}::uuid, ${on}, ${t1.userId}::uuid)`)).outcome;
      expect(await setC(true)).toBe("ok");
      expect(await setC(true)).toBe("unchanged");
      expect(await setC(false)).toBe("ok");
      expect(await setC(false)).toBe("unchanged");
      expect(await setC(true, bGroup)).toBe("group_unavailable");
      const saveCat = async (id: string | null, name: string) =>
        one(await fx.app(A, sql`select * from presby_reimbursement_save_category(${id}::uuid, ${name}, 5, ${t1.userId}::uuid)`));
      const name = `Mileage ${nextKey()}`;
      const made = await saveCat(null, name);
      expect(made.outcome).toBe("ok");
      expect((await saveCat(null, name.toUpperCase())).outcome).toBe("name_taken");
      expect((await saveCat(null, "x".repeat(61))).outcome).toBe("name_invalid");
      expect((await saveCat(String(made.category_id), `${name} renamed`)).outcome).toBe("ok");
      const end = async (id: string) =>
        one(await fx.app(A, sql`select * from presby_reimbursement_end_category(${id}::uuid, ${t1.userId}::uuid)`)).outcome;
      expect(await end(String(made.category_id))).toBe("ok");
      expect(await end(String(made.category_id))).toBe("not_found");
      expect((await saveCat(String(made.category_id), "Again")).outcome).toBe("not_found");
      await expectDeny(() => fx.app(A, sql`select * from presby_reimbursement_set_chargeable(${g}::uuid, true, ${chair.userId}::uuid)`));
    });
  });
});
