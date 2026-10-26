/**
 * requests.ts and pickers.ts against a REAL Postgres connection, through the
 * application's own path (`withOrgContext` on presby_app, RLS enforced) -
 * docs/work-log/2026-10-25-treasury-inc1.md, Edge Cases EC1, EC2, EC12, EC14,
 * EC15, EC17, EC28, EC35, EC38, EC41. The SQL half of each of these is pinned in
 * src/lib/db/domain/reimbursement-definers.db.test.ts; THIS file proves the
 * TypeScript layer over it: create-or-find then edit, the revision carried by
 * the form, the posted-beneficiary re-check, the result mapping and the
 * identity refusal. Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/reimbursement/requests.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { ReimbursementFixture } from "@/lib/testing/reimbursement-fixture";
import type { RequestActor } from "./requests";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
const ALL_KEYS = ["reimbursement.request_for_others", "reimbursement.view", "reimbursement.pay", "reimbursement.manage"];

describe.skipIf(!hasDb)("requests.ts and pickers.ts (Postgres-backed)", () => {
  let fx: ReimbursementFixture;
  let requests: typeof import("./requests");
  let pickers: typeof import("./pickers");
  let input: typeof import("./input");
  let reads: typeof import("./reads");

  let A: string;
  let N: string;
  let today: string;
  let committee: string;
  let quiet: string;
  let unlisted: string;
  let nGroup: string;
  let category: string;
  let requester: RequestActor;
  let visitor: RequestActor;
  let clerk: RequestActor;
  let chair: RequestActor;
  let treasurer: RequestActor;
  let listed: RequestActor;
  let hidden: RequestActor;
  let plain: RequestActor;
  let nMember: RequestActor;
  let keySeq = 0;
  const nextKey = () => `tk${Date.now().toString(36)}${(keySeq += 1)}`.padEnd(10, "x");

  const actor = (org: string, m: { userId: string; personId: string }): RequestActor => ({
    userId: m.userId,
    email: null,
    personId: m.personId,
    organizationId: org,
  });

  /** A parsed save payload with sensible defaults (a complete reimbursement; no receipt claimed). */
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

  beforeAll(async () => {
    const mod = await import("@/lib/testing/reimbursement-fixture");
    fx = await mod.createReimbursementFixture("reqts");
    requests = await import("./requests");
    pickers = await import("./pickers");
    input = await import("./input");
    reads = await import("./reads");

    A = await fx.makeOrg("main", { timeZone: "America/New_York", toggle: true });
    committee = await fx.makeGroup(A, "Finance Committee");
    quiet = await fx.makeGroup(A, "Quiet Committee");
    unlisted = await fx.makeGroup(A, "Unlisted Committee");

    const r = await fx.member(A, "Requester");
    const v = await fx.member(A, "Visitor", { engagement: "visitor", roll: null });
    const c = await fx.member(A, "Clerk");
    const ch = await fx.member(A, "Chair");
    const t = await fx.member(A, "Treasurer");
    const l = await fx.member(A, "Listed");
    const h = await fx.member(A, "Hidden");
    const p = await fx.member(A, "Plain");
    requester = actor(A, r);
    visitor = actor(A, v);
    clerk = actor(A, c);
    chair = actor(A, ch);
    treasurer = actor(A, t);
    listed = actor(A, l);
    hidden = actor(A, h);
    plain = actor(A, p);

    await fx.seat(A, committee, ch.personId, { role: "chair" });
    await fx.grant(A, await fx.makeRole(A, "treasurer_like", ALL_KEYS), t.personId);
    await fx.grant(A, await fx.makeRole(A, "clerk_like", ["reimbursement.request_for_others", "directory.view"]), c.personId);
    await fx.chargeable(A, committee, t.userId);
    await fx.chargeable(A, quiet, t.userId);
    category = await fx.category(A, "Supplies", t.userId);
    await fx.q(sql`insert into person_privacy (person_id, organization_id, directory_hidden) values (${h.personId}, ${A}, true)`);
    today = await reads.getOrgToday({ userId: r.userId, personId: r.personId, organizationId: A });

    N = await fx.makeOrg("nobody", { toggle: true });
    nGroup = await fx.makeGroup(N, "Nobody Committee");
    const nm = await fx.member(N, "Lonely");
    nMember = actor(N, nm);
    await fx.chargeable(N, nGroup, nm.userId);
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  const draftRows = async (userId: string, key: string) =>
    fx.q(sql`select id, revision, status from reimbursement_requests where created_by_user = ${userId} and client_key = ${key}`);

  // =========================================================================
  describe("saveRequest: create-or-find, then edit", () => {
    it("EC1: one client key is one request - a double tap or a lost reply never makes a second", async () => {
      const key = nextKey();
      const first = await requests.saveRequest(requester, values({ clientKey: key, amountCents: 500 }));
      expect(first).toMatchObject({ kind: "ok", created: true, revision: 1 });
      const second = await requests.saveRequest(requester, values({ clientKey: key, amountCents: 999 }));
      expect(second).toMatchObject({ kind: "ok", created: false, revision: 1 });
      if (first.kind !== "ok" || second.kind !== "ok") return;
      expect(second.requestId).toBe(first.requestId);
      expect(await draftRows(requester.userId, key)).toHaveLength(1);
      // the double tap left the first save's content untouched
      const detail = await reads.getRequestDetail(requester, first.requestId, "member");
      expect(detail.kind === "ok" && detail.detail.amountCents).toBe(500);
    });

    it("a re-save from the SAME open form (key + the revision it last saw) is an edit; a stale revision is changed_since_viewed", async () => {
      const key = nextKey();
      const first = await requests.saveRequest(requester, values({ clientKey: key, amountCents: 500 }));
      if (first.kind !== "ok") throw new Error("setup");
      const edited = await requests.saveRequest(
        requester,
        values({ clientKey: key, amountCents: 750, expectedRevision: first.revision }),
      );
      expect(edited).toMatchObject({ kind: "ok", created: false, requestId: first.requestId, revision: 2 });
      const stale = await requests.saveRequest(
        requester,
        values({ clientKey: key, amountCents: 800, expectedRevision: first.revision }),
      );
      expect(stale).toEqual({ kind: "refused", outcome: "changed_since_viewed" });
      const detail = await reads.getRequestDetail(requester, first.requestId, "member");
      expect(detail.kind === "ok" && detail.detail.amountCents).toBe(750);
    });

    it("edits by request id carry the expected revision", async () => {
      const first = await requests.saveRequest(requester, values({}));
      if (first.kind !== "ok") throw new Error("setup");
      const edited = await requests.saveRequest(
        requester,
        values({ requestId: first.requestId, expectedRevision: first.revision, purpose: "New purpose" }),
      );
      expect(edited).toMatchObject({ kind: "ok", requestId: first.requestId, revision: 2 });
      expect(
        await requests.saveRequest(requester, values({ requestId: first.requestId, expectedRevision: 1, purpose: "Again" })),
      ).toEqual({ kind: "refused", outcome: "changed_since_viewed" });
    });

    it("another member's request id is not_found (the same answer as a missing one, EC16)", async () => {
      const mine = await requests.saveRequest(requester, values({}));
      if (mine.kind !== "ok") throw new Error("setup");
      const theirs = await requests.saveRequest(plain, values({ requestId: mine.requestId, expectedRevision: 1 }));
      expect(theirs).toEqual({ kind: "refused", outcome: "not_found" });
      const missing = await requests.saveRequest(
        plain,
        values({ requestId: "99999999-9999-4999-8999-999999999999", expectedRevision: 1 }),
      );
      expect(missing).toEqual(theirs);
    });

    it("EC12: a visitor cannot start a request (not_eligible); a regular member can", async () => {
      expect(await requests.saveRequest(visitor, values({}))).toEqual({ kind: "refused", outcome: "not_eligible" });
      expect(await requests.saveRequest(requester, values({}))).toMatchObject({ kind: "ok" });
    });

    it("EC35: the date window is the ORGANIZATION'S local date - today is accepted, tomorrow and 366 days back are refused", async () => {
      const dates = await import("./dates");
      expect(await requests.saveRequest(requester, values({ expenseDate: today }))).toMatchObject({ kind: "ok" });
      expect(await requests.saveRequest(requester, values({ expenseDate: dates.addDays(today, 1) }))).toEqual({
        kind: "refused",
        outcome: "date_out_of_range",
      });
      expect(await requests.saveRequest(requester, values({ expenseDate: dates.addDays(today, -366) }))).toEqual({
        kind: "refused",
        outcome: "date_out_of_range",
      });
      expect(await requests.saveRequest(requester, values({ expenseDate: dates.addDays(today, -365) }))).toMatchObject({ kind: "ok" });
    });

    it("EC35: a UTC-evening request in America/New_York is not 'future' (today comes from the organization, not the server)", async () => {
      const tz = await fx.makeOrg("pacific", { timeZone: "Pacific/Pago_Pago", toggle: true });
      const m = await fx.member(tz, "Samoa");
      const group = await fx.makeGroup(tz, "Samoa Committee");
      await fx.chargeable(tz, group, m.userId);
      const a = actor(tz, m);
      const orgToday = await reads.getOrgToday(a);
      const expected = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Pago_Pago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      expect(orgToday).toBe(expected);
      const { addDays } = await import("./dates");
      const mk = (d: string) => input.saveRequestSchema.parse({ clientKey: nextKey(), kind: "reimburse", groupId: group, expenseDate: d, noReceiptClaimed: true });
      expect(await requests.saveRequest(a, mk(orgToday))).toMatchObject({ kind: "ok" });
      expect(await requests.saveRequest(a, mk(addDays(orgToday, 1)))).toEqual({ kind: "refused", outcome: "date_out_of_range" });
    });

    it("EC41: twenty open drafts per user; the twenty-first is too_many_drafts", async () => {
      const m = await fx.member(A, "Drafty");
      const a = actor(A, m);
      for (let i = 0; i < 20; i += 1) {
        expect(await requests.saveRequest(a, values({})), `draft ${i + 1}`).toMatchObject({ kind: "ok", created: true });
      }
      expect(await requests.saveRequest(a, values({}))).toEqual({ kind: "refused", outcome: "too_many_drafts" });
    });

    it("EC38: a vendor request carries a vendor and no person payee (a beneficiary on a vendor request is invalid_shape)", async () => {
      const ok = await requests.saveRequest(requester, values({ kind: "vendor", vendorName: "Hardware Co" }));
      expect(ok).toMatchObject({ kind: "ok" });
      if (ok.kind !== "ok") return;
      const detail = await reads.getRequestDetail(requester, ok.requestId, "member");
      expect(detail.kind === "ok" && detail.detail.payee).toEqual({ kind: "vendor", name: "Hardware Co" });
      expect(
        await requests.saveRequest(requester, values({ kind: "vendor", vendorName: "Shop", beneficiaryPersonId: listed.personId })),
      ).toEqual({ kind: "refused", outcome: "invalid_shape" });
    });

    it("the identity refusal is mapped, not thrown: a user with no person at the organization is denied", async () => {
      const stranger = await fx.makeUser("stranger");
      const forged = { ...requester, userId: stranger };
      expect(await requests.saveRequest(forged, values({}))).toEqual({ kind: "denied" });
    });
  });

  // =========================================================================
  describe("EC15 and EC17: entering a request for someone else, and the posted beneficiary id", () => {
    it("a member without request_for_others naming someone else is not_allowed_for_others - and learns nothing about the person", async () => {
      const hiddenTry = await requests.saveRequest(plain, values({ beneficiaryPersonId: hidden.personId }));
      const listedTry = await requests.saveRequest(plain, values({ beneficiaryPersonId: listed.personId }));
      expect(hiddenTry).toEqual({ kind: "refused", outcome: "not_allowed_for_others" });
      expect(listedTry).toEqual(hiddenTry);
    });

    it("a holder of request_for_others may name a listed member; the request reads as entered on their behalf", async () => {
      const result = await requests.saveRequest(clerk, values({ beneficiaryPersonId: listed.personId }));
      expect(result).toMatchObject({ kind: "ok" });
      if (result.kind !== "ok") return;
      const detail = await reads.getRequestDetail(clerk, result.requestId, "member");
      expect(detail.kind === "ok" && detail.detail.enteredOnBehalf).toBe(true);
      expect(detail.kind === "ok" && detail.detail.payee).toMatchObject({ kind: "person", personId: listed.personId });
    });

    it("EC17: a directory_hidden member cannot be named by a hand-posted id - and no row is created", async () => {
      const key = nextKey();
      const result = await requests.saveRequest(clerk, values({ clientKey: key, beneficiaryPersonId: hidden.personId }));
      expect(result).toEqual({ kind: "refused", outcome: "beneficiary_unavailable" });
      expect(await draftRows(clerk.userId, key)).toHaveLength(0);
    });

    it("EC17: a member of another organization and an unknown id are both beneficiary_unavailable", async () => {
      const elsewhere = await fx.member(N, "Away");
      expect(await requests.saveRequest(clerk, values({ beneficiaryPersonId: elsewhere.personId }))).toEqual({
        kind: "refused",
        outcome: "beneficiary_unavailable",
      });
      expect(await requests.saveRequest(clerk, values({ beneficiaryPersonId: "99999999-9999-4999-8999-999999999999" }))).toEqual({
        kind: "refused",
        outcome: "beneficiary_unavailable",
      });
    });

    it("an unchanged payee on an edit is not re-judged: a payee who has since been hidden does not strand the clerk's returned request", async () => {
      const late = await fx.member(A, "LateHidden");
      const created = await requests.saveRequest(clerk, values({ beneficiaryPersonId: late.personId }));
      if (created.kind !== "ok") throw new Error("setup");
      await fx.q(sql`insert into person_privacy (person_id, organization_id, directory_hidden) values (${late.personId}, ${A}, true)`);
      const edited = await requests.saveRequest(
        clerk,
        values({ requestId: created.requestId, expectedRevision: created.revision, beneficiaryPersonId: late.personId, purpose: "Edited" }),
      );
      expect(edited).toMatchObject({ kind: "ok", revision: 2 });
    });

    it("naming yourself (explicitly) is the ordinary case and needs no key", async () => {
      expect(await requests.saveRequest(plain, values({ beneficiaryPersonId: plain.personId }))).toMatchObject({ kind: "ok" });
    });
  });

  // =========================================================================
  describe("submitRequest", () => {
    it("EC2: submit is idempotent - the first is 'ok' with its route and the people to tell; a second is already_submitted, success, no second event", async () => {
      const saved = await requests.saveRequest(requester, values({}));
      if (saved.kind !== "ok") throw new Error("setup");
      const first = await requests.submitRequest(requester, { requestId: saved.requestId, expectedRevision: saved.revision });
      expect(first).toMatchObject({ kind: "ok", route: "seat", groupName: "Finance Committee", already: false });
      if (first.kind !== "ok") return;
      expect(first.notifyPersonIds).toEqual([chair.personId]);

      const again = await requests.submitRequest(requester, { requestId: saved.requestId, expectedRevision: saved.revision });
      expect(again).toMatchObject({ kind: "ok", already: true, route: "seat", groupName: "Finance Committee" });
      const events = await fx.q(sql`select kind from reimbursement_events where request_id = ${saved.requestId} order by seq`);
      expect(events.map((e) => e.kind)).toEqual(["created", "submitted"]);
    });

    it("EC28: a group with no approver routes to the treasurer (the pay holders are the people to tell); with none at all, 'nobody'", async () => {
      const toTreasurer = await requests.saveRequest(requester, values({ groupId: quiet }));
      if (toTreasurer.kind !== "ok") throw new Error("setup");
      const t = await requests.submitRequest(requester, { requestId: toTreasurer.requestId, expectedRevision: 1 });
      expect(t).toMatchObject({ kind: "ok", route: "treasurer" });
      if (t.kind === "ok") expect(t.notifyPersonIds).toEqual([treasurer.personId]);

      const lonely = await requests.saveRequest(nMember, input.saveRequestSchema.parse({
        clientKey: nextKey(), kind: "reimburse", groupId: nGroup, amountCents: 100, expenseDate: today, purpose: "Stamps", noReceiptClaimed: true,
      }));
      if (lonely.kind !== "ok") throw new Error("setup");
      const n = await requests.submitRequest(nMember, { requestId: lonely.requestId, expectedRevision: 1 });
      expect(n).toMatchObject({ kind: "ok", route: "nobody", notifyPersonIds: [] });
    });

    it("an incomplete request says what is missing, in the definer's order, and changes nothing", async () => {
      const saved = await requests.saveRequest(requester, input.saveRequestSchema.parse({
        clientKey: nextKey(), kind: "vendor", groupId: committee,
      }));
      if (saved.kind !== "ok") throw new Error("setup");
      const result = await requests.submitRequest(requester, { requestId: saved.requestId, expectedRevision: 1 });
      expect(result).toEqual({ kind: "incomplete", missing: ["amount", "date", "purpose", "payee", "category", "receipt"] });
      const detail = await reads.getRequestDetail(requester, saved.requestId, "member");
      expect(detail.kind === "ok" && detail.detail.status).toBe("draft");
    });

    it("a stale revision is changed_since_viewed; someone else's request is not_found", async () => {
      const saved = await requests.saveRequest(requester, values({}));
      if (saved.kind !== "ok") throw new Error("setup");
      expect(await requests.submitRequest(requester, { requestId: saved.requestId, expectedRevision: 7 })).toEqual({
        kind: "refused",
        outcome: "changed_since_viewed",
      });
      expect(await requests.submitRequest(plain, { requestId: saved.requestId, expectedRevision: 1 })).toEqual({
        kind: "refused",
        outcome: "not_found",
      });
    });

    it("EC14 (first-submission half): a group no longer chargeable cannot take a first submission", async () => {
      const g = await fx.makeGroup(A, "Closing Committee");
      const link = await fx.chargeable(A, g, treasurer.userId);
      const saved = await requests.saveRequest(requester, values({ groupId: g }));
      if (saved.kind !== "ok") throw new Error("setup");
      await fx.q(sql`update reimbursement_chargeable_groups set ended_at = now(), ended_by_user = ${treasurer.userId} where id = ${link}`);
      expect(await requests.submitRequest(requester, { requestId: saved.requestId, expectedRevision: 1 })).toEqual({
        kind: "refused",
        outcome: "group_not_chargeable",
      });
    });

    it("a visitor's existing draft cannot be sent: not_eligible", async () => {
      const m = await fx.member(A, "WasMember");
      const a = actor(A, m);
      const saved = await requests.saveRequest(a, values({}));
      if (saved.kind !== "ok") throw new Error("setup");
      await fx.q(sql`update memberships set engagement_status = 'visitor', current_roll = null where organization_id = ${A} and person_id = ${m.personId}`);
      expect(await requests.submitRequest(a, { requestId: saved.requestId, expectedRevision: 1 })).toEqual({
        kind: "refused",
        outcome: "not_eligible",
      });
    });
  });

  // =========================================================================
  describe("withdrawRequest", () => {
    it("the creator withdraws a draft; a second withdraw is not_withdrawable and reports the status it is in", async () => {
      const saved = await requests.saveRequest(requester, values({}));
      if (saved.kind !== "ok") throw new Error("setup");
      expect(await requests.withdrawRequest(requester, { requestId: saved.requestId, reason: null })).toEqual({ kind: "ok" });
      expect(await requests.withdrawRequest(requester, { requestId: saved.requestId, reason: null })).toEqual({
        kind: "not_withdrawable",
        status: "withdrawn",
      });
    });

    it("someone else cannot withdraw it - the same not_found as a request that does not exist", async () => {
      const saved = await requests.saveRequest(requester, values({}));
      if (saved.kind !== "ok") throw new Error("setup");
      const theirs = await requests.withdrawRequest(plain, { requestId: saved.requestId, reason: null });
      expect(theirs).toEqual({ kind: "refused", outcome: "not_found" });
      expect(await requests.withdrawRequest(plain, { requestId: "99999999-9999-4999-8999-999999999999", reason: null })).toEqual(theirs);
    });

    it("the beneficiary who has an account may withdraw a submitted request entered on their behalf", async () => {
      const saved = await requests.saveRequest(clerk, values({ beneficiaryPersonId: listed.personId }));
      if (saved.kind !== "ok") throw new Error("setup");
      await requests.submitRequest(clerk, { requestId: saved.requestId, expectedRevision: saved.revision });
      expect(await requests.withdrawRequest(listed, { requestId: saved.requestId, reason: "No longer needed" })).toEqual({ kind: "ok" });
    });

    it("the reason is recorded in history and an over-long one is a named refusal, not a truncation", async () => {
      const saved = await requests.saveRequest(requester, values({}));
      if (saved.kind !== "ok") throw new Error("setup");
      expect(await requests.withdrawRequest(requester, { requestId: saved.requestId, reason: "x".repeat(301) })).toEqual({
        kind: "refused",
        outcome: "reason_too_long",
      });
      expect(await requests.withdrawRequest(requester, { requestId: saved.requestId, reason: "Changed my mind" })).toEqual({ kind: "ok" });
      const [event] = await fx.q(sql`select note from reimbursement_events where request_id = ${saved.requestId} and kind = 'withdrawn'`);
      expect(event!.note).toBe("Changed my mind");
    });
  });

  // =========================================================================
  describe("pickers.searchBeneficiaries (residual 6)", () => {
    it("offers listed members by name, names only", async () => {
      const found = await pickers.searchBeneficiaries(clerk, "Listed");
      expect(found.map((c) => c.personId)).toEqual([listed.personId]);
      expect(Object.keys(found[0]!).sort()).toEqual(["displayName", "personId"]);
      expect(found[0]!.displayName).toMatch(/^Listed /);
    });

    it("never offers a directory_hidden member", async () => {
      expect(await pickers.searchBeneficiaries(clerk, "Hidden")).toEqual([]);
    });

    it("needs request_for_others: a plain member gets the same empty list as a query that matches no one", async () => {
      expect(await pickers.searchBeneficiaries(plain, "Listed")).toEqual([]);
      expect(await pickers.searchBeneficiaries(clerk, "Zzzzzz")).toEqual([]);
    });

    it("needs the directory: a clerk role without directory.view finds no one", async () => {
      const m = await fx.member(A, "BlindClerk");
      await fx.grant(A, await fx.makeRole(A, "blind_clerk", ["reimbursement.request_for_others"]), m.personId);
      expect(await pickers.searchBeneficiaries(actor(A, m), "Listed")).toEqual([]);
    });

    it("does not search a query under two characters, and returns at most eight", async () => {
      expect(await pickers.searchBeneficiaries(clerk, "L")).toEqual([]);
      expect((await pickers.searchBeneficiaries(clerk, "Quillfeather")).length).toBeLessThanOrEqual(8);
    });

    it("never crosses organizations", async () => {
      const elsewhere = await fx.member(N, "Quartzenburg");
      void elsewhere;
      expect(await pickers.searchBeneficiaries(clerk, "Quartzenburg")).toEqual([]);
    });
  });
});
