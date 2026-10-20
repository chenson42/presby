/**
 * funds.ts against a REAL Postgres connection (docs/work-log/
 * 2026-10-15-online-giving.md, Batch 2). Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/giving/funds.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { GivingFixture } from "@/lib/testing/giving-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const FUND = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  onlineDisplayName: null,
  description: null,
  restrictionClass: "unrestricted" as const,
  offeredOnline: false,
  ...extra,
});

describe.skipIf(!hasDb)("funds.ts (Postgres-backed)", () => {
  let fx: GivingFixture;
  let funds: typeof import("./funds");
  let org: string;
  let otherOrg: string;
  let treasurer: { personId: string; userId: string };
  let viewer: { personId: string; userId: string };
  let recorder: { personId: string; userId: string };
  let nobody: { personId: string; userId: string };

  beforeAll(async () => {
    const mod = await import("@/lib/testing/giving-fixture");
    fx = await mod.createGivingFixture("funds-db-test");
    funds = await import("./funds");
    org = await fx.makeOrg("a", { givingToggle: true });
    otherOrg = await fx.makeOrg("b", { givingToggle: true });
    treasurer = await fx.makeActor(org, "Tess", "Manager", ["giving.view", "giving.record", "giving.manage"]);
    viewer = await fx.makeActor(org, "Vera", "Viewer", ["giving.view"]);
    recorder = await fx.makeActor(org, "Rex", "Recorder", ["giving.record"]);
    nobody = await fx.makeActor(org, "Nora", "Nobody", []);
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("every function refuses a holder of no giving key, a viewer and a recorder: manage only", async () => {
    for (const actor of [nobody, viewer, recorder]) {
      expect(await funds.listFunds(actor.personId, org)).toEqual({ kind: "forbidden" });
      expect(await funds.createFund(actor.personId, org, actor.userId, FUND("Nope") as never)).toEqual({ kind: "forbidden" });
    }
  });

  it("creates a fund and lists it with active first; a name is unique including a retired one", async () => {
    const created = await funds.createFund(treasurer.personId, org, treasurer.userId, FUND("General Fund") as never);
    expect(created.kind).toBe("ok");
    const second = await funds.createFund(treasurer.personId, org, treasurer.userId, FUND("Missions") as never);
    expect(second.kind).toBe("ok");

    const listed = await funds.listFunds(treasurer.personId, org);
    expect(listed.kind).toBe("ok");
    if (listed.kind !== "ok") return;
    expect(listed.funds.map((f) => f.name)).toEqual(["General Fund", "Missions"]);
    expect(listed.funds.every((f) => f.isActive && !f.offeredOnline && !f.hasGifts)).toBe(true);

    // a duplicate name, any case, is typed - not thrown
    expect(await funds.createFund(treasurer.personId, org, treasurer.userId, FUND("general fund") as never)).toEqual({
      kind: "duplicate_name",
    });

    // retire Missions: its name stays reserved
    if (second.kind !== "ok") return;
    expect((await funds.retireFund(treasurer.personId, org, treasurer.userId, second.fundId)).kind).toBe("ok");
    expect(await funds.createFund(treasurer.personId, org, treasurer.userId, FUND("MISSIONS") as never)).toEqual({
      kind: "duplicate_name",
    });
  });

  it("an offered-online fund needs a display name (the DB CHECK) and nothing is online by default", async () => {
    const withName = await funds.createFund(
      treasurer.personId, org, treasurer.userId,
      FUND("Building Fund", { onlineDisplayName: "Building Fund", offeredOnline: true, restrictionClass: "temporarily_restricted" }) as never,
    );
    expect(withName.kind).toBe("ok");
    // without a public name the CHECK refuses (the schema layer catches it first in the app; the DB is the backstop)
    await expect(
      funds.createFund(treasurer.personId, org, treasurer.userId, FUND("Hidden", { offeredOnline: true }) as never),
    ).rejects.toThrow();
  });

  it("updates a fund and reports exactly which fields changed", async () => {
    const created = await funds.createFund(treasurer.personId, org, treasurer.userId, FUND("Youth Fund") as never);
    if (created.kind !== "ok") throw new Error("setup");
    const same = await funds.updateFund(treasurer.personId, org, treasurer.userId, created.fundId, FUND("Youth Fund") as never);
    expect(same).toEqual({ kind: "ok", changedFields: [] });

    const changed = await funds.updateFund(
      treasurer.personId, org, treasurer.userId, created.fundId,
      FUND("Youth Ministry", { description: "Camp and trips", restrictionClass: "permanently_restricted" }) as never,
    );
    expect(changed).toEqual({ kind: "ok", changedFields: ["name", "description", "restrictionClass"] });

    expect(await funds.updateFund(treasurer.personId, org, treasurer.userId, "99999999-9999-4999-8999-999999999999", FUND("X") as never)).toEqual({ kind: "not_found" });
    // renaming onto an existing name is typed
    expect(await funds.updateFund(treasurer.personId, org, treasurer.userId, created.fundId, FUND("General Fund") as never)).toEqual({
      kind: "duplicate_name",
    });
  });

  it("retire clears the online offer; reactivate does NOT put it back; a retired fund cannot be offered", async () => {
    const created = await funds.createFund(
      treasurer.personId, org, treasurer.userId,
      FUND("Hunger Relief", { onlineDisplayName: "Hunger Relief", offeredOnline: true }) as never,
    );
    if (created.kind !== "ok") throw new Error("setup");

    expect((await funds.retireFund(treasurer.personId, org, treasurer.userId, created.fundId)).kind).toBe("ok");
    const [retired] = fx.rowsOf(await fx.platform.execute(sql`select is_active, offered_online, retired_at is not null as r from giving_funds where id = ${created.fundId}`));
    expect(retired).toMatchObject({ is_active: false, offered_online: false, r: true });
    expect(await funds.retireFund(treasurer.personId, org, treasurer.userId, created.fundId)).toEqual({ kind: "already_retired" });

    // asking to offer a retired fund online is ignored, not an error
    const edit = await funds.updateFund(
      treasurer.personId, org, treasurer.userId, created.fundId,
      FUND("Hunger Relief", { onlineDisplayName: "Hunger Relief", offeredOnline: true }) as never,
    );
    expect(edit.kind).toBe("ok");
    const [still] = fx.rowsOf(await fx.platform.execute(sql`select offered_online from giving_funds where id = ${created.fundId}`));
    expect(still!.offered_online).toBe(false);

    expect((await funds.reactivateFund(treasurer.personId, org, treasurer.userId, created.fundId)).kind).toBe("ok");
    const [back] = fx.rowsOf(await fx.platform.execute(sql`select is_active, offered_online from giving_funds where id = ${created.fundId}`));
    expect(back).toMatchObject({ is_active: true, offered_online: false });
    expect(await funds.reactivateFund(treasurer.personId, org, treasurer.userId, created.fundId)).toEqual({ kind: "already_active" });
  });

  it("retiring the LAST online fund while the public page is live needs confirm; a second online fund or an unlive page does not", async () => {
    const solo = await fx.makeOrg("solo", { givingToggle: true });
    const boss = await fx.makeActor(solo, "Sol", "Boss", ["giving.manage"]);
    const only = await funds.createFund(boss.personId, solo, boss.userId, FUND("Only", { onlineDisplayName: "Only", offeredOnline: true }) as never);
    if (only.kind !== "ok") throw new Error("setup");

    // no connection yet: the public page is not live, so no confirmation is needed
    const noPage = await funds.createFund(boss.personId, solo, boss.userId, FUND("Spare", { onlineDisplayName: "Spare", offeredOnline: true }) as never);
    if (noPage.kind !== "ok") throw new Error("setup");
    expect((await funds.retireFund(boss.personId, solo, boss.userId, noPage.fundId)).kind).toBe("ok");

    // a live public page + the last online fund => confirm_required, then ok with confirm
    await fx.makeConnection(solo, { status: "active", isPublic: true });
    expect(await funds.retireFund(boss.personId, solo, boss.userId, only.fundId)).toEqual({
      kind: "confirm_required",
      reason: "last_online_fund",
    });
    const [untouched] = fx.rowsOf(await fx.platform.execute(sql`select is_active from giving_funds where id = ${only.fundId}`));
    expect(untouched!.is_active).toBe(true);
    expect((await funds.retireFund(boss.personId, solo, boss.userId, only.fundId, { confirm: true })).kind).toBe("ok");

    // with a second online fund, retiring one needs no confirmation
    const a = await funds.createFund(boss.personId, solo, boss.userId, FUND("A", { onlineDisplayName: "A", offeredOnline: true }) as never);
    const b = await funds.createFund(boss.personId, solo, boss.userId, FUND("B", { onlineDisplayName: "B", offeredOnline: true }) as never);
    if (a.kind !== "ok" || b.kind !== "ok") throw new Error("setup");
    expect((await funds.retireFund(boss.personId, solo, boss.userId, a.fundId)).kind).toBe("ok");
  });

  it("listFundOptions: manage/view/record may read the ACTIVE funds, name only; a plain member may not", async () => {
    for (const actor of [treasurer, viewer, recorder]) {
      const options = await funds.listFundOptions(actor.personId, org);
      expect(options.kind).toBe("ok");
      if (options.kind !== "ok") continue;
      expect(options.funds.length).toBeGreaterThan(0);
      for (const option of options.funds) expect(Object.keys(option).sort()).toEqual(["id", "name"]);
    }
    expect(await funds.listFundOptions(nobody.personId, org)).toEqual({ kind: "forbidden" });

    const active = await funds.listFundOptions(recorder.personId, org);
    const withRetired = await funds.listFundOptions(viewer.personId, org, { includeRetired: true });
    const recorderTryingRetired = await funds.listFundOptions(recorder.personId, org, { includeRetired: true });
    if (active.kind !== "ok" || withRetired.kind !== "ok" || recorderTryingRetired.kind !== "ok") throw new Error("setup");
    expect(withRetired.funds.length).toBeGreaterThan(active.funds.length);
    // a recorder asking for retired funds still gets only the active ones
    expect(recorderTryingRetired.funds).toEqual(active.funds);
  });

  it("never reads or writes another organization's funds", async () => {
    const theirFund = await fx.makeFund(otherOrg, "Their Fund");
    const mine = await funds.listFunds(treasurer.personId, org);
    if (mine.kind !== "ok") throw new Error("setup");
    expect(mine.funds.some((f) => f.id === theirFund)).toBe(false);
    expect(await funds.updateFund(treasurer.personId, org, treasurer.userId, theirFund, FUND("Hijack") as never)).toEqual({ kind: "not_found" });
    expect(await funds.retireFund(treasurer.personId, org, treasurer.userId, theirFund)).toEqual({ kind: "not_found" });
    expect(await funds.reactivateFund(treasurer.personId, org, treasurer.userId, theirFund)).toEqual({ kind: "not_found" });
    // and a person with no membership at the org is refused outright
    await expect(funds.listFunds(treasurer.personId, otherOrg)).rejects.toThrow();
  });

  it("hasGifts is true once a gift references the fund", async () => {
    const created = await funds.createFund(treasurer.personId, org, treasurer.userId, FUND("Has Gifts") as never);
    if (created.kind !== "ok") throw new Error("setup");
    const donor = await fx.makeDonor(org, "Fund Test Donor");
    await fx.makeOfflineGift(org, donor, created.fundId, 1000);
    const listed = await funds.listFunds(treasurer.personId, org);
    if (listed.kind !== "ok") throw new Error("setup");
    expect(listed.funds.find((f) => f.id === created.fundId)?.hasGifts).toBe(true);
    expect(listed.funds.find((f) => f.name === "General Fund")?.hasGifts).toBe(false);
  });
});
