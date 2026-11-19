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
 *   - INCREMENT 2, commission records (the last describe): each commission reader is
 *     `forbidden` without the key (checked before the id); the congregation a record is
 *     about reads ZERO rows of it (organization-only policy); the list never carries a
 *     charge, counts serving members by the half-open rule on the organization's local
 *     day, and uses a fixed number of queries; a removed record, another presbytery's, a
 *     committee's group id and a malformed id are one `not_found`; the congregation
 *     choices include a closing congregation and exclude one that left; the member form
 *     answers `commission_ended` for an ended record.
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

  // ===========================================================================
  // INCREMENT 2: commission records
  // ===========================================================================
  describe("commission records (Increment 2)", () => {
    let CG1: string; // a member congregation of P
    let CGCLOSING: string; // a member congregation of P whose lifecycle is no longer active
    let CGDEPART: string; // a congregation that left P for P2
    let CGX: string; // a member congregation of the other presbytery
    const made: string[] = [];

    async function affiliate(subject: string, parent: string) {
      await q(sql`
        insert into organization_affiliations
          (organization_id, subject_org_id, parent_org_id, relationship_type, effective_from, authority, minute_reference)
        values (${parent}, ${subject}, ${parent}, 'member_congregation', '2000-01-01', 'recorded',
                'Fixture affiliation for the commission reads of reads.db.test.ts')`);
    }
    async function cong(label: string, parent: string): Promise<string> {
      const id = await fx.makeOrg(`${label}${(n += 1)}`);
      made.push(id);
      await affiliate(id, parent);
      return id;
    }

    /** A commission record, inserted as the owner (the owner may insert history: an ended or removed record). */
    async function record(
      org: string,
      over: { title?: string; charge?: string | null; about?: string | null; appointedOn?: string; endedOn?: string | null; removed?: boolean } = {},
    ): Promise<string> {
      const endedOn = over.endedOn ?? null;
      const rows = await q(sql`
        insert into commission_records
          (organization_id, about_org_id, title, charge, appointed_on, ended_on, ended_by, ended_at, removed_at, removed_by, created_by, updated_by)
        values (${org}, ${over.about ?? null}, ${over.title ?? `Rd90 ${stamp} Commission ${(n += 1)}`}, ${over.charge ?? null},
                ${over.appointedOn ?? shift(TODAY, -100)}::date,
                ${endedOn}::date, ${endedOn ? fx.actingUserId : null}, ${endedOn ? sql`now()` : null},
                ${over.removed ? sql`now()` : null}, ${over.removed ? fx.actingUserId : null}, ${fx.actingUserId}, ${fx.actingUserId})
        returning id`);
      return String(rows[0]!.id);
    }
    async function member(org: string, commissionId: string, personId: string, role: string, startsOn: string, endsOn: string | null = null) {
      return String(
        (
          await q(sql`insert into commission_record_members (organization_id, commission_record_id, person_id, role, starts_on, ends_on, created_by, updated_by)
                      values (${org}, ${commissionId}, ${personId}, ${role}, ${startsOn}::date, ${endsOn}::date, ${fx.actingUserId}, ${fx.actingUserId}) returning id`)
        )[0]!.id,
      );
    }

    beforeAll(async () => {
      CG1 = await cong("RdCong1", P);
      CGCLOSING = await cong("RdCongClosing", P);
      await q(sql`update organizations set lifecycle_status = 'dissolved' where id = ${CGCLOSING}`);
      CGDEPART = await cong("RdCongDeparted", P);
      CGX = await cong("RdCongX", P2);
      await fx.platform.transaction(async (tx) => {
        await tx.execute(sql`select set_config('presby.affiliation_trigger_active', 'true', true)`);
        await tx.execute(sql`
          update organization_affiliations
             set effective_to = '2024-01-01', closed_by_org_id = ${P}, closed_on = '2024-01-01',
                 closed_minute_reference = 'Fixture departure for the commission reads of reads.db.test.ts'
           where subject_org_id = ${CGDEPART} and effective_to is null`);
        await tx.execute(sql`
          insert into organization_affiliations
            (organization_id, subject_org_id, parent_org_id, relationship_type, effective_from, authority, minute_reference)
          values (${P2}, ${CGDEPART}, ${P2}, 'member_congregation', '2024-01-01', 'recorded', 'Fixture arrival for the commission reads of reads.db.test.ts')`);
      });
    });

    afterAll(async () => {
      if (!fx) return;
      // about_org_id is NO ACTION: the records go before the congregations they name.
      await q(sql`delete from commission_record_members where organization_id in (${P}, ${P2}, ${PKIR}, ${PPAGO})`);
      await q(sql`delete from commission_records where organization_id in (${P}, ${P2}, ${PKIR}, ${PPAGO})`);
      await q(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
      try {
        for (const id of made) await q(sql`delete from organizations where id = ${id}`);
      } finally {
        await q(sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
      }
    });

    // -----------------------------------------------------------------------
    describe("forbidden without the key, inside the reader's own transaction", () => {
      it("every commission reader is `forbidden` for a member with no key, and for the congregation's clerk at a congregation, returning no data", async () => {
        const id = await record(P, { title: `Rd90 ${stamp} Secret title`, charge: "ZQ-READ-CHARGE-SENTINEL" });
        for (const who of [viewer(keyless), viewer(clerkC, C)]) {
          const results = [
            await reads.readCommissionList(who),
            await reads.readCommission(who, id),
            await reads.readCommissionFormOptions(who),
            await reads.readCommissionMemberFormOptions(who, id),
          ];
          for (const r of results) expect(r).toEqual({ kind: "forbidden" });
          expect(JSON.stringify(results)).not.toContain("ZQ-READ-CHARGE-SENTINEL");
          expect(JSON.stringify(results)).not.toContain("Secret title");
        }
      });

      it("the key is checked BEFORE the id: a keyless viewer is `forbidden` (not `not_found`) for a malformed or foreign id", async () => {
        const foreign = await record(P2);
        expect(await reads.readCommission(viewer(keyless), "not-a-uuid")).toEqual({ kind: "forbidden" });
        expect(await reads.readCommission(viewer(keyless), foreign)).toEqual({ kind: "forbidden" });
        expect(await reads.readCommission(viewer(clerk), "not-a-uuid")).toEqual({ kind: "not_found" });
      });
    });

    // -----------------------------------------------------------------------
    describe("the congregation a commission is about reads NOTHING of it", () => {
      it("from the congregation's own context the records table answers zero rows, even for a record about it", async () => {
        await record(P, { about: CG1, title: `Rd90 ${stamp} About CG1` });
        const { withOrgContext } = await import("@/lib/authz");
        const seen = await withOrgContext(clerkC, C, async (tx) => rowsOf(await tx.execute(sql`select count(*)::int as n from commission_records`)));
        expect(Number(seen[0]!.n)).toBe(0);
        const seenMembers = await withOrgContext(clerkC, C, async (tx) => rowsOf(await tx.execute(sql`select count(*)::int as n from commission_record_members`)));
        expect(Number(seenMembers[0]!.n)).toBe(0);
        // and the other presbytery's clerk sees none of this presbytery's, only their own
        const other = await withOrgContext(clerkP2, P2, async (tx) => rowsOf(await tx.execute(sql`select count(*)::int as n from commission_records where organization_id = ${P}`)));
        expect(Number(other[0]!.n)).toBe(0);
      });
    });

    // -----------------------------------------------------------------------
    describe("the list", () => {
      it("lists this presbytery's active records, newest-appointed first; not removed ones, not another presbytery's; ended ones only when asked, and always as a count", async () => {
        const active = await record(P, { title: `Rd90 ${stamp} List active`, about: CG1, appointedOn: shift(TODAY, -10) });
        const none = await record(P, { title: `Rd90 ${stamp} List none`, appointedOn: shift(TODAY, -20) });
        const ended = await record(P, { title: `Rd90 ${stamp} List ended`, endedOn: shift(TODAY, -3) });
        const removed = await record(P, { title: `Rd90 ${stamp} List removed`, removed: true });
        const foreign = await record(P2, { title: `Rd90 ${stamp} List foreign` });

        const hidden = await reads.readCommissionList(viewer(clerk));
        const shown = await reads.readCommissionList(viewer(clerk), { showEnded: true });
        if (hidden.kind !== "ok" || shown.kind !== "ok") throw new Error("list refused");
        const ids = (r: typeof hidden) => (r.kind === "ok" ? r.data.commissions.map((c) => c.id) : []);
        expect(ids(hidden)).toEqual(expect.arrayContaining([active, none]));
        for (const id of [ended, removed, foreign]) expect(ids(hidden)).not.toContain(id);
        expect(ids(shown)).toContain(ended);
        for (const id of [removed, foreign]) expect(ids(shown)).not.toContain(id);
        expect(ids(hidden).indexOf(active)).toBeLessThan(ids(hidden).indexOf(none));
        expect(hidden.data.endedCount).toBeGreaterThanOrEqual(1);
        expect(shown.data.endedCount).toBe(hidden.data.endedCount);
        expect(hidden.data.showEnded).toBe(false);
        expect(shown.data.showEnded).toBe(true);
        expect(hidden.data.today).toBe(TODAY);

        const row = (r: typeof hidden, id: string) => (r.kind === "ok" ? r.data.commissions.find((c) => c.id === id) : undefined);
        expect(row(hidden, active)).toMatchObject({ aboutOrgId: CG1, congregationName: expect.stringContaining("RdCong1"), endedOn: null });
        expect(row(hidden, none)).toMatchObject({ aboutOrgId: null, congregationName: null });
        expect(row(shown, ended)).toMatchObject({ endedOn: shift(TODAY, -3) });
      });

      it("the list NEVER carries a charge (only the record's own reader does)", async () => {
        await record(P, { title: `Rd90 ${stamp} Charged`, charge: "ZQ-LIST-CHARGE-SENTINEL" });
        const r = await reads.readCommissionList(viewer(clerk), { showEnded: true });
        if (r.kind !== "ok") throw new Error(r.kind);
        expect(JSON.stringify(r)).not.toContain("ZQ-LIST-CHARGE-SENTINEL");
        for (const row of r.data.commissions) expect(Object.keys(row)).not.toContain("charge");
      });

      it("the serving count follows the half-open rule: a member ending today, one starting tomorrow and a zero-length one are not serving; one ending tomorrow is", async () => {
        const id = await record(P, { title: `Rd90 ${stamp} Serving count` });
        await member(P, id, people[0]!, "chair", shift(TODAY, -50));
        await member(P, id, people[1]!, "member", shift(TODAY, -50), shift(TODAY, 1)); // ends tomorrow: serving
        await member(P, id, people[2]!, "member", shift(TODAY, -50), TODAY); // ends today
        await member(P, id, people[3]!, "member", shift(TODAY, 1)); // starts tomorrow
        await member(P, id, people[4]!, "member", shift(TODAY, -2), shift(TODAY, -2)); // zero-length
        const r = await reads.readCommissionList(viewer(clerk));
        if (r.kind !== "ok") throw new Error(r.kind);
        expect(r.data.commissions.find((c) => c.id === id)).toMatchObject({ servingCount: 2 });
        const none = await record(P, { title: `Rd90 ${stamp} Nobody serves` });
        const again = await reads.readCommissionList(viewer(clerk));
        if (again.kind !== "ok") throw new Error(again.kind);
        expect(again.data.commissions.find((c) => c.id === none)).toMatchObject({ servingCount: 0 });
      });

      it("a removed record's members are not counted anywhere (a removed record is not listed at all)", async () => {
        // the live-parent guard refuses a member of an already-removed record even for the owner, so the member goes in first
        const id = await record(P, { title: `Rd90 ${stamp} Removed with member` });
        await member(P, id, people[0]!, "member", shift(TODAY, -5));
        await q(sql`update commission_records set removed_at = now(), removed_by = ${fx.actingUserId} where id = ${id}`);
        const r = await reads.readCommissionList(viewer(clerk), { showEnded: true });
        if (r.kind !== "ok") throw new Error(r.kind);
        expect(r.data.commissions.map((c) => c.id)).not.toContain(id);
      });

      it("uses the ORGANIZATION'S local day: at one instant a member starting on the 16th serves in Kiritimati and not in Pago Pago", async () => {
        const instant = new Date("2026-06-15T12:00:00Z");
        const mk = async (org: string) => {
          const who = await fx.makePerson("Member", `Cmz${stamp}${(n += 1)}`);
          await fx.addMember(org, who, { roll: null });
          const id = await record(org, { title: `Rd90 ${stamp} TZ ${org.slice(0, 4)}`, appointedOn: "2026-01-01" });
          await member(org, id, who, "chair", "2026-06-16");
          return id;
        };
        const idKir = await mk(PKIR);
        const idPago = await mk(PPAGO);
        const kir = await reads.readCommissionList(viewer(clerkKir, PKIR), {}, instant);
        const pago = await reads.readCommissionList(viewer(clerkPago, PPAGO), {}, instant);
        if (kir.kind !== "ok" || pago.kind !== "ok") throw new Error("list refused");
        expect(kir.data.today).toBe("2026-06-16");
        expect(pago.data.today).toBe("2026-06-15");
        expect(kir.data.commissions.find((c) => c.id === idKir)).toMatchObject({ servingCount: 1 });
        expect(pago.data.commissions.find((c) => c.id === idPago)).toMatchObject({ servingCount: 0 });
      });

      it("uses a FIXED number of queries for 2 and for 30 records", async () => {
        const own = await fx.makeOrg("CmCountPresbytery", { organizationType: "presbytery" });
        const who = await fx.makePerson("Counter", `Cmc${stamp}`);
        await fx.enroll(own, who, ["groups.manage"]);
        const seated = await fx.makePerson("Seated", `Cmc${stamp}`);
        await fx.addMember(own, seated, { roll: null });
        const make = async (count: number) => {
          for (let i = 0; i < count; i += 1) {
            const id = await record(own, { title: `Rd90 ${stamp} Cm count ${(n += 1)}` });
            await member(own, id, seated, "member", shift(TODAY, -5));
          }
        };
        const measure = async () => {
          counter.executes = 0;
          const r = await reads.readCommissionList(viewer(who, own));
          if (r.kind !== "ok") throw new Error(r.kind);
          return { queries: counter.executes, rows: r.data.commissions.length };
        };
        await make(2);
        const small = await measure();
        await make(28);
        const large = await measure();
        expect(small.rows).toBe(2);
        expect(large.rows).toBe(30);
        expect(large.queries).toBe(small.queries);
        expect(small.queries).toBeLessThanOrEqual(6);
        await q(sql`delete from commission_record_members where organization_id = ${own}`);
        await q(sql`delete from commission_records where organization_id = ${own}`);
      });
    });

    // -----------------------------------------------------------------------
    describe("readCommission", () => {
      it("a removed record, another presbytery's, a committee's group id, a congregation's id, a nonexistent UUID and a malformed id are ONE `not_found`", async () => {
        const removed = await record(P, { removed: true });
        const foreign = await record(P2);
        const committeeId = await committee(P);
        const results = await Promise.all(
          [removed, foreign, committeeId, CG1, "00000000-0000-4090-8000-00000000f0f0", "not-a-uuid"].map((id) => reads.readCommission(viewer(clerk), id)),
        );
        for (const r of results) expect(r).toEqual({ kind: "not_found" });
        expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
      });

      it("returns the record with its charge and congregation, and every member (past and planned too) with role, dates and the two status badges", async () => {
        const id = await record(P, { title: `Rd90 ${stamp} Detail`, charge: "A general charge.", about: CG1, appointedOn: shift(TODAY, -40) });
        const deadPerson = await fx.makePerson("Departed", `Cmd${stamp}`);
        await fx.addMember(P, deadPerson, { roll: null });
        await q(sql`update people set date_of_death = '2025-02-02' where id = ${deadPerson}`);
        const leftPerson = await fx.makePerson("Leaver", `Cmd${stamp}`);
        await fx.addMember(P, leftPerson, { roll: null });
        await fx.platform.execute(sql`alter table memberships disable trigger memberships_guard_end`);
        try {
          await q(sql`update memberships set ended_on = '2025-03-03' where person_id = ${leftPerson} and organization_id = ${P}`);
        } finally {
          await fx.platform.execute(sql`alter table memberships enable trigger memberships_guard_end`);
        }
        const serving = await member(P, id, people[0]!, "chair", shift(TODAY, -30));
        const planned = await member(P, id, people[1]!, "clerk", shift(TODAY, 10), shift(TODAY, 90));
        const past = await member(P, id, people[2]!, "member", shift(TODAY, -39), shift(TODAY, -20));
        await member(P, id, deadPerson, "member", shift(TODAY, -39), shift(TODAY, -30));
        await member(P, id, leftPerson, "member", shift(TODAY, -39), shift(TODAY, -30));

        const r = await reads.readCommission(viewer(clerk), id);
        if (r.kind !== "ok") throw new Error(r.kind);
        expect(r.data.today).toBe(TODAY);
        expect(r.data.commission).toMatchObject({
          id,
          title: `Rd90 ${stamp} Detail`,
          charge: "A general charge.",
          aboutOrgId: CG1,
          congregationIsMember: true,
          appointedOn: shift(TODAY, -40),
          minuteReference: null,
          endedOn: null,
          endedMinuteReference: null,
          rowVersion: 1,
        });
        expect(r.data.commission.congregationName).toContain("RdCong1");
        const byId = new Map(r.data.members.map((m) => [m.memberId, m]));
        expect(byId.get(serving)).toMatchObject({ role: "chair", startsOn: shift(TODAY, -30), endsOn: null, connected: true, deceased: false });
        expect(byId.get(planned)).toMatchObject({ role: "clerk", startsOn: shift(TODAY, 10), endsOn: shift(TODAY, 90) });
        expect(byId.get(past)).toMatchObject({ role: "member", endsOn: shift(TODAY, -20) });
        const dead = r.data.members.find((m) => m.personId === deadPerson)!;
        expect(dead).toMatchObject({ deceased: true, connected: true });
        const left = r.data.members.find((m) => m.personId === leftPerson)!;
        expect(left).toMatchObject({ connected: false, deceased: false });
        expect(r.data.members).toHaveLength(5);
      });

      it("a record with no congregation, one about a CLOSING congregation (still a member) and one about a congregation that has LEFT say so", async () => {
        const none = await record(P);
        const closing = await record(P, { about: CGCLOSING });
        // a record about a congregation that has since left: inserted before it departed would be refused by the trigger today,
        // so the owner writes it with the trigger's about-org check disabled, exactly as history would have arrived.
        await q(sql`alter table commission_records disable trigger commission_records_about_org`);
        let left: string;
        try {
          left = await record(P, { about: CGDEPART });
        } finally {
          await q(sql`alter table commission_records enable trigger commission_records_about_org`);
        }
        const get = async (id: string) => {
          const r = await reads.readCommission(viewer(clerk), id);
          if (r.kind !== "ok") throw new Error(r.kind);
          return r.data.commission;
        };
        expect(await get(none)).toMatchObject({ aboutOrgId: null, congregationName: null, congregationIsMember: false });
        expect(await get(closing)).toMatchObject({ aboutOrgId: CGCLOSING, congregationIsMember: true });
        expect(await get(left)).toMatchObject({ aboutOrgId: CGDEPART, congregationIsMember: false });
        expect((await get(left)).congregationName).toContain("RdCongDeparted");
      });

      it("an ended record carries its end date and minute reference", async () => {
        const id = await record(P, { endedOn: shift(TODAY, -4) });
        await q(sql`update commission_records set ended_minute_reference = 'Reported in minutes 2026-11-01' where id = ${id}`);
        const r = await reads.readCommission(viewer(clerk), id);
        if (r.kind !== "ok") throw new Error(r.kind);
        expect(r.data.commission).toMatchObject({ endedOn: shift(TODAY, -4), endedMinuteReference: "Reported in minutes 2026-11-01" });
      });
    });

    // -----------------------------------------------------------------------
    describe("the form readers", () => {
      it("readCommissionFormOptions: this presbytery's member congregations only (a closing one is choosable); not another presbytery's, not one that left; plus today", async () => {
        const r = await reads.readCommissionFormOptions(viewer(clerk));
        if (r.kind !== "ok") throw new Error(r.kind);
        const ids = r.data.congregations.map((c) => c.id);
        expect(ids).toEqual(expect.arrayContaining([CG1, CGCLOSING]));
        for (const other of [CGX, CGDEPART, C, P, P2]) expect(ids).not.toContain(other);
        expect(r.data.today).toBe(TODAY);
      });

      it("readCommissionMemberFormOptions: current members only, `alreadyServes` for a serving or planned term and not for a past or zero-length one", async () => {
        const id = await record(P, { title: `Rd90 ${stamp} Member options` });
        await member(P, id, people[0]!, "member", shift(TODAY, -10)); // serving
        await member(P, id, people[1]!, "member", shift(TODAY, 10)); // planned
        await member(P, id, people[2]!, "member", shift(TODAY, -50), shift(TODAY, -20)); // past
        await member(P, id, people[3]!, "member", shift(TODAY, -5), shift(TODAY, -5)); // zero-length
        await member(P, id, people[4]!, "member", shift(TODAY, -50), TODAY); // ends today: past

        const r = await reads.readCommissionMemberFormOptions(viewer(clerk), id);
        if (r.kind !== "ok") throw new Error(r.kind);
        const flag = new Map(r.data.people.map((p) => [p.personId, p.alreadyServes]));
        expect(flag.get(people[0]!)).toBe(true);
        expect(flag.get(people[1]!)).toBe(true);
        for (const past of [people[2]!, people[3]!, people[4]!, people[5]!]) expect(flag.get(past)).toBe(false);
        expect(flag.has(clerkC)).toBe(false);
        expect(flag.has(clerkP2)).toBe(false);
        expect(r.data.commissionTitle).toBe(`Rd90 ${stamp} Member options`);
        expect(r.data.today).toBe(TODAY);
      });

      it("readCommissionMemberFormOptions: an ended record is `commission_ended`; a removed, foreign, wrong-kind or malformed id is `not_found`", async () => {
        const ended = await record(P, { endedOn: shift(TODAY, -2) });
        expect(await reads.readCommissionMemberFormOptions(viewer(clerk), ended)).toEqual({ kind: "commission_ended" });
        const removed = await record(P, { removed: true });
        const foreign = await record(P2);
        const committeeId = await committee(P);
        for (const id of [removed, foreign, committeeId, "not-a-uuid"]) {
          expect(await reads.readCommissionMemberFormOptions(viewer(clerk), id), id).toEqual({ kind: "not_found" });
        }
      });
    });
  });
});
