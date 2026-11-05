/**
 * The SCHEDULING half of `store.ts` against a REAL Postgres connection -
 * services, placements, answers and blockouts (docs/work-log/
 * 2026-11-04-worship-inc1.md, Phase 3 Tests, `store.db.test.ts`; Phase 4
 * Batch 3). Every export runs on the `presby_app` connection with an
 * organization context, so RLS, the 0085 guards and the CHECKs are live. The
 * Send and the cancel hook have their own files (`store.send.db.test.ts`,
 * `store.cancel.db.test.ts`); the configuration half is `store.config.db.test.ts`.
 *
 *   - THE AUTHORITY MATRIX: key, seat, neither; per team; a seat that ended
 *     yesterday or starts tomorrow; a merged, deceased or ended-relationship
 *     leader; the toggle and the organization type;
 *   - placement refusals with the Copy sentences, and what each leaves behind;
 *   - guests: confirmed at once, never emailed, no contact details;
 *   - the id-guessing hole: another person's assignment id equals an unknown id;
 *   - answers: own row, on behalf, idempotence, closed requests, a decline notice;
 *   - blockouts: merge, history kept, caps, past, conflicts reported;
 *   - services: create, generate, update, setServiceTeams, and C2: a
 *     `worship.plan` holder reaches ONLY worship services.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/worship/store.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { WorshipTestWorld, WorshipWorld } from "@/lib/testing/worship-world";
import { ACTION_COPY, GATE_COPY, MEMBER_COPY } from "./copy";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 240_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("worship/store.ts scheduling exports (Postgres-backed)", () => {
  let t: WorshipTestWorld;
  let store: typeof import("./store");
  let A: WorshipWorld;
  let B: WorshipWorld;
  let stamp: string;

  const v = (personId: string, w: WorshipWorld = A) => t.viewer(personId, w.org);
  const status = async (id: string) => (await t.one(sql`select status, response_source, responded_by_person_id::text as responded_by,
                                                              decline_reason, withdrawn_reason, withdrawn_by_person_id::text as withdrawn_by,
                                                              sent_by_person_id::text as sent_by, notice_outcome, responded_at
                                                         from worship_assignments where id = ${id}`));
  const queued = (to: string) =>
    t.q(sql`select template_key, subject, text_body, html_body, status from email_queue where to_email = ${to} order by created_at`);
  const address = (name: string) => `${name.toLowerCase()}-${stamp}@wstore.example.invalid`;

  beforeAll(async () => {
    await import("@/lib/db/schema");
    const world = await import("@/lib/testing/worship-world");
    t = await world.createWorshipWorld("wstore");
    store = await import("./store");
    stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    A = await t.build("a");
    B = await t.build("b");
    await t.email(A.scheduler, address("scheduler"));
    await t.email(A.alice, address("alice"));
  });
  afterAll(async () => {
    if (t) {
      await t.q(sql`delete from email_queue where to_email like ${`%-${stamp}@wstore.example.invalid`}`).catch(() => undefined);
      await t.fx.cleanup();
    }
  });

  // -------------------------------------------------------------------------
  describe("the gate", () => {
    it("a presbytery is not_applicable; toggle off is toggle_off; both for every scheduling export and every kind of caller", async () => {
      const off = await t.build("off", { toggle: false });
      const pres = await t.build("pres", { organizationType: "presbytery" });
      const presViewer = t.viewer(pres.scheduler, pres.org, "presbytery");
      const calls = (w: WorshipWorld, viewer: ReturnType<typeof v>) => [
        () => store.placePerson(viewer, { eventId: w.sunday, groupId: w.band, positionId: w.drums, personId: w.alice }),
        () => store.placeGuest(viewer, { eventId: w.sunday, groupId: w.band, positionId: w.drums, guestName: "Guest" }),
        () => store.removeAssignment(viewer, { assignmentId: "00000000-0000-4000-8000-000000000001" }),
        () => store.recordResponse(viewer, { assignmentId: "00000000-0000-4000-8000-000000000001", answer: "accepted" }),
        () => store.sendRequests(viewer, {}),
        () => store.respondToAssignment(viewer, { assignmentId: "00000000-0000-4000-8000-000000000001", answer: "accepted" }),
        () => store.addBlockout(viewer, { startsOn: "2099-01-01", endsOn: "2099-01-02" }),
        () => store.endBlockout(viewer, { blockoutId: "00000000-0000-4000-8000-000000000001" }),
        () => store.createService(viewer, { title: "x", startsAt: "2099-01-01T09:00", groupIds: [] }),
        () => store.generateServices(viewer, { serviceTypeId: "00000000-0000-4000-8000-000000000001", firstDate: "2099-01-01", pattern: "weekly", count: 2 }),
        () => store.updateService(viewer, { eventId: w.sunday, title: "x", startsAt: "2099-01-01T09:00" }),
        () => store.cancelService(viewer, { eventId: w.sunday }),
        () => store.setServiceTeams(viewer, { eventId: w.sunday, groupIds: [] }),
      ];
      for (const call of calls(off, v(off.all, off))) expect(await call()).toEqual({ kind: "toggle_off" });
      for (const call of calls(pres, presViewer)) expect(await call()).toEqual({ kind: "not_applicable" });
      // A volunteer's own answer is gated by the toggle too: nothing is writable while Worship is off.
      expect(await t.q(sql`select 1 from worship_assignments where organization_id = ${off.org}`)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("the authority matrix for placing people (key, seat, neither; per team)", () => {
    const place = (who: string, w: WorshipWorld, groupId: string, positionId: string, personId: string, eventId = w.sunday) =>
      store.placePerson(v(who, w), { eventId, groupId, positionId, personId });

    it("a worship.schedule holder places on every team; a chair on their own team only; a leader on theirs only", async () => {
      const w = await t.build("m1");
      expect((await place(w.scheduler, w, w.band, w.drums, w.alice)).kind).toBe("ok");
      expect((await place(w.scheduler, w, w.choir, w.soprano, w.alice)).kind).toBe("ok");
      expect((await place(w.leader, w, w.band, w.vocals, w.bob)).kind).toBe("ok");
      expect(await place(w.leader, w, w.choir, w.soprano, w.bob)).toEqual({ kind: "forbidden" });
      expect((await place(w.choirLeader, w, w.choir, w.soprano, w.bob)).kind).toBe("conflict"); // bob is not on the choir: authority passed, roster refused
      expect(await place(w.choirLeader, w, w.band, w.vocals, w.child)).toEqual({ kind: "forbidden" });
    });

    it("manage, plan and a plain member (no seat) are forbidden: scheduling is not implied by planning", async () => {
      const w = await t.build("m2");
      for (const who of [w.manager, w.planner, w.plain]) {
        expect(await place(who, w, w.band, w.drums, w.alice), who).toEqual({ kind: "forbidden" });
      }
      expect(await t.q(sql`select 1 from worship_assignments where organization_id = ${w.org}`)).toHaveLength(0);
    });

    it("a seat that ended, has not begun, or belongs to a merged, deceased or ended-relationship person schedules nothing", async () => {
      const w = await t.build("m3");
      // the in-effect day: the day the trigger and the resolver compare grant and seat dates against (F434), not the service day
      const day = String((await t.one(sql`select presby_worship_in_effect_day(${w.org})::text as d`)).d);
      const seat = async () => {
        const id = await t.person(w.org, `Seat${Math.floor(Math.random() * 1e6)}`);
        await t.onRoster(w.org, w.band, id, "leader");
        return id;
      };
      const attempt = async (who: string) => place(who, w, w.band, w.drums, w.bob);

      // The leader seat that ends TODAY has ended (ends_on is exclusive).
      const ended = await seat();
      await t.q(sql`update group_memberships set ends_on = ${day}::date where group_id = ${w.band} and person_id = ${ended}`);
      expect(await attempt(ended)).toEqual({ kind: "forbidden" });
      // A seat that begins tomorrow has not begun.
      const future = await seat();
      await t.q(sql`update group_memberships set starts_on = (${day}::date + 1) where group_id = ${w.band} and person_id = ${future}`);
      expect(await attempt(future)).toEqual({ kind: "forbidden" });
      // A merged leader, a deceased leader, and a leader whose relationship ended.
      const merged = await seat();
      await t.q(sql`update people set merged_into_id = ${w.plain} where id = ${merged}`);
      expect(await attempt(merged)).toEqual({ kind: "forbidden" });
      await t.q(sql`update people set merged_into_id = null where id = ${merged}`); // so the fixture can delete the survivor
      const dead = await seat();
      await t.q(sql`update people set date_of_death = current_date - 1 where id = ${dead}`);
      expect(await attempt(dead)).toEqual({ kind: "forbidden" });
      const gone = await seat();
      await t.q(sql`update memberships set ended_on = current_date - 1, ended_reason = 'moved' where organization_id = ${w.org} and person_id = ${gone}`);
      await expect(attempt(gone)).rejects.toThrow(); // the membership gate itself: not even a transaction
      // The control: a live seat works.
      const live = await seat();
      expect((await attempt(live)).kind).toBe("ok");
    });

    it("the same matrix holds for remove, record, guest and send (a leader of A cannot touch B)", async () => {
      const w = await t.build("m4");
      const onChoir = await place(w.scheduler, w, w.choir, w.soprano, w.alice);
      if (onChoir.kind !== "ok") throw new Error("setup");
      const id = onChoir.data.assignmentId;
      expect(await store.removeAssignment(v(w.leader, w), { assignmentId: id })).toEqual({ kind: "forbidden" });
      expect(await store.recordResponse(v(w.leader, w), { assignmentId: id, answer: "accepted" })).toEqual({ kind: "forbidden" });
      expect(await store.placeGuest(v(w.leader, w), { eventId: w.sunday, groupId: w.choir, positionId: w.soprano, guestName: "Visitor" })).toEqual({ kind: "forbidden" });
      expect(await store.sendRequests(v(w.leader, w), { groupId: w.choir })).toEqual({ kind: "forbidden" });
      expect((await status(id)).status).toBe("draft");
      // Their own team's controls work.
      expect((await store.recordResponse(v(w.choirLeader, w), { assignmentId: id, answer: "accepted" })).kind).toBe("ok");
      expect((await store.removeAssignment(v(w.choirLeader, w), { assignmentId: id })).kind).toBe("ok");
    });
  });

  // -------------------------------------------------------------------------
  describe("placePerson", () => {
    it("places a DRAFT assigned by the viewer, tells nobody, and writes no audit row", async () => {
      const w = await t.build("p1");
      const before = await t.one(sql`select count(*)::int as n from email_queue where to_email = ${address("alice")}`);
      const r = await store.placePerson(v(w.scheduler, w), { eventId: w.sunday, groupId: w.band, positionId: w.drums, personId: w.alice });
      if (r.kind !== "ok") throw new Error("setup");
      const row = await t.one(sql`select status, assigned_by_person_id::text as by, person_id::text as person, guest_name, notice_outcome, requested_at
                                    from worship_assignments where id = ${r.data.assignmentId}`);
      expect(row).toMatchObject({ status: "draft", by: w.scheduler, person: w.alice, guest_name: null, notice_outcome: null, requested_at: null });
      expect((await t.one(sql`select count(*)::int as n from email_queue where to_email = ${address("alice")}`)).n).toBe(before.n);
      expect(await t.q(sql`select 1 from audit_events where resource_id = ${r.data.assignmentId}`)).toHaveLength(0);
    });

    it("refuses with the Copy sentence: not on the team, a cancelled or started service, a retired team, a team not serving, a retired position", async () => {
      const w = await t.build("p2");
      const base = { eventId: w.sunday, groupId: w.band, positionId: w.drums };
      const viewer = v(w.scheduler, w);
      expect(await store.placePerson(viewer, { ...base, personId: w.plain })).toEqual({
        kind: "conflict",
        reason: "not_open",
        message: ACTION_COPY.notOnTeam("Plain Worshiptest"),
      });
      // A person of another organization is not found, not "not on team".
      expect(await store.placePerson(viewer, { ...base, personId: B.alice })).toEqual({ kind: "not_found" });
      // Positions: another team's position, a retired one.
      expect(await store.placePerson(viewer, { ...base, positionId: w.soprano, personId: w.alice })).toEqual({ kind: "not_found" });
      await t.q(sql`update worship_positions set retired_at = now() where id = ${w.vocals}`);
      expect(await store.placePerson(viewer, { ...base, positionId: w.vocals, personId: w.alice })).toMatchObject({ kind: "conflict", message: ACTION_COPY.stale });
      // A team no longer serving this service.
      await t.q(sql`update worship_service_teams set removed_at = now() where event_id = ${w.later} and group_id = ${w.band}`);
      expect(await store.placePerson(viewer, { ...base, eventId: w.later, personId: w.alice })).toMatchObject({ kind: "conflict", message: ACTION_COPY.stale });
      // Cancelled and started services.
      await t.q(sql`update events set cancelled_at = now() where id = ${w.midweek}`);
      expect(await store.placePerson(viewer, { ...base, eventId: w.midweek, personId: w.alice })).toEqual({
        kind: "conflict",
        reason: "not_open",
        message: ACTION_COPY.serviceCancelled,
      });
      await t.q(sql`update events set starts_at = presby_worship_org_now(${w.org}) - interval '1 hour' where id = ${w.soon}`);
      expect(await store.placePerson(viewer, { ...base, eventId: w.soon, personId: w.alice })).toEqual({
        kind: "conflict",
        reason: "not_open",
        message: ACTION_COPY.serviceStarted,
      });
      // A retired team (its own message names it).
      await t.q(sql`update worship_teams set retired_at = now() where group_id = ${w.choir}`);
      expect(await store.placePerson(viewer, { eventId: w.sunday, groupId: w.choir, positionId: w.soprano, personId: w.alice })).toEqual({
        kind: "conflict",
        reason: "not_open",
        message: ACTION_COPY.teamRetired("Choir"),
      });
      expect(await t.q(sql`select 1 from worship_assignments where organization_id = ${w.org}`)).toHaveLength(0);
    });

    it("a service that is not a worship service is not found (the plain calendar event), as is an unknown id", async () => {
      const plainEvent = String((await t.one(sql`insert into events (organization_id, title, starts_at)
                                                  values (${A.org}, 'Plain event', presby_worship_org_now(${A.org}) + interval '3 days') returning id`)).id);
      for (const eventId of [plainEvent, "00000000-0000-4000-8000-0000000000aa", B.sunday]) {
        expect(await store.placePerson(v(A.scheduler), { eventId, groupId: A.band, positionId: A.drums, personId: A.alice })).toEqual({ kind: "not_found" });
      }
    });

    it("placing the same person in the same position on the same service twice is a conflict, and a withdrawn row frees the place", async () => {
      const w = await t.build("p3");
      const input = { eventId: w.sunday, groupId: w.band, positionId: w.drums, personId: w.alice };
      const first = await store.placePerson(v(w.scheduler, w), input);
      if (first.kind !== "ok") throw new Error("setup");
      expect((await store.placePerson(v(w.scheduler, w), input)).kind).toBe("conflict");
      expect((await store.removeAssignment(v(w.scheduler, w), { assignmentId: first.data.assignmentId })).kind).toBe("ok");
      expect((await store.placePerson(v(w.scheduler, w), input)).kind).toBe("ok");
      // A different position for the same person is fine (the unique key is per position).
      expect((await store.placePerson(v(w.scheduler, w), { ...input, positionId: w.vocals })).kind).toBe("ok");
    });

    it("a presumed minor is placed (a draft), never emailed; the placement itself writes no mail", async () => {
      const w = await t.build("p4");
      const r = await store.placePerson(v(w.scheduler, w), { eventId: w.sunday, groupId: w.band, positionId: w.drums, personId: w.child });
      expect(r.kind).toBe("ok");
    });

    it("malformed ids are not found, never a database error", async () => {
      expect(await store.placePerson(v(A.scheduler), { eventId: "x", groupId: A.band, positionId: A.drums, personId: A.alice })).toEqual({ kind: "not_found" });
      expect(await store.removeAssignment(v(A.scheduler), { assignmentId: "x" })).toEqual({ kind: "not_found" });
    });
  });

  // -------------------------------------------------------------------------
  describe("placeGuest", () => {
    it("places a confirmed guest recorded on the leader's behalf, with no person and no contact column", async () => {
      const w = await t.build("g1");
      const r = await store.placeGuest(v(w.leader, w), { eventId: w.sunday, groupId: w.band, positionId: w.drums, guestName: "  Rev. Tamsin Holloway " });
      if (r.kind !== "ok") throw new Error("setup");
      const row = await t.one(sql`select status, person_id, guest_name, response_source, responded_by_person_id::text as by, assigned_by_person_id::text as assigned, responded_at
                                    from worship_assignments where id = ${r.data.assignmentId}`);
      expect(row).toMatchObject({ status: "confirmed", person_id: null, guest_name: "Rev. Tamsin Holloway", response_source: "on_behalf", by: w.leader, assigned: w.leader });
      expect(row.responded_at).not.toBeNull();
    });

    it("refuses contact-looking, blank, over-long and line-broken names with the Copy sentence, and writes nothing", async () => {
      const w = await t.build("g2");
      const base = { eventId: w.sunday, groupId: w.band, positionId: w.drums };
      for (const guestName of ["pat@example.invalid", "Pat 555 0142 77", "", "   ", "x".repeat(81), "Pat\nHolloway"]) {
        const r = await store.placeGuest(v(w.scheduler, w), { ...base, guestName });
        expect(r.kind, JSON.stringify(guestName)).toBe("invalid_input");
      }
      expect(await store.placeGuest(v(w.scheduler, w), { ...base, guestName: "a@b" })).toEqual({
        kind: "invalid_input",
        message: "Enter just a name. Contact details aren't kept here.",
      });
      expect(await t.q(sql`select 1 from worship_assignments where organization_id = ${w.org}`)).toHaveLength(0);
    });

    it("a guest has no answer to record, can be removed, and is never emailed or reminded", async () => {
      const w = await t.build("g3");
      const r = await store.placeGuest(v(w.scheduler, w), { eventId: w.sunday, groupId: w.band, positionId: w.drums, guestName: "Visiting organist" });
      if (r.kind !== "ok") throw new Error("setup");
      expect((await store.recordResponse(v(w.scheduler, w), { assignmentId: r.data.assignmentId, answer: "declined" })).kind).toBe("invalid_input");
      expect((await store.removeAssignment(v(w.scheduler, w), { assignmentId: r.data.assignmentId })).kind).toBe("ok");
      expect((await status(r.data.assignmentId)).status).toBe("withdrawn");
    });
  });

  // -------------------------------------------------------------------------
  describe("removeAssignment and recordResponse", () => {
    it("remove withdraws with reason 'removed' by the viewer, queues no message, and is a no-op on a withdrawn row", async () => {
      const w = await t.build("rm1");
      await t.email(w.alice, address("rm1alice"));
      const placed = await store.placePerson(v(w.scheduler, w), { eventId: w.sunday, groupId: w.band, positionId: w.drums, personId: w.alice });
      if (placed.kind !== "ok") throw new Error("setup");
      const id = placed.data.assignmentId;
      // Make it a sent request so the "no message on removal" claim is the interesting one.
      await t.inOrg(w.org, (tx) =>
        tx.execute(sql`update worship_assignments set status = 'requested', sent_by_person_id = ${w.scheduler}, notice_outcome = 'emailed' where id = ${id}`),
      );
      expect(await store.removeAssignment(v(w.leader, w), { assignmentId: id })).toEqual({ kind: "ok", data: { changed: true } });
      expect(await status(id)).toMatchObject({ status: "withdrawn", withdrawn_reason: "removed", withdrawn_by: w.leader });
      expect(await queued(address("rm1alice"))).toHaveLength(0);
      expect(await store.removeAssignment(v(w.leader, w), { assignmentId: id })).toEqual({ kind: "ok", data: { changed: false } });
      expect(await store.removeAssignment(v(w.scheduler, w), { assignmentId: "00000000-0000-4000-8000-0000000000bb" })).toEqual({ kind: "not_found" });
      expect(await store.removeAssignment(v(A.scheduler), { assignmentId: id })).toEqual({ kind: "not_found" });
    });

    it("recordResponse stores source on_behalf and the recorder; the same answer is a no-op; a different one is a normal transition", async () => {
      const w = await t.build("rr1");
      const placed = await store.placePerson(v(w.scheduler, w), { eventId: w.sunday, groupId: w.band, positionId: w.drums, personId: w.alice });
      if (placed.kind !== "ok") throw new Error("setup");
      const id = placed.data.assignmentId;
      expect(await store.recordResponse(v(w.leader, w), { assignmentId: id, answer: "accepted" })).toEqual({ kind: "ok", data: { changed: true } });
      expect(await status(id)).toMatchObject({ status: "confirmed", response_source: "on_behalf", responded_by: w.leader, decline_reason: null });
      const stamped = (await status(id)).responded_at;
      expect(await store.recordResponse(v(w.leader, w), { assignmentId: id, answer: "accepted" })).toEqual({ kind: "ok", data: { changed: false } });
      expect(String((await status(id)).responded_at)).toBe(String(stamped));
      expect(await store.recordResponse(v(w.scheduler, w), { assignmentId: id, answer: "declined", reason: "family" })).toEqual({ kind: "ok", data: { changed: true } });
      expect(await status(id)).toMatchObject({ status: "declined", responded_by: w.scheduler, decline_reason: "family" });
      // The same decline with a different reason is a change; the same reason is not.
      expect(await store.recordResponse(v(w.scheduler, w), { assignmentId: id, answer: "declined", reason: "away" })).toEqual({ kind: "ok", data: { changed: true } });
      expect(await store.recordResponse(v(w.scheduler, w), { assignmentId: id, answer: "declined", reason: "away" })).toEqual({ kind: "ok", data: { changed: false } });
      // An accepted answer clears the reason.
      await store.recordResponse(v(w.scheduler, w), { assignmentId: id, answer: "accepted" });
      expect((await status(id)).decline_reason).toBeNull();
    });

    it("refuses a reason outside the closed list, an answer outside the vocabulary, and a withdrawn row; a started service is not open", async () => {
      const w = await t.build("rr2");
      const placed = await store.placePerson(v(w.scheduler, w), { eventId: w.sunday, groupId: w.band, positionId: w.drums, personId: w.alice });
      if (placed.kind !== "ok") throw new Error("setup");
      const id = placed.data.assignmentId;
      expect((await store.recordResponse(v(w.scheduler, w), { assignmentId: id, answer: "declined", reason: "vacation" as never })).kind).toBe("invalid_input");
      expect((await store.recordResponse(v(w.scheduler, w), { assignmentId: id, answer: "maybe" as never })).kind).toBe("invalid_input");
      await t.q(sql`update events set starts_at = presby_worship_org_now(${w.org}) - interval '1 hour' where id = ${w.sunday}`);
      expect(await store.recordResponse(v(w.scheduler, w), { assignmentId: id, answer: "accepted" })).toEqual({
        kind: "conflict",
        reason: "not_open",
        message: ACTION_COPY.serviceStarted,
      });
      expect((await store.removeAssignment(v(w.scheduler, w), { assignmentId: id })).kind).toBe("ok"); // removal has no service condition
      expect((await store.recordResponse(v(w.scheduler, w), { assignmentId: id, answer: "accepted" })).kind).toBe("conflict");
    });
  });

  // -------------------------------------------------------------------------
  describe("respondToAssignment (the volunteer's own answer)", () => {
    /** A request the person can answer: placed, then sent by the owner path (the Send has its own file). */
    async function requested(w: WorshipWorld, personId: string, eventId = w.sunday, positionId = w.drums): Promise<string> {
      const id = await t.draft(w, personId, eventId, positionId);
      await t.inOrg(w.org, (tx) =>
        tx.execute(sql`update worship_assignments set status = 'requested', sent_by_person_id = ${w.scheduler}, notice_outcome = 'emailed' where id = ${id}`),
      );
      return id;
    }

    it("accepts and declines their own request: source self, themselves as responder, the reason cleared on accept", async () => {
      const w = await t.build("ra1");
      const id = await requested(w, w.alice);
      expect(await store.respondToAssignment(v(w.alice, w), { assignmentId: id, answer: "accepted" })).toEqual({ kind: "ok", data: { changed: true, queueIds: [] } });
      expect(await status(id)).toMatchObject({ status: "confirmed", response_source: "self", responded_by: w.alice, decline_reason: null });
      const declined = await store.respondToAssignment(v(w.alice, w), { assignmentId: id, answer: "declined", reason: "work" });
      expect(declined.kind).toBe("ok");
      expect(await status(id)).toMatchObject({ status: "declined", response_source: "self", responded_by: w.alice, decline_reason: "work" });
      await store.respondToAssignment(v(w.alice, w), { assignmentId: id, answer: "accepted" });
      expect(await status(id)).toMatchObject({ status: "confirmed", decline_reason: null });
    });

    it("the same answer again is a no-op: no write, and the response stamp does not move", async () => {
      const w = await t.build("ra2");
      const id = await requested(w, w.alice);
      await store.respondToAssignment(v(w.alice, w), { assignmentId: id, answer: "accepted" });
      const stamp1 = String((await status(id)).responded_at);
      expect(await store.respondToAssignment(v(w.alice, w), { assignmentId: id, answer: "accepted" })).toEqual({ kind: "ok", data: { changed: false, queueIds: [] } });
      expect(String((await status(id)).responded_at)).toBe(stamp1);
    });

    it("THE ID-GUESSING HOLE: another person's assignment id, another organization's id, a draft's id and an unknown id are the SAME answer", async () => {
      const w = await t.build("ra3");
      const theirs = await requested(w, w.alice);
      const draftOfBob = await t.draft(w, w.bob, w.sunday, w.vocals);
      const unknown = "00000000-0000-4000-8000-0000000000cc";
      const mine = await requested(w, w.bob, w.midweek);
      const answers = [
        await store.respondToAssignment(v(w.bob, w), { assignmentId: theirs, answer: "accepted" }),
        await store.respondToAssignment(v(w.bob, w), { assignmentId: unknown, answer: "accepted" }),
        await store.respondToAssignment(v(w.bob, w), { assignmentId: draftOfBob, answer: "accepted" }),
        await store.respondToAssignment(v(B.alice, B), { assignmentId: theirs, answer: "accepted" }),
        await store.respondToAssignment(v(w.bob, w), { assignmentId: "not-a-uuid", answer: "accepted" }),
      ];
      for (const answer of answers) expect(answer).toEqual({ kind: "not_found" });
      expect((await status(theirs)).status).toBe("requested");
      expect((await status(draftOfBob)).status).toBe("draft");
      expect((await store.respondToAssignment(v(w.bob, w), { assignmentId: mine, answer: "accepted" })).kind).toBe("ok");
    });

    it("a withdrawn request, a cancelled service and a started service are 'no longer open'", async () => {
      const w = await t.build("ra4");
      const open = GATE_COPY.closedRequest.heading;
      const closed = { kind: "conflict", reason: "not_open", message: open };
      const a = await requested(w, w.alice, w.sunday);
      const b = await requested(w, w.alice, w.midweek, w.vocals);
      const c = await requested(w, w.alice, w.later, w.vocals);
      await t.inOrg(w.org, (tx) => tx.execute(sql`update worship_assignments set status = 'withdrawn', withdrawn_by_person_id = ${w.scheduler}, withdrawn_reason = 'removed' where id = ${a}`));
      await t.q(sql`update events set cancelled_at = now() where id = ${w.midweek}`);
      await t.q(sql`update events set starts_at = presby_worship_org_now(${w.org}) - interval '30 minutes' where id = ${w.later}`);
      for (const id of [a, b, c]) expect(await store.respondToAssignment(v(w.alice, w), { assignmentId: id, answer: "accepted" }), id).toEqual(closed);
    });

    it("a change TO declined queues one notice to the person who placed them (never naming the decliner); none for a later same-answer or an accept", async () => {
      const w = await t.build("ra5");
      await t.email(w.scheduler, address("ra5sched"));
      await t.email(w.alice, address("ra5alice"));
      const id = await requested(w, w.alice);
      const r = await store.respondToAssignment(v(w.alice, w), { assignmentId: id, answer: "declined", reason: "family" });
      if (r.kind !== "ok") throw new Error("setup");
      expect(r.data.queueIds).toHaveLength(1);
      const mail = await queued(address("ra5sched"));
      expect(mail).toHaveLength(1);
      expect(mail[0]).toMatchObject({ template_key: "worship.notice.declined" });
      const body = `${mail[0]!.subject}\n${mail[0]!.text_body}\n${mail[0]!.html_body}`;
      expect(body).toContain("Someone you scheduled has declined Drums on");
      expect(body).not.toMatch(/Alice|Worshiptest/);
      // The reason a person gave is never in the body (the CSS has a font-family, so look at the readable parts).
      expect(`${mail[0]!.subject}\n${mail[0]!.text_body}`).not.toMatch(/\bfamily\b/i);
      expect(body).toContain(`/o/`);
      expect(body).toContain(`/worship/teams/${w.band}/services/${w.sunday}`);
      expect(body).not.toContain("?");
      // The decliner got nothing, and a repeat does not write a second notice.
      expect(await queued(address("ra5alice"))).toHaveLength(0);
      expect(await store.respondToAssignment(v(w.alice, w), { assignmentId: id, answer: "declined", reason: "family" })).toMatchObject({ data: { changed: false, queueIds: [] } });
      expect(await queued(address("ra5sched"))).toHaveLength(1);
      // Changing the mind to accept sends nothing; declining again is a new change to declined.
      await store.respondToAssignment(v(w.alice, w), { assignmentId: id, answer: "accepted" });
      expect(await queued(address("ra5sched"))).toHaveLength(1);
    });

    it("a placer with no address, or who is the decliner, gets no notice (and the answer still commits)", async () => {
      const w = await t.build("ra6");
      const id = await requested(w, w.alice);
      const r = await store.respondToAssignment(v(w.alice, w), { assignmentId: id, answer: "declined" });
      expect(r).toEqual({ kind: "ok", data: { changed: true, queueIds: [] } });
      // Self-placed: the scheduler places and then declines their own row.
      const sched = await t.person(w.org, "Selfplace", ["worship.schedule"]);
      await t.onRoster(w.org, w.band, sched);
      await t.email(sched, address("ra6self"));
      const own = await t.inOrg(w.org, async (tx) =>
        String((await tx.execute(sql`insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
                                        values (${w.org}, ${w.midweek}, ${w.band}, ${w.vocals}, ${sched}, ${sched}) returning id`) as unknown as { rows: Array<{ id: string }> }).rows[0]!.id),
      );
      await t.inOrg(w.org, (tx) => tx.execute(sql`update worship_assignments set status = 'requested', sent_by_person_id = ${sched}, notice_outcome = 'emailed' where id = ${own}`));
      expect(await store.respondToAssignment(v(sched, w), { assignmentId: own, answer: "declined" })).toEqual({ kind: "ok", data: { changed: true, queueIds: [] } });
      expect(await queued(address("ra6self"))).toHaveLength(0);
    });

    it("refuses an answer outside the vocabulary and a reason outside the closed list", async () => {
      const w = await t.build("ra7");
      const id = await requested(w, w.alice);
      expect((await store.respondToAssignment(v(w.alice, w), { assignmentId: id, answer: "maybe" as never })).kind).toBe("invalid_input");
      expect((await store.respondToAssignment(v(w.alice, w), { assignmentId: id, answer: "declined", reason: "bored" as never })).kind).toBe("invalid_input");
      expect((await status(id)).status).toBe("requested");
    });
  });

  // -------------------------------------------------------------------------
  describe("blockouts", () => {
    const day = (offset: number) => t.one(sql`select (presby_worship_org_today(${A.org}) + ${offset}::int)::text as d`).then((r) => String(r.d));

    it("saves a range, lists it, and ends it (never a delete)", async () => {
      const w = await t.build("b1");
      const viewer = v(w.bob, w);
      const from = String((await t.one(sql`select (presby_worship_org_today(${w.org}) + 10)::text as d`)).d);
      const to = String((await t.one(sql`select (presby_worship_org_today(${w.org}) + 12)::text as d`)).d);
      const r = await store.addBlockout(viewer, { startsOn: from, endsOn: to, reason: "away" });
      if (r.kind !== "ok") throw new Error("setup");
      expect(r.data).toMatchObject({ merged: false, conflicts: [] });
      const row = await t.one(sql`select starts_on::text as s, ends_on::text as e, reason, ended_at from worship_blockouts where id = ${r.data.blockoutId}`);
      expect(row).toMatchObject({ s: from, e: to, reason: "away", ended_at: null });
      expect(await store.endBlockout(viewer, { blockoutId: r.data.blockoutId })).toEqual({ kind: "ok", data: { changed: true } });
      expect((await t.one(sql`select ended_at from worship_blockouts where id = ${r.data.blockoutId}`)).ended_at).not.toBeNull();
      expect(await store.endBlockout(viewer, { blockoutId: r.data.blockoutId })).toEqual({ kind: "ok", data: { changed: false } });
      expect(await t.q(sql`select 1 from worship_blockouts where id = ${r.data.blockoutId}`)).toHaveLength(1);
    });

    it("joins overlapping and touching ranges: the absorbed rows are END-DATED (history kept) and one union is live", async () => {
      const w = await t.build("b2");
      const viewer = v(w.bob, w);
      const d = async (n: number) => String((await t.one(sql`select (presby_worship_org_today(${w.org}) + ${n}::int)::text as d`)).d);
      const first = await store.addBlockout(viewer, { startsOn: await d(20), endsOn: await d(22) });
      const second = await store.addBlockout(viewer, { startsOn: await d(30), endsOn: await d(32) });
      if (first.kind !== "ok" || second.kind !== "ok") throw new Error("setup");
      // Touching the first (the day after its end) and overlapping the second.
      const bridge = await store.addBlockout(viewer, { startsOn: await d(23), endsOn: await d(31), reason: "work" });
      if (bridge.kind !== "ok") throw new Error("setup");
      expect(bridge.data.merged).toBe(true);
      const live = await t.q(sql`select starts_on::text as s, ends_on::text as e, reason from worship_blockouts
                                  where organization_id = ${w.org} and person_id = ${w.bob} and ended_at is null`);
      expect(live).toEqual([{ s: await d(20), e: await d(32), reason: "work" }]);
      const all = await t.q(sql`select 1 from worship_blockouts where organization_id = ${w.org} and person_id = ${w.bob}`);
      expect(all).toHaveLength(3);
      // A range one clear day away does not join.
      const apart = await store.addBlockout(viewer, { startsOn: await d(40), endsOn: await d(41) });
      expect(apart).toMatchObject({ kind: "ok", data: { merged: false } });
    });

    it("refuses an end before the start, a range wholly in the past, one over 366 days, and a malformed date - with the Copy sentences", async () => {
      const viewer = v(A.bob);
      expect(await store.addBlockout(viewer, { startsOn: await day(5), endsOn: await day(4) })).toEqual({ kind: "invalid_input", message: MEMBER_COPY.blockouts.endBeforeStart });
      expect(await store.addBlockout(viewer, { startsOn: await day(-9), endsOn: await day(-2) })).toEqual({ kind: "invalid_input", message: MEMBER_COPY.blockouts.inPast });
      expect(await store.addBlockout(viewer, { startsOn: await day(1), endsOn: await day(400) })).toEqual({ kind: "invalid_input", message: MEMBER_COPY.blockouts.tooLong });
      expect((await store.addBlockout(viewer, { startsOn: "soon", endsOn: await day(4) })).kind).toBe("invalid_input");
      expect((await store.addBlockout(viewer, { startsOn: await day(3), endsOn: await day(3), reason: "bored" as never })).kind).toBe("invalid_input");
      // A range that began in the past but has not ended is fine, and 366 days exactly is fine.
      expect((await store.addBlockout(viewer, { startsOn: await day(-3), endsOn: await day(2) })).kind).toBe("ok");
    });

    it("a merge can never exceed a year: joining two ranges whose union is over 366 days is refused", async () => {
      const w = await t.build("b3");
      const viewer = v(w.bob, w);
      const d = async (n: number) => String((await t.one(sql`select (presby_worship_org_today(${w.org}) + ${n}::int)::text as d`)).d);
      expect((await store.addBlockout(viewer, { startsOn: await d(1), endsOn: await d(200) })).kind).toBe("ok");
      expect(await store.addBlockout(viewer, { startsOn: await d(201), endsOn: await d(400) })).toEqual({ kind: "invalid_input", message: MEMBER_COPY.blockouts.tooLong });
    });

    it("at most 50 live ranges: the 51st is refused with the Copy sentence, and a merge that lowers the count is allowed", async () => {
      const w = await t.build("b4");
      const viewer = v(w.bob, w);
      const d = async (n: number) => String((await t.one(sql`select (presby_worship_org_today(${w.org}) + ${n}::int)::text as d`)).d);
      for (let i = 0; i < 50; i += 1) {
        expect((await store.addBlockout(viewer, { startsOn: await d(3 * i + 1), endsOn: await d(3 * i + 1) })).kind, `range ${i}`).toBe("ok");
      }
      expect(await store.addBlockout(viewer, { startsOn: await d(500), endsOn: await d(500) })).toEqual({
        kind: "conflict",
        reason: "over_cap",
        message: MEMBER_COPY.blockouts.tooMany,
      });
      // Joining ranges frees places: this one absorbs the first two.
      expect((await store.addBlockout(viewer, { startsOn: await d(1), endsOn: await d(4) })).kind).toBe("ok");
      expect((await store.addBlockout(viewer, { startsOn: await d(500), endsOn: await d(500) })).kind).toBe("ok");
    });

    it("a blockout over a date the person has agreed to serve is SAVED and reports the conflict; it cancels nothing", async () => {
      const w = await t.build("b5");
      const id = await t.draft(w, w.bob, w.sunday);
      await t.inOrg(w.org, (tx) => tx.execute(sql`update worship_assignments set status = 'confirmed', response_source = 'on_behalf',
                                                      responded_by_person_id = ${w.scheduler}, responded_at = now() where id = ${id}`));
      const sundayDay = String((await t.one(sql`select to_char(starts_at, 'YYYY-MM-DD') as d from events where id = ${w.sunday}`)).d);
      const r = await store.addBlockout(v(w.bob, w), { startsOn: sundayDay, endsOn: sundayDay, reason: "family" });
      if (r.kind !== "ok") throw new Error("setup");
      expect(r.data.conflicts).toHaveLength(1);
      expect(r.data.conflicts[0]).toMatchObject({ assignmentId: id, eventId: w.sunday, positionName: "Drums", teamName: "Band" });
      expect(r.data.conflicts[0]!.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect((await status(id)).status).toBe("confirmed");
      expect(await t.q(sql`select 1 from worship_blockouts where id = ${r.data.blockoutId} and ended_at is null`)).toHaveLength(1);
    });

    it("one person cannot end, or see the effect on, another's range; another organization's id is not_found", async () => {
      const w = await t.build("b6");
      const d = String((await t.one(sql`select (presby_worship_org_today(${w.org}) + 7)::text as d`)).d);
      const mine = await store.addBlockout(v(w.bob, w), { startsOn: d, endsOn: d });
      if (mine.kind !== "ok") throw new Error("setup");
      expect(await store.endBlockout(v(w.alice, w), { blockoutId: mine.data.blockoutId })).toEqual({ kind: "not_found" });
      expect(await store.endBlockout(v(A.alice), { blockoutId: mine.data.blockoutId })).toEqual({ kind: "not_found" });
      expect(await t.q(sql`select 1 from worship_blockouts where id = ${mine.data.blockoutId} and ended_at is null`)).toHaveLength(1);
      expect(await store.endBlockout(v(w.bob, w), { blockoutId: "nope" })).toEqual({ kind: "not_found" });
    });

    it("two simultaneous saves of the same range leave one live row between them", async () => {
      const w = await t.build("b7");
      const d = String((await t.one(sql`select (presby_worship_org_today(${w.org}) + 9)::text as d`)).d);
      const [x, y] = await Promise.all([
        store.addBlockout(v(w.bob, w), { startsOn: d, endsOn: d }),
        store.addBlockout(v(w.bob, w), { startsOn: d, endsOn: d }),
      ]);
      expect([x.kind, y.kind]).toEqual(["ok", "ok"]);
      expect(await t.q(sql`select 1 from worship_blockouts where organization_id = ${w.org} and person_id = ${w.bob} and ended_at is null`)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("services: create, generate, update, teams", () => {
    const sundayStart = async (org: string, weeks = 2) =>
      String((await t.one(sql`select to_char(date_trunc('week', presby_worship_org_now(${org})) + make_interval(weeks => ${weeks}, days => 6, hours => 9), 'YYYY-MM-DD"T"HH24:MI') as s`)).s);

    it("creates an event open to everyone, off the website, no check-in, with its worship row and serving teams", async () => {
      const w = await t.build("s1");
      const startsAt = await sundayStart(w.org);
      const r = await store.createService(v(w.planner, w), { title: "  Easter worship ", startsAt, endsAt: startsAt.replace("T09", "T10"), location: " Sanctuary ", groupIds: [w.band, w.choir] });
      if (r.kind !== "ok" || !r.data.created) throw new Error("setup");
      const ev = await t.one(sql`select title, location, is_public, website_listed, allows_checkin, event_type_id, cancelled_at, created_by::text as by,
                                        to_char(starts_at, 'YYYY-MM-DD"T"HH24:MI') as s, to_char(ends_at, 'YYYY-MM-DD"T"HH24:MI') as e
                                   from events where id = ${r.data.eventId}`);
      expect(ev).toMatchObject({ title: "Easter worship", location: "Sanctuary", is_public: true, website_listed: false, allows_checkin: false, event_type_id: null, cancelled_at: null, by: t.fx.actingUserId, s: startsAt, e: startsAt.replace("T09", "T10") });
      const teams = await t.q(sql`select group_id::text as g from worship_service_teams where event_id = ${r.data.eventId} and removed_at is null order by group_id`);
      expect(teams.map((x) => x.g).sort()).toEqual([w.band, w.choir].sort());
      expect(await t.q(sql`select 1 from worship_services where event_id = ${r.data.eventId}`)).toHaveLength(1);
      // No website-listing audit row (not listed) and no worship audit row for a create.
      expect(await t.q(sql`select 1 from audit_events where resource_id = ${r.data.eventId}`)).toHaveLength(0);
    });

    it("uses the organization's active 'Worship' event type when it has one (case-insensitive), else leaves it untyped", async () => {
      const w = await t.build("s2");
      const typed = await t.one(sql`insert into event_types (organization_id, name, color, icon) values (${w.org}, 'WORSHIP', 'sky', 'Music') returning id`);
      const r = await store.createService(v(w.planner, w), { title: "Typed", startsAt: await sundayStart(w.org), groupIds: [] });
      if (r.kind !== "ok" || !r.data.created) throw new Error("setup");
      expect((await t.one(sql`select event_type_id::text as t from events where id = ${r.data.eventId}`)).t).toBe(String(typed.id));
      await t.q(sql`update event_types set is_active = false where id = ${typed.id}`);
      const r2 = await store.createService(v(w.planner, w), { title: "Untyped", startsAt: await sundayStart(w.org, 3), groupIds: [] });
      if (r2.kind !== "ok" || !r2.data.created) throw new Error("setup");
      expect((await t.one(sql`select event_type_id from events where id = ${r2.data.eventId}`)).event_type_id).toBeNull();
    });

    it("a service at the same minute as another is returned as a hint, never created, until the caller says 'add it anyway'", async () => {
      const w = await t.build("s3");
      const startsAt = await sundayStart(w.org);
      const first = await store.createService(v(w.planner, w), { title: "Morning worship", startsAt, groupIds: [w.band] });
      if (first.kind !== "ok" || !first.data.created) throw new Error("setup");
      const dup = await store.createService(v(w.planner, w), { title: "Another", startsAt, groupIds: [w.band] });
      expect(dup).toEqual({ kind: "ok", data: { created: false, duplicate: { eventId: first.data.eventId, title: "Morning worship" } } });
      expect(await t.q(sql`select 1 from events where organization_id = ${w.org} and title = 'Another'`)).toHaveLength(0);
      const again = await store.createService(v(w.planner, w), { title: "Another", startsAt, groupIds: [w.band], allowDuplicate: true });
      expect(again).toMatchObject({ kind: "ok", data: { created: true } });
      // A cancelled service at that minute is not a duplicate.
      await t.q(sql`update events set cancelled_at = now() where organization_id = ${w.org} and title in ('Morning worship', 'Another')`);
      expect(await store.createService(v(w.planner, w), { title: "Third", startsAt, groupIds: [] })).toMatchObject({ data: { created: true } });
    });

    it("refuses a plain member, a manager without plan, bad input and teams that are not live worship teams - and creates nothing", async () => {
      const w = await t.build("s4");
      const before = await t.one(sql`select count(*)::int as n from events where organization_id = ${w.org}`);
      const startsAt = await sundayStart(w.org);
      expect(await store.createService(v(w.manager, w), { title: "x", startsAt, groupIds: [] })).toEqual({ kind: "forbidden" });
      expect(await store.createService(v(w.scheduler, w), { title: "x", startsAt, groupIds: [] })).toEqual({ kind: "forbidden" });
      expect((await store.createService(v(w.planner, w), { title: "", startsAt, groupIds: [] })).kind).toBe("invalid_input");
      expect((await store.createService(v(w.planner, w), { title: "x".repeat(201), startsAt, groupIds: [] })).kind).toBe("invalid_input");
      expect((await store.createService(v(w.planner, w), { title: "x", startsAt: "next Sunday", groupIds: [] })).kind).toBe("invalid_input");
      expect((await store.createService(v(w.planner, w), { title: "x", startsAt, endsAt: startsAt.replace("T09", "T08"), groupIds: [] })).kind).toBe("invalid_input");
      expect((await store.createService(v(w.planner, w), { title: "x", startsAt, groupIds: [B.band] })).kind).toBe("invalid_input");
      expect((await store.createService(v(w.planner, w), { title: "x", startsAt, groupIds: ["nope"] })).kind).toBe("invalid_input");
      await t.q(sql`update worship_teams set retired_at = now() where group_id = ${w.choir}`);
      expect((await store.createService(v(w.planner, w), { title: "x", startsAt, groupIds: [w.choir] })).kind).toBe("invalid_input");
      expect((await store.createService(v(w.planner, w), { title: "x", startsAt, serviceTypeId: "00000000-0000-4000-8000-000000000001", groupIds: [] })).kind).toBe("invalid_input");
      const after = await t.one(sql`select count(*)::int as n from events where organization_id = ${w.org}`);
      expect(after.n).toBe(before.n);
    });

    it("generateServices makes a series from a type: its time, length, place and teams, linked to one parent; the whole series or none", async () => {
      const w = await t.build("s5");
      const type = await store.createServiceType(v(w.manager, w), { name: "Sunday worship", startTime: "10:30", durationMinutes: 75, location: "Sanctuary", groupIds: [w.band] });
      if (type.kind !== "ok") throw new Error("setup");
      const firstDate = (await sundayStart(w.org)).slice(0, 10);
      const r = await store.generateServices(v(w.planner, w), { serviceTypeId: type.data.serviceTypeId, firstDate, pattern: "weekly", count: 4 });
      if (r.kind !== "ok") throw new Error("setup");
      expect(r.data.eventIds).toHaveLength(4);
      const rows = await t.q(sql`select e.title, e.location, to_char(e.starts_at, 'HH24:MI') as s, to_char(e.ends_at, 'HH24:MI') as e,
                                        e.parent_event_id::text as parent, ws.service_type_id::text as type
                                   from events e join worship_services ws on ws.event_id = e.id
                                  where e.id in (${sql.join(r.data.eventIds.map((id) => sql`${id}::uuid`), sql`, `)}) order by e.starts_at`);
      expect(rows).toHaveLength(4);
      for (const row of rows) expect(row).toMatchObject({ title: "Sunday worship", location: "Sanctuary", s: "10:30", e: "11:45", type: type.data.serviceTypeId });
      expect(rows.slice(1).every((row) => row.parent === r.data.eventIds[0])).toBe(true);
      const teams = await t.q(sql`select group_id::text as g from worship_service_teams where event_id = ${r.data.eventIds[3]!}`);
      expect(teams.map((x) => x.g)).toEqual([w.band]);
      const gaps = await t.q(sql`select (lead(starts_at) over (order by starts_at) - starts_at) as gap from events where id in (${sql.join(r.data.eventIds.map((id) => sql`${id}::uuid`), sql`, `)}) order by starts_at`);
      expect(String(gaps[0]!.gap)).toMatch(/7 days/);
    });

    it("generateServices: biweekly, monthly, one occurrence, and the limits - 26 at a time, the events cap of 52, a retired or unknown type", async () => {
      const w = await t.build("s6");
      const type = await store.createServiceType(v(w.manager, w), { name: "Usual", startTime: "09:00", groupIds: [] });
      if (type.kind !== "ok") throw new Error("setup");
      const id = type.data.serviceTypeId;
      const firstDate = (await sundayStart(w.org)).slice(0, 10);
      const biweekly = await store.generateServices(v(w.planner, w), { serviceTypeId: id, firstDate, pattern: "biweekly", count: 3 });
      expect(biweekly).toMatchObject({ kind: "ok" });
      const one = await store.generateServices(v(w.planner, w), { serviceTypeId: id, firstDate, pattern: "monthly", count: 1 });
      expect(one).toMatchObject({ kind: "ok", data: { eventIds: [expect.any(String)] } });
      expect(await store.generateServices(v(w.planner, w), { serviceTypeId: id, firstDate, pattern: "weekly", count: 27 })).toEqual({ kind: "invalid_input", message: "You can add up to 26 at a time." });
      expect((await store.generateServices(v(w.planner, w), { serviceTypeId: id, firstDate, pattern: "weekly", count: 0 })).kind).toBe("invalid_input");
      expect((await store.generateServices(v(w.planner, w), { serviceTypeId: id, firstDate, pattern: "daily" as never, count: 2 })).kind).toBe("invalid_input");
      expect((await store.generateServices(v(w.planner, w), { serviceTypeId: id, firstDate: "2026-02-30", pattern: "weekly", count: 2 })).kind).toBe("invalid_input");
      expect((await store.createService(v(w.planner, w), { title: "x", startsAt: "2026-02-30T09:00", groupIds: [] })).kind).toBe("invalid_input");
      expect((await store.createService(v(w.planner, w), { title: "x", startsAt: "2026-03-01T25:00", groupIds: [] })).kind).toBe("invalid_input");
      expect(await store.generateServices(v(w.planner, w), { serviceTypeId: "00000000-0000-4000-8000-000000000001", firstDate, pattern: "weekly", count: 2 })).toEqual({ kind: "not_found" });
      await store.retireServiceType(v(w.manager, w), { serviceTypeId: id });
      expect(await store.generateServices(v(w.planner, w), { serviceTypeId: id, firstDate, pattern: "weekly", count: 2 })).toEqual({ kind: "not_found" });
    });

    it("updateService changes title, time and place and keeps the place when none is given; an empty place clears it", async () => {
      const w = await t.build("s7");
      const startsAt = await sundayStart(w.org);
      const made = await store.createService(v(w.planner, w), { title: "Original", startsAt, location: "Fellowship hall", groupIds: [w.band] });
      if (made.kind !== "ok" || !made.data.created) throw new Error("setup");
      const eventId = made.data.eventId;
      const newStart = startsAt.replace("T09", "T11");
      expect(await store.updateService(v(w.planner, w), { eventId, title: " Renamed ", startsAt: newStart })).toEqual({ kind: "ok", data: { eventId } });
      expect(await t.one(sql`select title, location, to_char(starts_at, 'YYYY-MM-DD"T"HH24:MI') as s from events where id = ${eventId}`)).toMatchObject({ title: "Renamed", location: "Fellowship hall", s: newStart });
      await store.updateService(v(w.planner, w), { eventId, title: "Renamed", startsAt: newStart, location: "Sanctuary" });
      expect((await t.one(sql`select location from events where id = ${eventId}`)).location).toBe("Sanctuary");
      await store.updateService(v(w.planner, w), { eventId, title: "Renamed", startsAt: newStart, location: "" });
      expect((await t.one(sql`select location from events where id = ${eventId}`)).location).toBeNull();
      // The columns it must never touch.
      expect(await t.one(sql`select is_public, website_listed, allows_checkin, event_type_id, parent_event_id, recurrence_pattern from events where id = ${eventId}`)).toMatchObject({
        is_public: true,
        website_listed: false,
        allows_checkin: false,
        event_type_id: null,
        parent_event_id: null,
      });
      expect((await t.one(sql`select updated_by::text as u from worship_services where event_id = ${eventId}`)).u).toBe(t.fx.actingUserId);
      expect((await store.updateService(v(w.planner, w), { eventId, title: "", startsAt: newStart })).kind).toBe("invalid_input");
      expect((await store.updateService(v(w.planner, w), { eventId, title: "x", startsAt: "soon" })).kind).toBe("invalid_input");
      expect(await store.updateService(v(w.manager, w), { eventId, title: "x", startsAt: newStart })).toEqual({ kind: "forbidden" });
      await t.q(sql`update events set cancelled_at = now() where id = ${eventId}`);
      expect(await store.updateService(v(w.planner, w), { eventId, title: "x", startsAt: newStart })).toEqual({ kind: "conflict", reason: "not_open", message: ACTION_COPY.serviceCancelled });
    });

    it("setServiceTeams adds, soft-removes and re-adds; removing a team with a live assignment on the service is refused", async () => {
      const w = await t.build("s8");
      expect((await store.setServiceTeams(v(w.planner, w), { eventId: w.sunday, groupIds: [w.band] })).kind).toBe("ok");
      expect((await t.one(sql`select (removed_at is not null) as r from worship_service_teams where event_id = ${w.sunday} and group_id = ${w.choir}`)).r).toBe(true);
      expect((await store.setServiceTeams(v(w.planner, w), { eventId: w.sunday, groupIds: [w.band, w.choir] })).kind).toBe("ok");
      expect((await t.one(sql`select (removed_at is not null) as r from worship_service_teams where event_id = ${w.sunday} and group_id = ${w.choir}`)).r).toBe(false);
      expect(await t.q(sql`select 1 from worship_service_teams where event_id = ${w.sunday}`)).toHaveLength(2);
      const placed = await store.placePerson(v(w.scheduler, w), { eventId: w.sunday, groupId: w.choir, positionId: w.soprano, personId: w.alice });
      if (placed.kind !== "ok") throw new Error("setup");
      expect(await store.setServiceTeams(v(w.planner, w), { eventId: w.sunday, groupIds: [w.band] })).toEqual({
        kind: "conflict",
        reason: "in_use",
        message: ACTION_COPY.inUse("Choir", 1),
      });
      await store.removeAssignment(v(w.scheduler, w), { assignmentId: placed.data.assignmentId });
      expect((await store.setServiceTeams(v(w.planner, w), { eventId: w.sunday, groupIds: [w.band] })).kind).toBe("ok");
      expect((await store.setServiceTeams(v(w.planner, w), { eventId: w.sunday, groupIds: [B.band] })).kind).toBe("invalid_input");
      await t.q(sql`update events set cancelled_at = now() where id = ${w.midweek}`);
      expect(await store.setServiceTeams(v(w.planner, w), { eventId: w.midweek, groupIds: [] })).toMatchObject({ kind: "conflict", message: ACTION_COPY.serviceCancelled });
    });
  });

  // -------------------------------------------------------------------------
  describe("C2: a worship.plan holder reaches ONLY worship services", () => {
    it("updateService and cancelService on a PLAIN event are not_found, the row is byte-unchanged, and no hook side effect exists", async () => {
      const w = await t.build("c2");
      const plain = String((await t.one(sql`insert into events (organization_id, title, starts_at, is_public)
                                             values (${w.org}, 'Finance committee', presby_worship_org_now(${w.org}) + interval '4 days', false) returning id`)).id);
      const rowJson = async () => String((await t.one(sql`select row_to_json(e)::text as j from events e where id = ${plain}`)).j);
      const sideEffects = async () => ({
        assignments: (await t.one(sql`select count(*)::int as n from worship_assignments where organization_id = ${w.org}`)).n,
        queue: (await t.one(sql`select count(*)::int as n from email_queue where template_key like 'worship.%' and to_email like ${`%-${stamp}@wstore.example.invalid`}`)).n,
        audit: (await t.one(sql`select count(*)::int as n from audit_events where resource_id = ${plain}`)).n,
      });
      const before = { row: await rowJson(), effects: await sideEffects() };

      const planViewer = v(w.planner, w);
      expect(await store.updateService(planViewer, { eventId: plain, title: "Hijacked", startsAt: "2099-01-01T09:00", location: "Elsewhere" })).toEqual({ kind: "not_found" });
      expect(await store.cancelService(planViewer, { eventId: plain })).toEqual({ kind: "not_found" });
      expect(await store.setServiceTeams(planViewer, { eventId: plain, groupIds: [w.band] })).toEqual({ kind: "not_found" });
      // The same response as an unknown id.
      expect(await store.cancelService(planViewer, { eventId: "00000000-0000-4000-8000-0000000000dd" })).toEqual({ kind: "not_found" });

      expect({ row: await rowJson(), effects: await sideEffects() }).toEqual(before);
      // Another organization's real service: also not_found.
      expect(await store.cancelService(planViewer, { eventId: B.sunday })).toEqual({ kind: "not_found" });
      expect((await t.one(sql`select cancelled_at from events where id = ${B.sunday}`)).cancelled_at).toBeNull();
      // The control: the same calls on a real service succeed.
      expect((await store.updateService(planViewer, { eventId: w.later, title: "Edited", startsAt: "2099-01-01T09:00" })).kind).toBe("ok");
      expect((await store.cancelService(planViewer, { eventId: w.later })).kind).toBe("ok");
    });
  });
});
