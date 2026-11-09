/**
 * `states.ts` against the REAL trigger - docs/work-log/2026-11-04-worship-inc1.md,
 * Phase 3 Tests (`states.db.test.ts`), DECISION-324. Every (from, to, actor kind)
 * triple is driven through `presby_worship_assignments_guard_update` on a real
 * row, in a transaction that is rolled back, and the database's verdict is
 * compared with `canTransition`. So the pure state machine the pages and the
 * store reason from cannot drift from the guard that actually decides: 5 x 5 x 6
 * = 150 triples, plus the service conditions (open, cancelled, started) for each
 * transition kind. Where the two disagree the TRIGGER is the truth and
 * `states.ts` is the bug.
 *
 * Each actor's update is built to CHANGE at least one column from every starting
 * state, so a "no change" update (which the trigger accepts as a no-op) is never
 * mistaken for a transition.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/worship/states.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { WorshipTestWorld, WorshipWorld } from "@/lib/testing/worship-world";
import { ACTOR_KINDS, canTransition, serviceAllows, transitionKind, type ActorKind, type ServiceDateState } from "./states";
import { ASSIGNMENT_STATUSES, type AssignmentStatus } from "./vocab";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

class Rollback extends Error {}
type Tx = Parameters<Parameters<WorshipTestWorld["fx"]["platform"]["transaction"]>[0]>[0];

describe.skipIf(!hasDb)("states.ts equals the assignment guard (Postgres-backed)", () => {
  let t: WorshipTestWorld;
  let w: WorshipWorld;

  beforeAll(async () => {
    await import("@/lib/db/schema");
    const world = await import("@/lib/testing/worship-world");
    t = await world.createWorshipWorld("wstates");
    w = await t.build("a");
  });
  afterAll(async () => {
    if (t) await t.fx.cleanup();
  });

  /** A row in `from`, reached by legal steps. Returns its id. */
  async function rowIn(tx: Tx, from: AssignmentStatus): Promise<string> {
    const r = (
      await tx.execute(sql`insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
                           values (${w.org}, ${w.sunday}, ${w.band}, ${w.drums}, ${w.alice}, ${w.scheduler}) returning id::text as id`)
    ).rows[0] as { id: string };
    const id = r.id;
    if (from === "requested") {
      await tx.execute(sql`update worship_assignments set status = 'requested', sent_by_person_id = ${w.scheduler}, notice_outcome = 'emailed' where id = ${id}`);
    } else if (from === "confirmed") {
      await tx.execute(sql`update worship_assignments set status = 'confirmed', response_source = 'on_behalf', responded_by_person_id = ${w.scheduler} where id = ${id}`);
    } else if (from === "declined") {
      await tx.execute(sql`update worship_assignments set status = 'declined', response_source = 'on_behalf', responded_by_person_id = ${w.scheduler}, decline_reason = 'away' where id = ${id}`);
    } else if (from === "withdrawn") {
      await tx.execute(sql`update worship_assignments set status = 'withdrawn', withdrawn_by_person_id = ${w.scheduler}, withdrawn_reason = 'removed' where id = ${id}`);
    }
    return id;
  }

  /** The update an actor of this kind would attempt to reach `to`. */
  function attempt(tx: Tx, id: string, to: AssignmentStatus, actor: ActorKind) {
    const reason = to === "declined" ? "work" : null;
    switch (actor) {
      case "sender":
        return tx.execute(sql`update worship_assignments set status = ${to}, sent_by_person_id = ${w.scheduler}, notice_outcome = 'no_address' where id = ${id}`);
      case "self":
        return tx.execute(sql`update worship_assignments set status = ${to}, response_source = 'self', responded_by_person_id = ${w.alice}, decline_reason = ${reason} where id = ${id}`);
      case "on_behalf":
        return tx.execute(sql`update worship_assignments set status = ${to}, response_source = 'on_behalf', responded_by_person_id = ${w.leader}, decline_reason = ${reason} where id = ${id}`);
      case "link":
        return tx.execute(sql`update worship_assignments set status = ${to}, response_source = 'link', responded_by_person_id = ${w.alice}, decline_reason = ${reason} where id = ${id}`);
      case "remover":
        return tx.execute(sql`update worship_assignments set status = ${to}, withdrawn_by_person_id = ${w.leader}, withdrawn_reason = 'removed' where id = ${id}`);
      case "service_cancel":
        return tx.execute(sql`update worship_assignments set status = ${to}, withdrawn_reason = 'service_cancelled' where id = ${id}`);
    }
  }

  /** Runs one triple in a rolled-back transaction; true when the trigger accepted the update. */
  async function accepted(from: AssignmentStatus, to: AssignmentStatus, actor: ActorKind, service?: Partial<ServiceDateState>): Promise<boolean> {
    let ok = false;
    try {
      await t.fx.platform.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_org_id', ${w.org}, true)`);
        const id = await rowIn(tx, from);
        if (service?.cancelled || actor === "service_cancel") await tx.execute(sql`update events set cancelled_at = now() where id = ${w.sunday}`);
        if (service?.started) await tx.execute(sql`update events set starts_at = presby_worship_org_now(${w.org}) - interval '1 hour' where id = ${w.sunday}`);
        try {
          await attempt(tx, id, to, actor);
          ok = true;
        } catch {
          ok = false;
        }
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
    return ok;
  }

  it("every (from, to, actor) triple: the trigger accepts exactly what canTransition says", async () => {
    const disagreements: string[] = [];
    let accepts = 0;
    let refusals = 0;
    for (const from of ASSIGNMENT_STATUSES) {
      for (const to of ASSIGNMENT_STATUSES) {
        for (const actor of ACTOR_KINDS) {
          const kind = transitionKind(from, to);
          const expected = canTransition(from, to, actor) && kind !== null && serviceAllows(kind, actor, { cancelled: actor === "service_cancel", started: false });
          const actual = await accepted(from, to, actor);
          if (actual) accepts += 1;
          else refusals += 1;
          if (actual !== expected) disagreements.push(`${from} -> ${to} by ${actor}: trigger ${actual ? "accepted" : "refused"}, states.ts says ${expected ? "yes" : "no"}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
    // Both outcomes were exercised in volume (the comparison is not vacuous).
    expect(accepts).toBeGreaterThan(20);
    expect(refusals).toBeGreaterThan(80);
    expect(accepts + refusals).toBe(150);
  });

  it("the service conditions: send and respond need an open service; a person's removal needs none; a service-cancel withdrawal needs the cancel", async () => {
    const cases: Array<{ from: AssignmentStatus; to: AssignmentStatus; actor: ActorKind }> = [
      { from: "draft", to: "requested", actor: "sender" },
      { from: "requested", to: "confirmed", actor: "self" },
      { from: "requested", to: "declined", actor: "on_behalf" },
      { from: "confirmed", to: "withdrawn", actor: "remover" },
      { from: "requested", to: "withdrawn", actor: "service_cancel" },
    ];
    const states: Array<{ name: string; state: ServiceDateState }> = [
      { name: "open", state: { cancelled: false, started: false } },
      { name: "cancelled", state: { cancelled: true, started: false } },
      { name: "started", state: { cancelled: false, started: true } },
    ];
    const disagreements: string[] = [];
    for (const { from, to, actor } of cases) {
      const kind = transitionKind(from, to)!;
      for (const { name, state } of states) {
        const effective: ServiceDateState = actor === "service_cancel" ? { cancelled: true, started: state.started } : state;
        const expected = canTransition(from, to, actor) && serviceAllows(kind, actor, effective);
        const actual = await accepted(from, to, actor, state);
        if (actual !== expected) disagreements.push(`${from} -> ${to} by ${actor} on a ${name} service: trigger ${actual}, states.ts ${expected}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("a guest row: born confirmed, answers refused, removal allowed - as canTransition(..., { guest: true }) says", async () => {
    const run = async (to: AssignmentStatus, actor: ActorKind): Promise<boolean> => {
      let ok = false;
      try {
        await t.fx.platform.transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.current_org_id', ${w.org}, true)`);
          const r = (
            await tx.execute(sql`insert into worship_assignments (organization_id, event_id, group_id, position_id, guest_name, assigned_by_person_id,
                                                                    status, responded_by_person_id, response_source)
                                 values (${w.org}, ${w.sunday}, ${w.band}, ${w.drums}, 'Visitor', ${w.scheduler}, 'confirmed', ${w.scheduler}, 'on_behalf') returning id::text as id`)
          ).rows[0] as { id: string };
          try {
            await attempt(tx, r.id, to, actor);
            ok = true;
          } catch {
            ok = false;
          }
          throw new Rollback();
        });
      } catch (err) {
        if (!(err instanceof Rollback)) throw err;
      }
      return ok;
    };
    for (const [to, actor] of [
      ["declined", "on_behalf"],
      ["confirmed", "self"],
      ["withdrawn", "remover"],
      ["requested", "sender"],
    ] as Array<[AssignmentStatus, ActorKind]>) {
      const expected = canTransition("confirmed", to, actor, { guest: true });
      expect(await run(to, actor), `guest confirmed -> ${to} by ${actor}`).toBe(expected);
    }
  });
});
