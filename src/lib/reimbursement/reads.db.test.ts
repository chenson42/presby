/**
 * reads.ts against a REAL Postgres connection - docs/work-log/2026-10-25-
 * treasury-inc1.md, the "Read doors" table and Edge Cases EC11, EC13, EC16,
 * EC21. The strict zod schemas in detail-shape.ts parse REAL definer output
 * here, and a golden file pins the detail shape at both levels (Batch 1a
 * ruling 5: the field names are frozen as built; this batch pins them).
 *
 * Regenerate the golden after a DELIBERATE change to presby_reimbursement_detail:
 *   WRITE_REIMBURSEMENT_GOLDEN=1 npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/reimbursement/reads.db.test.ts
 * and review the diff key by key. Run normally with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/reimbursement/reads.db.test.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { ReimbursementFixture } from "@/lib/testing/reimbursement-fixture";
import type { RequestActor } from "./requests";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
const GOLDEN = path.join(__dirname, "detail-shape.golden.json");
const ALL_KEYS = ["reimbursement.request_for_others", "reimbursement.view", "reimbursement.pay", "reimbursement.manage"];

/** Ids, timestamps, dates and the fixture's name suffix are replaced so the golden is stable. */
function normalize(value: unknown): unknown {
  const ids = new Map<string, string>();
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    if (typeof v === "string") {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
        if (!ids.has(v)) ids.set(v, `<id:${ids.size + 1}>`);
        return ids.get(v);
      }
      if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return "<timestamp>";
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return "<date>";
      return v.replace(/Quillfeather\d+/g, "Quillfeather<n>");
    }
    return v;
  };
  return walk(value);
}

describe.skipIf(!hasDb)("reads.ts (Postgres-backed)", () => {
  let fx: ReimbursementFixture;
  let requests: typeof import("./requests");
  let reads: typeof import("./reads");
  let input: typeof import("./input");
  let shape: typeof import("./detail-shape");

  let A: string;
  let today: string;
  let committee: string;
  let quiet: string;
  let categoryA: string;
  let requester: RequestActor;
  let beneficiary: RequestActor;
  let clerk: RequestActor;
  let chair: RequestActor;
  let t1: RequestActor;
  let t2: RequestActor;
  let plain: RequestActor;
  let visitor: RequestActor;
  let manager: RequestActor;
  let keySeq = 0;
  const nextKey = () => `rk${Date.now().toString(36)}${(keySeq += 1)}`.padEnd(10, "x");

  const actor = (org: string, m: { userId: string; personId: string }): RequestActor => ({
    userId: m.userId, email: null, personId: m.personId, organizationId: org,
  });
  const one = <T,>(rows: T[]): T => {
    expect(rows).toHaveLength(1);
    return rows[0]!;
  };
  const app = (a: RequestActor, query: ReturnType<typeof sql>) => fx.app(a.organizationId, query);

  function values(over: Record<string, unknown> = {}) {
    return input.saveRequestSchema.parse({
      clientKey: nextKey(), kind: "reimburse", groupId: committee, amountCents: 4150, expenseDate: today,
      purpose: "Paint for the fellowship hall", categoryId: categoryA, noReceiptClaimed: true, ...over,
    });
  }

  async function attach(a: RequestActor, requestId: string, sha?: string): Promise<{ sha: string }> {
    const b = await fx.blob(a.organizationId);
    const hash = sha ?? b.sha;
    const out = one(await app(a, sql`select * from presby_reimbursement_attach_receipt(${requestId}::uuid, ${b.id}::uuid,
      ${hash}, 'image/jpeg', 3, 'receipt.jpg', ${a.userId}::uuid)`));
    expect(out.outcome, JSON.stringify(out)).toBe("ok");
    return { sha: hash };
  }

  /** Save (no receipt claimed unless `receipt`), attach, submit; returns id and revision. */
  async function filed(a: RequestActor, over: Record<string, unknown> = {}, receiptSha?: string) {
    const saved = await requests.saveRequest(a, values({ noReceiptClaimed: receiptSha === undefined, ...over }));
    if (saved.kind !== "ok") throw new Error(`setup: ${JSON.stringify(saved)}`);
    let revision = saved.revision;
    if (receiptSha !== undefined) {
      await attach(a, saved.requestId, receiptSha);
      revision += 1;
    }
    const sub = await requests.submitRequest(a, { requestId: saved.requestId, expectedRevision: revision });
    if (sub.kind !== "ok") throw new Error(`setup submit: ${JSON.stringify(sub)}`);
    return { id: saved.requestId, revision: sub.revision };
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/reimbursement-fixture");
    fx = await mod.createReimbursementFixture("reads");
    requests = await import("./requests");
    reads = await import("./reads");
    input = await import("./input");
    shape = await import("./detail-shape");

    A = await fx.makeOrg("main", { timeZone: "America/New_York", toggle: true });
    committee = await fx.makeGroup(A, "Finance Committee");
    quiet = await fx.makeGroup(A, "Quiet Committee");
    const people = {
      requester: await fx.member(A, "Requester"),
      beneficiary: await fx.member(A, "Beneficiary"),
      clerk: await fx.member(A, "Clerk"),
      chair: await fx.member(A, "Chair"),
      t1: await fx.member(A, "TreasurerOne"),
      t2: await fx.member(A, "TreasurerTwo"),
      plain: await fx.member(A, "Plain"),
      visitor: await fx.member(A, "Visitor", { engagement: "visitor", roll: null }),
      manager: await fx.member(A, "Manager"),
    };
    requester = actor(A, people.requester);
    beneficiary = actor(A, people.beneficiary);
    clerk = actor(A, people.clerk);
    chair = actor(A, people.chair);
    t1 = actor(A, people.t1);
    t2 = actor(A, people.t2);
    plain = actor(A, people.plain);
    visitor = actor(A, people.visitor);
    manager = actor(A, people.manager);

    await fx.seat(A, committee, people.chair.personId, { role: "chair" });
    const treasurerRole = await fx.makeRole(A, "treasurer_like", ALL_KEYS);
    await fx.grant(A, treasurerRole, people.t1.personId);
    await fx.grant(A, treasurerRole, people.t2.personId);
    await fx.grant(A, await fx.makeRole(A, "clerk_like", ["reimbursement.request_for_others"]), people.clerk.personId);
    await fx.grant(A, await fx.makeRole(A, "manager_only", ["reimbursement.manage"]), people.manager.personId);
    await fx.chargeable(A, committee, people.t1.userId);
    await fx.chargeable(A, quiet, people.t1.userId);
    categoryA = await fx.category(A, "Supplies", people.t1.userId);
    await fx.category(A, "Music", people.t1.userId);
    today = await reads.getOrgToday(requester);
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  // =========================================================================
  describe("getFormOptions", () => {
    it("offers the live chargeable groups and the active categories, parsed by the strict schema", async () => {
      const options = await reads.getFormOptions(requester);
      expect(options.mayFile).toBe(true);
      expect(options.groups.map((g) => g.name)).toEqual(["Finance Committee", "Quiet Committee"]);
      expect(options.categories.map((c) => c.name)).toEqual(["Music", "Supplies"]); // sort order, then name
      expect(options.canRequestForOthers).toBe(false);
    });

    it("a visitor may not file and is offered nothing; a clerk may enter for others", async () => {
      expect(await reads.getFormOptions(visitor)).toEqual({ mayFile: false, groups: [], categories: [], canRequestForOthers: false });
      expect((await reads.getFormOptions(clerk)).canRequestForOthers).toBe(true);
    });

    it("a group un-listed after the form was built drops off the next read", async () => {
      const g = await fx.makeGroup(A, "Short Lived");
      const link = await fx.chargeable(A, g, t1.userId);
      expect((await reads.getFormOptions(requester)).groups.map((x) => x.name)).toContain("Short Lived");
      await fx.q(sql`update reimbursement_chargeable_groups set ended_at = now(), ended_by_user = ${t1.userId} where id = ${link}`);
      expect((await reads.getFormOptions(requester)).groups.map((x) => x.name)).not.toContain("Short Lived");
    });
  });

  // =========================================================================
  describe("getRequestDetail", () => {
    it("EC16: a missing id, a malformed id and an id the caller may not see are ONE answer", async () => {
      const mine = await filed(requester);
      const forbidden = await reads.getRequestDetail(plain, mine.id, "member");
      expect(forbidden).toEqual({ kind: "not_found" });
      expect(await reads.getRequestDetail(plain, "99999999-9999-4999-8999-999999999999", "member")).toEqual(forbidden);
      expect(await reads.getRequestDetail(plain, "not-a-uuid", "member")).toEqual(forbidden);
      expect(await reads.getRequestDetail(plain, mine.id, "treasury")).toEqual(forbidden);
    });

    it("a draft is visible to its creator ONLY - not a seat holder, not even a treasury key holder", async () => {
      const saved = await requests.saveRequest(requester, values({}));
      if (saved.kind !== "ok") throw new Error("setup");
      expect((await reads.getRequestDetail(requester, saved.requestId, "member")).kind).toBe("ok");
      for (const other of [chair, t1, beneficiary]) {
        expect(await reads.getRequestDetail(other, saved.requestId, "member")).toEqual({ kind: "not_found" });
      }
      expect(await reads.getRequestDetail(t1, saved.requestId, "treasury")).toEqual({ kind: "not_found" });
    });

    it("the treasury level needs reimbursement.view; the member level is open to the creator, a live seat and a view holder", async () => {
      const mine = await filed(requester);
      expect((await reads.getRequestDetail(requester, mine.id, "member")).kind).toBe("ok");
      expect((await reads.getRequestDetail(chair, mine.id, "member")).kind).toBe("ok");
      expect((await reads.getRequestDetail(t1, mine.id, "member")).kind).toBe("ok");
      expect(await reads.getRequestDetail(requester, mine.id, "treasury")).toEqual({ kind: "not_found" });
      expect(await reads.getRequestDetail(chair, mine.id, "treasury")).toEqual({ kind: "not_found" });
      const asTreasury = await reads.getRequestDetail(t1, mine.id, "treasury");
      expect(asTreasury.kind === "ok" && asTreasury.detail.level).toBe("treasury");
    });

    it("EC11: a seat that ends mid-queue loses access to the request at once", async () => {
      const mine = await filed(requester);
      expect((await reads.getRequestDetail(chair, mine.id, "member")).kind).toBe("ok");
      const seatRow = one(await fx.q(sql`select id from group_memberships where organization_id = ${A} and group_id = ${committee} and person_id = ${chair.personId}`));
      await fx.q(sql`update group_memberships set ends_on = current_date - 1 where id = ${String(seatRow.id)}`);
      try {
        expect(await reads.getRequestDetail(chair, mine.id, "member")).toEqual({ kind: "not_found" });
      } finally {
        await fx.q(sql`update group_memberships set ends_on = null where id = ${String(seatRow.id)}`);
      }
    });

    it("EC21: the duplicate-receipt flag is a yes/no for a seat approver and the treasury team, with the other request's id for the team - and NEVER the requester's", async () => {
      const sha = `${"ab".repeat(32)}`.slice(0, 64).replace(/./g, (c, i) => (i % 2 ? "c" : "a")); // 64 hex chars
      const firstReq = await filed(requester, {}, sha);
      const second = await filed(plain, {}, sha);
      const asCreator = await reads.getRequestDetail(plain, second.id, "member");
      const asSeat = await reads.getRequestDetail(chair, second.id, "member");
      const asTreasury = await reads.getRequestDetail(t1, second.id, "treasury");
      expect(asCreator.kind === "ok" && asCreator.detail.duplicateReceipt).toBeNull();
      expect(asSeat.kind === "ok" && asSeat.detail.duplicateReceipt).toBe(true);
      expect(asTreasury.kind === "ok" && asTreasury.detail.duplicateReceipt).toBe(true);
      expect(asTreasury.kind === "ok" && asTreasury.detail.level === "treasury" && asTreasury.detail.duplicateRequestIds).toEqual([firstReq.id]);
      // the EARLIER request is not flagged for the later one's receipt
      const earlier = await reads.getRequestDetail(chair, firstReq.id, "member");
      expect(earlier.kind === "ok" && earlier.detail.duplicateReceipt).toBe(false);
      // and the member-level payload never carries the other request's id
      expect(JSON.stringify(asSeat)).not.toContain(firstReq.id);
    });

    it("EC13: display names follow merged_into_id - a payee merged into another person reads as the survivor", async () => {
      const dupUser = await fx.makeUser("dup");
      const dup = await fx.makePerson("Duplicate", dupUser);
      await fx.addMembership(A, dup);
      const entered = await requests.saveRequest(clerk, values({ beneficiaryPersonId: dup }));
      if (entered.kind !== "ok") throw new Error("setup");
      const before = await reads.getRequestDetail(clerk, entered.requestId, "member");
      expect(before.kind === "ok" && before.detail.payee).toMatchObject({ kind: "person", name: expect.stringMatching(/^Duplicate /) });
      await fx.q(sql`update people set merged_into_id = ${beneficiary.personId} where id = ${dup}`);
      const after = await reads.getRequestDetail(clerk, entered.requestId, "member");
      expect(after.kind === "ok" && after.detail.payee).toMatchObject({ kind: "person", name: expect.stringMatching(/^Beneficiary /) });
    });

    it("the viewer block tells the page what to offer: edit on a draft, decide only for a live seat, withdraw for the beneficiary", async () => {
      const saved = await requests.saveRequest(requester, values({}));
      if (saved.kind !== "ok") throw new Error("setup");
      const draft = await reads.getRequestDetail(requester, saved.requestId, "member");
      expect(draft.kind === "ok" && draft.detail.viewer).toEqual({ relation: "creator", canEdit: true, canWithdraw: true, canDecide: false });
      const sub = await requests.submitRequest(requester, { requestId: saved.requestId, expectedRevision: saved.revision });
      if (sub.kind !== "ok") throw new Error("setup");
      const asChair = await reads.getRequestDetail(chair, saved.requestId, "member");
      expect(asChair.kind === "ok" && asChair.detail.viewer).toEqual({ relation: "seat", canEdit: false, canWithdraw: false, canDecide: true });
      const asT1 = await reads.getRequestDetail(t1, saved.requestId, "member");
      expect(asT1.kind === "ok" && asT1.detail.viewer.canDecide).toBe(false);
      const behalf = await requests.saveRequest(clerk, values({ beneficiaryPersonId: beneficiary.personId }));
      if (behalf.kind !== "ok") throw new Error("setup");
      await requests.submitRequest(clerk, { requestId: behalf.requestId, expectedRevision: behalf.revision });
      const asBeneficiary = await reads.getRequestDetail(beneficiary, behalf.requestId, "member");
      expect(asBeneficiary.kind === "ok" && asBeneficiary.detail.viewer).toMatchObject({ relation: "beneficiary", canWithdraw: true, canEdit: false });
    });
  });

  // =========================================================================
  describe("the golden detail shape (Batch 1a ruling 5)", () => {
    it("pins presby_reimbursement_detail at the member level, the seat-approver level and the treasury level over a real paid-then-corrected request", async () => {
      const gOrg = await fx.makeOrg("golden", { timeZone: "America/New_York", toggle: true });
      const gGroup = await fx.makeGroup(gOrg, "Property Committee");
      const gReq = actor(gOrg, await fx.member(gOrg, "Requester"));
      const gChair = actor(gOrg, await fx.member(gOrg, "Chair"));
      const gPay1 = actor(gOrg, await fx.member(gOrg, "PayerOne"));
      const gPay2 = actor(gOrg, await fx.member(gOrg, "PayerTwo"));
      await fx.seat(gOrg, gGroup, gChair.personId, { role: "chair" });
      const role = await fx.makeRole(gOrg, "treasurer_like", ALL_KEYS);
      await fx.grant(gOrg, role, gPay1.personId);
      await fx.grant(gOrg, role, gPay2.personId);
      await fx.chargeable(gOrg, gGroup, gPay1.userId);
      const cat = await fx.category(gOrg, "Supplies", gPay1.userId);
      const gToday = await reads.getOrgToday(gReq);

      const saved = await requests.saveRequest(gReq, input.saveRequestSchema.parse({
        clientKey: nextKey(), kind: "reimburse", groupId: gGroup, amountCents: 4150, expenseDate: gToday,
        purpose: "Paint for the fellowship hall", categoryId: cat, preApprovedBy: "Pat", noReceiptClaimed: false,
      }));
      if (saved.kind !== "ok") throw new Error("setup");
      await attach(gReq, saved.requestId);
      const sub = await requests.submitRequest(gReq, { requestId: saved.requestId, expectedRevision: 2 });
      if (sub.kind !== "ok") throw new Error("setup");

      const submittedAsSeat = await reads.getRequestDetail(gChair, saved.requestId, "member");
      const approve = one(await app(gChair, sql`select * from presby_reimbursement_approve(${saved.requestId}::uuid, ${sub.revision}::integer, 'seat', ${gChair.userId}::uuid)`));
      expect(approve.outcome).toBe("ok");
      const paid = one(await app(gPay1, sql`select * from presby_reimbursement_record_payment(${saved.requestId}::uuid, 'check', '3001', ${gToday}::date, 'First try', ${gPay1.userId}::uuid)`));
      expect(paid.outcome, JSON.stringify(paid)).toBe("ok");
      const rev = one(await app(gPay1, sql`select * from presby_reimbursement_reverse_payment(${saved.requestId}::uuid, 'Check was voided', ${gPay1.userId}::uuid)`));
      expect(rev.outcome).toBe("ok");
      const paidAgain = one(await app(gPay2, sql`select * from presby_reimbursement_record_payment(${saved.requestId}::uuid, 'ach', 'ACH-77', ${gToday}::date, null, ${gPay2.userId}::uuid)`));
      expect(paidAgain.outcome, JSON.stringify(paidAgain)).toBe("ok");

      const snapshots = {
        memberAsRequester: await reads.getRequestDetail(gReq, saved.requestId, "member"),
        memberAsSeatWhileSubmitted: submittedAsSeat,
        treasuryAsPayer: await reads.getRequestDetail(gPay2, saved.requestId, "treasury"),
      };
      for (const [name, result] of Object.entries(snapshots)) {
        expect(result.kind, name).toBe("ok");
        if (result.kind === "ok") expect(shape.requestDetailSchema.safeParse(result.detail).success, name).toBe(true);
      }
      const actual = normalize(Object.fromEntries(Object.entries(snapshots).map(([k, v]) => [k, v.kind === "ok" ? v.detail : null])));
      if (process.env.WRITE_REIMBURSEMENT_GOLDEN === "1") {
        writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 2)}\n`);
      }
      expect(actual).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
    });
  });

  // =========================================================================
  describe("lists and counts", () => {
    let listOrg: string;
    let lReq: RequestActor;
    let lBen: RequestActor;
    let lClerk: RequestActor;
    let lChair: RequestActor;
    let lPay: RequestActor;
    let lGroup: string;

    beforeAll(async () => {
      listOrg = await fx.makeOrg("lists", { toggle: true });
      lGroup = await fx.makeGroup(listOrg, "Hospitality");
      lReq = actor(listOrg, await fx.member(listOrg, "Lister"));
      lBen = actor(listOrg, await fx.member(listOrg, "Payee"));
      lClerk = actor(listOrg, await fx.member(listOrg, "Cleric"));
      lChair = actor(listOrg, await fx.member(listOrg, "Chairperson"));
      lPay = actor(listOrg, await fx.member(listOrg, "Payor"));
      await fx.seat(listOrg, lGroup, lChair.personId, { role: "leader" });
      await fx.grant(listOrg, await fx.makeRole(listOrg, "treasurer_like", ALL_KEYS), lPay.personId);
      await fx.grant(listOrg, await fx.makeRole(listOrg, "clerk_like", ["reimbursement.request_for_others"]), lClerk.personId);
      await fx.chargeable(listOrg, lGroup, lPay.userId);
    });

    const mk = (a: RequestActor, over: Record<string, unknown> = {}) =>
      input.saveRequestSchema.parse({
        clientKey: nextKey(), kind: "reimburse", groupId: lGroup, amountCents: 1000, expenseDate: today, purpose: "Coffee supplies",
        noReceiptClaimed: true, ...over,
      });

    it("listMyRequests: the creator's drafts and submitted requests; a payee sees only submitted ones entered for them", async () => {
      const mine = await requests.saveRequest(lReq, mk(lReq));
      const sent = await requests.saveRequest(lReq, mk(lReq, { amountCents: 2000 }));
      if (mine.kind !== "ok" || sent.kind !== "ok") throw new Error("setup");
      await requests.submitRequest(lReq, { requestId: sent.requestId, expectedRevision: 1 });
      const draftForBen = await requests.saveRequest(lClerk, mk(lClerk, { beneficiaryPersonId: lBen.personId }));
      const sentForBen = await requests.saveRequest(lClerk, mk(lClerk, { beneficiaryPersonId: lBen.personId }));
      if (draftForBen.kind !== "ok" || sentForBen.kind !== "ok") throw new Error("setup");
      await requests.submitRequest(lClerk, { requestId: sentForBen.requestId, expectedRevision: 1 });

      const list = await reads.listMyRequests(lReq);
      expect(list.kind).toBe("ok");
      if (list.kind !== "ok") return;
      expect(list.items.map((i) => i.id).sort()).toEqual([mine.requestId, sent.requestId].sort());
      expect(list.items.find((i) => i.id === mine.requestId)).toMatchObject({
        status: "draft", kind: "reimburse", amountCents: 1000, groupName: "Hospitality", isCreator: true, enteredOnBehalf: false, revision: 1,
      });
      expect(list.items.find((i) => i.id === mine.requestId)!.expenseDate).toBe(today);
      expect(list.items[0]!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

      const benList = await reads.listMyRequests(lBen);
      expect(benList.kind === "ok" && benList.items.map((i) => i.id)).toEqual([sentForBen.requestId]);
      expect(benList.kind === "ok" && benList.items[0]).toMatchObject({ isCreator: false, enteredOnBehalf: true });
      // the clerk who entered both sees both
      const clerkList = await reads.listMyRequests(lClerk);
      expect(clerkList.kind === "ok" && clerkList.items).toHaveLength(2);
    });

    it("listWaitingForMe and getCounts: the chair sees what they can approve now, oldest first; the treasury counts are null without view", async () => {
      const waiting = await reads.listWaitingForMe(lChair);
      expect(waiting.kind).toBe("ok");
      if (waiting.kind !== "ok") return;
      expect(waiting.items.length).toBeGreaterThanOrEqual(2);
      expect(waiting.items.every((i) => i.groupName === "Hospitality")).toBe(true);
      const times = waiting.items.map((i) => i.submittedAt);
      expect([...times].sort()).toEqual(times);
      expect((await reads.listWaitingForMe(lReq)).kind === "ok" && (await reads.listWaitingForMe(lReq))).toEqual({ kind: "ok", items: [] });

      const chairCounts = await reads.getCounts(lChair);
      expect(chairCounts.kind === "ok" && chairCounts.counts).toEqual({
        waitingForMe: waiting.items.length, needsTreasurer: null, waitingForPayment: null, inProgress: null,
      });
      const payCounts = await reads.getCounts(lPay);
      expect(payCounts.kind === "ok" && payCounts.counts.waitingForMe).toBe(0);
      expect(payCounts.kind === "ok" && payCounts.counts.inProgress).toBe(waiting.items.length);
      expect(payCounts.kind === "ok" && payCounts.counts.needsTreasurer).toBe(0);
      expect(payCounts.kind === "ok" && payCounts.counts.waitingForPayment).toBe(0);
    });

    it("EC11: waiting_for_me is live - end the chair's seat and the queue row is gone on the next read", async () => {
      const before = await reads.listWaitingForMe(lChair);
      expect(before.kind === "ok" && before.items.length).toBeGreaterThan(0);
      const seatRow = one(await fx.q(sql`select id from group_memberships where organization_id = ${listOrg} and group_id = ${lGroup} and person_id = ${lChair.personId}`));
      await fx.q(sql`update group_memberships set ends_on = current_date - 1 where id = ${String(seatRow.id)}`);
      expect(await reads.listWaitingForMe(lChair)).toEqual({ kind: "ok", items: [] });
      // with no seat the requests now take the treasurer path: they appear under 'needs treasurer approval'
      const payCounts = await reads.getCounts(lPay);
      expect(payCounts.kind === "ok" && payCounts.counts.needsTreasurer).toBe(before.kind === "ok" ? before.items.length : -1);
    });

    it("a caller with no person at the organization is denied, not given an empty list", async () => {
      const stranger = await fx.makeUser("stranger");
      const forged = { ...lReq, userId: stranger };
      expect(await reads.listMyRequests(forged)).toEqual({ kind: "denied" });
      expect(await reads.listWaitingForMe(forged)).toEqual({ kind: "denied" });
      expect(await reads.getCounts(forged)).toEqual({ kind: "denied" });
      expect(await reads.getRequestDetail(forged, "99999999-9999-4999-8999-999999999999", "member")).toEqual({ kind: "denied" });
    });
  });

  // =========================================================================
  describe("getSettings (reimbursement.manage)", () => {
    it("lists every group with its chargeable flag and how many seats can approve now, the categories, and the pay-holder count", async () => {
      const result = await reads.getSettings(manager);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      const byName = Object.fromEntries(result.settings.groups.map((g) => [g.name, g]));
      expect(byName["Finance Committee"]).toMatchObject({ chargeable: true, approverCount: 1, membershipSource: "managed" });
      expect(byName["Quiet Committee"]).toMatchObject({ chargeable: true, approverCount: 0 });
      expect(byName["Session"]).toMatchObject({ chargeable: false, approverCount: 0, membershipSource: "derived" });
      expect(result.settings.categories.map((c) => c.name)).toEqual(["Music", "Supplies"]);
      expect(result.settings.payHolderCount).toBe(2);
    });

    it("anyone without reimbursement.manage - a pay-only holder, a view-only holder, a plain member - is denied", async () => {
      const payOnly = actor(A, await fx.member(A, "PayOnly"));
      await fx.grant(A, await fx.makeRole(A, "pay_only", ["reimbursement.pay"]), payOnly.personId);
      const viewOnly = actor(A, await fx.member(A, "ViewOnly"));
      await fx.grant(A, await fx.makeRole(A, "view_only", ["reimbursement.view"]), viewOnly.personId);
      for (const who of [payOnly, viewOnly, plain, requester]) {
        expect(await reads.getSettings(who)).toEqual({ kind: "denied" });
      }
    });
  });
});
