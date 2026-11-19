/**
 * D4: src/lib/committees/reads.ts against a REAL Postgres connection
 * (docs/work-log/2026-11-19-presbytery-committees.md, Phase 3 "Test plan" D4 and
 * "API Contract: Reads"). Every reader runs on `presby_app` inside its own
 * `withOrgContext()` transaction. Pinned here:
 *
 *   - each reader is `forbidden` for a person without `groups.manage` (and for the
 *     congregation's own clerk at the congregation, which is not a presbytery),
 *     returning no data, and the key is checked BEFORE a malformed or wrong id is
 *     looked at;
 *   - "today" is the ORGANIZATION'S local day: at one instant, a seat that starts
 *     on the 16th is serving at a presbytery in Kiritimati (already the 16th) and
 *     planned at one in Pago Pago (still the 15th), and a seat that ends on the 16th
 *     is past at the first and still serving at the second;
 *   - the list uses a FIXED number of queries for 2 and for 30 committees (a
 *     counting wrapper on the transaction), and its chairs and serving count follow
 *     the half-open rule (a seat that ends today and one that starts tomorrow are
 *     not serving);
 *   - a `choir`, a derived group, another presbytery's committee, a congregation's
 *     committee, a nonexistent UUID and a malformed id are the one `not_found`;
 *   - the status derivations: a seat whose person's membership here has ended is
 *     not `connected`; a person with a date of death is `deceased`;
 *   - `carriedRoles` counts a group grant in date and excludes an ended grant, a
 *     person grant and another group's grant;
 *   - `readSeatFormOptions` flags `alreadyServes` for a serving or planned seat and
 *     not for a past or zero-length one, and excludes people whose membership ended;
 *   - the two form readers answer `committee_dissolved` for a dissolved committee.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/committees/reads.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";
import { todayInOrgZone } from "@/lib/shared/org-time";
// Enter the domain cycle through the canonical entry point first (see store.db.test.ts).
import "@/lib/db/schema";

vi.mock("server-only", () => ({}));

/** Counts every `tx.execute` a reader issues, per call of `withOrgContext`. */
const counter = vi.hoisted(() => ({ executes: 0 }));
vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return {
    ...actual,
    withOrgContext: (personId: string, organizationId: string, fn: (tx: unknown) => Promise<unknown>) =>
      actual.withOrgContext(personId, organizationId, (tx) =>
        fn(
          new Proxy(tx as object, {
            get(target, prop, receiver) {
              const value = Reflect.get(target, prop, receiver);
              if (prop === "execute" && typeof value === "function") {
                return (...args: unknown[]) => {
                  counter.executes += 1;
                  return (value as (...a: unknown[]) => unknown).apply(target, args);
                };
              }
              return typeof value === "function" ? value.bind(target) : value;
            },
          }),
        ),
      ),
  };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
type Row = Record<string, unknown>;
const rowsOf = (result: unknown): Row[] => {
  const r = result as { rows?: Row[] } | Row[];
  return Array.isArray(r) ? r : (r.rows ?? []);
};

/** The default zone the fixtures without a settings row use. */
const NOW = new Date();
const TODAY = todayInOrgZone(NOW, "America/New_York");
function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe.skipIf(!hasDb)("committees/reads.ts (Postgres-backed)", { timeout: 240_000 }, () => {
  let fx: CalendarFixture;
  let reads: typeof import("./reads");
  let P: string;
  let P2: string;
  let C: string;
  let PKIR: string; // a presbytery in Pacific/Kiritimati (UTC+14)
  let PPAGO: string; // a presbytery in Pacific/Pago_Pago (UTC-11)
  let stamp: string;
  let n = 0;

  let clerk: string;
  let keyless: string;
  let clerkC: string;
  let clerkP2: string;
  let clerkKir: string;
  let clerkPago: string;
  let people: string[] = [];
  let choirP: string;
  let derivedP: string;
  let committeeC: string;
  let committeeP2: string;

  const q = async (query: SQL): Promise<Row[]> => rowsOf(await fx.platform.execute(query));
  const viewer = (personId: string, organizationId = P) => ({ personId, organizationId });

  async function group(org: string, typeKey: string, name: string): Promise<string> {
    return String(
      (
        await q(sql`insert into groups (organization_id, group_type_id, name)
                    values (${org}, (select id from group_types where key = ${typeKey}), ${name}) returning id`)
      )[0]!.id,
    );
  }
  const committee = (org: string, name = `Rd90 ${stamp} ${(n += 1)}`) => group(org, "committee", name);
  async function details(org: string, groupId: string, kind: string | null, dissolvedOn: string | null = null) {
    await q(sql`insert into committee_details (organization_id, group_id, kind, created_by, updated_by)
                values (${org}, ${groupId}, ${kind}, ${fx.actingUserId}, ${fx.actingUserId})`);
    if (dissolvedOn) {
      await q(sql`update committee_details set dissolved_on = ${dissolvedOn}, dissolved_by = ${fx.actingUserId}, dissolved_at = now() where group_id = ${groupId}`);
    }
  }
  async function seat(org: string, groupId: string, personId: string, role: string, startsOn: string, endsOn: string | null = null) {
    return String(
      (
        await q(sql`insert into group_memberships (organization_id, group_id, person_id, group_role, source, starts_on, ends_on)
                    values (${org}, ${groupId}, ${personId}, ${role}, 'managed', ${startsOn}, ${endsOn}) returning id`)
      )[0]!.id,
    );
  }

  beforeAll(async () => {
    const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
    fx = await createCalendarFixture("cmtread");
    stamp = String(Date.now());
    P = await fx.makeOrg("Presbytery", { organizationType: "presbytery" });
    P2 = await fx.makeOrg("OtherPresbytery", { organizationType: "presbytery" });
    C = await fx.makeOrg("Congregation");
    PKIR = await fx.makeOrg("Kiritimati", { organizationType: "presbytery", timeZone: "Pacific/Kiritimati" });
    PPAGO = await fx.makeOrg("PagoPago", { organizationType: "presbytery", timeZone: "Pacific/Pago_Pago" });

    const person = async (first: string, last: string) => fx.makePerson(first, `${last}${stamp}`);
    clerk = await person("Clerk", "Rd");
    await fx.enroll(P, clerk, ["groups.manage"]);
    keyless = await person("Keyless", "Rd");
    await fx.enroll(P, keyless, []);
    clerkC = await person("Congclerk", "Rd");
    await fx.enroll(C, clerkC, ["groups.manage"]);
    clerkP2 = await person("Otherclerk", "Rd");
    await fx.enroll(P2, clerkP2, ["groups.manage"]);
    clerkKir = await person("Kirclerk", "Rd");
    await fx.enroll(PKIR, clerkKir, ["groups.manage"]);
    clerkPago = await person("Pagoclerk", "Rd");
    await fx.enroll(PPAGO, clerkPago, ["groups.manage"]);

    for (const [i, name] of ["Aster", "Briar", "Cedar", "Dahlia", "Elm", "Fern"].entries()) {
      const id = await person(name, `Rd${i}`);
      await fx.addMember(P, id, { roll: null });
      people.push(id);
    }

    choirP = await group(P, "choir", `Rd90 ${stamp} Choir`);
    committeeC = await group(C, "committee", `Rd90 ${stamp} Congregation Committee`);
    derivedP = String((await q(sql`select id from groups where organization_id = ${P} and derived_from = 'active_membership'`))[0]!.id);
    committeeP2 = await group(P2, "committee", `Rd90 ${stamp} Other Committee`);

    reads = await import("./reads");
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  // ---------------------------------------------------------------------------
  it("(precondition) the readers run on presby_app", async () => {
    const { db } = await import("@/lib/db");
    const who = await db.transaction(async (tx) => rowsOf(await tx.execute(sql`select current_user as u`)));
    expect(who[0]).toEqual({ u: "presby_app" });
  });

  // ---------------------------------------------------------------------------
  describe("forbidden without the key, inside the reader's own transaction", () => {
    it("every reader is `forbidden` for a member with no key, and for the congregation's clerk at a congregation, returning no data", async () => {
      const id = await committee(P);
      const s = await seat(P, id, people[0]!, "member", shift(TODAY, -5));
      for (const who of [viewer(keyless), viewer(clerkC, C)]) {
        const results = [
          await reads.readCommitteeList(who),
          await reads.readCommittee(who, id),
          await reads.readCommitteeFormDefaults(who),
          await reads.readCommitteeFormDefaults(who, id),
          await reads.readSeatFormOptions(who, id),
          await reads.readSeat(who, id, s),
        ];
        for (const r of results) expect(r).toEqual({ kind: "forbidden" });
      }
    });

    it("the key is checked BEFORE the id: a keyless viewer is `forbidden` (not `not_found`) for a malformed or wrong id", async () => {
      expect(await reads.readCommittee(viewer(keyless), "not-a-uuid")).toEqual({ kind: "forbidden" });
      expect(await reads.readCommittee(viewer(keyless), committeeP2)).toEqual({ kind: "forbidden" });
      expect(await reads.readCommittee(viewer(clerk), "not-a-uuid")).toEqual({ kind: "not_found" });
    });

    it("a person who is not a member of the organization throws the access error (propagated to the error boundary), not an empty answer", async () => {
      await expect(reads.readCommitteeList(viewer(people[0]!, P2))).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  describe("the list", () => {
    it("lists only this presbytery's committees: not a choir, a derived group, another presbytery's or a congregation's", async () => {
      const own = await committee(P, `Rd90 ${stamp} List own`);
      const r = await reads.readCommitteeList(viewer(clerk));
      if (r.kind !== "ok") throw new Error(r.kind);
      const ids = r.data.committees.map((c) => c.id);
      expect(ids).toContain(own);
      for (const other of [choirP, derivedP, committeeP2, committeeC]) expect(ids).not.toContain(other);
      expect(r.data.today).toBe(TODAY);
    });

    it("Not yet labelled is no details row or a row with no kind; kinds come through; dissolved ones appear only when asked, and always as a count", async () => {
      const lonely = await committee(P, `Rd90 ${stamp} No row`);
      const nullKind = await committee(P, `Rd90 ${stamp} Null kind`);
      await details(P, nullKind, null);
      const req = await committee(P, `Rd90 ${stamp} Required`);
      await details(P, req, "required");
      const gone = await committee(P, `Rd90 ${stamp} Dissolved`);
      await details(P, gone, "ad_hoc", shift(TODAY, -3));

      const hidden = await reads.readCommitteeList(viewer(clerk));
      const shown = await reads.readCommitteeList(viewer(clerk), { showDissolved: true });
      if (hidden.kind !== "ok" || shown.kind !== "ok") throw new Error("list refused");
      const by = (r: typeof hidden, id: string) => (r.kind === "ok" ? r.data.committees.find((c) => c.id === id) : undefined);

      expect(by(hidden, lonely)).toMatchObject({ kind: null, dissolvedOn: null });
      expect(by(hidden, nullKind)).toMatchObject({ kind: null });
      expect(by(hidden, req)).toMatchObject({ kind: "required" });
      expect(by(hidden, gone)).toBeUndefined();
      expect(by(shown, gone)).toMatchObject({ kind: "ad_hoc", dissolvedOn: shift(TODAY, -3) });
      expect(hidden.data.dissolvedCount).toBeGreaterThanOrEqual(1);
      expect(shown.data.dissolvedCount).toBe(hidden.data.dissolvedCount);
      expect(hidden.data.showDissolved).toBe(false);
      expect(shown.data.showDissolved).toBe(true);
    });

    it("chairs and the serving count follow the half-open rule: a seat ending today and one starting tomorrow are not serving; co-chairs are both listed", async () => {
      const id = await committee(P, `Rd90 ${stamp} Half-open`);
      await seat(P, id, people[0]!, "chair", shift(TODAY, -50));
      await seat(P, id, people[1]!, "chair", shift(TODAY, -10));
      await seat(P, id, people[2]!, "member", shift(TODAY, -50));
      await seat(P, id, people[3]!, "chair", shift(TODAY, -50), TODAY); // ends today: no longer serving
      await seat(P, id, people[4]!, "chair", shift(TODAY, 1)); // starts tomorrow
      await seat(P, id, people[5]!, "member", shift(TODAY, -50), shift(TODAY, 1)); // ends tomorrow: still serving
      await seat(P, id, people[5]!, "member", shift(TODAY, -2), shift(TODAY, -2)); // zero-length
      const r = await reads.readCommitteeList(viewer(clerk));
      if (r.kind !== "ok") throw new Error(r.kind);
      const row = r.data.committees.find((c) => c.id === id)!;
      expect(row.servingCount).toBe(4);
      expect(row.chairNames).toEqual(["Aster Rd0" + stamp, "Briar Rd1" + stamp]);
    });

    it("a committee with no seat serving says so: no chairs, zero serving", async () => {
      const id = await committee(P, `Rd90 ${stamp} Empty`);
      const r = await reads.readCommitteeList(viewer(clerk));
      if (r.kind !== "ok") throw new Error(r.kind);
      expect(r.data.committees.find((c) => c.id === id)).toMatchObject({ chairNames: [], servingCount: 0 });
    });

    it("uses the ORGANIZATION'S local day: at one instant a seat starting on the 16th serves in Kiritimati and not in Pago Pago, and a seat ending on the 16th is past in the first and serving in the second", async () => {
      const instant = new Date("2026-06-15T12:00:00Z");
      expect(todayInOrgZone(instant, "Pacific/Kiritimati")).toBe("2026-06-16");
      expect(todayInOrgZone(instant, "Pacific/Pago_Pago")).toBe("2026-06-15");
      const mk = async (org: string, person: string) => {
        const id = await committee(org, `Rd90 ${stamp} TZ ${org.slice(0, 4)}`);
        const startsLater = await fx.makePerson("Starts", `Tz${stamp}${(n += 1)}`);
        await fx.addMember(org, startsLater, { roll: null });
        await seat(org, id, startsLater, "chair", "2026-06-16");
        await seat(org, id, person, "chair", "2026-01-01", "2026-06-16");
        return id;
      };
      const pCl = await fx.makePerson("Member", `Tz${stamp}${(n += 1)}`);
      await fx.addMember(PKIR, pCl, { roll: null });
      const pPa = await fx.makePerson("Member", `Tz${stamp}${(n += 1)}`);
      await fx.addMember(PPAGO, pPa, { roll: null });
      const idKir = await mk(PKIR, pCl);
      const idPago = await mk(PPAGO, pPa);

      const kir = await reads.readCommitteeList(viewer(clerkKir, PKIR), {}, instant);
      const pago = await reads.readCommitteeList(viewer(clerkPago, PPAGO), {}, instant);
      if (kir.kind !== "ok" || pago.kind !== "ok") throw new Error("list refused");
      expect(kir.data.today).toBe("2026-06-16");
      expect(pago.data.today).toBe("2026-06-15");
      // Kiritimati (already the 16th): the seat starting on the 16th serves, the one ending on the 16th is past.
      expect(kir.data.committees.find((c) => c.id === idKir)).toMatchObject({ servingCount: 1 });
      expect(kir.data.committees.find((c) => c.id === idKir)!.chairNames).toHaveLength(1);
      // Pago Pago (still the 15th): the seat starting on the 16th has not started, the one ending on the 16th still serves.
      expect(pago.data.committees.find((c) => c.id === idPago)).toMatchObject({ servingCount: 1 });
      expect(pago.data.committees.find((c) => c.id === idPago)!.chairNames).toHaveLength(1);
      // They are different people: the two zones disagree about who serves.
      expect(kir.data.committees.find((c) => c.id === idKir)!.chairNames[0]).toContain("Starts");
      expect(pago.data.committees.find((c) => c.id === idPago)!.chairNames[0]).toContain("Member");
    });

    it("uses a FIXED number of queries for 2 and for 30 committees", async () => {
      // A presbytery of its own so the committee count is exact.
      const own = await fx.makeOrg("CountPresbytery", { organizationType: "presbytery" });
      const who = await fx.makePerson("Counter", `Cnt${stamp}`);
      await fx.enroll(own, who, ["groups.manage"]);
      const seatPerson = await fx.makePerson("Seated", `Cnt${stamp}`);
      await fx.addMember(own, seatPerson, { roll: null });

      const make = async (count: number) => {
        for (let i = 0; i < count; i += 1) {
          const id = await group(own, "committee", `Rd90 ${stamp} Count ${own.slice(0, 4)} ${(n += 1)}`);
          await seat(own, id, seatPerson, i % 2 === 0 ? "chair" : "member", shift(TODAY, -5));
        }
      };
      const measure = async () => {
        counter.executes = 0;
        const r = await reads.readCommitteeList(viewer(who, own));
        if (r.kind !== "ok") throw new Error(r.kind);
        return { queries: counter.executes, rows: r.data.committees.length };
      };
      await make(2);
      const small = await measure();
      await make(28);
      const large = await measure();
      expect(small.rows).toBe(2);
      expect(large.rows).toBe(30);
      expect(large.queries).toBe(small.queries);
      expect(small.queries).toBeLessThanOrEqual(6);
    });
  });

  // ---------------------------------------------------------------------------
  describe("readCommittee", () => {
    it("a choir, a derived group, another presbytery's committee, a congregation's committee, a nonexistent UUID and a malformed id are ONE `not_found`", async () => {
      const answers = new Set<string>();
      for (const id of [choirP, derivedP, committeeP2, committeeC, "00000000-0000-4000-8000-0000000000aa", "not-a-uuid", ""]) {
        answers.add(JSON.stringify(await reads.readCommittee(viewer(clerk), id)));
      }
      expect([...answers]).toEqual([JSON.stringify({ kind: "not_found" })]);
    });

    it("returns the committee, every seat (past and planned too) with role, dates and the listing, and today", async () => {
      const id = await committee(P, `Rd90 ${stamp} Page`);
      await details(P, id, "standing");
      await q(sql`update groups set description = 'A purpose', meets_when = 'Mondays' where id = ${id}`);
      const serving = await seat(P, id, people[0]!, "clerk", shift(TODAY, -30));
      const planned = await seat(P, id, people[1]!, "member", shift(TODAY, 10));
      const past = await seat(P, id, people[2]!, "chair", shift(TODAY, -90), shift(TODAY, -40));
      await q(sql`update group_memberships set public_listed = true where id = ${serving}`);

      const r = await reads.readCommittee(viewer(clerk), id);
      if (r.kind !== "ok") throw new Error(r.kind);
      expect(r.data.committee).toEqual({ id, name: `Rd90 ${stamp} Page`.replace(/^/, ""), purpose: "A purpose", meetsWhen: "Mondays", kind: "standing", dissolvedOn: null });
      expect(r.data.today).toBe(TODAY);
      const byId = new Map(r.data.seats.map((s) => [s.membershipId, s]));
      expect(byId.get(serving)).toMatchObject({ role: "clerk", startsOn: shift(TODAY, -30), endsOn: null, publicListed: true, connected: true, deceased: false });
      expect(byId.get(planned)).toMatchObject({ role: "member", startsOn: shift(TODAY, 10), publicListed: false });
      expect(byId.get(past)).toMatchObject({ role: "chair", endsOn: shift(TODAY, -40) });
      expect(byId.get(serving)!.displayName).toBe(`Aster Rd0${stamp}`);
    });

    it("derives the two status badges: a person whose membership here ended is not connected; a person with a date of death is deceased", async () => {
      const id = await committee(P, `Rd90 ${stamp} Status`);
      const leaver = await fx.makePerson("Leaver", `St${stamp}`);
      await fx.addMember(P, leaver, { roll: null });
      const departed = await fx.makePerson("Departed", `St${stamp}`);
      await fx.addMember(P, departed, { roll: null });
      await seat(P, id, leaver, "member", shift(TODAY, -60));
      await seat(P, id, departed, "member", shift(TODAY, -60));
      await q(sql`update people set date_of_death = '2025-01-02' where id = ${departed}`);
      await fx.platform.execute(sql`alter table memberships disable trigger memberships_guard_end`);
      try {
        await q(sql`update memberships set ended_on = '2025-02-01' where person_id = ${leaver} and organization_id = ${P}`);
      } finally {
        await fx.platform.execute(sql`alter table memberships enable trigger memberships_guard_end`);
      }
      const r = await reads.readCommittee(viewer(clerk), id);
      if (r.kind !== "ok") throw new Error(r.kind);
      const find = (p: string) => r.data.seats.find((s) => s.personId === p)!;
      expect(find(leaver)).toMatchObject({ connected: false, deceased: false });
      expect(find(departed)).toMatchObject({ connected: true, deceased: true });
    });

    it("carriedRoles: a group grant in date is carried; an ended grant, a person grant, another group's grant and one not yet started are not", async () => {
      const id = await committee(P, `Rd90 ${stamp} Carries`);
      const other = await committee(P, `Rd90 ${stamp} Carries other`);
      const carried = await fx.makeRole(P, `rd90_carried_${stamp}`, ["directory.view"]);
      const ended = await fx.makeRole(P, `rd90_ended_${stamp}`, ["tickets.file"]);
      const personOnly = await fx.makeRole(P, `rd90_person_${stamp}`, ["events.view"]).catch(() => fx.makeRole(P, `rd90_person_${stamp}`, ["directory.view"]));
      const otherGroupRole = await fx.makeRole(P, `rd90_other_${stamp}`, ["directory.view"]);
      const future = await fx.makeRole(P, `rd90_future_${stamp}`, ["directory.view"]);
      const grant = (role: string, groupId: string | null, personId: string | null, from: string, to: string | null) =>
        q(sql`insert into role_grants (organization_id, role_id, group_id, person_id, starts_on, ends_on, granted_by)
              values (${P}, ${role}, ${groupId}, ${personId}, ${from}, ${to}, ${fx.actingUserId})`);
      await grant(carried, id, null, "2020-01-01", null);
      await grant(ended, id, null, "2020-01-01", shift(TODAY, 0)); // ends today: half-open, not carried
      await grant(personOnly, null, people[0]!, "2020-01-01", null);
      await grant(otherGroupRole, other, null, "2020-01-01", null);
      await grant(future, id, null, shift(TODAY, 5), null);

      const r = await reads.readCommittee(viewer(clerk), id);
      if (r.kind !== "ok") throw new Error(r.kind);
      expect(r.data.carriedRoles).toEqual([{ id: carried, name: `rd90_carried_${stamp}` }]);
    });
  });

  // ---------------------------------------------------------------------------
  describe("the form readers", () => {
    it("readCommitteeFormDefaults: without an id the create form's `today`; with one the committee's values; a dissolved one is `committee_dissolved`; a wrong kind is `not_found`", async () => {
      const create = await reads.readCommitteeFormDefaults(viewer(clerk));
      expect(create).toEqual({ kind: "ok", data: { today: TODAY } });

      const id = await committee(P, `Rd90 ${stamp} Defaults`);
      await details(P, id, "ad_hoc");
      await q(sql`update groups set description = 'Why', meets_when = 'When' where id = ${id}`);
      const edit = await reads.readCommitteeFormDefaults(viewer(clerk), id);
      expect(edit).toEqual({
        kind: "ok",
        data: { today: TODAY, committee: { id, name: `Rd90 ${stamp} Defaults`, kind: "ad_hoc", purpose: "Why", meetsWhen: "When" } },
      });

      const plain = await committee(P, `Rd90 ${stamp} Defaults plain`);
      expect(await reads.readCommitteeFormDefaults(viewer(clerk), plain)).toMatchObject({
        kind: "ok",
        data: { committee: { kind: null, purpose: "", meetsWhen: "" } },
      });

      const dissolved = await committee(P, `Rd90 ${stamp} Defaults dissolved`);
      await details(P, dissolved, "standing", shift(TODAY, -1));
      expect(await reads.readCommitteeFormDefaults(viewer(clerk), dissolved)).toEqual({ kind: "committee_dissolved" });
      for (const wrong of [choirP, committeeP2, committeeC, "not-a-uuid"]) {
        expect(await reads.readCommitteeFormDefaults(viewer(clerk), wrong), wrong).toEqual({ kind: "not_found" });
      }
    });

    it("readSeatFormOptions: current members only, `alreadyServes` for a serving or planned seat and not for a past or zero-length one", async () => {
      const id = await committee(P, `Rd90 ${stamp} Options`);
      const gone = await fx.makePerson("Gone", `Op${stamp}`);
      await fx.addMember(P, gone, { roll: null });
      await fx.platform.execute(sql`alter table memberships disable trigger memberships_guard_end`);
      try {
        await q(sql`update memberships set ended_on = '2022-01-01' where person_id = ${gone} and organization_id = ${P}`);
      } finally {
        await fx.platform.execute(sql`alter table memberships enable trigger memberships_guard_end`);
      }
      await seat(P, id, people[0]!, "member", shift(TODAY, -10)); // serving
      await seat(P, id, people[1]!, "member", shift(TODAY, 10)); // planned
      await seat(P, id, people[2]!, "member", shift(TODAY, -50), shift(TODAY, -20)); // past
      await seat(P, id, people[3]!, "member", shift(TODAY, -5), shift(TODAY, -5)); // zero-length
      await seat(P, id, people[4]!, "member", shift(TODAY, -50), TODAY); // ends today: past

      const r = await reads.readSeatFormOptions(viewer(clerk), id);
      if (r.kind !== "ok") throw new Error(r.kind);
      const flag = new Map(r.data.people.map((p) => [p.personId, p.alreadyServes]));
      expect(flag.get(people[0]!)).toBe(true);
      expect(flag.get(people[1]!)).toBe(true);
      expect(flag.get(people[2]!)).toBe(false);
      expect(flag.get(people[3]!)).toBe(false);
      expect(flag.get(people[4]!)).toBe(false);
      expect(flag.get(people[5]!)).toBe(false);
      expect(flag.has(gone)).toBe(false); // an ended membership is not eligible
      expect(flag.has(clerk)).toBe(true); // the clerk is a member too
      expect(r.data.committeeName).toBe(`Rd90 ${stamp} Options`);
      expect(r.data.carriedRoles).toEqual([]);
    });

    it("readSeatFormOptions: a dissolved committee is `committee_dissolved`; a wrong kind is `not_found`; a person who is a member only of another organization is never listed", async () => {
      const dissolved = await committee(P, `Rd90 ${stamp} Options dissolved`);
      await details(P, dissolved, "standing", shift(TODAY, -1));
      expect(await reads.readSeatFormOptions(viewer(clerk), dissolved)).toEqual({ kind: "committee_dissolved" });
      expect(await reads.readSeatFormOptions(viewer(clerk), choirP)).toEqual({ kind: "not_found" });

      const id = await committee(P, `Rd90 ${stamp} Options scope`);
      const r = await reads.readSeatFormOptions(viewer(clerk), id);
      if (r.kind !== "ok") throw new Error(r.kind);
      expect(r.data.people.map((p) => p.personId)).not.toContain(clerkC);
      expect(r.data.people.map((p) => p.personId)).not.toContain(clerkP2);
    });

    it("readSeat: a seat of this committee; another committee's seat, another presbytery's and a malformed id are `not_found`", async () => {
      const id = await committee(P, `Rd90 ${stamp} Seat page`);
      const other = await committee(P, `Rd90 ${stamp} Seat other`);
      const mine = await seat(P, id, people[0]!, "secretary", shift(TODAY, -20), shift(TODAY, 100));
      const theirs = await seat(P, other, people[1]!, "member", shift(TODAY, -20));

      const r = await reads.readSeat(viewer(clerk), id, mine);
      expect(r).toMatchObject({
        kind: "ok",
        data: { committeeId: id, committeeName: `Rd90 ${stamp} Seat page`, today: TODAY, seat: { membershipId: mine, role: "secretary", endsOn: shift(TODAY, 100) } },
      });
      for (const [committeeId, seatId] of [
        [id, theirs],
        [choirP, mine],
        [committeeP2, mine],
        [id, "not-a-uuid"],
        ["not-a-uuid", mine],
      ] as const) {
        expect(await reads.readSeat(viewer(clerk), committeeId, seatId), `${committeeId} ${seatId}`).toEqual({ kind: "not_found" });
      }
    });
  });
});
