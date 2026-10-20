/**
 * gifts.ts against a REAL Postgres connection (docs/work-log/
 * 2026-10-15-online-giving.md, Batch 2): the list and its keyset paging, the
 * filters, offline recording through `presby_giving_record_offline_gift`, void
 * through `presby_giving_void_gift`, the recorder's own recent entries, the
 * CSV export's query, and the S4 scope ruling (P3-4). Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/giving/gifts.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { offlineGiftSchema, type OfflineGiftValues } from "./gift-input";
import type { GivingFixture } from "@/lib/testing/giving-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Actor = { personId: string; userId: string };

describe.skipIf(!hasDb)("gifts.ts (Postgres-backed)", () => {
  let fx: GivingFixture;
  let gifts: typeof import("./gifts");
  let armGivingWrite: typeof import("@/lib/testing/giving-fixture").armGivingWrite;

  let org: string;
  let otherOrg: string;
  let fund: string;
  let fund2: string;
  let retiredFund: string;
  let otherFund: string;
  let conn: string;
  let treasurer: Actor; // view + record + manage
  let manageOnly: Actor;
  let viewer: Actor;
  let recorder: Actor;
  let recorder2: Actor;
  let nobody: Actor;
  let donor: string;

  /** A parsed form value, the way the action hands it to the library. */
  function values(over: Record<string, unknown> = {}): OfflineGiftValues {
    return offlineGiftSchema.parse({
      donor: { mode: "existing", donorId: donor },
      fundId: fund,
      occurredOn: localToday(-1),
      method: "cash",
      amount: "50",
      ...over,
    });
  }

  // The org has no settings row, so "today" is America/New_York (F132).
  function localToday(offsetDays = 0): string {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const [y, m, d] = parts.split("-").map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
  }

  async function q(query: ReturnType<typeof sql>) {
    return fx.rowsOf(await fx.platform.execute(query));
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/giving-fixture");
    armGivingWrite = mod.armGivingWrite;
    fx = await mod.createGivingFixture("gifts-db-test");
    gifts = await import("./gifts");

    org = await fx.makeOrg("a", { givingToggle: true });
    otherOrg = await fx.makeOrg("b", { givingToggle: true });
    fund = await fx.makeFund(org, "General Fund", { offeredOnline: true });
    fund2 = await fx.makeFund(org, "Building Fund", { offeredOnline: false });
    retiredFund = await fx.makeFund(org, "Old Fund", { retired: true });
    otherFund = await fx.makeFund(otherOrg, "Their Fund", { offeredOnline: false });
    conn = await fx.makeConnection(org, { status: "active", livemode: true });
    donor = await fx.makeDonor(org, "Josephine Marlowe", { email: "josephine@example.invalid" });

    treasurer = await fx.makeActor(org, "Tess", "Treasurer", ["giving.view", "giving.record", "giving.manage"]);
    manageOnly = await fx.makeActor(org, "Max", "Manager", ["giving.manage"]);
    viewer = await fx.makeActor(org, "Vera", "Viewer", ["giving.view"]);
    recorder = await fx.makeActor(org, "Rex", "Recorder", ["giving.record"]);
    recorder2 = await fx.makeActor(org, "Rita", "Recorder", ["giving.record"]);
    nobody = await fx.makeActor(org, "Nora", "Nobody", []);
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  // -----------------------------------------------------------------------
  describe("recordOfflineGift", () => {
    it("records cash, a check with a number, and stock; the row carries the actor as recorded_by", async () => {
      const cash = await gifts.recordOfflineGift(recorder.personId, org, recorder.userId, values({ amount: "125.50" }));
      expect(cash).toMatchObject({ kind: "ok", amountCents: 12_550, createdDonor: false, donorId: donor });
      if (cash.kind !== "ok") return;
      const [row] = await q(sql`select source, method, status, amount_cents, livemode, recorded_by, occurred_on::text as d from giving_gifts where id = ${cash.giftId}`);
      expect(row).toMatchObject({ source: "offline", method: "cash", status: "succeeded", amount_cents: 12_550, livemode: true, recorded_by: recorder.userId });

      const check = await gifts.recordOfflineGift(recorder.personId, org, recorder.userId, values({ method: "check", checkNumber: "1042", amount: "75" }));
      expect(check.kind).toBe("ok");
      if (check.kind === "ok") {
        const [r] = await q(sql`select check_number from giving_gifts where id = ${check.giftId}`);
        expect(r!.check_number).toBe("1042");
      }

      const stock = await gifts.recordOfflineGift(
        recorder.personId, org, recorder.userId,
        values({ method: "stock", stockDescription: "20 shares of an index fund", stockQuantity: "20", amount: "2000" }),
      );
      expect(stock.kind).toBe("ok");
      if (stock.kind === "ok") {
        const [r] = await q(sql`select method, stock_description, stock_quantity::text as qty from giving_gifts where id = ${stock.giftId}`);
        expect(r).toMatchObject({ method: "stock", stock_description: "20 shares of an index fund", qty: "20.000000" });
      }
    });

    it("refuses anyone without giving.record, whatever else they hold (including giving.manage alone)", async () => {
      for (const actor of [manageOnly, viewer, nobody]) {
        expect(await gifts.recordOfflineGift(actor.personId, org, actor.userId, values())).toEqual({ kind: "forbidden" });
      }
    });

    it("the DATABASE refuses a claimed actor who lacks giving.record, even when the caller's person has it (D2)", async () => {
      // personId = the recorder (passes the TS gate), userId = the viewer's user (the DEFINER function re-proves it)
      expect(await gifts.recordOfflineGift(recorder.personId, org, viewer.userId, values())).toEqual({ kind: "forbidden" });
    });

    it("rejects a future date, in the organization's own zone", async () => {
      expect(await gifts.recordOfflineGift(recorder.personId, org, recorder.userId, values({ occurredOn: localToday(2) }))).toEqual({ kind: "future_date" });
      // today and yesterday are fine
      expect((await gifts.recordOfflineGift(recorder.personId, org, recorder.userId, values({ occurredOn: localToday(0), amount: "3" }))).kind).toBe("ok");
    });

    it("rejects a retired fund and a fund from another organization", async () => {
      expect(await gifts.recordOfflineGift(recorder.personId, org, recorder.userId, values({ fundId: retiredFund }))).toEqual({ kind: "retired_fund" });
      expect(await gifts.recordOfflineGift(recorder.personId, org, recorder.userId, values({ fundId: otherFund }))).toEqual({ kind: "retired_fund" });
    });

    it("an unidentified (plate) gift is cash only and reuses the single plate donor", async () => {
      const refused = await gifts.recordOfflineGift(
        recorder.personId, org, recorder.userId,
        offlineGiftSchema.parse({ donor: { mode: "unidentified" }, fundId: fund, occurredOn: localToday(-1), method: "cash", amount: "20" }),
      );
      expect(refused.kind).toBe("ok");
      const second = await gifts.recordOfflineGift(
        recorder.personId, org, recorder.userId,
        offlineGiftSchema.parse({ donor: { mode: "unidentified" }, fundId: fund, occurredOn: localToday(-1), method: "cash", amount: "21" }),
      );
      expect(second.kind).toBe("ok");
      if (refused.kind === "ok" && second.kind === "ok") expect(second.donorId).toBe(refused.donorId);
      const plate = await q(sql`select id from giving_donors where organization_id = ${org} and kind = 'unidentified'`);
      expect(plate).toHaveLength(1);

      // a check from the plate donor: the schema refuses it up front, and the DB refuses it behind that
      const viaExisting = await gifts.recordOfflineGift(
        recorder.personId, org, recorder.userId,
        values({ donor: { mode: "existing", donorId: String(plate[0]!.id) }, method: "check", amount: "9" }),
      );
      expect(viaExisting).toMatchObject({ kind: "invalid" });
    });

    it("a new donor is created WITH the gift in one transaction; a refused gift leaves no donor behind", async () => {
      const ok = await gifts.recordOfflineGift(
        recorder.personId, org, recorder.userId,
        values({ donor: { mode: "new", displayName: "Barnaby Quill", email: "barnaby@example.invalid", city: "Dover" }, amount: "40" }),
      );
      expect(ok).toMatchObject({ kind: "ok", createdDonor: true });
      if (ok.kind === "ok") {
        const [d] = await q(sql`select display_name, email, city, created_by from giving_donors where id = ${ok.donorId}`);
        expect(d).toMatchObject({ display_name: "Barnaby Quill", email: "barnaby@example.invalid", city: "Dover", created_by: recorder.userId });
      }

      const refused = await gifts.recordOfflineGift(
        recorder.personId, org, recorder.userId,
        values({ donor: { mode: "new", displayName: "Rollback Rowan" }, fundId: retiredFund }),
      );
      expect(refused).toEqual({ kind: "retired_fund" });
      expect(await q(sql`select 1 from giving_donors where organization_id = ${org} and display_name = 'Rollback Rowan'`)).toHaveLength(0);
    });

    it("warns, without blocking, when a new donor's name or email matches an existing donor", async () => {
      const byName = await gifts.recordOfflineGift(
        recorder.personId, org, recorder.userId,
        values({ donor: { mode: "new", displayName: "josephine marlowe" } }),
      );
      expect(byName).toMatchObject({ kind: "duplicate_donor", donors: [{ id: donor, displayName: "Josephine Marlowe" }] });

      const byEmail = await gifts.recordOfflineGift(
        recorder.personId, org, recorder.userId,
        values({ donor: { mode: "new", displayName: "J. Marlowe", email: "Josephine@Example.invalid" } }),
      );
      expect(byEmail.kind).toBe("duplicate_donor");

      const acknowledged = await gifts.recordOfflineGift(
        recorder.personId, org, recorder.userId,
        values({ donor: { mode: "new", displayName: "josephine marlowe" }, acknowledgeDuplicate: true, amount: "11" }),
      );
      expect(acknowledged).toMatchObject({ kind: "ok", createdDonor: true });
    });

    it("warns on a possible duplicate GIFT (same donor, date, amount, check number) and records it when acknowledged", async () => {
      const day = localToday(-3);
      const first = await gifts.recordOfflineGift(recorder.personId, org, recorder.userId, values({ occurredOn: day, amount: "88.80", method: "check", checkNumber: "7001" }));
      expect(first.kind).toBe("ok");

      const again = await gifts.recordOfflineGift(recorder.personId, org, recorder.userId, values({ occurredOn: day, amount: "88.80", method: "check", checkNumber: "7001" }));
      expect(again).toMatchObject({ kind: "duplicate_warning" });
      if (first.kind === "ok" && again.kind === "duplicate_warning") expect(again.giftId).toBe(first.giftId);

      // a different check number is a different gift
      expect((await gifts.recordOfflineGift(recorder.personId, org, recorder.userId, values({ occurredOn: day, amount: "88.80", method: "check", checkNumber: "7002" }))).kind).toBe("ok");
      // acknowledged -> recorded
      expect((await gifts.recordOfflineGift(recorder.personId, org, recorder.userId, values({ occurredOn: day, amount: "88.80", method: "check", checkNumber: "7001", acknowledgeDuplicate: true }))).kind).toBe("ok");
    });

    it("a voided gift is not a duplicate of a new identical one", async () => {
      const day = localToday(-4);
      const first = await gifts.recordOfflineGift(recorder.personId, org, recorder.userId, values({ occurredOn: day, amount: "17.17" }));
      if (first.kind !== "ok") throw new Error("setup");
      expect((await gifts.voidGift(treasurer.personId, org, treasurer.userId, { giftId: first.giftId, reason: "keyed in error" })).kind).toBe("ok");
      expect((await gifts.recordOfflineGift(recorder.personId, org, recorder.userId, values({ occurredOn: day, amount: "17.17" }))).kind).toBe("ok");
    });

    it("refuses a merged donor, and another organization's donor, as an inline donor error", async () => {
      const survivor = await fx.makeDonor(org, "Survivor Sam");
      const merged = await fx.makeDonor(org, "Merged Mia");
      await fx.platform.execute(sql`update giving_donors set merged_into_id = ${survivor}, merged_at = now() where id = ${merged}`);
      const mergedTry = await gifts.recordOfflineGift(recorder.personId, org, recorder.userId, values({ donor: { mode: "existing", donorId: merged } }));
      expect(mergedTry).toMatchObject({ kind: "invalid", fieldErrors: { "donor.donorId": expect.any(String) } });

      const foreign = await fx.makeDonor(otherOrg, "Foreign Fran");
      const foreignTry = await gifts.recordOfflineGift(recorder.personId, org, recorder.userId, values({ donor: { mode: "existing", donorId: foreign } }));
      expect(foreignTry).toMatchObject({ kind: "invalid" });
    });
  });

  // -----------------------------------------------------------------------
  describe("voidGift", () => {
    async function record(actor: Actor, amount = "30"): Promise<string> {
      const result = await gifts.recordOfflineGift(actor.personId, org, actor.userId, values({ amount, occurredOn: localToday(-5) , acknowledgeDuplicate: true }));
      if (result.kind !== "ok") throw new Error(`setup: ${result.kind}`);
      return result.giftId;
    }

    it("a recorder voids their OWN entry; the gift is untouched and a void reversal is inserted", async () => {
      const giftId = await record(recorder, "31");
      const result = await gifts.voidGift(recorder.personId, org, recorder.userId, { giftId, reason: "  Keyed twice  " });
      expect(result).toMatchObject({ kind: "ok", amountCents: 3_100 });
      const [reversal] = await q(sql`select kind, amount_cents, reason, recorded_by from giving_gift_reversals where gift_id = ${giftId}`);
      expect(reversal).toMatchObject({ kind: "void", amount_cents: 3_100, reason: "Keyed twice", recorded_by: recorder.userId });
      const [g] = await q(sql`select status, amount_cents from giving_gifts where id = ${giftId}`);
      expect(g).toMatchObject({ status: "succeeded", amount_cents: 3_100 });
    });

    it("a recorder may NOT void someone else's entry; the treasurer may void any offline gift", async () => {
      const giftId = await record(recorder, "32");
      expect(await gifts.voidGift(recorder2.personId, org, recorder2.userId, { giftId, reason: "not mine" })).toEqual({ kind: "forbidden" });
      expect((await gifts.voidGift(treasurer.personId, org, treasurer.userId, { giftId, reason: "treasurer correction" })).kind).toBe("ok");
    });

    it("a recorder cannot void their own entry once it is older than 30 days; the treasurer still can", async () => {
      const giftId = await fx.makeOfflineGift(org, donor, fund, 3_300, { recordedBy: recorder.userId, createdDaysAgo: 31 });
      expect(await gifts.voidGift(recorder.personId, org, recorder.userId, { giftId, reason: "too late now" })).toEqual({
        kind: "not_voidable", reason: "outside_window",
      });
      const fresh = await fx.makeOfflineGift(org, donor, fund, 3_301, { recordedBy: recorder.userId, createdDaysAgo: 29 });
      expect((await gifts.voidGift(recorder.personId, org, recorder.userId, { giftId: fresh, reason: "inside the window" })).kind).toBe("ok");
      expect((await gifts.voidGift(treasurer.personId, org, treasurer.userId, { giftId, reason: "treasurer override" })).kind).toBe("ok");
    });

    it("needs giving.record (D2): a giving.manage-only holder is refused, as is a viewer", async () => {
      const giftId = await record(recorder, "34");
      expect(await gifts.voidGift(manageOnly.personId, org, manageOnly.userId, { giftId, reason: "no record key" })).toEqual({ kind: "forbidden" });
      expect(await gifts.voidGift(viewer.personId, org, viewer.userId, { giftId, reason: "view only" })).toEqual({ kind: "forbidden" });
    });

    it("refuses twice, an online gift, an unknown gift and another organization's gift", async () => {
      const giftId = await record(recorder, "35");
      expect((await gifts.voidGift(treasurer.personId, org, treasurer.userId, { giftId, reason: "first void" })).kind).toBe("ok");
      expect(await gifts.voidGift(treasurer.personId, org, treasurer.userId, { giftId, reason: "second void" })).toEqual({
        kind: "not_voidable", reason: "already_voided",
      });

      const online = await fx.makeOnlineGift(org, conn, donor, fund, 5_000);
      expect(await gifts.voidGift(treasurer.personId, org, treasurer.userId, { giftId: online, reason: "online one" })).toEqual({
        kind: "not_voidable", reason: "not_offline",
      });

      expect(await gifts.voidGift(treasurer.personId, org, treasurer.userId, { giftId: "99999999-9999-4999-8999-999999999999", reason: "ghost" })).toEqual({ kind: "not_found" });
      const foreignDonor = await fx.makeDonor(otherOrg, "Foreign");
      const foreignGift = await fx.makeOfflineGift(otherOrg, foreignDonor, otherFund, 1_000);
      expect(await gifts.voidGift(treasurer.personId, org, treasurer.userId, { giftId: foreignGift, reason: "cross org" })).toEqual({ kind: "not_found" });
    });
  });

  // -----------------------------------------------------------------------
  describe("listGifts, getGift, exportGifts", () => {
    let listOrg: string;
    let lister: Actor;
    let lTreasurer: Actor;
    let lConn: string;
    let lFund: string;
    let lFund2: string;
    let lDonor: string;
    let lDonor2: string;
    let mergedDonor: string;
    let refundedGift: string;
    let voidedGift: string;
    let testModeGift: string;

    beforeAll(async () => {
      listOrg = await fx.makeOrg("list", { givingToggle: true });
      lConn = await fx.makeConnection(listOrg, { status: "active", livemode: true });
      lFund = await fx.makeFund(listOrg, "General");
      lFund2 = await fx.makeFund(listOrg, "Missions");
      lDonor = await fx.makeDonor(listOrg, "Aurelia Pennington", { email: "aurelia@example.invalid" });
      lDonor2 = await fx.makeDonor(listOrg, "Benedict Ashworth");
      mergedDonor = await fx.makeDonor(listOrg, "A. Pennington");
      await fx.platform.execute(sql`update giving_donors set merged_into_id = ${lDonor}, merged_at = now() where id = ${mergedDonor}`);
      lister = await fx.makeActor(listOrg, "Lena", "Lister", ["giving.view", "giving.record"]);
      lTreasurer = await fx.makeActor(listOrg, "Leo", "Treasurer", ["giving.view", "giving.record", "giving.manage"]);

      // 120 offline gifts across 3 dates for paging, plus the specials
      await fx.platform.transaction(async (tx) => {
        await armGivingWrite(tx);
        for (let i = 0; i < 120; i++) {
          await tx.execute(sql`
            insert into giving_gifts (organization_id, donor_id, fund_id, source, method, amount_cents, status, occurred_on, livemode, recorded_by)
            values (${listOrg}, ${i % 2 === 0 ? lDonor : lDonor2}, ${i % 3 === 0 ? lFund2 : lFund}, 'offline', 'cash', ${100 + i}, 'succeeded',
                    current_date - (${10 + (i % 3)})::int, true, ${lister.userId})`);
        }
      });
      refundedGift = await fx.makeOnlineGift(listOrg, lConn, lDonor, lFund, 10_000, { feeCents: 320 });
      await fx.makeReversal(listOrg, lConn, refundedGift, "refund", 4_000);
      voidedGift = await fx.makeOfflineGift(listOrg, mergedDonor, lFund, 2_500);
      const voidResult = await gifts.voidGift(lTreasurer.personId, listOrg, lTreasurer.userId, { giftId: voidedGift, reason: "keyed twice" });
      if (voidResult.kind !== "ok") throw new Error(`setup: void ${voidResult.kind}`);
      testModeGift = await fx.makeOnlineGift(listOrg, lConn, lDonor, lFund, 9_900, { livemode: false });
      await fx.makeOnlineGift(listOrg, lConn, lDonor2, lFund, 1_500, { status: "pending", feeCents: null });
      await fx.makeOnlineGift(listOrg, lConn, lDonor2, lFund, 1_600, { status: "failed" });
    });

    it("the ledger is giving.view ONLY: a recorder, a manager and a plain member get 'forbidden' (S4)", async () => {
      const recorderOnly = await fx.makeActor(listOrg, "Rory", "Recorder", ["giving.record"]);
      const managerOnly = await fx.makeActor(listOrg, "Mona", "Manager", ["giving.manage"]);
      const plain = await fx.makeActor(listOrg, "Pia", "Plain", []);
      for (const actor of [recorderOnly, managerOnly, plain]) {
        expect(await gifts.listGifts(actor.personId, listOrg, { filters: {} })).toEqual({ kind: "forbidden" });
        expect(await gifts.exportGifts(actor.personId, listOrg, {})).toEqual({ kind: "forbidden" });
        expect(await gifts.getGift(actor.personId, listOrg, actor.userId, refundedGift)).toEqual({ kind: "forbidden" });
      }
    });

    it("pages 50 at a time by (occurred_on desc, id desc) with no gap and no repeat", async () => {
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await gifts.listGifts(lister.personId, listOrg, { filters: {}, cursor });
        if (page.kind !== "ok") throw new Error("setup");
        expect(page.gifts.length).toBeLessThanOrEqual(50);
        seen.push(...page.gifts.map((g) => g.id));
        cursor = page.nextCursor ?? undefined;
        pages += 1;
      } while (cursor && pages < 10);
      const all = await q(sql`select id from giving_gifts where organization_id = ${listOrg}`);
      expect(seen).toHaveLength(all.length);
      expect(new Set(seen).size).toBe(seen.length);

      // ordering: dates never increase down the list
      const first = await gifts.listGifts(lister.personId, listOrg, { filters: {} });
      if (first.kind !== "ok") throw new Error("setup");
      const dates = first.gifts.map((g) => g.occurredOn);
      expect([...dates].sort().reverse()).toEqual(dates);
    });

    it("a tampered cursor is dropped to page one, not an error", async () => {
      const page = await gifts.listGifts(lister.personId, listOrg, { filters: {}, cursor: "not-a-cursor'; drop table giving_gifts;--" });
      expect(page.kind).toBe("ok");
      expect(gifts.decodeGiftCursor("2026-01-01|nope")).toBeNull();
      expect(gifts.decodeGiftCursor(undefined)).toBeNull();
      expect(gifts.decodeGiftCursor(gifts.encodeGiftCursor({ occurredOn: "2026-01-01", id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }))).toEqual({
        occurredOn: "2026-01-01", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      });
    });

    it("filters by fund, status, source, donor (including its merged donors) and date", async () => {
      const byFund = await gifts.listGifts(lister.personId, listOrg, { filters: { fundId: lFund2 } });
      if (byFund.kind !== "ok") throw new Error("setup");
      expect(byFund.gifts.length).toBeGreaterThan(0);
      expect(byFund.gifts.every((g) => g.fundId === lFund2)).toBe(true);

      const failed = await gifts.listGifts(lister.personId, listOrg, { filters: { status: "failed" } });
      if (failed.kind !== "ok") throw new Error("setup");
      expect(failed.gifts.map((g) => g.status)).toEqual(["failed"]);

      const pending = await gifts.listGifts(lister.personId, listOrg, { filters: { status: "pending" } });
      expect(pending.kind === "ok" && pending.gifts.length).toBe(1);

      const online = await gifts.listGifts(lister.personId, listOrg, { filters: { source: "online" } });
      if (online.kind !== "ok") throw new Error("setup");
      expect(online.gifts.every((g) => g.source === "online")).toBe(true);
      expect(online.gifts).toHaveLength(4); // refunded, test-mode, pending, failed

      // the root donor's filter includes gifts written to a donor merged into it
      const byRoot = await gifts.listGifts(lister.personId, listOrg, { filters: { donorId: lDonor, fundId: lFund, source: "offline" } });
      if (byRoot.kind !== "ok") throw new Error("setup");
      expect(byRoot.gifts.some((g) => g.id === voidedGift)).toBe(true);
      // and the merged donor's gift is NAMED for the root donor
      expect(byRoot.gifts.find((g) => g.id === voidedGift)?.donorName).toBe("Aurelia Pennington");

      const dated = await gifts.listGifts(lister.personId, listOrg, { filters: { from: "2000-01-01", to: "2000-12-31" } });
      expect(dated.kind === "ok" && dated.gifts.length).toBe(0);
    });

    it("rows carry net-of-reversal figures, the voided flag and the Test badge flag", async () => {
      const listed = await gifts.listGifts(lister.personId, listOrg, { filters: { source: "online" } });
      if (listed.kind !== "ok") throw new Error("setup");
      const refunded = listed.gifts.find((g) => g.id === refundedGift)!;
      expect(refunded).toMatchObject({ amountCents: 10_000, reversedCents: 4_000, feeCents: 320, netCents: 9_680, voided: false, testMode: false });
      expect(listed.gifts.find((g) => g.id === testModeGift)?.testMode).toBe(true);

      const offline = await gifts.listGifts(lister.personId, listOrg, { filters: { donorId: lDonor, source: "offline", fundId: lFund } });
      if (offline.kind !== "ok") throw new Error("setup");
      expect(offline.gifts.find((g) => g.id === voidedGift)).toMatchObject({ voided: true, reversedCents: 2_500 });
    });

    it("exportGifts: live-mode gifts only (a test-mode gift never reaches the CSV), no PII on the row", async () => {
      const exported = await gifts.exportGifts(lister.personId, listOrg, {});
      if (exported.kind !== "ok") throw new Error("setup");
      expect(exported.rows.some((r) => r.giftId === testModeGift)).toBe(false);
      expect(exported.rows.some((r) => r.giftId === refundedGift)).toBe(true);
      expect(exported.rows).toHaveLength(124); // 120 offline + refunded + voided + pending + failed; the test-mode gift is excluded
      const keys = new Set(Object.keys(exported.rows[0]!));
      for (const forbidden of ["email", "address", "memo", "phone"]) expect([...keys].some((k) => k.toLowerCase().includes(forbidden))).toBe(false);
    });

    it("getGift: detail, reversals in order, provenance, and canVoid by key; another org's gift is not_found", async () => {
      const detail = await gifts.getGift(lister.personId, listOrg, lister.userId, refundedGift);
      expect(detail.kind).toBe("ok");
      if (detail.kind !== "ok") return;
      expect(detail.gift.reversals).toMatchObject([{ kind: "refund", amountCents: 4_000 }]);
      expect(detail.gift.source).toBe("online");
      expect(detail.gift.canVoid).toBe(false); // online gifts are refunded in Stripe

      const voided = await gifts.getGift(lister.personId, listOrg, lister.userId, voidedGift);
      if (voided.kind !== "ok") throw new Error("setup");
      expect(voided.gift.reversals[0]).toMatchObject({ kind: "void", reason: "keyed twice" });
      expect(voided.gift.canVoid).toBe(false); // already voided

      const live = await fx.makeOfflineGift(listOrg, lDonor, lFund, 4_200);
      const mine = await gifts.getGift(lister.personId, listOrg, lister.userId, live);
      if (mine.kind !== "ok") throw new Error("setup");
      // lister holds view+record but not manage and did not record it (the fixture's recorded_by is the acting user)
      expect(mine.gift.canVoid).toBe(false);
      expect(mine.gift.recordedByName).toBeTruthy();

      const treasurerHere = await fx.makeActor(listOrg, "Theo", "Treasurer", ["giving.view", "giving.record", "giving.manage"]);
      const asTreasurer = await gifts.getGift(treasurerHere.personId, listOrg, treasurerHere.userId, live);
      expect(asTreasurer.kind === "ok" && asTreasurer.gift.canVoid).toBe(true);

      expect(await gifts.getGift(lister.personId, listOrg, lister.userId, "99999999-9999-4999-8999-999999999999")).toEqual({ kind: "not_found" });
      const foreignDonor = await fx.makeDonor(otherOrg, "Foreign 2");
      const foreignGift = await fx.makeOfflineGift(otherOrg, foreignDonor, otherFund, 1_000);
      expect(await gifts.getGift(lister.personId, listOrg, lister.userId, foreignGift)).toEqual({ kind: "not_found" });
    });
  });

  // -----------------------------------------------------------------------
  describe("listRecentOwnEntries (the whole of what a recorder reads about gifts, S4)", () => {
    it("returns the caller's OWN entries only, newest first, with the void flag", async () => {
      const mine = await gifts.listRecentOwnEntries(recorder2.personId, org, recorder2.userId);
      expect(mine.kind).toBe("ok");
      const result = await gifts.recordOfflineGift(recorder2.personId, org, recorder2.userId, values({ amount: "61", occurredOn: localToday(-6) }));
      if (result.kind !== "ok") throw new Error("setup");
      const after = await gifts.listRecentOwnEntries(recorder2.personId, org, recorder2.userId);
      if (after.kind !== "ok") throw new Error("setup");
      expect(after.entries.map((e) => e.id)).toContain(result.giftId);
      expect(after.entries.every((e) => e.amountCents > 0)).toBe(true);

      // another recorder never sees it
      const theirs = await gifts.listRecentOwnEntries(recorder.personId, org, recorder.userId);
      if (theirs.kind !== "ok") throw new Error("setup");
      expect(theirs.entries.map((e) => e.id)).not.toContain(result.giftId);
    });

    it("carries no donor id, email, address or total - and a viewer/manager/plain member is refused", async () => {
      const entries = await gifts.listRecentOwnEntries(recorder.personId, org, recorder.userId);
      if (entries.kind !== "ok") throw new Error("setup");
      expect(entries.entries.length).toBeGreaterThan(0);
      const keys = Object.keys(entries.entries[0]!).sort();
      expect(keys).toEqual(["amountCents", "canVoid", "createdAt", "donorName", "fundName", "id", "method", "occurredOn", "voided"]);

      for (const actor of [viewer, manageOnly, nobody]) {
        expect(await gifts.listRecentOwnEntries(actor.personId, org, actor.userId)).toEqual({ kind: "forbidden" });
      }
    });

    it("a user id that is not the caller's gets only entries recorded by THAT id - the parameter is the actor, never a free target", async () => {
      // The page always passes the session's own user id; this documents that
      // the function filters strictly on it (no 'all entries' escape hatch).
      const others = await gifts.listRecentOwnEntries(recorder.personId, org, "99999999-9999-4999-8999-999999999999");
      expect(others).toEqual({ kind: "ok", entries: [] });
    });

    it("excludes entries older than 30 days and includes ones inside it", async () => {
      const old = await fx.makeOfflineGift(org, donor, fund, 777, { recordedBy: recorder2.userId, createdDaysAgo: 31 });
      const recent = await fx.makeOfflineGift(org, donor, fund, 778, { recordedBy: recorder2.userId, createdDaysAgo: 29 });
      const list = await gifts.listRecentOwnEntries(recorder2.personId, org, recorder2.userId);
      if (list.kind !== "ok") throw new Error("setup");
      const ids = list.entries.map((e) => e.id);
      expect(ids).toContain(recent);
      expect(ids).not.toContain(old);
    });
  });

  // -----------------------------------------------------------------------
  describe("the CSV cap", () => {
    it("answers too_many when the query returns more than CSV_MAX_ROWS", async () => {
      vi.resetModules();
      vi.doMock("./csv", async (importOriginal) => ({ ...(await importOriginal<typeof import("./csv")>()), CSV_MAX_ROWS: 2 }));
      const capped = await import("./gifts");
      const exported = await capped.exportGifts(treasurer.personId, org, {});
      expect(exported).toEqual({ kind: "too_many" });
      vi.doUnmock("./csv");
      vi.resetModules();
    });
  });

  // -----------------------------------------------------------------------
  describe("orgLocalToday / getRecordingDefaults", () => {
    it("reads 'today' in the organization's zone (America/New_York when it has no settings row)", async () => {
      const result = await gifts.getRecordingDefaults(recorder.personId, org);
      expect(result).toEqual({ kind: "ok", today: localToday(0) });
      expect(await gifts.getRecordingDefaults(viewer.personId, org)).toEqual({ kind: "forbidden" });
    });
  });
});
