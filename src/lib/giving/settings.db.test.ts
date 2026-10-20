/**
 * settings.ts against a REAL Postgres connection (docs/work-log/
 * 2026-10-15-online-giving.md, R5 / DECISION-172). Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/giving/settings.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { givingSettingsSchema } from "./settings-input";
import type { GivingFixture } from "@/lib/testing/giving-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("settings.ts (Postgres-backed)", () => {
  let fx: GivingFixture;
  let settings: typeof import("./settings");
  let org: string;
  let otherOrg: string;
  let treasurer: { personId: string; userId: string };
  let viewer: { personId: string; userId: string };
  let recorder: { personId: string; userId: string };

  const parse = (over: Record<string, unknown>) => givingSettingsSchema.parse(over);

  beforeAll(async () => {
    const mod = await import("@/lib/testing/giving-fixture");
    fx = await mod.createGivingFixture("settings-db-test");
    settings = await import("./settings");
    org = await fx.makeOrg("a", { givingToggle: true });
    otherOrg = await fx.makeOrg("b", { givingToggle: true });
    treasurer = await fx.makeActor(org, "Tess", "Treasurer", ["giving.view", "giving.record", "giving.manage"]);
    viewer = await fx.makeActor(org, "Vera", "Viewer", ["giving.view"]);
    recorder = await fx.makeActor(org, "Rex", "Recorder", ["giving.record"]);
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("an organization with no row reads as blank, unsaved, with both blockers", async () => {
    const result = await settings.getGivingSettings(treasurer.personId, org);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.saved).toBe(false);
    expect(Object.values(result.settings).every((v) => v === null)).toBe(true);
    expect(result.blockers).toEqual(["donee_name", "donee_address"]);
  });

  it("the first save creates the row and reports every field set as changed; the audit gets NAMES only", async () => {
    const saved = await settings.updateGivingSettings(
      treasurer.personId, org, treasurer.userId,
      parse({ doneeLegalName: "Fixture Presbyterian Church", doneeAddressLine1: "1 Mill Road", doneeCity: "Dover", doneeRegion: "de", doneePostalCode: "19901", greetingText: "Dear {donor_name}," }),
    );
    expect(saved).toEqual({ kind: "ok", changedFields: ["doneeLegalName", "doneeAddressLine1", "doneeCity", "doneeRegion", "doneePostalCode", "greetingText"] });
    const read = await settings.getGivingSettings(treasurer.personId, org);
    if (read.kind !== "ok") throw new Error("setup");
    expect(read.saved).toBe(true);
    expect(read.settings).toMatchObject({ doneeLegalName: "Fixture Presbyterian Church", doneeRegion: "DE", greetingText: "Dear {donor_name}," });
    expect(read.blockers).toEqual([]);
    const [row] = fx.rowsOf(await fx.platform.execute(sql`select updated_by from giving_settings where organization_id = ${org}`));
    expect(row!.updated_by).toBe(treasurer.userId);
  });

  it("a later save reports only what changed, and an identical save changes nothing", async () => {
    const same = await settings.updateGivingSettings(
      treasurer.personId, org, treasurer.userId,
      parse({ doneeLegalName: "Fixture Presbyterian Church", doneeAddressLine1: "1 Mill Road", doneeCity: "Dover", doneeRegion: "DE", doneePostalCode: "19901", greetingText: "Dear {donor_name}," }),
    );
    expect(same).toEqual({ kind: "ok", changedFields: [] });
    const changed = await settings.updateGivingSettings(
      treasurer.personId, org, treasurer.userId,
      parse({ doneeLegalName: "Fixture Presbyterian Church", doneeAddressLine1: "2 Mill Road", doneeCity: "Dover", doneeRegion: "DE", doneePostalCode: "19901", greetingText: "Dear {donor_name}," , doneeEin: "00-0000000" }),
    );
    expect(changed).toEqual({ kind: "ok", changedFields: ["doneeAddressLine1", "doneeEin"] });
  });

  it("clearing a field stores null and brings the blocker back", async () => {
    const cleared = await settings.updateGivingSettings(treasurer.personId, org, treasurer.userId, parse({ doneeLegalName: "Fixture Presbyterian Church" }));
    expect(cleared.kind).toBe("ok");
    const read = await settings.getGivingSettings(treasurer.personId, org);
    if (read.kind !== "ok") throw new Error("setup");
    expect(read.settings.doneeAddressLine1).toBeNull();
    expect(read.blockers).toEqual(["donee_address"]);
  });

  it("is giving.manage ONLY (a viewer and a recorder read and write nothing) and per-organization", async () => {
    for (const actor of [viewer, recorder]) {
      expect(await settings.getGivingSettings(actor.personId, org)).toEqual({ kind: "forbidden" });
      expect(await settings.updateGivingSettings(actor.personId, org, actor.userId, parse({ doneeLegalName: "Hijack" }))).toEqual({ kind: "forbidden" });
    }
    const other = await fx.makeActor(otherOrg, "Olga", "Other", ["giving.manage"]);
    const read = await settings.getGivingSettings(other.personId, otherOrg);
    if (read.kind !== "ok") throw new Error("setup");
    expect(read.saved).toBe(false); // org A's row is invisible
    const [row] = fx.rowsOf(await fx.platform.execute(sql`select donee_legal_name from giving_settings where organization_id = ${org}`));
    expect(row!.donee_legal_name).toBe("Fixture Presbyterian Church");
  });
});
