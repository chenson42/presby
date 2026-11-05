/**
 * The nightly reminder step - `sweep.ts` over `presby_worship_claim_reminders`
 * (docs/work-log/2026-11-04-worship-inc1.md, Phase 3 "Cron", DECISION-325,
 * F429; Phase 4 Batch 3), against a REAL Postgres connection on the OWNER path.
 * The claim function's own windows and exclusions are pinned in
 * `worship.db.test.ts` (Batch 1); this file pins what the STEP does with them:
 *
 *   - each due assignment becomes one queued reminder to the address the
 *     definer resolved, with the ruled subject, text and bare link, once only;
 *   - never to a decliner, a withdrawn row, a guest, a cancelled service, a
 *     presumed minor, a merged or ended person, or an organization with
 *     Worship off, and not before the windows;
 *   - with no safe platform origin the step claims NOTHING;
 *   - the claim and the queue rows commit together: a failed queue insert
 *     un-claims, so the next run retries.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/worship/sweep.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { WorshipTestWorld, WorshipWorld } from "@/lib/testing/worship-world";

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

class Rollback extends Error {}

describe.skipIf(!hasDb)("worship/sweep.ts (Postgres-backed, owner path)", () => {
  let t: WorshipTestWorld;
  let sweep: typeof import("./sweep");
  let stamp: string;

  const addr = (name: string) => `${name}-${stamp}@wsweep.example.invalid`;

  beforeAll(async () => {
    await import("@/lib/db/schema");
    const world = await import("@/lib/testing/worship-world");
    t = await world.createWorshipWorld("wsweep");
    sweep = await import("./sweep");
    stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  });
  afterAll(async () => {
    if (t) {
      await t.q(sql`delete from email_queue where to_email like ${`%-${stamp}@wsweep.example.invalid`}`).catch(() => undefined);
      await t.fx.cleanup();
    }
  });
  beforeEach(() => {
    hooks.queueFails = false;
  });

  interface Setup {
    w: WorshipWorld;
    off: WorshipWorld;
    id: Record<string, string>;
    who: Record<string, string>;
  }

  /**
   * Builds every state the step must tell apart. `requested_at` must be back-dated, which no
   * connection can do through the update guard, so the guards are off while the rows go in
   * (inside the caller's transaction, so the change is undone with it) and on again before the step.
   */
  async function seed(tx: Parameters<Parameters<WorshipTestWorld["fx"]["platform"]["transaction"]>[0]>[0], tag: string): Promise<Setup> {
    const w = await t.build(tag);
    const off = await t.build(`${tag}off`, { toggle: false });
    const who: Record<string, string> = {};
    for (const k of ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9"]) {
      who[k] = await t.person(w.org, k.toUpperCase());
      await t.onRoster(w.org, w.band, who[k]!);
      await t.email(who[k]!, addr(`${tag}-${k}`));
    }
    const offPerson = await t.person(off.org, "Doff");
    await t.onRoster(off.org, off.band, offPerson);
    await t.email(offPerson, addr(`${tag}-off`));
    await t.email(w.child, addr(`${tag}-child`));
    const cancelled = await t.service(w.org, "Service cancelled", 30, [w.band]);

    await tx.execute(sql`alter table worship_assignments disable trigger worship_assignments_guard_insert`);
    await tx.execute(sql`alter table worship_assignments disable trigger worship_assignments_guard_update`);
    const ins = async (x: WorshipWorld, person: string, event: string, st: string, askedHoursAgo: number | null) => {
      const r = (
        await tx.execute(sql`insert into worship_assignments
            (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id, status,
             sent_by_person_id, requested_at, notice_outcome, responded_by_person_id, response_source, responded_at, decline_reason)
          values (${x.org}, ${event}, ${x.band}, ${x.drums}, ${person}, ${x.scheduler}, ${st},
                  ${askedHoursAgo === null ? null : x.scheduler},
                  ${askedHoursAgo === null ? null : sql`now() - make_interval(hours => ${askedHoursAgo})`},
                  ${askedHoursAgo === null ? null : "emailed"},
                  ${st === "requested" ? null : person}, ${st === "requested" ? null : "self"},
                  ${st === "requested" ? null : sql`now()`}, ${st === "declined" ? "away" : null})
          returning id::text as id`)
      ).rows[0] as { id: string };
      return r.id;
    };
    const id: Record<string, string> = {};
    id.unanswered = await ins(w, who.m1!, w.soon, "requested", 25); //  due: asked 25h ago, service 30h out
    id.confirmed = await ins(w, who.m2!, w.soon, "confirmed", 25); //   due: confirmed, service within 48h
    id.laterUnanswered = await ins(w, who.m3!, w.later, "requested", 25); // due: 60h <= 72h
    id.laterConfirmed = await ins(w, who.m4!, w.later, "confirmed", 25); // not: confirmed but 60h > 48h
    id.fresh = await ins(w, who.m5!, w.soon, "requested", 2); //        not: asked under 24h ago
    id.declined = await ins(w, who.m6!, w.soon, "declined", 25); //     not: declined
    id.far = await ins(w, who.m7!, w.midweek, "requested", 25); //     not: 5 days out
    id.cancelled = await ins(w, who.m8!, cancelled, "requested", 25); // not: service cancelled
    id.withdrawn = await ins(w, who.m9!, w.soon, "requested", 25); //  not: withdrawn below
    id.child = await ins(w, w.child, w.soon, "requested", 25); //      not: presumed minor
    id.off = await ins(off, offPerson, off.soon, "requested", 25); //  not: Worship off at that organization
    await tx.execute(sql`alter table worship_assignments enable trigger worship_assignments_guard_insert`);
    await tx.execute(sql`alter table worship_assignments enable trigger worship_assignments_guard_update`);
    await tx.execute(sql`update events set cancelled_at = now() where id = ${cancelled}`);
    await tx.execute(sql`select set_config('app.current_org_id', ${w.org}, true)`);
    await tx.execute(sql`update worship_assignments set status = 'withdrawn', withdrawn_by_person_id = ${w.scheduler}, withdrawn_reason = 'removed' where id = ${id.withdrawn}`);
    await tx.execute(sql`insert into worship_assignments (organization_id, event_id, group_id, position_id, guest_name, assigned_by_person_id, status, response_source, responded_by_person_id)
                         values (${w.org}, ${w.soon}, ${w.choir}, ${w.soprano}, 'Visiting organist', ${w.scheduler}, 'confirmed', 'on_behalf', ${w.scheduler})`);
    return { w, off, id, who };
  }

  type Tx = Parameters<Parameters<WorshipTestWorld["fx"]["platform"]["transaction"]>[0]>[0];
  async function rolledBack(fn: (tx: Tx) => Promise<void>) {
    try {
      await t.fx.platform.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }
  const mailIn = async (tx: Tx, name: string) =>
    ((await tx.execute(sql`select template_key, subject, text_body, html_body, to_email from email_queue where to_email = ${addr(name)} order by created_at`)) as unknown as {
      rows: Array<Record<string, string>>;
    }).rows;
  const stampsIn = async (tx: Tx, id: string) =>
    ((await tx.execute(sql`select unanswered_reminded_at is not null as u, reminded_at is not null as c from worship_assignments where id = ${id}`)) as unknown as {
      rows: Array<{ u: boolean; c: boolean }>;
    }).rows[0]!;

  // -------------------------------------------------------------------------
  it("queues one reminder per due assignment with the ruled subject, text and bare link - and nothing for the rest", async () => {
    await rolledBack(async (tx) => {
      const s = await seed(tx, "d1");
      const queued = await sweep.sweepReminders(tx);
      const mine = [
        ...(await mailIn(tx, "d1-m1")),
        ...(await mailIn(tx, "d1-m2")),
        ...(await mailIn(tx, "d1-m3")),
      ];
      expect(mine).toHaveLength(3);
      expect(queued).toBeGreaterThanOrEqual(3);
      for (const m of mine) expect(m!.template_key).toBe("worship.notice.reminder");

      const [waiting] = await mailIn(tx, "d1-m1");
      expect(waiting!.subject).toMatch(/: please answer your request$/);
      expect(waiting!.text_body).toContain("A request is waiting for your answer");
      expect(waiting!.text_body).toMatch(/You were asked to serve on [A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2} at \d{1,2}:\d{2} (AM|PM): Drums, Band\. Please answer so the team can plan\./);
      expect(waiting!.text_body).toContain(`/worship/requests/${s.id.unanswered}`);

      const [serving] = await mailIn(tx, "d1-m2");
      expect(serving!.subject).toMatch(/: you're serving soon$/);
      expect(serving!.text_body).toContain("You're serving soon");
      expect(serving!.text_body).toContain("Can't make it any more? Open your schedule and choose Decline, or tell your team leader.");
      expect(serving!.text_body).toMatch(/\/o\/[a-z0-9-]+\/worship(\s|$)/);
      expect(serving!.text_body).not.toContain("/requests/");

      for (const m of [...mine, ...(await mailIn(tx, "d1-m1"))]) {
        const body = `${m!.subject}\n${m!.text_body}\n${m!.html_body}`;
        expect(body).not.toMatch(/M1|M2|M3|Worshiptest/);
        for (const url of body.match(/https?:\/\/[^\s"<]+/g) ?? []) expect(url).not.toContain("?");
      }

      // Not due: confirmed too far out, asked too recently, declined, five days out, cancelled, withdrawn, a guest,
      // a presumed minor, and an organization with Worship off.
      for (const name of ["d1-m4", "d1-m5", "d1-m6", "d1-m7", "d1-m8", "d1-m9", "d1-child", "d1-off"]) {
        expect(await mailIn(tx, name), name).toHaveLength(0);
      }
    });
  });

  it("stamps the matching kind once: a second run claims nothing, and a later confirm is due for the confirmed kind exactly once", async () => {
    await rolledBack(async (tx) => {
      const s = await seed(tx, "d2");
      await sweep.sweepReminders(tx);
      expect(await stampsIn(tx, s.id.unanswered)).toEqual({ u: true, c: false });
      expect(await stampsIn(tx, s.id.confirmed)).toEqual({ u: false, c: true });
      expect(await stampsIn(tx, s.id.fresh)).toEqual({ u: false, c: false });
      expect(await stampsIn(tx, s.id.child)).toEqual({ u: false, c: false });
      const before = (await mailIn(tx, "d2-m1")).length + (await mailIn(tx, "d2-m2")).length + (await mailIn(tx, "d2-m3")).length;
      await sweep.sweepReminders(tx);
      expect((await mailIn(tx, "d2-m1")).length + (await mailIn(tx, "d2-m2")).length + (await mailIn(tx, "d2-m3")).length).toBe(before);
      // m1 confirms after being reminded: the confirmed reminder is due, once.
      await tx.execute(sql`update worship_assignments set status = 'confirmed', response_source = 'self', responded_by_person_id = ${s.who.m1!} where id = ${s.id.unanswered}`);
      await sweep.sweepReminders(tx);
      const m1 = await mailIn(tx, "d2-m1");
      expect(m1.map((m) => m.subject.replace(/^.*?: /, ""))).toEqual(["please answer your request", "you're serving soon"]);
      await sweep.sweepReminders(tx);
      expect(await mailIn(tx, "d2-m1")).toHaveLength(2);
    });
  });

  it("never reminds a merged person, a person whose relationship ended, or one marked do not contact", async () => {
    await rolledBack(async (tx) => {
      const s = await seed(tx, "d3");
      await tx.execute(sql`update people set merged_into_id = ${s.w.plain} where id = ${s.who.m1!}`);
      await tx.execute(sql`update memberships set ended_on = current_date - 1, ended_reason = 'moved' where organization_id = ${s.w.org} and person_id = ${s.who.m2!}`);
      await tx.execute(sql`update contact_methods set do_not_contact = true where person_id = ${s.who.m3!}`);
      await sweep.sweepReminders(tx);
      for (const name of ["d3-m1", "d3-m2", "d3-m3"]) expect(await mailIn(tx, name), name).toHaveLength(0);
    });
  });

  it("with no safe platform origin the step claims NOTHING (a claim with no way to link would burn the once-only stamp)", async () => {
    await rolledBack(async (tx) => {
      const s = await seed(tx, "d4");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "not a url");
      try {
        expect(await sweep.sweepReminders(tx)).toBe(0);
      } finally {
        vi.unstubAllEnvs();
      }
      expect(await stampsIn(tx, s.id.unanswered)).toEqual({ u: false, c: false });
      expect(await mailIn(tx, "d4-m1")).toHaveLength(0);
    });
  });

  it("is the only step that touches the owner connection: the claim function is not executable by presby_app", async () => {
    const { db } = await import("@/lib/db");
    await expect(
      (db as unknown as { transaction<T>(f: (tx: { execute(q: unknown): Promise<unknown> }) => Promise<T>): Promise<T> }).transaction((tx) =>
        tx.execute(sql`select * from presby_worship_claim_reminders(1)`),
      ),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  describe("the claim and the queue rows commit together", () => {
    /** Committed setup: the guards are toggled inside one transaction, so the window is closed when it commits. */
    async function committedSeed(tag: string): Promise<Setup> {
      return t.fx.platform.transaction((tx) => seed(tx, tag));
    }

    it("a failed queue insert un-claims every row, so the next run retries them", async () => {
      const s = await committedSeed("d5");
      hooks.queueFails = true;
      await expect(sweep.runWorshipReminderSweep()).rejects.toThrow("queue unavailable");
      hooks.queueFails = false;
      for (const id of [s.id.unanswered, s.id.confirmed, s.id.laterUnanswered]) {
        expect(await t.one(sql`select unanswered_reminded_at is not null as u, reminded_at is not null as c from worship_assignments where id = ${id}`), id).toEqual({ u: false, c: false });
      }
      expect(await t.q(sql`select 1 from email_queue where to_email like ${`d5-%-${stamp}@wsweep.example.invalid`}`)).toHaveLength(0);
      // The next run queues them.
      const queued = await sweep.runWorshipReminderSweep();
      expect(queued).toBeGreaterThanOrEqual(3);
      expect(await t.q(sql`select 1 from email_queue where to_email in (${addr("d5-m1")}, ${addr("d5-m2")}, ${addr("d5-m3")})`)).toHaveLength(3);
      expect((await t.one(sql`select unanswered_reminded_at is not null as u from worship_assignments where id = ${s.id.unanswered}`)).u).toBe(true);
      // And a third run finds none of them again.
      await sweep.runWorshipReminderSweep();
      expect(await t.q(sql`select 1 from email_queue where to_email in (${addr("d5-m1")}, ${addr("d5-m2")}, ${addr("d5-m3")})`)).toHaveLength(3);
    });

    it("rows the step queued are `queued`, for the five-minute worker (the step never sends inline)", async () => {
      await committedSeed("d6");
      await sweep.runWorshipReminderSweep();
      const rows = await t.q(sql`select status, attempt_count::int as attempts from email_queue where to_email = ${addr("d6-m1")}`);
      expect(rows).toEqual([{ status: "queued", attempts: 0 }]);
    });
  });
});
