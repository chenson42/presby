/**
 * The member-directory, Find-a-person and admin Community readers on a REAL
 * Postgres connection (docs/work-log/2026-10-23-person-emails.md: ER3a, ER23,
 * ER23a, F212, D12; DECISION-217).
 *
 *   - the directory shows the active MAIN address; a person with an OPEN staff
 *     position also shows their active Work address (once, when main is Work);
 *     `hide_email` hides both;
 *   - ended addresses appear in NO reader and never match a search;
 *   - member-facing search (directory and Find a person) matches only what the
 *     card SHOWS (F212): a hidden email or phone, a non-main non-Work address and
 *     an ended one never produce a match, so the oracle is closed;
 *   - the admin Community search (`people.manage`) matches every ACTIVE address
 *     of the person, and no ended one.
 *
 * Run (serial): npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/contact-methods/readers.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { InvitationFixture, Row } from "@/lib/testing/invitation-fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("directory, Find a person and Community readers (Postgres-backed)", { timeout: 120_000 }, () => {
  let fx: InvitationFixture;
  let directory: typeof import("@/lib/directory");
  let community: typeof import("@/lib/community");
  let findPerson: typeof import("@/lib/org-portal/find-person");
  let authz: typeof import("@/lib/authz");
  let org: string;
  let viewer: string;
  let stamp: string;
  const q = (query: SQL): Promise<Row[]> => fx.q(query);

  let n = 0;
  const addr = (tag: string) => `rd-${tag}-${stamp}-${(n += 1)}@example.invalid`;

  /** A regular, rolled member (eligible for the member directory). */
  async function member(first: string, last: string, status: "regular" | "visitor" = "regular"): Promise<string> {
    const id = await fx.makePerson(first, `${last}${stamp}`);
    await fx.addMember(org, id);
    if (status === "visitor") {
      await q(sql`update memberships set engagement_status = 'visitor', current_roll = null where organization_id = ${org} and person_id = ${id}`);
    }
    return id;
  }
  async function email(
    personId: string,
    value: string,
    o: { main?: boolean; subtype?: string | null; ended?: boolean; at: number },
  ): Promise<void> {
    await q(sql`
      insert into contact_methods (person_id, kind, value, subtype, is_primary, created_at, ended_at)
      values (${personId}, 'email', ${value}, ${o.subtype ?? null}, ${o.main ?? false},
              '2026-01-01T00:00:00Z'::timestamptz + make_interval(secs => ${o.at}),
              ${o.ended ? "2026-02-01T00:00:00Z" : null}::timestamptz)`);
  }
  async function phone(personId: string, value: string, ended = false): Promise<void> {
    await q(sql`
      insert into contact_methods (person_id, kind, value, is_primary, ended_at)
      values (${personId}, 'phone', ${value}, ${!ended}, ${ended ? "2026-02-01T00:00:00Z" : null}::timestamptz)`);
  }
  async function position(personId: string, startsOn: string, endsOn: string | null, title = "Office Manager"): Promise<void> {
    await q(sql`
      insert into staff_positions (organization_id, person_id, position, position_key, starts_on, ends_on)
      values (${org}, ${personId}, ${title}, ${title.toLowerCase()}, ${startsOn}::date, ${endsOn}::date)`);
  }
  const hide = (personId: string, col: "hide_email" | "hide_phone") =>
    q(sql.raw(`insert into person_privacy (person_id, organization_id, ${col}) values ('${personId}', '${org}', true)`));

  async function entries(opts?: { search?: string }) {
    const result = await directory.getDirectory(viewer, org, opts);
    if (result.kind !== "ok") throw new Error("directory forbidden");
    return result.entries;
  }
  const entryOf = async (personId: string) => (await entries()).find((e) => e.personId === personId);
  const found = async (query: string) => (await entries({ search: query })).map((e) => e.personId);
  const finderIds = (query: string) =>
    authz.withOrgContext(viewer, org, (tx) => directory.findDirectoryPersonIds(tx, org, query, 50));

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  // fixture handles
  let ada: string; // main + Work, open staff position
  let bea: string; // main + Work, position starts tomorrow
  let cai: string; // main + Work, position already ended
  let dov: string; // the main address IS the Work address, open position
  let eli: string; // hide_email set, main + Work, open position
  let fay: string; // active main + an ENDED Work address, open position
  let gus: string; // main + a second Personal address (not main, not Work)
  let ivy: string; // phone hidden
  let jon: string; // phone shown
  let kit: string; // a phone that ended
  let hal: string; // visitor with two addresses (Community admin list)
  const A = {} as Record<string, string>;

  beforeAll(async () => {
    const mod = await import("@/lib/testing/invitation-fixture");
    fx = await mod.createInvitationFixture("cm-readers");
    directory = await import("@/lib/directory");
    community = await import("@/lib/community");
    findPerson = await import("@/lib/org-portal/find-person");
    authz = await import("@/lib/authz");
    stamp = `${Date.now()}`;
    org = await fx.makeOrg("a");
    await q(sql`
      insert into permissions (key, module, description, sensitivity_tier) values
        ('directory.view', 'directory', 'See the member directory', 1),
        ('people.manage', 'people', 'Create and edit people, households, and contact/address detail', 1)
      on conflict do nothing`);
    viewer = await fx.makePerson("Vera", `Viewer${stamp}`);
    await fx.enroll(org, viewer, ["directory.view", "people.manage"]);

    ada = await member("Ada", "Marlowe");
    A.adaMain = addr("ada-main");
    A.adaWork = addr("ada-work");
    await email(ada, A.adaMain, { main: true, subtype: "personal", at: 1 });
    await email(ada, A.adaWork, { subtype: "work", at: 2 });
    await position(ada, yesterday, null);

    bea = await member("Bea", "Nightingale");
    A.beaMain = addr("bea-main");
    A.beaWork = addr("bea-work");
    await email(bea, A.beaMain, { main: true, subtype: "personal", at: 1 });
    await email(bea, A.beaWork, { subtype: "work", at: 2 });
    await position(bea, tomorrow, null);

    cai = await member("Cai", "Okoro");
    A.caiMain = addr("cai-main");
    A.caiWork = addr("cai-work");
    await email(cai, A.caiMain, { main: true, subtype: "personal", at: 1 });
    await email(cai, A.caiWork, { subtype: "work", at: 2 });
    await position(cai, "2020-01-01", yesterday);

    dov = await member("Dov", "Pell");
    A.dovWork = addr("dov-work");
    await email(dov, A.dovWork, { main: true, subtype: "work", at: 1 });
    await position(dov, yesterday, null);

    eli = await member("Eli", "Quist");
    A.eliMain = addr("eli-main");
    A.eliWork = addr("eli-work");
    await email(eli, A.eliMain, { main: true, subtype: "personal", at: 1 });
    await email(eli, A.eliWork, { subtype: "work", at: 2 });
    await position(eli, yesterday, null);
    await hide(eli, "hide_email");

    fay = await member("Fay", "Rowan");
    A.fayMain = addr("fay-main");
    A.fayEnded = addr("fay-ended-work");
    await email(fay, A.fayMain, { main: true, subtype: "personal", at: 1 });
    await email(fay, A.fayEnded, { subtype: "work", ended: true, at: 2 });
    await position(fay, yesterday, null);

    gus = await member("Gus", "Tamm");
    A.gusMain = addr("gus-main");
    A.gusSecond = addr("gus-second");
    await email(gus, A.gusMain, { main: true, subtype: "personal", at: 1 });
    await email(gus, A.gusSecond, { subtype: "other", at: 2 });

    ivy = await member("Ivy", "Jonas");
    await phone(ivy, "555-0177");
    await hide(ivy, "hide_phone");
    jon = await member("Jon", "Kale");
    await phone(jon, "555-0178");
    kit = await member("Kit", "Lund");
    await phone(kit, "555-0179", true);

    hal = await member("Hal", "Ivers", "visitor");
    A.halMain = addr("hal-main");
    A.halSecond = addr("hal-second");
    A.halEnded = addr("hal-ended");
    await email(hal, A.halMain, { main: true, subtype: "personal", at: 1 });
    await email(hal, A.halSecond, { subtype: "other", at: 2 });
    await email(hal, A.halEnded, { subtype: "other", ended: true, at: 3 });
  }, 240_000);

  afterAll(async () => {
    if (fx) {
      await q(sql`delete from person_privacy where organization_id = ${org}`);
      await fx.cleanup();
    }
  }, 180_000);

  // -------------------------------------------------------------------------
  describe("what the member directory shows (ER23, D12)", () => {
    it("the active MAIN address, and an open staff member's active Work address as well", async () => {
      const e = await entryOf(ada);
      expect(e).toMatchObject({ email: A.adaMain, workEmail: A.adaWork });
    });

    it("a person with no staff position shows the main address only", async () => {
      expect(await entryOf(gus)).toMatchObject({ email: A.gusMain, workEmail: null });
    });

    it("a position that starts in the FUTURE does not show the Work address yet (D12)", async () => {
      expect(await entryOf(bea)).toMatchObject({ email: A.beaMain, workEmail: null });
    });

    it("a position that has ENDED does not show the Work address", async () => {
      expect(await entryOf(cai)).toMatchObject({ email: A.caiMain, workEmail: null });
    });

    it("when the main address IS the Work address it is shown once, as the main", async () => {
      expect(await entryOf(dov)).toMatchObject({ email: A.dovWork, workEmail: null });
    });

    it("hide_email hides BOTH the main and the Work address", async () => {
      expect(await entryOf(eli)).toMatchObject({ email: null, workEmail: null });
    });

    it("an ENDED Work address is never shown, even for an open staff position", async () => {
      expect(await entryOf(fay)).toMatchObject({ email: A.fayMain, workEmail: null });
    });

    it("the person detail reader shows the same", async () => {
      const result = await directory.getPersonDetail(viewer, org, ada);
      if (result.kind !== "ok") throw new Error("not ok");
      expect(result.entry).toMatchObject({ email: A.adaMain, workEmail: A.adaWork });
    });

    it("no address of any person ever appears twice, and an ended address appears nowhere in the whole directory", async () => {
      const all = await entries();
      const shown = all.flatMap((e) => [e.email, e.workEmail]).filter((v): v is string => v !== null);
      expect(new Set(shown).size).toBe(shown.length);
      expect(shown).not.toContain(A.fayEnded);
      expect(shown).not.toContain(A.halEnded);
    });
  });

  // -------------------------------------------------------------------------
  describe("member-facing search matches only what the card shows (F212, ER23a)", () => {
    it("the main address matches; a staff member's displayed Work address matches", async () => {
      expect(await found(A.adaMain)).toEqual([ada]);
      expect(await found(A.adaWork)).toEqual([ada]);
    });

    it("a non-main, non-Work address does not match (the card never shows it)", async () => {
      expect(await found(A.gusSecond)).toEqual([]);
      expect(await found(A.gusMain)).toEqual([gus]);
    });

    it("a Work address that is not displayed does not match: a future-dated or ended position, or no position", async () => {
      expect(await found(A.beaWork)).toEqual([]);
      expect(await found(A.caiWork)).toEqual([]);
    });

    it("a hidden email does not match: neither the main nor the Work address of hide_email (the oracle is closed)", async () => {
      expect(await found(A.eliMain)).toEqual([]);
      expect(await found(A.eliWork)).toEqual([]);
      expect(await finderIds(A.eliMain)).toEqual([]);
    });

    it("an ENDED address never matches", async () => {
      expect(await found(A.fayEnded)).toEqual([]);
      expect(await finderIds(A.fayEnded)).toEqual([]);
      expect(await found(A.halEnded)).toEqual([]);
    });

    it("a hidden phone does not match; a shown phone does; an ended phone does not", async () => {
      expect(await found("555-0177")).toEqual([]);
      expect(await found("555-0178")).toEqual([jon]);
      expect(await found("555-0179")).toEqual([]);
    });

    it("names still match (and are not affected by hiding contact details)", async () => {
      expect(await found(`Quist${stamp}`)).toEqual([eli]);
      expect(await found(`Jonas${stamp}`)).toEqual([ivy]);
    });
  });

  // -------------------------------------------------------------------------
  describe("Find a person uses the same predicate", () => {
    it("matches what the card shows, never more", async () => {
      expect(await finderIds(A.adaMain)).toEqual([ada]);
      expect(await finderIds(A.adaWork)).toEqual([ada]);
      expect(await finderIds(A.gusSecond)).toEqual([]);
      expect(await finderIds("555-0177")).toEqual([]);
      expect(await finderIds("555-0178")).toEqual([jon]);
    });

    it("findPersonMatches gives the same answers through the public entry point", async () => {
      expect(await findPerson.findPersonMatches(viewer, org, A.adaWork)).toEqual({ kind: "ok", personIds: [ada] });
      expect(await findPerson.findPersonMatches(viewer, org, A.eliMain)).toEqual({ kind: "ok", personIds: [] });
    });

    it("agrees with the directory search for every probe (one predicate, no drift)", async () => {
      for (const probe of [A.adaMain, A.adaWork, A.beaWork, A.eliMain, A.fayEnded, A.gusSecond, "555-0177", "555-0178", "555-0179"]) {
        expect((await finderIds(probe)).sort(), probe).toEqual((await found(probe)).sort());
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("the admin Community readers (people.manage)", () => {
    const opts = (search?: string) => ({ search, page: 1, pageSize: 50 });
    const ids = async (kind: "visitors" | "staff", search?: string) => {
      const result =
        kind === "visitors"
          ? await community.listVisitors(viewer, org, opts(search))
          : await community.listStaff(viewer, org, opts(search));
      if (result.kind !== "ok") throw new Error("forbidden");
      return result.rows.map((r) => r.personId);
    };

    it("the row shows the active MAIN address", async () => {
      const result = await community.listVisitors(viewer, org, opts());
      if (result.kind !== "ok") throw new Error("forbidden");
      expect(result.rows.find((r) => r.personId === hal)!.email).toBe(A.halMain);
    });

    it("search matches the main address AND every other active address of the person", async () => {
      expect(await ids("visitors", A.halMain)).toEqual([hal]);
      expect(await ids("visitors", A.halSecond)).toEqual([hal]);
    });

    it("search never matches an ended address", async () => {
      expect(await ids("visitors", A.halEnded)).toEqual([]);
      expect(await ids("staff", A.fayEnded)).toEqual([]);
    });

    it("the admin search is wider than the member search on purpose: it ignores hide_email and the card's display rule", async () => {
      expect(await ids("staff", A.eliMain)).toEqual([eli]);
      expect(await ids("staff", A.eliWork)).toEqual([eli]);
      expect(await found(A.eliMain)).toEqual([]);
    });

    it("LIKE wildcards in an admin search are matched literally (the escape clause survives the move to the shared fragment)", async () => {
      expect(await ids("visitors", "%")).toEqual([]);
      expect(await ids("visitors", "_")).toEqual([]);
    });
  });
});
