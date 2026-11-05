/**
 * The scheduling reads against a REAL Postgres connection (docs/work-log/
 * 2026-11-04-worship-inc1.md, Phase 3 "Reads"; Tests, `reads.db.test.ts`; Phase 4
 * Batch 3). Every read runs on the `presby_app` connection with an organization
 * context, so RLS is live.
 *
 *   - SELF-READ ISOLATION: another member's, another organization's and a
 *     toggled-off organization's rows are never returned; a draft is invisible to
 *     its assignee; the id-guessing hole is the same `not_found`;
 *   - the team page: roster member or any key, names only, canFill, no contact;
 *   - the services list: counts, caps per position, upcoming and earlier;
 *   - the board: a key sees every serving team, a seat only the led ones; names,
 *     reasons, outcomes, the recorder; the minor flag;
 *   - the picker: qualified, blocked-out, double-booked, overlapping, declined,
 *     under-18; who is excluded;
 *   - NO N+1: the statement count does not grow with the roster or the board;
 *   - the Features count (`presby_worship_open_count`).
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/worship/reads.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { WorshipTestWorld, WorshipWorld } from "@/lib/testing/worship-world";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 240_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("worship/reads.ts scheduling reads (Postgres-backed)", () => {
  let t: WorshipTestWorld;
  let reads: typeof import("./reads");
  let store: typeof import("./store");
  let db: typeof import("@/lib/db").db;

  const v = (personId: string, w: WorshipWorld) => t.viewer(personId, w.org);

  beforeAll(async () => {
    await import("@/lib/db/schema");
    const world = await import("@/lib/testing/worship-world");
    t = await world.createWorshipWorld("wreads");
    reads = await import("./reads");
    store = await import("./store");
    ({ db } = await import("@/lib/db"));
  });
  afterAll(async () => {
    if (t) await t.fx.cleanup();
  });

  /** Counts `tx.execute` calls the app connection makes while `fn` runs (the N+1 detector). */
  async function statements<T>(fn: () => Promise<T>): Promise<{ result: T; count: number }> {
    let count = 0;
    const original = db.transaction.bind(db) as (cb: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) => Promise<unknown>;
    const spy = vi.spyOn(db, "transaction").mockImplementation(((cb: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) =>
      original(
        (tx: unknown) =>
          cb(
            new Proxy(tx as object, {
              get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver);
                if (prop === "execute" && typeof value === "function") {
                  return (...args: unknown[]) => {
                    count += 1;
                    return (value as (...a: unknown[]) => unknown).apply(target, args);
                  };
                }
                return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
              },
            }),
          ),
        ...rest,
      )) as never);
    try {
      return { result: await fn(), count };
    } finally {
      spy.mockRestore();
    }
  }

  /** A service start two weeks out, 09:00 on the organization's calendar. */
  const futureStart = async (org: string) =>
    String((await t.one(sql`select to_char(date_trunc('week', presby_worship_org_now(${org})) + make_interval(weeks => 2, days => 6, hours => 9), 'YYYY-MM-DD"T"HH24:MI') as s`)).s);

  /** A request in the given state, by the owner path (the Send has its own tests). */
  async function put(
    w: WorshipWorld,
    personId: string,
    eventId: string,
    positionId: string,
    state: "draft" | "requested" | "confirmed" | "declined",
    opts: { groupId?: string; onBehalf?: boolean; reason?: string } = {},
  ): Promise<string> {
    const id = await t.draft(w, personId, eventId, positionId, opts.groupId ?? w.band);
    if (state === "draft") return id;
    await t.inOrg(w.org, async (tx) => {
      await tx.execute(sql`update worship_assignments set status = 'requested', sent_by_person_id = ${w.scheduler}, notice_outcome = 'emailed' where id = ${id}`);
      if (state === "confirmed") {
        await tx.execute(sql`update worship_assignments set status = 'confirmed', response_source = ${opts.onBehalf ? "on_behalf" : "self"},
                               responded_by_person_id = ${opts.onBehalf ? w.leader : personId} where id = ${id}`);
      } else if (state === "declined") {
        await tx.execute(sql`update worship_assignments set status = 'declined', response_source = ${opts.onBehalf ? "on_behalf" : "self"},
                               responded_by_person_id = ${opts.onBehalf ? w.leader : personId}, decline_reason = ${opts.reason ?? "away"} where id = ${id}`);
      }
    });
    return id;
  }

  // -------------------------------------------------------------------------
  describe("the volunteer's own side", () => {
    it("getMySchedule groups waiting, scheduled and declined, hides drafts and withdrawn rows and past services, flags a cancelled service", async () => {
      const w = await t.build("m1");
      const waiting = await put(w, w.alice, w.sunday, w.drums, "requested");
      const scheduled = await put(w, w.alice, w.midweek, w.vocals, "confirmed");
      const declined = await put(w, w.alice, w.later, w.vocals, "declined", { reason: "family" });
      await put(w, w.alice, w.soon, w.vocals, "draft");
      const gone = await put(w, w.alice, w.soon, w.drums, "requested");
      await t.inOrg(w.org, (tx) => tx.execute(sql`update worship_assignments set status = 'withdrawn', withdrawn_by_person_id = ${w.scheduler}, withdrawn_reason = 'removed' where id = ${gone}`));
      const r = await reads.getMySchedule(v(w.alice, w));
      if (r.kind !== "ok") throw new Error(JSON.stringify(r));
      expect(r.data.waiting.map((x) => x.assignmentId)).toEqual([waiting]);
      expect(r.data.scheduled.map((x) => x.assignmentId)).toEqual([scheduled]);
      expect(r.data.declined.map((x) => x.assignmentId)).toEqual([declined]);
      expect(r.data.declined[0]).toMatchObject({ declineReason: "family", positionName: "Vocals", teamName: "Band", title: "Later service", cancelled: false });
      expect(r.data.waiting[0]!.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(r.data.teams).toEqual([
        { groupId: w.band, name: "Band", youLead: false },
        { groupId: w.choir, name: "Choir", youLead: false },
      ]);
      // A cancelled service stays in the list, flagged (from the worship read, never the event page).
      await t.q(sql`update events set cancelled_at = now() where id = ${w.sunday}`);
      const again = await reads.getMySchedule(v(w.alice, w));
      if (again.kind !== "ok") throw new Error("read");
      expect(again.data.waiting[0]).toMatchObject({ assignmentId: waiting, cancelled: true });
      // A service that has started drops off.
      await t.q(sql`update events set starts_at = presby_worship_org_now(${w.org}) - interval '1 hour' where id = ${w.midweek}`);
      const past = await reads.getMySchedule(v(w.alice, w));
      if (past.kind !== "ok") throw new Error("read");
      expect(past.data.scheduled).toEqual([]);
    });

    it("shows a leader their seat ('You lead'), and a person only the teams they are on now", async () => {
      const w = await t.build("m2");
      const lead = await reads.getMySchedule(v(w.leader, w));
      if (lead.kind !== "ok") throw new Error("read");
      expect(lead.data.teams).toEqual([{ groupId: w.band, name: "Band", youLead: true }]);
      const bob = await reads.getMySchedule(v(w.bob, w));
      if (bob.kind !== "ok") throw new Error("read");
      expect(bob.data.teams).toEqual([{ groupId: w.band, name: "Band", youLead: false }]);
      const plain = await reads.getMySchedule(v(w.plain, w));
      expect(plain).toEqual({ kind: "ok", data: { waiting: [], scheduled: [], declined: [], teams: [] } });
      await t.q(sql`update worship_teams set retired_at = now() where group_id = ${w.choir}`);
      const afterRetire = await reads.getMySchedule(v(w.alice, w));
      if (afterRetire.kind !== "ok") throw new Error("read");
      expect(afterRetire.data.teams.map((x) => x.name)).toEqual(["Band"]);
    });

    it("SELF-READ ISOLATION: nobody sees another member's, another organization's or a toggled-off organization's rows", async () => {
      const w = await t.build("m3");
      const other = await t.build("m3other");
      const off = await t.build("m3off", { toggle: false });
      await put(w, w.alice, w.sunday, w.drums, "requested");
      await put(other, other.alice, other.sunday, other.drums, "requested");
      await put(off, off.alice, off.sunday, off.drums, "requested");
      for (const [who, world] of [[w.bob, w], [w.plain, w], [other.bob, other]] as Array<[string, WorshipWorld]>) {
        expect(await reads.getMySchedule(v(who, world)), who).toMatchObject({ kind: "ok", data: { waiting: [], scheduled: [], declined: [] } });
      }
      expect(await reads.getMySchedule(v(off.alice, off))).toEqual({ kind: "toggle_off" });
      const mine = await reads.getMySchedule(v(w.alice, w));
      expect(mine).toMatchObject({ kind: "ok", data: { waiting: [expect.objectContaining({ positionName: "Drums" })] } });
    });

    it("getRequest: the viewer's own row only; another's, an unknown id and a draft are the SAME not_found; closed states come back not open", async () => {
      const w = await t.build("m4");
      const mine = await put(w, w.alice, w.sunday, w.drums, "requested");
      const draft = await put(w, w.alice, w.midweek, w.drums, "draft");
      const r = await reads.getRequest(v(w.alice, w), { assignmentId: mine });
      expect(r).toMatchObject({
        kind: "ok",
        data: { assignmentId: mine, positionName: "Drums", teamName: "Band", title: "Sunday worship", status: "requested", cancelled: false, started: false, open: true, declineReason: null },
      });
      if (r.kind === "ok") expect(r.data.organizationName).toMatch(/^Fixture m4 for wreads$/);
      for (const [who, id] of [[w.bob, mine], [w.alice, "00000000-0000-4000-8000-0000000000ee"], [w.alice, draft], [w.alice, "nope"]] as Array<[string, string]>) {
        expect(await reads.getRequest(v(who, w), { assignmentId: id }), `${who} ${id}`).toEqual({ kind: "not_found" });
      }
      await t.q(sql`update events set cancelled_at = now() where id = ${w.sunday}`);
      expect(await reads.getRequest(v(w.alice, w), { assignmentId: mine })).toMatchObject({ data: { cancelled: true, open: false } });
      const second = await put(w, w.alice, w.later, w.vocals, "requested");
      await t.q(sql`update events set starts_at = presby_worship_org_now(${w.org}) - interval '1 hour' where id = ${w.later}`);
      expect(await reads.getRequest(v(w.alice, w), { assignmentId: second })).toMatchObject({ data: { started: true, open: false } });
      const third = await put(w, w.bob, w.soon, w.vocals, "requested");
      await t.inOrg(w.org, (tx) => tx.execute(sql`update worship_assignments set status = 'withdrawn', withdrawn_by_person_id = ${w.scheduler}, withdrawn_reason = 'removed' where id = ${third}`));
      expect(await reads.getRequest(v(w.bob, w), { assignmentId: third })).toMatchObject({ data: { status: "withdrawn", open: false } });
    });

    it("getMyBlockouts: only the viewer's live ranges, earliest first", async () => {
      const w = await t.build("m5");
      const d = async (n: number) => String((await t.one(sql`select (presby_worship_org_today(${w.org}) + ${n}::int)::text as d`)).d);
      await store.addBlockout(v(w.alice, w), { startsOn: await d(30), endsOn: await d(31), reason: "work" });
      await store.addBlockout(v(w.alice, w), { startsOn: await d(10), endsOn: await d(12) });
      await store.addBlockout(v(w.bob, w), { startsOn: await d(5), endsOn: await d(6) });
      const ended = await store.addBlockout(v(w.alice, w), { startsOn: await d(50), endsOn: await d(51) });
      if (ended.kind === "ok") await store.endBlockout(v(w.alice, w), { blockoutId: ended.data.blockoutId });
      const r = await reads.getMyBlockouts(v(w.alice, w));
      if (r.kind !== "ok") throw new Error("read");
      expect(r.data.map((x) => [x.startsOn, x.endsOn, x.reason])).toEqual([
        [await d(10), await d(12), null],
        [await d(30), await d(31), "work"],
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe("getTeamPage", () => {
    it("a roster member or any key holder sees names, badges and what each can fill - never an address or phone", async () => {
      const w = await t.build("t1");
      await t.email(w.alice, `alice-${Date.now()}@wreads.example.invalid`);
      await store.setQualifications(t.viewer(w.manager, w.org), { groupId: w.band, personId: w.alice, positionIds: [w.drums, w.vocals] });
      const r = await reads.getTeamPage(v(w.bob, w), { groupId: w.band });
      if (r.kind !== "ok") throw new Error(JSON.stringify(r));
      expect(r.data).toMatchObject({ name: "Band", retired: false, canSchedule: false, services: [] });
      expect(r.data.leaders.map((p) => [p.displayName, p.role])).toEqual([["Leader Worshiptest", "chair"]]);
      const alice = r.data.people.find((p) => p.personId === w.alice)!;
      expect(alice.canFill).toEqual(["Drums", "Vocals"]);
      expect(JSON.stringify(r.data)).not.toMatch(/@|example\.invalid|phone/i);
      // A key holder who is not on the team may read it; a plain member who is not on it may not.
      expect((await reads.getTeamPage(v(w.planner, w), { groupId: w.band })).kind).toBe("ok");
      expect(await reads.getTeamPage(v(w.plain, w), { groupId: w.band })).toEqual({ kind: "not_found" });
      expect(await reads.getTeamPage(v(w.plain, w), { groupId: "nope" })).toEqual({ kind: "not_found" });
      const other = await t.build("t1other");
      expect(await reads.getTeamPage(v(w.manager, w), { groupId: other.band })).toEqual({ kind: "not_found" });
    });

    it("for someone who may schedule it lists the upcoming services the team serves (cancelled and removed ones excluded)", async () => {
      const w = await t.build("t2");
      await t.q(sql`update events set cancelled_at = now() where id = ${w.midweek}`);
      await t.q(sql`update worship_service_teams set removed_at = now() where event_id = ${w.later} and group_id = ${w.band}`);
      const r = await reads.getTeamPage(v(w.leader, w), { groupId: w.band });
      if (r.kind !== "ok") throw new Error("read");
      expect(r.data.canSchedule).toBe(true);
      expect(r.data.services.map((s) => s.title)).toEqual(["Soon service", "Sunday worship"]);
      // The leader of the OTHER team does not get this team's schedule.
      const rb = await reads.getTeamPage(v(w.choirLeader, w), { groupId: w.band });
      expect(rb).toEqual({ kind: "not_found" });
    });

    it("people who left the team, died or were merged are not listed", async () => {
      const w = await t.build("t3");
      await t.q(sql`update group_memberships set ends_on = presby_worship_org_today(${w.org}) where group_id = ${w.band} and person_id = ${w.bob}`);
      await t.q(sql`update people set date_of_death = current_date - 1 where id = ${w.child}`);
      const r = await reads.getTeamPage(v(w.alice, w), { groupId: w.band });
      if (r.kind !== "ok") throw new Error("read");
      expect(r.data.people.map((p) => p.personId)).toEqual([w.alice]);
    });
  });

  // -------------------------------------------------------------------------
  describe("getServicesList", () => {
    it("counts filled (capped per position at its slots), needed and waiting in one statement; plain events and other organizations are absent", async () => {
      const w = await t.build("l1");
      // Band: Drums 1, Vocals 2. Choir: Soprano 4. Needed per service = 7.
      await put(w, w.alice, w.sunday, w.drums, "confirmed");
      await put(w, w.bob, w.sunday, w.vocals, "requested");
      await put(w, w.leader, w.sunday, w.vocals, "draft");
      await put(w, w.child, w.sunday, w.vocals, "draft"); // a third person in a 2-slot position: capped
      await put(w, w.alice, w.midweek, w.soprano, "declined", { groupId: w.choir }); // a decline does not fill
      await t.q(sql`insert into events (organization_id, title, starts_at) values (${w.org}, 'Plain event', presby_worship_org_now(${w.org}) + interval '2 days')`);
      await t.build("l1other");
      const { result, count } = await statements(() => reads.getServicesList(v(w.scheduler, w), { scope: "upcoming" }));
      if (result.kind !== "ok") throw new Error("read");
      expect(result.data.map((s) => s.title)).toEqual(["Soon service", "Later service", "Midweek service", "Sunday worship"]);
      const sunday = result.data.find((s) => s.title === "Sunday worship")!;
      expect(sunday).toMatchObject({ filled: 3, needed: 7, waiting: 1, cancelled: false });
      expect(result.data.find((s) => s.title === "Midweek service")).toMatchObject({ filled: 0, needed: 7, waiting: 0 });
      // The gate (2 statements), the key reads (1), the toggle/type reads and ONE aggregate for the list.
      expect(count).toBeLessThanOrEqual(8);
    });

    it("earlier lists past services newest first (last 20); a removed team's slots do not count; a cancelled service is flagged", async () => {
      const w = await t.build("l2");
      await t.q(sql`update events set starts_at = presby_worship_org_now(${w.org}) - interval '3 days' where id = ${w.sunday}`);
      await t.q(sql`update events set starts_at = presby_worship_org_now(${w.org}) - interval '9 days', cancelled_at = now() where id = ${w.midweek}`);
      await t.q(sql`update worship_service_teams set removed_at = now() where event_id = ${w.later} and group_id = ${w.choir}`);
      const earlier = await reads.getServicesList(v(w.planner, w), { scope: "earlier" });
      if (earlier.kind !== "ok") throw new Error("read");
      expect(earlier.data.map((s) => [s.title, s.cancelled])).toEqual([["Sunday worship", false], ["Midweek service", true]]);
      const upcoming = await reads.getServicesList(v(w.planner, w), { scope: "upcoming" });
      if (upcoming.kind !== "ok") throw new Error("read");
      expect(upcoming.data.find((s) => s.title === "Later service")!.needed).toBe(3);
      expect(upcoming.data.map((s) => s.title)).toEqual(["Soon service", "Later service"]);
    });

    it("needs a worship key: a seat alone and a plain member are forbidden", async () => {
      const w = await t.build("l3");
      for (const who of [w.leader, w.plain]) expect(await reads.getServicesList(v(who, w), { scope: "upcoming" })).toEqual({ kind: "forbidden" });
      for (const who of [w.manager, w.planner, w.scheduler]) expect((await reads.getServicesList(v(who, w), { scope: "upcoming" })).kind).toBe("ok");
    });
  });

  // -------------------------------------------------------------------------
  describe("getServiceBoard", () => {
    it("a key holder sees every serving team with positions, people, statuses, reasons, outcomes, the recorder and the minor flag; a guest by name", async () => {
      const w = await t.build("b1");
      await put(w, w.alice, w.sunday, w.drums, "confirmed", { onBehalf: true });
      await put(w, w.bob, w.sunday, w.vocals, "declined", { reason: "work" });
      const childReq = await put(w, w.child, w.sunday, w.vocals, "requested");
      await t.inOrg(w.org, (tx) => tx.execute(sql`update worship_assignments set notice_outcome = 'guardian' where id = ${childReq}`).catch(() => undefined));
      await store.placeGuest(v(w.scheduler, w), { eventId: w.sunday, groupId: w.choir, positionId: w.soprano, guestName: "Visiting organist" });
      const r = await reads.getServiceBoard(v(w.planner, w), { eventId: w.sunday });
      if (r.kind !== "ok") throw new Error(JSON.stringify(r));
      expect(r.data).toMatchObject({ title: "Sunday worship", cancelled: false, started: false });
      expect(r.data.teams.map((x) => [x.name, x.canSchedule])).toEqual([["Band", false], ["Choir", false]]);
      const band = r.data.teams[0]!;
      expect(band.positions.map((p) => [p.name, p.slots, p.filled])).toEqual([["Drums", 1, 1], ["Vocals", 2, 1]]);
      const drums = band.positions[0]!.assignments[0]!;
      expect(drums).toMatchObject({ name: "Alice Worshiptest", status: "confirmed", recordedBy: "Leader Worshiptest", isGuest: false, mayBeUnder18: false });
      const vocals = band.positions[1]!.assignments;
      // F436: a planner sees that Bob declined, not why; a viewer who can schedule the team sees the reason.
      expect(vocals.find((a) => a.personId === w.bob)).toMatchObject({ status: "declined", declineReason: null, recordedBy: null });
      const asScheduler = await reads.getServiceBoard(v(w.scheduler, w), { eventId: w.sunday });
      if (asScheduler.kind !== "ok") throw new Error(JSON.stringify(asScheduler));
      const schedVocals = asScheduler.data.teams[0]!.positions[1]!.assignments;
      expect(schedVocals.find((a) => a.personId === w.bob)).toMatchObject({ status: "declined", declineReason: "work", recordedBy: null });
      expect(vocals.find((a) => a.personId === w.child)).toMatchObject({ status: "requested", mayBeUnder18: true });
      const guest = r.data.teams[1]!.positions[0]!.assignments[0]!;
      expect(guest).toMatchObject({ name: "Visiting organist", isGuest: true, personId: null, status: "confirmed" });
      expect(JSON.stringify(r.data)).not.toMatch(/@/);
    });

    it("a decline reason is shown only to a viewer who can schedule that team — regression for the reason read by planners (F436)", async () => {
      const w = await t.build("b1r");
      await put(w, w.bob, w.sunday, w.vocals, "declined", { reason: "work" });
      await put(w, w.alice, w.sunday, w.drums, "declined", { reason: "family", onBehalf: true });
      const reasonOf = async (who: string, personId: string, groupId?: string) => {
        const r = await reads.getServiceBoard(v(who, w), { eventId: w.sunday, groupId });
        if (r.kind !== "ok") throw new Error(JSON.stringify(r));
        const a = r.data.teams.flatMap((x) => x.positions.flatMap((p) => p.assignments)).find((x) => x.personId === personId)!;
        return { status: a.status, declineReason: a.declineReason, recordedBy: a.recordedBy };
      };
      for (const who of [w.scheduler, w.leader]) expect(await reasonOf(who, w.bob)).toMatchObject({ status: "declined", declineReason: "work" });
      for (const who of [w.planner, w.manager]) expect(await reasonOf(who, w.bob)).toEqual({ status: "declined", declineReason: null, recordedBy: null });
      // Recorded on someone's behalf follows the same rule.
      expect(await reasonOf(w.scheduler, w.alice)).toMatchObject({ declineReason: "family", recordedBy: "Leader Worshiptest" });
      expect(await reasonOf(w.planner, w.alice)).toMatchObject({ declineReason: null, recordedBy: "Leader Worshiptest" });
      // The reason is not serialized at all for a planner.
      const planner = await reads.getServiceBoard(v(w.planner, w), { eventId: w.sunday });
      expect(JSON.stringify(planner)).not.toMatch(/"work"|"family"/);
      // A seat is enough: the band chair sees the band's reasons; the choir leader does not reach the band board.
      expect(await reads.getServiceBoard(v(w.choirLeader, w), { eventId: w.sunday, groupId: w.band })).toEqual({ kind: "forbidden" });
      // A manage key plus a band seat sees the reason (the seat is enough), and only for that team.
      const both = await t.person(w.org, "Managerchair", ["worship.manage"]);
      await t.onRoster(w.org, w.band, both, "chair");
      expect(await reasonOf(both, w.bob)).toMatchObject({ declineReason: "work" });
      const choirPerson = await t.person(w.org, "Choirdecliner");
      await t.onRoster(w.org, w.choir, choirPerson);
      await put(w, choirPerson, w.sunday, w.soprano, "declined", { groupId: w.choir, reason: "away" });
      expect(await reasonOf(both, choirPerson)).toMatchObject({ status: "declined", declineReason: null });
      expect(await reasonOf(w.scheduler, choirPerson)).toMatchObject({ declineReason: "away" });
    });

    it("a service with no serving team opens, with an empty team list, for a key holder and for nobody else — regression for the team-less 404 (F435)", async () => {
      const w = await t.build("b5");
      const made = await store.createService(v(w.planner, w), { title: "No team yet", startsAt: await futureStart(w.org), groupIds: [] });
      if (made.kind !== "ok" || !made.data.created) throw new Error(JSON.stringify(made));
      const eventId = made.data.eventId;
      for (const who of [w.planner, w.manager, w.scheduler]) {
        expect(await reads.getServiceBoard(v(who, w), { eventId }), who).toMatchObject({ kind: "ok", data: { eventId, title: "No team yet", teams: [], cancelled: false } });
      }
      for (const who of [w.leader, w.plain]) expect(await reads.getServiceBoard(v(who, w), { eventId }), who).toEqual({ kind: "forbidden" });
      expect(await reads.getServiceBoard(v(w.planner, w), { eventId, groupId: w.band })).toEqual({ kind: "forbidden" });
      // A cancelled team-less service still opens, read-only.
      expect((await store.cancelService(v(w.planner, w), { eventId })).kind).toBe("ok");
      expect(await reads.getServiceBoard(v(w.planner, w), { eventId })).toMatchObject({ kind: "ok", data: { cancelled: true, teams: [] } });
    });

    it("removing the last team from a service leaves it open — regression for the team-less 404 (F435)", async () => {
      const w = await t.build("b6");
      const made = await store.createService(v(w.planner, w), { title: "One team", startsAt: await futureStart(w.org), groupIds: [w.band] });
      if (made.kind !== "ok" || !made.data.created) throw new Error(JSON.stringify(made));
      const eventId = made.data.eventId;
      expect((await reads.getServiceBoard(v(w.planner, w), { eventId })).kind).toBe("ok");
      expect((await store.setServiceTeams(v(w.planner, w), { eventId, groupIds: [] })).kind).toBe("ok");
      expect(await reads.getServiceBoard(v(w.planner, w), { eventId })).toMatchObject({ kind: "ok", data: { teams: [] } });
      expect(await reads.getServiceBoard(v(w.leader, w), { eventId })).toEqual({ kind: "forbidden" });
    });

    it("a scheduler can schedule every team; a leader sees (and may schedule) only the team they lead; groupId narrows to one", async () => {
      const w = await t.build("b2");
      const all = await reads.getServiceBoard(v(w.scheduler, w), { eventId: w.sunday });
      if (all.kind !== "ok") throw new Error("read");
      expect(all.data.teams.map((x) => [x.name, x.canSchedule])).toEqual([["Band", true], ["Choir", true]]);
      const lead = await reads.getServiceBoard(v(w.leader, w), { eventId: w.sunday });
      if (lead.kind !== "ok") throw new Error("read");
      expect(lead.data.teams.map((x) => [x.name, x.canSchedule])).toEqual([["Band", true]]);
      expect(await reads.getServiceBoard(v(w.leader, w), { eventId: w.sunday, groupId: w.choir })).toEqual({ kind: "forbidden" });
      const narrowed = await reads.getServiceBoard(v(w.planner, w), { eventId: w.sunday, groupId: w.choir });
      if (narrowed.kind !== "ok") throw new Error("read");
      expect(narrowed.data.teams.map((x) => x.name)).toEqual(["Choir"]);
    });

    it("a plain member, an unknown id, a plain calendar event and another organization's service are not served (forbidden or not_found, never data)", async () => {
      const w = await t.build("b3");
      const plainEvent = String((await t.one(sql`insert into events (organization_id, title, starts_at) values (${w.org}, 'Plain', presby_worship_org_now(${w.org}) + interval '2 days') returning id`)).id);
      const other = await t.build("b3other");
      expect(await reads.getServiceBoard(v(w.plain, w), { eventId: w.sunday })).toEqual({ kind: "forbidden" });
      expect(await reads.getServiceBoard(v(w.planner, w), { eventId: plainEvent })).toEqual({ kind: "not_found" });
      expect(await reads.getServiceBoard(v(w.planner, w), { eventId: other.sunday })).toEqual({ kind: "not_found" });
      expect(await reads.getServiceBoard(v(w.planner, w), { eventId: "nope" })).toEqual({ kind: "not_found" });
      // A removed team is not on the board even for a key holder.
      await t.q(sql`update worship_service_teams set removed_at = now() where event_id = ${w.sunday} and group_id = ${w.choir}`);
      const r = await reads.getServiceBoard(v(w.planner, w), { eventId: w.sunday });
      if (r.kind !== "ok") throw new Error("read");
      expect(r.data.teams.map((x) => x.name)).toEqual(["Band"]);
    });

    it("NO N+1: the statement count does not grow with the people on the board", async () => {
      const small = await t.build("b4a");
      const big = await t.build("b4b");
      await put(small, small.alice, small.sunday, small.drums, "requested");
      const people: string[] = [];
      for (let i = 0; i < 8; i += 1) {
        const p = await t.person(big.org, `Crowd${i}`);
        await t.onRoster(big.org, big.band, p);
        people.push(p);
      }
      await put(big, people[0]!, big.sunday, big.drums, "requested");
      await put(big, people[1]!, big.sunday, big.vocals, "confirmed", { onBehalf: true });
      await put(big, people[2]!, big.sunday, big.vocals, "declined");
      for (const p of people.slice(3, 6)) await t.draft(big, p, big.sunday, big.soprano, big.choir).catch(() => undefined);
      const a = await statements(() => reads.getServiceBoard(v(small.planner, small), { eventId: small.sunday }));
      const b = await statements(() => reads.getServiceBoard(v(big.planner, big), { eventId: big.sunday }));
      expect(a.result.kind).toBe("ok");
      expect(b.result.kind).toBe("ok");
      expect(b.count).toBe(a.count);
    });
  });

  // -------------------------------------------------------------------------
  describe("getPickerCandidates", () => {
    const input = (w: WorshipWorld, over: Partial<{ eventId: string; groupId: string; positionId: string; showAll: boolean }> = {}) => ({
      eventId: w.sunday,
      groupId: w.band,
      positionId: w.drums,
      showAll: true,
      ...over,
    });
    const byId = <T extends { personId: string }>(rows: T[], id: string): T => rows.find((r) => r.personId === id)!;

    it("lists the team's people, qualified first; 'only marked' hides the rest; the marked flag is per position", async () => {
      const w = await t.build("p1");
      await store.setQualifications(t.viewer(w.manager, w.org), { groupId: w.band, personId: w.bob, positionIds: [w.drums] });
      await store.setQualifications(t.viewer(w.manager, w.org), { groupId: w.band, personId: w.alice, positionIds: [w.vocals] });
      const all = await reads.getPickerCandidates(v(w.scheduler, w), input(w));
      if (all.kind !== "ok") throw new Error(JSON.stringify(all));
      expect(all.data[0]).toMatchObject({ personId: w.bob, qualified: true });
      expect(all.data.map((c) => c.personId).sort()).toEqual([w.alice, w.bob, w.child, w.leader].sort());
      expect(byId(all.data, w.alice).qualified).toBe(false);
      const marked = await reads.getPickerCandidates(v(w.scheduler, w), input(w, { showAll: false }));
      if (marked.kind !== "ok") throw new Error("read");
      expect(marked.data.map((c) => c.personId)).toEqual([w.bob]);
    });

    it("warns, never blocks: blocked out that day, already scheduled that day, overlapping another service, declined this service; the minor note is info", async () => {
      const w = await t.build("p2");
      const sundayDay = String((await t.one(sql`select to_char(starts_at, 'YYYY-MM-DD') as d from events where id = ${w.sunday}`)).d);
      // Alice: saved the date as one she can't serve.
      await store.addBlockout(v(w.alice, w), { startsOn: sundayDay, endsOn: sundayDay });
      // Bob: already holds Vocals at the same service (same day).
      await put(w, w.bob, w.sunday, w.vocals, "requested");
      // The leader: serves a second event that overlaps (a service an hour into Sunday's two-hour default window).
      const overlapping = await t.service(w.org, "Overlapping service", 0, [w.band]);
      await t.q(sql`update events set starts_at = (select starts_at + interval '1 hour' from events where id = ${w.sunday}), ends_at = null where id = ${overlapping}`);
      await put(w, w.leader, overlapping, w.vocals, "confirmed", { onBehalf: true });
      // The child declined this service already (a different position).
      await put(w, w.child, w.sunday, w.vocals, "declined");
      const r = await reads.getPickerCandidates(v(w.scheduler, w), input(w));
      if (r.kind !== "ok") throw new Error(JSON.stringify(r));
      expect(byId(r.data, w.alice).warnings).toEqual([{ kind: "blocked_out", date: sundayDay }]);
      expect(byId(r.data, w.bob).warnings).toEqual([{ kind: "same_day", position: "Vocals" }]);
      expect(byId(r.data, w.leader).warnings).toEqual(
        expect.arrayContaining([{ kind: "same_day", position: "Vocals" }, { kind: "overlap", title: "Overlapping service" }]),
      );
      // A decline is not "already scheduled": only the decline itself is flagged.
      expect(byId(r.data, w.child).warnings).toEqual([{ kind: "declined_this_service" }]);
      expect(byId(r.data, w.child).info).toEqual([{ kind: "may_be_under_18" }]);
      expect(byId(r.data, w.alice).info).toEqual([]);
      // Nobody is removed for a warning: the same people come back.
      expect(r.data).toHaveLength(4 - 0);
    });

    it("excludes anyone already live in this position on this service, and merged, deceased or ended-relationship people; withdrawn frees them", async () => {
      const w = await t.build("p3");
      const aliceRow = await put(w, w.alice, w.sunday, w.drums, "draft");
      await t.q(sql`update people set date_of_death = current_date - 1 where id = ${w.child}`);
      await t.q(sql`update people set merged_into_id = ${w.plain} where id = ${w.bob}`);
      const r = await reads.getPickerCandidates(v(w.scheduler, w), input(w));
      if (r.kind !== "ok") throw new Error("read");
      expect(r.data.map((c) => c.personId)).toEqual([w.leader]);
      await t.inOrg(w.org, (tx) => tx.execute(sql`update worship_assignments set status = 'withdrawn', withdrawn_by_person_id = ${w.scheduler}, withdrawn_reason = 'removed' where id = ${aliceRow}`));
      const again = await reads.getPickerCandidates(v(w.scheduler, w), input(w));
      if (again.kind !== "ok") throw new Error("read");
      expect(again.data.map((c) => c.personId).sort()).toEqual([w.alice, w.leader].sort());
      await t.q(sql`update people set merged_into_id = null where id = ${w.bob}`);
    });

    it("authority is per team: a leader picks for their own team only; manage, plan and a plain member are forbidden; foreign ids are not found", async () => {
      const w = await t.build("p4");
      expect((await reads.getPickerCandidates(v(w.leader, w), input(w))).kind).toBe("ok");
      expect(await reads.getPickerCandidates(v(w.leader, w), input(w, { groupId: w.choir, positionId: w.soprano }))).toEqual({ kind: "forbidden" });
      for (const who of [w.manager, w.planner, w.plain]) expect(await reads.getPickerCandidates(v(who, w), input(w)), who).toEqual({ kind: "forbidden" });
      const other = await t.build("p4other");
      expect(await reads.getPickerCandidates(v(w.scheduler, w), input(w, { eventId: other.sunday }))).toEqual({ kind: "not_found" });
      expect(await reads.getPickerCandidates(v(w.scheduler, w), input(w, { positionId: other.drums }))).toEqual({ kind: "not_found" });
      expect(await reads.getPickerCandidates(v(w.scheduler, w), input(w, { positionId: w.soprano }))).toEqual({ kind: "not_found" });
    });

    it("NO N+1: two statements for the facts however many people are on the team", async () => {
      const small = await t.build("p5a");
      const big = await t.build("p5b");
      for (let i = 0; i < 10; i += 1) {
        const p = await t.person(big.org, `Roster${i}`);
        await t.onRoster(big.org, big.band, p);
        if (i % 2 === 0) await t.draft(big, p, big.midweek, big.vocals);
      }
      const a = await statements(() => reads.getPickerCandidates(v(small.scheduler, small), input(small)));
      const b = await statements(() => reads.getPickerCandidates(v(big.scheduler, big), input(big)));
      expect(a.result.kind).toBe("ok");
      expect(b.result.kind).toBe("ok");
      expect(b.count).toBe(a.count);
      if (b.result.kind === "ok") expect(b.result.data.length).toBeGreaterThanOrEqual(12);
    });
  });

  // -------------------------------------------------------------------------
  describe("presby_worship_open_count behind the Features warning", () => {
    it("counts distinct PEOPLE with a requested or confirmed assignment on an upcoming, uncancelled service - not drafts, decliners, guests, past or cancelled", async () => {
      const w = await t.build("o1");
      const featureManager = await t.person(w.org, "Featmgr", ["org_features.manage"]);
      const count = () =>
        import("@/lib/authz").then(({ withOrgContext }) => withOrgContext(featureManager, w.org, (tx) => reads.countUpcomingScheduled(tx)));
      expect(await count()).toBe(0);
      await put(w, w.alice, w.sunday, w.drums, "requested");
      await put(w, w.alice, w.midweek, w.vocals, "confirmed", { onBehalf: true }); // the same person twice: one
      await put(w, w.bob, w.sunday, w.vocals, "confirmed", { onBehalf: true });
      await put(w, w.leader, w.sunday, w.vocals, "draft"); //   not counted
      await put(w, w.child, w.later, w.vocals, "declined"); //   not counted
      await store.placeGuest(v(w.scheduler, w), { eventId: w.sunday, groupId: w.choir, positionId: w.soprano, guestName: "Visiting organist" }); // not a person
      expect(await count()).toBe(2);
      await t.q(sql`update events set cancelled_at = now() where id = ${w.sunday}`);
      expect(await count()).toBe(1);
      await t.q(sql`update events set starts_at = presby_worship_org_now(${w.org}) - interval '1 hour' where id = ${w.midweek}`);
      expect(await count()).toBe(0);
    });

    it("is scoped to the current organization, and a person without org_features.manage still reads the bare count through the definer", async () => {
      const w = await t.build("o2");
      const other = await t.build("o2other");
      await put(other, other.alice, other.sunday, other.drums, "requested");
      const { withOrgContext } = await import("@/lib/authz");
      expect(await withOrgContext(w.plain, w.org, (tx) => reads.countUpcomingScheduled(tx))).toBe(0);
      await put(w, w.alice, w.sunday, w.drums, "requested");
      expect(await withOrgContext(w.plain, w.org, (tx) => reads.countUpcomingScheduled(tx))).toBe(1);
      expect(await withOrgContext(other.plain, other.org, (tx) => reads.countUpcomingScheduled(tx))).toBe(1);
    });
  });
});
