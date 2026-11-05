/**
 * THE CANCEL HOOK - `worship/event-hooks.ts#onServiceCancelledInTx`, reached
 * through `events/mutate.ts#cancelEventInTx` from BOTH writers (the worship
 * board's `cancelService` and Manage events' `cancelEvent`), against a REAL
 * Postgres connection (docs/work-log/2026-11-04-worship-inc1.md, Phase 3 "The
 * cancel hook", DECISION-326; architect addendum C1, C4; Phase 4 Batch 3):
 *
 *   - drafts and open requests are withdrawn (`service_cancelled`, no actor);
 *     confirmed and declined rows and guests are RETAINED;
 *   - one notice per person who was requested or confirmed - never a draft, a
 *     decliner, a guest, a presumed minor, nobody with no deliverable address;
 *   - the notice carries a date and a bare link, never a name;
 *   - a cancel from Manage events and from the worship board are the same;
 *   - the toggle off: rows are withdrawn, nothing is queued;
 *   - a repeat cancel runs no hook; a plain event runs no worship code;
 *   - a hook that cannot write its queue rows ROLLS THE CANCEL BACK (stated);
 *   - a response racing a cancel ends consistent.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/worship/store.cancel.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { WorshipTestWorld, WorshipWorld } from "@/lib/testing/worship-world";
import { GATE_COPY } from "./copy";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 240_000 });

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

describe.skipIf(!hasDb)("worship cancel hook (Postgres-backed)", () => {
  let t: WorshipTestWorld;
  let store: typeof import("./store");
  let events: typeof import("@/lib/events");
  let stamp: string;

  const v = (personId: string, w: WorshipWorld) => t.viewer(personId, w.org);
  const addr = (name: string) => `${name}-${stamp}@wcancel.example.invalid`;
  const mail = (name: string) =>
    t.q(sql`select template_key, subject, text_body, html_body from email_queue where to_email = ${addr(name)} order by created_at`);
  const row = (id: string) =>
    t.one(sql`select status, withdrawn_reason, withdrawn_by_person_id::text as withdrawn_by, withdrawn_at, decline_reason from worship_assignments where id = ${id}`);

  beforeAll(async () => {
    await import("@/lib/db/schema");
    const world = await import("@/lib/testing/worship-world");
    t = await world.createWorshipWorld("wcancel");
    store = await import("./store");
    events = await import("@/lib/events");
    stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  });
  afterAll(async () => {
    if (t) {
      await t.q(sql`delete from email_queue where to_email like ${`%-${stamp}@wcancel.example.invalid`}`).catch(() => undefined);
      await t.fx.cleanup();
    }
  });
  beforeEach(() => {
    hooks.queueFails = false;
  });

  interface Cast {
    w: WorshipWorld;
    ids: Record<"aliceDraft" | "aliceRequested" | "bobConfirmed" | "childRequested" | "noAddrRequested" | "dncRequested" | "declined" | "guest" | "carolRequested", string>;
  }

  /** One service carrying every status the hook must tell apart. */
  async function cast(tag: string, opts: { toggle?: boolean } = {}): Promise<Cast> {
    const w = await t.build(tag, { toggle: opts.toggle });
    const noAddr = await t.person(w.org, "Noaddr");
    const dnc = await t.person(w.org, "Dncperson");
    const decliner = await t.person(w.org, "Decliner");
    const carol = await t.person(w.org, "Carol");
    for (const p of [noAddr, dnc, decliner, carol]) await t.onRoster(w.org, w.band, p);
    await t.email(w.alice, addr(`${tag}-alice`));
    await t.email(w.bob, addr(`${tag}-bob`));
    await t.email(w.child, addr(`${tag}-child`));
    await t.email(dnc, addr(`${tag}-dnc`), { doNotContact: true });
    await t.email(decliner, addr(`${tag}-decliner`));
    await t.email(carol, addr(`${tag}-carol`));
    const sendIt = (id: string) =>
      t.inOrg(w.org, (tx) =>
        tx.execute(sql`update worship_assignments set status = 'requested', sent_by_person_id = ${w.scheduler}, notice_outcome = 'emailed' where id = ${id}`),
      );
    const extra = await t.q(sql`insert into worship_positions (organization_id, group_id, name, slots)
                                values (${w.org}, ${w.band}, 'Keys', 4), (${w.org}, ${w.band}, 'Bass', 4) returning id::text as id`);
    const keys = String(extra[0]!.id);
    const bass = String(extra[1]!.id);
    const aliceDraft = await t.draft(w, w.alice, w.sunday, w.drums);
    const aliceRequested = await t.draft(w, w.alice, w.sunday, w.vocals);
    await sendIt(aliceRequested);
    const bobConfirmed = await t.draft(w, w.bob, w.sunday, w.vocals);
    await t.inOrg(w.org, (tx) =>
      tx.execute(sql`update worship_assignments set status = 'confirmed', response_source = 'on_behalf', responded_by_person_id = ${w.scheduler}, responded_at = now() where id = ${bobConfirmed}`),
    );
    const childRequested = await t.draft(w, w.child, w.sunday, keys);
    await sendIt(childRequested);
    const noAddrRequested = await t.draft(w, noAddr, w.sunday, keys);
    await sendIt(noAddrRequested);
    const dncRequested = await t.draft(w, dnc, w.sunday, bass);
    await sendIt(dncRequested);
    const declined = await t.draft(w, decliner, w.sunday, bass);
    await sendIt(declined);
    await t.inOrg(w.org, (tx) =>
      tx.execute(sql`update worship_assignments set status = 'declined', response_source = 'self', responded_by_person_id = ${decliner}, responded_at = now(), decline_reason = 'away' where id = ${declined}`),
    );
    const carolRequested = await t.draft(w, carol, w.sunday, keys);
    await sendIt(carolRequested);
    // The guest row goes in on the owner path so the toggle-off cast can have one too.
    const guest = String(
      (
        await t.inOrg(w.org, (tx) =>
          tx.execute(sql`insert into worship_assignments (organization_id, event_id, group_id, position_id, guest_name, assigned_by_person_id,
                                                          status, responded_by_person_id, response_source)
                         values (${w.org}, ${w.sunday}, ${w.band}, ${bass}, 'Visiting organist', ${w.scheduler}, 'confirmed', ${w.scheduler}, 'on_behalf')
                         returning id::text as id`),
        )
      ).rows[0]!.id,
    );
    return {
      w,
      ids: { aliceDraft, aliceRequested, bobConfirmed, childRequested, noAddrRequested, dncRequested, declined, guest, carolRequested },
    };
  }

  // -------------------------------------------------------------------------
  it("withdraws drafts and open requests with reason service_cancelled and no actor; retains confirmed, declined and guest rows", async () => {
    const { w, ids } = await cast("c1");
    expect(await store.cancelService(v(w.planner, w), { eventId: w.sunday })).toEqual({ kind: "ok", data: { changed: true } });
    expect((await t.one(sql`select cancelled_at from events where id = ${w.sunday}`)).cancelled_at).not.toBeNull();
    for (const id of [ids.aliceDraft, ids.aliceRequested, ids.childRequested, ids.noAddrRequested, ids.dncRequested, ids.carolRequested]) {
      expect(await row(id), id).toMatchObject({ status: "withdrawn", withdrawn_reason: "service_cancelled", withdrawn_by: null });
      expect((await row(id)).withdrawn_at).not.toBeNull();
    }
    expect(await row(ids.bobConfirmed)).toMatchObject({ status: "confirmed", withdrawn_reason: null });
    expect(await row(ids.declined)).toMatchObject({ status: "declined", decline_reason: "away", withdrawn_reason: null });
    expect(await row(ids.guest)).toMatchObject({ status: "confirmed", withdrawn_reason: null });
  });

  it("tells each person who was requested or confirmed exactly once - never a draft, a decliner, a guest, a presumed minor or someone with no deliverable address", async () => {
    const { w } = await cast("c2");
    await t.q(sql`delete from email_queue where to_email like ${`%-${stamp}@wcancel.example.invalid`}`);
    await store.cancelService(v(w.planner, w), { eventId: w.sunday });
    // Alice held a draft AND a requested position: one notice. Bob was confirmed. Carol was requested.
    for (const name of ["c2-alice", "c2-bob", "c2-carol"]) {
      const m = await mail(name);
      expect(m, name).toHaveLength(1);
      expect(m[0]!.template_key).toBe("worship.notice.cancelled");
    }
    for (const name of ["c2-child", "c2-dnc", "c2-decliner"]) expect(await mail(name), name).toHaveLength(0);
    const [alice] = await mail("c2-alice");
    const text = `${alice!.subject}\n${alice!.text_body}\n${alice!.html_body}`;
    expect(alice!.subject).toMatch(/: a service was cancelled$/);
    expect(text).toMatch(/The service on [A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2} at \d{1,2}:\d{2} (AM|PM) was cancelled, so you are not serving that day\./);
    expect(text).not.toMatch(/Alice|Bob|Carol|Worshiptest|Decliner/);
    expect(text).toMatch(/\/o\/[a-z0-9-]+\/worship/);
    for (const url of text.match(/https?:\/\/[^\s"<]+/g) ?? []) expect(url).not.toContain("?");
  });

  it("writes one audit row with counts only, attributed to the cancelling user; nothing is written when nothing happened", async () => {
    const { w } = await cast("c3");
    await store.cancelService(v(w.planner, w), { eventId: w.sunday });
    const rows = await t.q(sql`select action, resource_type, resource_id, actor_user_id::text as actor, metadata from audit_events
                                where resource_id = ${w.sunday} and action = 'tenant.worship.service_cancelled'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ resource_type: "worship_service", actor: t.fx.actingUserId });
    expect(rows[0]!.metadata).toEqual({ eventId: w.sunday, withdrawn: 6, notified: 3 });
    // A service with only retained rows or none: the cancel still happens, with no audit row of ours.
    const empty = await t.build("c3b");
    await store.cancelService(v(empty.planner, empty), { eventId: empty.later });
    expect(await t.q(sql`select 1 from audit_events where resource_id = ${empty.later} and action = 'tenant.worship.service_cancelled'`)).toHaveLength(0);
    expect((await t.one(sql`select cancelled_at from events where id = ${empty.later}`)).cancelled_at).not.toBeNull();
  });

  it("a cancel from MANAGE EVENTS behaves exactly like one from the worship board", async () => {
    const board = await cast("c4a");
    const manage = await cast("c4b");
    const eventsManager = await t.person(manage.w.org, "Evmanager", ["events.manage"]);
    await store.cancelService(v(board.w.planner, board.w), { eventId: board.w.sunday });
    expect(await events.cancelEvent(eventsManager, manage.w.org, manage.w.sunday, { userId: t.fx.actingUserId, email: "actor@example.invalid" })).toEqual({
      kind: "ok",
      data: { eventId: manage.w.sunday },
    });
    const summarize = async (c: Cast, tag: string) => ({
      statuses: await Promise.all(Object.values(c.ids).map(async (id) => (await row(id)).status)),
      alice: (await mail(`${tag}-alice`)).length,
      bob: (await mail(`${tag}-bob`)).length,
      carol: (await mail(`${tag}-carol`)).length,
      child: (await mail(`${tag}-child`)).length,
      audit: (await t.one(sql`select metadata from audit_events where resource_id = ${c.w.sunday} and action = 'tenant.worship.service_cancelled'`)).metadata,
    });
    const a = await summarize(board, "c4a");
    const b = await summarize(manage, "c4b");
    expect({ ...b, audit: { ...(b.audit as object), eventId: "x" } }).toEqual({ ...a, audit: { ...(a.audit as object), eventId: "x" } });
  });

  it("with the toggle OFF the rows are still withdrawn but nothing is queued (Manage events can still cancel)", async () => {
    const { w, ids } = await cast("c5", { toggle: false });
    const eventsManager = await t.person(w.org, "Evmanager", ["events.manage"]);
    await events.cancelEvent(eventsManager, w.org, w.sunday, null);
    expect((await row(ids.aliceRequested)).status).toBe("withdrawn");
    expect((await row(ids.bobConfirmed)).status).toBe("confirmed");
    for (const name of ["c5-alice", "c5-bob", "c5-carol"]) expect(await mail(name), name).toHaveLength(0);
    // The audit row is still written, with no notification counted and no actor.
    const rows = await t.q(sql`select actor_user_id, metadata from audit_events where resource_id = ${w.sunday} and action = 'tenant.worship.service_cancelled'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_user_id: null });
    expect((rows[0]!.metadata as { notified: number }).notified).toBe(0);
  });

  it("with no safe platform origin the cancel still commits and withdraws; no notice can be linked, so none is written", async () => {
    const { w, ids } = await cast("c6");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "not a url");
    try {
      expect((await store.cancelService(v(w.planner, w), { eventId: w.sunday })).kind).toBe("ok");
    } finally {
      vi.unstubAllEnvs();
    }
    expect((await row(ids.aliceRequested)).status).toBe("withdrawn");
    expect(await mail("c6-alice")).toHaveLength(0);
  });

  it("a repeat cancel runs no hook: no new notice, no second audit row", async () => {
    const { w } = await cast("c7");
    await store.cancelService(v(w.planner, w), { eventId: w.sunday });
    const first = (await mail("c7-alice")).length;
    expect(await store.cancelService(v(w.planner, w), { eventId: w.sunday })).toEqual({ kind: "ok", data: { changed: false } });
    expect((await mail("c7-alice")).length).toBe(first);
    expect(await t.q(sql`select 1 from audit_events where resource_id = ${w.sunday} and action = 'tenant.worship.service_cancelled'`)).toHaveLength(1);
  });

  it("a plain event runs no worship code: cancelling it through Manage events leaves worship rows and the queue alone", async () => {
    const { w } = await cast("c8");
    const plain = String((await t.one(sql`insert into events (organization_id, title, starts_at)
                                           values (${w.org}, 'Finance committee', presby_worship_org_now(${w.org}) + interval '4 days') returning id`)).id);
    const eventsManager = await t.person(w.org, "Evmanager", ["events.manage"]);
    const before = (await t.one(sql`select count(*)::int as n from worship_assignments where organization_id = ${w.org} and status = 'withdrawn'`)).n;
    await events.cancelEvent(eventsManager, w.org, plain, null);
    expect((await t.one(sql`select count(*)::int as n from worship_assignments where organization_id = ${w.org} and status = 'withdrawn'`)).n).toBe(before);
    expect(await mail("c8-alice")).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  it("a hook that cannot write its queue rows ROLLS THE CANCEL BACK: the event is not cancelled, nothing is withdrawn, nothing is audited", async () => {
    const { w, ids } = await cast("c9");
    hooks.queueFails = true;
    await expect(store.cancelService(v(w.planner, w), { eventId: w.sunday })).rejects.toThrow("queue unavailable");
    hooks.queueFails = false;
    expect((await t.one(sql`select cancelled_at from events where id = ${w.sunday}`)).cancelled_at).toBeNull();
    for (const id of [ids.aliceDraft, ids.aliceRequested, ids.carolRequested]) expect((await row(id)).status, id).not.toBe("withdrawn");
    expect(await t.q(sql`select 1 from audit_events where resource_id = ${w.sunday} and action = 'tenant.worship.service_cancelled'`)).toHaveLength(0);
    // The same through Manage events.
    const eventsManager = await t.person(w.org, "Evmanager", ["events.manage"]);
    hooks.queueFails = true;
    await expect(events.cancelEvent(eventsManager, w.org, w.sunday, null)).rejects.toThrow("queue unavailable");
    hooks.queueFails = false;
    expect((await t.one(sql`select cancelled_at from events where id = ${w.sunday}`)).cancelled_at).toBeNull();
    // And once the queue works the cancel goes through.
    expect((await store.cancelService(v(w.planner, w), { eventId: w.sunday })).kind).toBe("ok");
  });

  // -------------------------------------------------------------------------
  describe("a response racing a cancel ends consistent", () => {
    it("the answer lands first (the person is told of the cancel) or the cancel does (the answer is 'no longer open'); never a withdrawn row that answered", async () => {
      const { w, ids } = await cast("c10");
      const [answer, cancel] = await Promise.all([
        store.respondToAssignment(v(w.alice, w), { assignmentId: ids.aliceRequested, answer: "accepted" }),
        store.cancelService(v(w.planner, w), { eventId: w.sunday }),
      ]);
      expect(cancel.kind).toBe("ok");
      const final = await row(ids.aliceRequested);
      if (answer.kind === "ok") {
        // The answer committed before the cancel read the row: it is now confirmed and RETAINED, and they are told.
        expect(final.status).toBe("confirmed");
        expect(await mail("c10-alice")).toHaveLength(1);
      } else {
        expect(answer).toEqual({ kind: "conflict", reason: "not_open", message: GATE_COPY.closedRequest.heading });
        expect(final.status).toBe("withdrawn");
        expect(await mail("c10-alice")).toHaveLength(1);
      }
    });
  });
});
