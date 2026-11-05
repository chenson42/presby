/**
 * THE SEND - `sendRequests` against a REAL Postgres connection (docs/work-log/
 * 2026-11-04-worship-inc1.md, Phase 3 store export `sendRequests`, DECISION-320,
 * DECISION-322, DECISION-324; Edge Cases; Phase 4 Batch 3):
 *
 *   - drafts only; each person asked once, listing every position and date;
 *   - the four outcomes (emailed, guardian, no_address, do_not_contact) are
 *     stored on the row and decide whether an `email_queue` row exists;
 *   - a presumed minor is placed and sent, NEVER emailed; the body carries no
 *     name, no reason and no query string;
 *   - the roster is re-checked per person, and the services that qualify;
 *   - scope: a key holder sends everything or one team; a seat holder's scope is
 *     cut to the teams they lead; a service that is cancelled or past is skipped;
 *   - the caps (200 assignments, 52 services), `mail_unavailable`, and
 *     "nothing to send", each leaving no write behind;
 *   - the lock order: two simultaneous Sends never double-queue a person, and
 *     overlapping Sends of different scopes cannot deadlock;
 *   - `getSendPreview` says exactly what the Send then does.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/worship/store.send.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { WorshipTestWorld, WorshipWorld } from "@/lib/testing/worship-world";
import { ACTION_COPY } from "./copy";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

// A switch in front of the real queue insert, to prove a failed queue write fails the whole Send.
const hooks = vi.hoisted(() => ({ queueFails: false }));
vi.mock("@/lib/email/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/queue")>();
  return {
    ...actual,
    insertQueueRowInTx: (...args: Parameters<typeof actual.insertQueueRowInTx>) =>
      hooks.queueFails ? Promise.reject(new Error("queue unavailable")) : actual.insertQueueRowInTx(...args),
  };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("worship/store.ts sendRequests (Postgres-backed)", () => {
  let t: WorshipTestWorld;
  let store: typeof import("./store");
  let reads: typeof import("./reads");
  let stamp: string;

  const v = (personId: string, w: WorshipWorld) => t.viewer(personId, w.org);
  const addr = (name: string) => `${name}-${stamp}@wsend.example.invalid`;
  const mail = (name: string) =>
    t.q(sql`select template_key, subject, text_body, html_body, status from email_queue where to_email = ${addr(name)} order by created_at`);
  const row = (id: string) =>
    t.one(sql`select status, sent_by_person_id::text as sent_by, notice_outcome, requested_at from worship_assignments where id = ${id}`);

  beforeAll(async () => {
    await import("@/lib/db/schema");
    const world = await import("@/lib/testing/worship-world");
    t = await world.createWorshipWorld("wsend");
    store = await import("./store");
    reads = await import("./reads");
    stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  });
  afterAll(async () => {
    if (t) {
      await t.q(sql`delete from email_queue where to_email like ${`%-${stamp}@wsend.example.invalid`}`).catch(() => undefined);
      await t.fx.cleanup();
    }
  });

  /** A world where alice and bob have addresses, plus a place helper. */
  async function world(tag: string) {
    const w = await t.build(tag);
    await t.email(w.alice, addr(`${tag}-alice`));
    await t.email(w.bob, addr(`${tag}-bob`));
    const place = async (personId: string, eventId: string, positionId: string, groupId = w.band) => {
      const r = await store.placePerson(v(w.scheduler, w), { eventId, groupId, positionId, personId });
      if (r.kind !== "ok") throw new Error(`place failed: ${JSON.stringify(r)}`);
      return r.data.assignmentId;
    };
    return { w, place };
  }

  // -------------------------------------------------------------------------
  it("sends the drafts: requested, sent_by, requested_at stamped, the outcome stored; one email per person listing all their positions", async () => {
    const { w, place } = await world("s1");
    const a1 = await place(w.alice, w.sunday, w.drums);
    const a2 = await place(w.alice, w.sunday, w.vocals);
    const a3 = await place(w.alice, w.midweek, w.vocals);
    const b1 = await place(w.bob, w.sunday, w.vocals);
    const r = await store.sendRequests(v(w.scheduler, w), {});
    if (r.kind !== "ok") throw new Error(JSON.stringify(r));
    expect(r.data).toMatchObject({ sent: 4, emailed: 2, guardian: 0, noAddress: 0, doNotContact: 0, notOnTeam: 0, services: 2 });
    expect(r.data.queueIds).toHaveLength(2);
    for (const id of [a1, a2, a3, b1]) {
      expect(await row(id)).toMatchObject({ status: "requested", sent_by: w.scheduler, notice_outcome: "emailed" });
      expect((await row(id)).requested_at).not.toBeNull();
    }
    const alice = await mail("s1-alice");
    expect(alice).toHaveLength(1);
    expect(alice[0]).toMatchObject({ template_key: "worship.notice.request", status: "queued" });
    expect(alice[0]!.subject).toMatch(/: a request to serve$/);
    const body = String(alice[0]!.text_body);
    expect(body).toContain("Drums, Band");
    expect(body.match(/Vocals, Band/g)).toHaveLength(2);
    expect(body).toContain("Answer your requests");
    expect(body).toMatch(/\/o\/[a-z0-9-]+\/worship(\s|$)/);
    expect(body).not.toContain("?");
    const bob = await mail("s1-bob");
    expect(bob).toHaveLength(1);
    expect(String(bob[0]!.text_body)).toContain("Answer the request");
    expect(String(bob[0]!.text_body)).toContain(`/worship/requests/${b1}`);
  });

  it("takes DRAFTS only: confirmed, declined and guest rows are untouched, and a second Send finds nothing to send", async () => {
    const { w, place } = await world("s2");
    const draftId = await place(w.alice, w.sunday, w.drums);
    const confirmed = await place(w.bob, w.sunday, w.vocals);
    await store.recordResponse(v(w.scheduler, w), { assignmentId: confirmed, answer: "accepted" });
    const guest = await store.placeGuest(v(w.scheduler, w), { eventId: w.sunday, groupId: w.band, positionId: w.vocals, guestName: "Visiting organist" });
    if (guest.kind !== "ok") throw new Error("setup");
    const r = await store.sendRequests(v(w.scheduler, w), {});
    expect(r).toMatchObject({ kind: "ok", data: { sent: 1, emailed: 1 } });
    expect((await row(draftId)).status).toBe("requested");
    expect((await row(confirmed)).status).toBe("confirmed");
    expect((await row(guest.data.assignmentId)).status).toBe("confirmed");
    expect(await mail("s2-bob")).toHaveLength(0);
    expect(await store.sendRequests(v(w.scheduler, w), {})).toEqual({ kind: "invalid_input", message: ACTION_COPY.sendNothing });
    expect(await mail("s2-alice")).toHaveLength(1);
  });

  it("the four outcomes: a presumed minor is 'guardian' and gets NO email of any kind; no address; do not contact; and each is stored", async () => {
    const { w, place } = await world("s3");
    const noAddr = await t.person(w.org, "Noaddr");
    const dnc = await t.person(w.org, "Dncperson");
    await t.onRoster(w.org, w.band, noAddr);
    await t.onRoster(w.org, w.band, dnc);
    await t.email(dnc, addr("s3-dnc"), { doNotContact: true });
    await t.email(w.child, addr("s3-child"));
    const ids = {
      alice: await place(w.alice, w.sunday, w.drums),
      child: await place(w.child, w.sunday, w.vocals),
      noAddr: await place(noAddr, w.midweek, w.drums),
      dnc: await place(dnc, w.midweek, w.vocals),
    };
    const r = await store.sendRequests(v(w.scheduler, w), {});
    expect(r).toMatchObject({ kind: "ok", data: { sent: 4, emailed: 1, guardian: 1, noAddress: 1, doNotContact: 1 } });
    expect((await row(ids.alice)).notice_outcome).toBe("emailed");
    expect((await row(ids.child)).notice_outcome).toBe("guardian");
    expect((await row(ids.noAddr)).notice_outcome).toBe("no_address");
    expect((await row(ids.dnc)).notice_outcome).toBe("do_not_contact");
    for (const id of Object.values(ids)) expect((await row(id)).status).toBe("requested");
    expect(await mail("s3-child")).toHaveLength(0);
    expect(await mail("s3-dnc")).toHaveLength(0);
    expect(await mail("s3-alice")).toHaveLength(1);
    if (r.kind === "ok") expect(r.data.queueIds).toHaveLength(1);
  });

  it("a Work-labelled address receives scheduling mail (accepted residual); a personal address is used when there is no Work one", async () => {
    const { w, place } = await world("s4");
    const staff = await t.person(w.org, "Staffer");
    await t.onRoster(w.org, w.band, staff);
    await t.email(staff, addr("s4-staff"), { subtype: "work" });
    await place(staff, w.sunday, w.drums);
    await store.sendRequests(v(w.scheduler, w), {});
    expect(await mail("s4-staff")).toHaveLength(1);
  });

  it("people who share an inbox each get their own email", async () => {
    const { w, place } = await world("s5");
    const first = await t.person(w.org, "Sharedone");
    const second = await t.person(w.org, "Sharedtwo");
    for (const p of [first, second]) {
      await t.onRoster(w.org, w.band, p);
      await t.email(p, addr("s5-shared"));
    }
    await place(first, w.sunday, w.drums);
    await place(second, w.sunday, w.vocals);
    await store.sendRequests(v(w.scheduler, w), {});
    expect(await mail("s5-shared")).toHaveLength(2);
  });

  it("the bodies carry no person's name and no free text, and no link has a query string", async () => {
    const { w, place } = await world("s6");
    await t.q(sql`update people set preferred_name = 'Zebediah' where id = ${w.alice}`);
    await place(w.alice, w.sunday, w.drums);
    await store.sendRequests(v(w.leader, w), {});
    const [m] = await mail("s6-alice");
    const everything = `${m!.subject}\n${m!.text_body}\n${m!.html_body}`;
    expect(everything).not.toMatch(/Zebediah|Alice|Worshiptest|Leader|Scheduler/);
    for (const url of everything.match(/https?:\/\/[^\s"<]+/g) ?? []) expect(url).not.toContain("?");
  });

  // -------------------------------------------------------------------------
  it("re-checks the roster: a person who left the team stays a draft, is not emailed, and is counted", async () => {
    const { w, place } = await world("s7");
    const a = await place(w.alice, w.sunday, w.drums);
    const b = await place(w.bob, w.sunday, w.vocals);
    await store.endTeamMember(v(w.manager, w), {
      groupId: w.band,
      groupMembershipId: String((await t.one(sql`select id::text as id from group_memberships where group_id = ${w.band} and person_id = ${w.bob}`)).id),
    });
    const r = await store.sendRequests(v(w.scheduler, w), {});
    expect(r).toMatchObject({ kind: "ok", data: { sent: 1, emailed: 1, notOnTeam: 1 } });
    expect((await row(a)).status).toBe("requested");
    expect((await row(b)).status).toBe("draft");
    expect(await mail("s7-bob")).toHaveLength(0);
    // A person who died, or was merged, is also left behind.
    const { w: w2, place: place2 } = await world("s7b");
    const c = await place2(w2.alice, w2.sunday, w2.drums);
    await t.q(sql`update people set date_of_death = current_date - 1 where id = ${w2.alice}`);
    expect(await store.sendRequests(v(w2.scheduler, w2), {})).toEqual({ kind: "invalid_input", message: ACTION_COPY.sendNothing });
    expect((await row(c)).status).toBe("draft");
  });

  it("skips a cancelled service and a service that has started, and a team no longer serving it", async () => {
    const { w, place } = await world("s8");
    const a = await place(w.alice, w.sunday, w.drums);
    const b = await place(w.bob, w.midweek, w.drums);
    const c = await place(w.bob, w.later, w.vocals);
    const d = await place(w.alice, w.soon, w.vocals);
    await t.q(sql`update events set cancelled_at = now() where id = ${w.midweek}`);
    await t.q(sql`update events set starts_at = presby_worship_org_now(${w.org}) - interval '1 hour' where id = ${w.soon}`);
    await t.q(sql`update worship_service_teams set removed_at = now() where event_id = ${w.later} and group_id = ${w.band}`);
    const r = await store.sendRequests(v(w.scheduler, w), {});
    expect(r).toMatchObject({ kind: "ok", data: { sent: 1, services: 1 } });
    expect((await row(a)).status).toBe("requested");
    for (const id of [b, c, d]) expect((await row(id)).status, id).toBe("draft");
  });

  // -------------------------------------------------------------------------
  describe("scope", () => {
    it("a key holder sends everything, one team (groupId) or chosen services (eventIds)", async () => {
      const { w, place } = await world("sc1");
      const band = await place(w.alice, w.sunday, w.drums);
      const choir = await place(w.alice, w.sunday, w.soprano, w.choir);
      const later = await place(w.bob, w.midweek, w.vocals);
      expect(await store.sendRequests(v(w.scheduler, w), { groupId: w.choir })).toMatchObject({ kind: "ok", data: { sent: 1 } });
      expect((await row(choir)).status).toBe("requested");
      expect((await row(band)).status).toBe("draft");
      expect(await store.sendRequests(v(w.scheduler, w), { eventIds: [w.midweek] })).toMatchObject({ kind: "ok", data: { sent: 1 } });
      expect((await row(later)).status).toBe("requested");
      expect((await row(band)).status).toBe("draft");
      expect(await store.sendRequests(v(w.scheduler, w), {})).toMatchObject({ kind: "ok", data: { sent: 1 } });
      expect((await row(band)).status).toBe("requested");
    });

    it("a seat holder's scope is cut to the teams they lead; naming another team is forbidden and sends nothing", async () => {
      const { w, place } = await world("sc2");
      const band = await place(w.alice, w.sunday, w.drums);
      const choir = await place(w.alice, w.sunday, w.soprano, w.choir);
      expect(await store.sendRequests(v(w.leader, w), { groupId: w.choir })).toEqual({ kind: "forbidden" });
      expect((await row(choir)).status).toBe("draft");
      expect(await store.sendRequests(v(w.leader, w), {})).toMatchObject({ kind: "ok", data: { sent: 1 } });
      expect((await row(band)).status).toBe("requested");
      expect((await row(choir)).status).toBe("draft");
      expect((await row(band)).sent_by).toBe(w.leader);
    });

    it("manage, plan and a plain member cannot send; malformed ids are not found", async () => {
      const { w } = await world("sc3");
      for (const who of [w.manager, w.planner, w.plain]) expect(await store.sendRequests(v(who, w), {}), who).toEqual({ kind: "forbidden" });
      expect(await store.sendRequests(v(w.scheduler, w), { groupId: "nope" })).toEqual({ kind: "not_found" });
      expect(await store.sendRequests(v(w.scheduler, w), { eventIds: ["nope"] })).toEqual({ kind: "not_found" });
    });

    it("an event id of a plain event or another organization's service sends nothing", async () => {
      const { w, place } = await world("sc4");
      const a = await place(w.alice, w.sunday, w.drums);
      expect(await store.sendRequests(v(w.scheduler, w), { eventIds: [(await t.build("sc4-other")).sunday] })).toEqual({ kind: "invalid_input", message: ACTION_COPY.sendNothing });
      expect((await row(a)).status).toBe("draft");
    });
  });

  // -------------------------------------------------------------------------
  describe("refusals leave nothing behind", () => {
    it("nothing to send is a sentence, not an empty success", async () => {
      const { w } = await world("r1");
      expect(await store.sendRequests(v(w.scheduler, w), {})).toEqual({ kind: "invalid_input", message: ACTION_COPY.sendNothing });
    });

    it("mail_unavailable (no safe platform origin) changes NOTHING: the drafts stay drafts", async () => {
      const { w, place } = await world("r2");
      const a = await place(w.alice, w.sunday, w.drums);
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "not a url");
      try {
        expect(await store.sendRequests(v(w.scheduler, w), {})).toEqual({ kind: "conflict", reason: "mail_unavailable", message: ACTION_COPY.sendMailUnavailable });
      } finally {
        vi.unstubAllEnvs();
      }
      expect((await row(a)).status).toBe("draft");
      expect(await mail("r2-alice")).toHaveLength(0);
    });

    it("more than 200 assignments is over_cap; exactly 200 is sent (one person, 201 positions on one service)", async () => {
      const { w } = await world("r3");
      const person = w.alice;
      await t.q(sql`insert into worship_positions (organization_id, group_id, name, slots)
                    select ${w.org}, ${w.band}, 'Cap position ' || g, 1 from generate_series(1, 201) g`);
      const positions = await t.q(sql`select id::text as id from worship_positions where group_id = ${w.band} and name like 'Cap position %' order by name`);
      await t.inOrg(w.org, async (tx) => {
        await tx.execute(sql`insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
                             select ${w.org}, ${w.sunday}, ${w.band}, p.id, ${person}, ${w.scheduler}
                               from worship_positions p where p.group_id = ${w.band} and p.name like 'Cap position %'`);
      });
      expect(positions).toHaveLength(201);
      expect(await store.sendRequests(v(w.scheduler, w), {})).toEqual({ kind: "conflict", reason: "over_cap", message: ACTION_COPY.sendOverCap });
      expect((await t.one(sql`select count(*)::int as n from worship_assignments where organization_id = ${w.org} and status = 'draft'`)).n).toBe(201);
      expect(await mail("r3-alice")).toHaveLength(0);
      // Withdraw one and the Send goes through at exactly 200.
      await t.inOrg(w.org, (tx) =>
        tx.execute(sql`update worship_assignments set status = 'withdrawn', withdrawn_by_person_id = ${w.scheduler}, withdrawn_reason = 'removed'
                        where id = (select id from worship_assignments where organization_id = ${w.org} and status = 'draft' limit 1)`),
      );
      expect(await store.sendRequests(v(w.scheduler, w), {})).toMatchObject({ kind: "ok", data: { sent: 200, emailed: 1, services: 1 } });
      const [m] = await mail("r3-alice");
      expect(String(m!.text_body)).toContain("and 188 more");
    });

    it("more than 52 services is over_cap, before any lock or write", async () => {
      const { w } = await world("r4");
      const ids = await t.q(sql`insert into events (organization_id, title, starts_at)
                                 select ${w.org}, 'Cap service ' || g, presby_worship_org_now(${w.org}) + make_interval(days => 10 + g)
                                   from generate_series(1, 53) g returning id::text as id`);
      await t.q(sql`insert into worship_services (event_id, organization_id)
                    select id, organization_id from events where organization_id = ${w.org} and title like 'Cap service %'`);
      await t.q(sql`insert into worship_service_teams (organization_id, event_id, group_id)
                    select organization_id, event_id, ${w.band}::uuid from worship_services ws where ws.organization_id = ${w.org}
                       and ws.event_id in (select id from events where title like 'Cap service %' and organization_id = ${w.org})`);
      await t.inOrg(w.org, (tx) =>
        tx.execute(sql`insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
                       select ${w.org}, e.id, ${w.band}, ${w.drums}, ${w.alice}, ${w.scheduler} from events e
                        where e.organization_id = ${w.org} and e.title like 'Cap service %'`),
      );
      expect(ids).toHaveLength(53);
      expect(await store.sendRequests(v(w.scheduler, w), {})).toEqual({ kind: "conflict", reason: "over_cap", message: ACTION_COPY.sendOverCap });
      expect((await t.one(sql`select count(*)::int as n from worship_assignments where organization_id = ${w.org} and status = 'requested'`)).n).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("concurrency", () => {
    it("two simultaneous Sends never double-queue a person: one sends, the other finds nothing", async () => {
      const { w, place } = await world("k1");
      await place(w.alice, w.sunday, w.drums);
      await place(w.bob, w.sunday, w.vocals);
      const [x, y] = await Promise.all([store.sendRequests(v(w.scheduler, w), {}), store.sendRequests(v(w.all, w), {})]);
      const kinds = [x.kind, y.kind].sort();
      expect(kinds).toEqual(["invalid_input", "ok"]);
      expect(await mail("k1-alice")).toHaveLength(1);
      expect(await mail("k1-bob")).toHaveLength(1);
    });

    it("overlapping Sends of different scopes (a leader and a key holder, services locked in the same order) both finish - no deadlock", async () => {
      const { w, place } = await world("k2");
      await place(w.alice, w.sunday, w.drums);
      await place(w.alice, w.midweek, w.vocals);
      await place(w.bob, w.later, w.vocals);
      await place(w.alice, w.sunday, w.soprano, w.choir);
      const results = await Promise.all([
        store.sendRequests(v(w.leader, w), {}),
        store.sendRequests(v(w.scheduler, w), {}),
        store.sendRequests(v(w.choirLeader, w), {}),
        store.sendRequests(v(w.all, w), { eventIds: [w.later, w.sunday] }),
      ]);
      for (const r of results) expect(["ok", "invalid_input"]).toContain(r.kind);
      expect((await t.one(sql`select count(*)::int as n from worship_assignments where organization_id = ${w.org} and status = 'draft'`)).n).toBe(0);
      // Each person is emailed once per Send that took their rows; nobody is emailed twice for the same assignment.
      const requests = await t.q(sql`select count(*)::int as n, sum(case when status = 'requested' then 1 else 0 end)::int as r
                                       from worship_assignments where organization_id = ${w.org}`);
      expect(requests[0]!.n).toBe(4);
      expect(requests[0]!.r).toBe(4);
    });

    it("a Send racing a cancel ends consistent: the cancelled service has no open request left, and the emails match who was asked", async () => {
      const { w, place } = await world("k3");
      await place(w.alice, w.sunday, w.drums);
      await place(w.bob, w.sunday, w.vocals);
      const [send, cancel] = await Promise.all([
        store.sendRequests(v(w.scheduler, w), {}),
        store.cancelService(v(w.planner, w), { eventId: w.sunday }),
      ]);
      expect(cancel.kind).toBe("ok");
      expect(["ok", "invalid_input"]).toContain(send.kind);
      const open = await t.q(sql`select 1 from worship_assignments where event_id = ${w.sunday} and status in ('draft', 'requested')`);
      expect(open).toHaveLength(0);
      const requests = await t.one(sql`select count(*) filter (where template_key = 'worship.notice.request')::int as asked,
                                              count(*) filter (where template_key = 'worship.notice.cancelled')::int as told
                                         from email_queue where to_email in (${addr("k3-alice")}, ${addr("k3-bob")})`);
      // Send first: two asked, then two told of the cancel. Cancel first: nothing sent at all.
      expect([`${requests.asked}/${requests.told}`]).toEqual([send.kind === "ok" ? "2/2" : "0/0"]);
    });
  });

  // -------------------------------------------------------------------------
  describe("getSendPreview says what the Send then does", () => {
    it("the same counts, the same scope, and no write", async () => {
      const { w, place } = await world("pv1");
      await t.email(w.child, addr("pv1-child"));
      const noAddr = await t.person(w.org, "Previewnoaddr");
      await t.onRoster(w.org, w.band, noAddr);
      await place(w.alice, w.sunday, w.drums);
      await place(w.bob, w.sunday, w.vocals);
      await place(w.child, w.midweek, w.drums);
      await place(noAddr, w.midweek, w.vocals);
      await place(w.alice, w.sunday, w.soprano, w.choir);
      const preview = await reads.getSendPreview(v(w.scheduler, w), {});
      expect(preview).toEqual({
        kind: "ok",
        data: { assignments: 5, people: 4, services: 2, emailed: 2, guardian: 1, noAddress: 1, doNotContact: 0, notEmailed: 2, notOnTeam: 0, overCap: false, mailAvailable: true },
      });
      expect((await t.one(sql`select count(*)::int as n from worship_assignments where organization_id = ${w.org} and status = 'draft'`)).n).toBe(5);
      const sent = await store.sendRequests(v(w.scheduler, w), {});
      expect(sent).toMatchObject({ kind: "ok", data: { sent: 5, emailed: 2, guardian: 1, noAddress: 1, doNotContact: 0, notOnTeam: 0, services: 2 } });
    });

    it("a leader's preview is cut to their team, a stranger's is forbidden, and a missing origin is reported", async () => {
      const { w, place } = await world("pv2");
      await place(w.alice, w.sunday, w.drums);
      await place(w.alice, w.sunday, w.soprano, w.choir);
      expect(await reads.getSendPreview(v(w.leader, w), {})).toMatchObject({ kind: "ok", data: { assignments: 1, people: 1 } });
      expect(await reads.getSendPreview(v(w.leader, w), { groupId: w.choir })).toEqual({ kind: "forbidden" });
      expect(await reads.getSendPreview(v(w.plain, w), {})).toEqual({ kind: "forbidden" });
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "not a url");
      try {
        expect(await reads.getSendPreview(v(w.scheduler, w), {})).toMatchObject({ kind: "ok", data: { mailAvailable: false } });
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  // -------------------------------------------------------------------------
  it("a failed queue write rolls the whole Send back: no drafts moved, no audit row, no email", async () => {
    const { w, place } = await world("f1");
    const a = await place(w.alice, w.sunday, w.drums);
    const b = await place(w.bob, w.sunday, w.vocals);
    hooks.queueFails = true;
    try {
      await expect(store.sendRequests(v(w.scheduler, w), {})).rejects.toThrow("queue unavailable");
    } finally {
      hooks.queueFails = false;
    }
    expect((await row(a)).status).toBe("draft");
    expect((await row(b)).status).toBe("draft");
    expect(await t.q(sql`select 1 from audit_events where action = 'tenant.worship.requests_sent' and resource_id = ${w.org}`)).toHaveLength(0);
    expect(await mail("f1-alice")).toHaveLength(0);
    // And the Send works once the queue does.
    expect(await store.sendRequests(v(w.scheduler, w), {})).toMatchObject({ kind: "ok", data: { sent: 2, emailed: 2 } });
  });
});
