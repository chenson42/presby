/**
 * drizzle/0066 on a REAL database: the engagement vocabulary (F243), the
 * engagement guard (R53, which binds EVERY role, the owner included) and the
 * roll-cache guard (F244, owner path only). Community Increment 3a, Batch A1,
 * test file T-E (docs/work-log/2026-10-22-founding-admin-directory-inc3.md,
 * Phase 3 sections 4.9 and 6.3, EC-10, EC-14, EC-15).
 *
 * ON PHASE 5's DB-BACKED LIST (arch-A4): the one-active-roll unique index
 * (memberships_one_active_roll_idx) moved here, onto the OWNER connection,
 * from scripts/test-rls.sql section 7 - presby_app can no longer write
 * current_roll at all, so that suite's insert is refused by the roll-cache
 * guard before the index is reached (scripts/membership-standing/
 * test-rls.sql.integration.patch removes it; test-rls-66.sql (g) asserts the
 * refusal).
 *
 * The roll projection's own writes (presby_sync_current_roll on an approved
 * roll action, the participant functions, the daily reconcile) pass the
 * roll-cache guard because they are owner-owned definers: proven here for
 * the projection trigger, and by re-running session-approval.db.test.ts and
 * participant-roll.db.test.ts unedited (A1 gate).
 *
 * Run with (serial):
 *   npx dotenv -e .env.local -- npx vitest run --no-file-parallelism src/lib/db/domain/engagement-guards.db.test.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { rowsOf } from "@/lib/testing/invitation-fixture";
import type { MembershipStandingFixture } from "@/lib/testing/membership-standing-fixture";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 240_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const files = readdirSync(path.join(process.cwd(), "drizzle")).filter((f) => /^\d{4}_presby_membership_standing\.sql$/.test(f));
if (files.length !== 1) throw new Error(`expected one *_presby_membership_standing.sql, found ${files.length}`);
const M66_TEXT = readFileSync(path.join(process.cwd(), "drizzle", files[0]!), "utf8");
function block(name: string): string {
  const start = M66_TEXT.indexOf(`-- BEGIN ${name}\n`);
  const end = M66_TEXT.indexOf(`-- END ${name}\n`);
  if (start < 0 || end < 0) throw new Error(`block ${name} not found in 0066`);
  return M66_TEXT.slice(start + `-- BEGIN ${name}\n`.length, end);
}

const ENDED = "memberships: this membership has ended; its engagement can no longer change";
const STAFF = "memberships: staff is set only when a staff record is created; engagement cannot change into or out of staff";
const ROLLED_VISITOR = "memberships: a person on the roll cannot be marked as a visitor";
const ROLL_CACHE = "memberships: current_roll and current_roll_since are written only by the roll; record a roll action instead (drizzle/0066, F244)";

describe.skipIf(!hasDb)("drizzle/0066 engagement and roll-cache guards (Postgres-backed)", () => {
  let fx: MembershipStandingFixture;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    const mod = await import("@/lib/testing/membership-standing-fixture");
    fx = await mod.createMembershipStandingFixture("eg66");
    orgA = await fx.org("a");
    orgB = await fx.org("b");
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  describe("F243: the vocabulary", () => {
    it("a value outside the five is refused on INSERT and UPDATE, on the owner path too", async () => {
      const p = await fx.person();
      const id = await fx.membership(orgA, p, null, "regular");
      await fx.ownerRolledBack(async (tx) => {
        // A second organization's membership needs the person claim (memberships_guard_insert, drizzle/0009 and 0048).
        await tx.execute(sql`select set_config('app.person_claim_authorized', ${p}, true)`);
        const ins = await fx.refused(tx, sql`insert into memberships (organization_id, person_id, engagement_status) values (${orgB}, ${p}, 'unknown')`);
        expect([ins.code, ins.constraint]).toEqual(["23514", "memberships_engagement_status_allowed"]);
        const upd = await fx.refused(tx, sql`update memberships set engagement_status = 'Regular' where id = ${id}`);
        expect([upd.code, upd.constraint]).toEqual(["23514", "memberships_engagement_status_allowed"]);
      });
    });

    it("each of the five is accepted at INSERT", async () => {
      await fx.ownerRolledBack(async (tx) => {
        for (const e of ["visitor", "regular", "inactive", "moved_away", "staff"]) {
          const p = await fx.person(e);
          await tx.execute(sql`insert into memberships (organization_id, person_id, engagement_status) values (${orgA}, ${p}, ${e})`);
        }
      });
    });

    it("the stop-block raises with a count and no value against a scratch copy holding a violator (rolled back)", async () => {
      const p = await fx.person();
      await fx.ownerRolledBack(async (tx) => {
        await tx.execute(sql`alter table memberships drop constraint memberships_engagement_status_allowed`);
        await tx.execute(sql`insert into memberships (organization_id, person_id, engagement_status) values (${orgA}, ${p}, 'fixture_secret_value')`);
        const r = await fx.refused(tx, sql.raw(block("preconditions")));
        expect(r.message).toBe("0066: 1 membership(s) carry an engagement_status outside (visitor, regular, inactive, moved_away, staff); correct them before this migration can apply");
        expect(r.message).not.toContain("fixture_secret_value");
      });
      expect((await fx.q(sql`select count(*)::int as n from pg_constraint where conname = 'memberships_engagement_status_allowed' and convalidated`))[0]!.n).toBe(1);
    });
  });

  describe("R53: the engagement guard binds every role", () => {
    for (const conn of ["owner", "presby_app"] as const) {
      it(`${conn}: an ended membership, a transition into or out of staff, and visitor on a rolled membership are refused; the editable transitions pass`, async () => {
        const visitor = await fx.membership(orgA, await fx.person("V"), null, "visitor");
        const staff = await fx.membership(orgA, await fx.person("S"), null, "staff");
        const rolled = await fx.membership(orgA, await fx.person("R"), "active", "regular");
        const ended = await fx.membership(orgA, await fx.person("E"), null, "regular");
        await fx.q(sql`update memberships set ended_on = current_date, ended_reason = 'moved away' where id = ${ended}`);

        const run = conn === "owner" ? fx.ownerRolledBack : (fn: Parameters<typeof fx.ownerRolledBack>[0]) => fx.appRolledBack(orgA, fn);
        await run(async (tx) => {
          const intoStaff = await fx.refused(tx, sql`update memberships set engagement_status = 'staff' where id = ${visitor}`);
          expect([intoStaff.code, intoStaff.message]).toEqual(["23514", STAFF]);
          const outOfStaff = await fx.refused(tx, sql`update memberships set engagement_status = 'regular' where id = ${staff}`);
          expect([outOfStaff.code, outOfStaff.message]).toEqual(["23514", STAFF]);
          const rolledVisitor = await fx.refused(tx, sql`update memberships set engagement_status = 'visitor' where id = ${rolled}`);
          expect([rolledVisitor.code, rolledVisitor.message]).toEqual(["23514", ROLLED_VISITOR]);
          const onEnded = await fx.refused(tx, sql`update memberships set engagement_status = 'inactive' where id = ${ended}`);
          expect([onEnded.code, onEnded.message]).toEqual(["23514", ENDED]);

          for (const next of ["regular", "inactive", "moved_away", "visitor"]) {
            const r = await tx.execute(sql`update memberships set engagement_status = ${next} where id = ${visitor} returning id`);
            expect(rowsOf(r), `visitor path -> ${next}`).toHaveLength(1);
          }
          // A rolled membership may be inactive or moved away (a label, not a departure).
          const r = await tx.execute(sql`update memberships set engagement_status = 'moved_away' where id = ${rolled} returning id`);
          expect(rowsOf(r)).toHaveLength(1);
          // An update that does not change engagement does not fire the guard.
          const same = await tx.execute(sql`update memberships set engagement_status = 'staff', household_id = null where id = ${staff} returning id`);
          expect(rowsOf(same)).toHaveLength(1);
        });
      });
    }
  });

  describe("F244: the roll cache is owner-path only", () => {
    it("presby_app: an INSERT with current_roll or current_roll_since and an UPDATE of either are refused (check_violation and the memberships: prefix only)", async () => {
      const id = await fx.membership(orgA, await fx.person("Cache"), null, "regular");
      const fresh = await fx.person("Fresh");
      await fx.appRolledBack(orgA, async (tx) => {
        for (const q of [
          sql`insert into memberships (organization_id, person_id, engagement_status, current_roll) values (${orgA}, ${fresh}, 'regular', 'baptized')`,
          sql`insert into memberships (organization_id, person_id, engagement_status, current_roll_since) values (${orgA}, ${fresh}, 'regular', current_date)`,
          sql`update memberships set current_roll = 'active' where id = ${id}`,
          sql`update memberships set current_roll_since = current_date where id = ${id}`,
        ]) {
          const r = await fx.refused(tx, q);
          expect([r.code, r.message]).toEqual(["23514", ROLL_CACHE]);
        }
        const ok = await tx.execute(sql`insert into memberships (organization_id, person_id, engagement_status) values (${orgA}, ${fresh}, 'regular') returning id`);
        expect(rowsOf(ok), "an insert with a null roll passes").toHaveLength(1);
      });
    });

    it("the owner writes both columns (fixtures, the 0012 backfill)", async () => {
      const p = await fx.person("Owner");
      await fx.ownerRolledBack(async (tx) => {
        const r = await tx.execute(sql`
          insert into memberships (organization_id, person_id, engagement_status, current_roll, current_roll_since)
          values (${orgA}, ${p}, 'regular', 'baptized', current_date) returning id`);
        const id = String(rowsOf(r)[0]!.id);
        const u = await tx.execute(sql`update memberships set current_roll = 'active', current_roll_since = current_date where id = ${id} returning id`);
        expect(rowsOf(u)).toHaveLength(1);
      });
    });

    it("an approved roll action written by presby_app's flow reaches current_roll through the presby_sync_current_roll definer (owner path)", async () => {
      // The decision functions are definers; here the approved row is written on
      // the owner connection and the projection trigger (a definer) does the
      // write the guard must let through.
      const p = await fx.person("Projected");
      const id = await fx.membership(orgA, p, null, "regular");
      await fx.ownerRolledBack(async (tx) => {
        await tx.execute(sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status, approved_on, minute_reference)
          values (${orgA}, ${p}, 'baptized_member_enrolled', current_date, 'baptized', 'approved', current_date, 'Session fixture minute')`);
        const [row] = rowsOf(await tx.execute(sql`select current_roll from memberships where id = ${id}`));
        expect(row!.current_roll).toBe("baptized");
      });
      const [def] = await fx.q(sql`select prosecdef, proowner::regrole::text as owner from pg_proc where proname = 'presby_sync_current_roll'`);
      const [tableOwner] = await fx.q(sql`select relowner::regrole::text as owner from pg_class where relname = 'memberships'`);
      expect(def).toEqual({ prosecdef: true, owner: tableOwner!.owner });
    });

    it("the one-active-roll unique index still holds, asserted on the OWNER connection (moved from test-rls.sql section 7)", async () => {
      const p = await fx.person("Twice");
      await fx.membership(orgA, p, "active", "regular");
      await fx.ownerRolledBack(async (tx) => {
        await tx.execute(sql`select set_config('app.person_claim_authorized', ${p}, true)`);
        const r = await fx.refused(tx, sql`
          insert into memberships (organization_id, person_id, engagement_status, current_roll) values (${orgB}, ${p}, 'regular', 'active')`);
        expect([r.code, r.constraint]).toEqual(["23505", "memberships_one_active_roll_idx"]);
        // A second roll of another kind elsewhere is fine (G-1.0403: an affiliate is an active member elsewhere).
        const ok = await tx.execute(sql`
          insert into memberships (organization_id, person_id, engagement_status, current_roll) values (${orgB}, ${p}, 'regular', 'affiliate') returning id`);
        expect(rowsOf(ok)).toHaveLength(1);
      });
    });
  });
});
