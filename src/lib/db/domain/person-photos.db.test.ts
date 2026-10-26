/**
 * drizzle/0078 on the OWNER path (person photos, Increment 1; DECISION-285;
 * docs/work-log/2026-10-26-person-photos-inc1.md, Test Plan R78d and edge
 * cases 5, 17).
 *
 * getPlatformDb() is neondb_owner: it holds every privilege by ownership and
 * bypasses RLS, so no grant binds it (F44). Only the triggers and constraints
 * do. scripts/person-photos/test-rls-78.sql proves the presby_app half; this
 * file proves what presby_app cannot reach:
 *
 *   - both guards bind the owner: immutable columns, one-way removal and
 *     ending, and no designation of a removed photo;
 *   - the FK BEHIND each guard: with the guard disabled inside a rolled-back
 *     transaction, a designation of another person's photo is still refused,
 *     by person_photo_designations_photo_fk;
 *   - people_photo_key_retired binds the owner;
 *   - a membership holding photos cannot be deleted (NO ACTION; the future
 *     merge writer must move photos explicitly, G10);
 *   - deleting a fixture organization (deletable_until) cascades through both
 *     tables and their blobs in one statement, NO ACTION FKs and all (edge
 *     case 17; the teardown every photo test relies on).
 *
 * Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/person-photos.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";
import {
  removeSeededPersonPhoto,
  seedPersonPhoto,
  type SeededPersonPhoto,
} from "@/lib/testing/person-photo-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []));

/** The Postgres error behind a drizzle query error. */
async function pgError(p: Promise<unknown>): Promise<{ code?: string; constraint?: string; message?: string }> {
  try {
    await p;
  } catch (e) {
    const c = (e as { cause?: { code?: string; constraint?: string; message?: string } }).cause ?? (e as object);
    return c as { code?: string; constraint?: string; message?: string };
  }
  throw new Error("expected the statement to be refused, and it succeeded");
}

describe.skipIf(!hasDb)("drizzle/0078 person photos: the owner path (Postgres-backed)", () => {
  let fx: CalendarFixture;
  let org: string;
  let alice: string;
  let bram: string;
  let a1: SeededPersonPhoto;
  let b1: SeededPersonPhoto;
  const tag = `P78${Date.now().toString(36)}`;

  const q = async (query: SQL): Promise<Row[]> => rowsOf(await fx.platform.execute(query));

  beforeAll(async () => {
    const mod = await import("@/lib/testing/calendar-fixture");
    fx = await mod.createCalendarFixture("person-photos-owner");
    org = await fx.makeOrg("photos");
    alice = await fx.makePerson("Alice", tag);
    bram = await fx.makePerson("Bram", tag);
    for (const p of [alice, bram]) await fx.addMember(org, p);
    a1 = await seedPersonPhoto(fx.platform, { organizationId: org, personId: alice, userId: fx.actingUserId, purposes: ["directory"] });
    b1 = await seedPersonPhoto(fx.platform, { organizationId: org, personId: bram, userId: fx.actingUserId, purposes: [] });
  }, 90_000);

  afterAll(async () => {
    if (!fx) return;
    await fx.cleanup();
    const left = await rowsOf(
      await (await import("@/lib/db")).getPlatformDb().execute(sql`
        select (select count(*) from person_photos where organization_id = ${org})::int
             + (select count(*) from person_photo_designations where organization_id = ${org})::int
             + (select count(*) from blob_assets where organization_id = ${org})::int as n`),
    );
    expect(left[0]!.n, "the fixture org's photo rows and blobs are gone").toBe(0);
  }, 90_000);

  it("(premise) this connection is the owner, which RLS and grants do not bind", async () => {
    const [r] = await q(sql`select current_user as u, (select rolbypassrls from pg_roles where rolname = current_user) as bypass,
                                   (select pg_get_userbyid(relowner) from pg_class where relname = 'person_photos') as owner`);
    expect(r!.bypass).toBe(true);
    expect(r!.u).toBe(r!.owner);
  });

  describe("person_photos_guard_write binds the owner (F44)", () => {
    it.each([
      ["image_asset_key", () => sql`image_asset_key = ${b1.imageKey}`],
      ["person_id (to another member of the org)", () => sql`person_id = ${bram}`],
      ["width", () => sql`width = 1`],
      ["created_at", () => sql`created_at = now() - interval '1 day'`],
      ["created_by", () => sql`created_by = gen_random_uuid()`],
      ["asset_audience", () => sql`asset_audience = 'public_site'`],
    ])("an UPDATE of %s is refused by the guard, before any FK or CHECK", async (_col, set) => {
      const err = await pgError(fx.platform.execute(sql`update person_photos set ${set()} where id = ${a1.photoId}`));
      expect(err.code).toBe("23514");
      expect(err.message).toContain("only removed_at and removed_by may change");
    });

    it("removal is one-way: no un-remove, no re-dating, on the owner path too", async () => {
      await removeSeededPersonPhoto(fx.platform, b1.photoId, fx.actingUserId);
      for (const set of [sql`removed_at = null, removed_by = null`, sql`removed_at = now() - interval '1 day'`]) {
        const err = await pgError(fx.platform.execute(sql`update person_photos set ${set} where id = ${b1.photoId}`));
        expect(err.code).toBe("23514");
        expect(err.message).toContain("is removed and cannot change (removal is one-way)");
      }
    });
  });

  describe("person_photo_designations_guard_write binds the owner (F44)", () => {
    it("a removed photo cannot be designated, even by the owner", async () => {
      const err = await pgError(
        fx.platform.execute(sql`
          insert into person_photo_designations (organization_id, person_id, photo_id, purpose, public_attested_at, public_attested_by, designated_by)
          values (${org}, ${bram}, ${b1.photoId}, 'website', now(), ${fx.actingUserId}, ${fx.actingUserId})`),
      );
      expect(err.code).toBe("23514");
      expect(err.message).toContain("is removed, or is not this person's photo in this organization");
    });

    it("an ended designation cannot be revived or changed, and an active one changes only by ending", async () => {
      const [d] = await q(sql`select id from person_photo_designations where photo_id = ${a1.photoId} and ended_at is null`);
      const err1 = await pgError(fx.platform.execute(sql`update person_photo_designations set purpose = 'website' where id = ${String(d!.id)}`));
      expect(err1.code).toBe("23514");
      expect(err1.message).toContain("only ended_at and ended_by may change");
      await q(sql`update person_photo_designations set ended_at = now(), ended_by = ${fx.actingUserId} where id = ${String(d!.id)}`);
      const err2 = await pgError(
        fx.platform.execute(sql`update person_photo_designations set ended_at = null, ended_by = null where id = ${String(d!.id)}`),
      );
      expect(err2.code).toBe("23514");
      expect(err2.message).toContain("is ended and cannot change (ending is one-way)");
    });

    it("the FK behind the guard: with the guard disabled (rolled back), another person's photo is still refused by person_photo_designations_photo_fk", async () => {
      const err = await pgError(
        fx.platform.transaction(async (tx) => {
          await tx.execute(sql`alter table person_photo_designations disable trigger person_photo_designations_guard_write`);
          await tx.execute(sql`
            insert into person_photo_designations (organization_id, person_id, photo_id, purpose, designated_by)
            values (${org}, ${bram}, ${a1.photoId}, 'directory', ${fx.actingUserId})`);
        }),
      );
      expect(err.code).toBe("23503");
      expect(err.constraint).toBe("person_photo_designations_photo_fk");
      const [t] = await q(sql`select tgenabled from pg_trigger where tgname = 'person_photo_designations_guard_write'`);
      expect(t!.tgenabled, "the rollback re-enabled the guard").toBe("O");
    });
  });

  it("people.photo_key and photo_updated_at are retired on the owner path too (people_photo_key_retired)", async () => {
    for (const set of [sql`photo_key = gen_random_uuid()::text`, sql`photo_updated_at = now()`]) {
      const err = await pgError(fx.platform.execute(sql`update people set ${set} where id = ${alice}`));
      expect(err.code).toBe("23514");
      expect(err.constraint).toBe("people_photo_key_retired");
    }
  });

  it("a membership holding photos cannot be deleted (person_photos_person_fk, NO ACTION; G10)", async () => {
    // The derived Active Membership group row references the membership too
    // (group_memberships_person_fk); clear it first, inside the same rolled-back
    // transaction, so the only remaining referrer is the photo.
    const err = await pgError(
      fx.platform.transaction(async (tx) => {
        await tx.execute(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
        await tx.execute(sql`delete from group_memberships where person_id = ${alice} and organization_id = ${org}`);
        await tx.execute(sql`delete from memberships where person_id = ${alice} and organization_id = ${org}`);
      }),
    );
    expect(err.code).toBe("23503");
    expect(err.constraint).toBe("person_photos_person_fk");
    const [m] = await q(sql`select count(*)::int as n from memberships where person_id = ${alice} and organization_id = ${org}`);
    expect(m!.n, "rolled back: the membership is still there").toBe(1);
  });

  it("deleting a fixture organization cascades through both tables and their blobs in one statement (edge case 17)", async () => {
    const mod = await import("@/lib/testing/calendar-fixture");
    const other = await mod.createCalendarFixture("person-photos-orgdel");
    const o2 = await other.makeOrg("doomed");
    const p = await other.makePerson("Cora", tag);
    await other.addMember(o2, p);
    await seedPersonPhoto(other.platform, { organizationId: o2, personId: p, userId: other.actingUserId, purposes: ["directory", "website"] });
    const count = async () =>
      Number(
        (
          await q(sql`select (select count(*) from person_photos where organization_id = ${o2})
                           + (select count(*) from person_photo_designations where organization_id = ${o2})
                           + (select count(*) from blob_assets where organization_id = ${o2}) as n`)
        )[0]!.n,
      );
    expect(await count()).toBe(5); // 1 photo, 2 designations, 2 blobs
    await other.cleanup();
    expect(await count()).toBe(0);
  });
});
