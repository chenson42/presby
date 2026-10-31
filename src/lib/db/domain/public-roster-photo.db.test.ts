/**
 * D3 - the two anonymous roster functions after drizzle/0072 (F289,
 * DECISION-277, operator ruling "hide_photo wins"; docs/work-log/
 * 2026-10-25-public-asset-allowlist.md, Phase 3 "Test Plan" D3), as switched
 * to person_photos by drizzle/0078 (DECISION-286; docs/work-log/
 * 2026-10-26-person-photos-inc1.md, F331: rewritten to seed person_photos and
 * designations - people.photo_key is retired and a write to it is refused).
 *
 * On the presby_app connection, exactly as the public site calls them (no org
 * GUC - they are SECURITY DEFINER and read the slug):
 *
 *   - a listed person whose person_privacy.hide_photo is set is STILL listed
 *     (name, role) but with photo_key null - in the staff branch, the officer
 *     branch and the committee function;
 *   - the same person without the flag, and a person with no person_privacy
 *     row at all, keep their key;
 *   - both functions keep their hardening through `create or replace`:
 *     prosecdef, proconfig search_path=public, pg_temp (0048), an ACL of the
 *     owner plus presby_app only, and an unchanged signature and result row.
 *
 * One positive through the asset door (presby_public_site_asset) on the
 * presby_app connection proves the definer reaches both roster helpers - and,
 * since 0078, presby_person_public_photo() inside them - without a permission
 * error and withholds a hidden photo (the 0046 B-M1 rule: every helper a
 * definer calls is exercised as presby_app).
 *
 * 0078's own live-site matrix (scripts/person-photos/test-rls-78.sql 78e
 * cannot reach a live site as presby_app): the Q6 fallback, a thumbnail key,
 * a removed photo, an ended designation and the toggle, through the rosters
 * AND the door.
 *
 * Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/public-roster-photo.db.test.ts
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";
import {
  removeSeededPersonPhoto,
  seedPersonPhoto,
  setPersonPhotosToggle,
  type SeededPersonPhoto,
} from "@/lib/testing/person-photo-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []));

describe.skipIf(!hasDb)("drizzle/0072 + 0078 roster functions: hide_photo wins (Postgres-backed)", () => {
  let fx: CalendarFixture;
  let appDb: typeof import("@/lib/db").db;
  let org: string;
  let slug: string;

  // Names carry a per-run tag so assertions read only this run's rows.
  const tag = `F${Date.now().toString(36)}`;
  const photo = {
    elsewhereHidden: randomUUID(),
    staffHidden: randomUUID(),
    staffShown: randomUUID(),
    staffNoPrivacyRow: randomUUID(),
    officerHidden: randomUUID(),
    committeeHidden: randomUUID(),
    committeeShown: randomUUID(),
  };
  const seeded: Record<string, SeededPersonPhoto> = {};

  const q = async (query: SQL): Promise<Row[]> => rowsOf(await fx.platform.execute(query));
  const asApp = async (query: SQL): Promise<Row[]> => rowsOf(await appDb.execute(query));

  /** A member of `org` whose website photo is `photoKey` (designated, attested). */
  async function listedPerson(first: string, photoKey: string, hidePhoto: boolean | null): Promise<string> {
    const id = await fx.makePerson(first, tag);
    await fx.addMember(org, id);
    seeded[first] = await seedPersonPhoto(fx.platform, {
      organizationId: org,
      personId: id,
      userId: fx.actingUserId,
      imageKey: photoKey,
      purposes: ["website"],
    });
    if (hidePhoto !== null) {
      await q(sql`insert into person_privacy (person_id, organization_id, hide_photo) values (${id}, ${org}, ${hidePhoto})`);
    }
    return id;
  }

  const staff = async (personId: string, position: string) =>
    q(sql`insert into staff_positions (organization_id, person_id, position, position_key, starts_on, public_listed)
          values (${org}, ${personId}, ${position}, ${position.toLowerCase()}, '2020-01-01', true)`);

  beforeAll(async () => {
    ({ db: appDb } = await import("@/lib/db"));
    const mod = await import("@/lib/testing/calendar-fixture");
    fx = await mod.createCalendarFixture("roster-photo");
    org = await fx.makeOrg("roster");
    const [o] = await q(sql`select slug from organizations where id = ${org}`);
    slug = String(o!.slug);
    await q(sql`insert into organization_sites (organization_id, repo, status) values (${org}, ${`presby-fixtures/site-${slug}`}, 'live')`);
    await setPersonPhotosToggle(fx.platform, org, true);

    await staff(await listedPerson("Hidden", photo.staffHidden, true), "Organist");
    await staff(await listedPerson("Shown", photo.staffShown, false), "Sexton");
    await staff(await listedPerson("Plain", photo.staffNoPrivacyRow, null), "Secretary");

    // A person who belongs to TWO orgs and hid their photo at the OTHER one:
    // person_privacy's key is person_id alone, so that one row is their choice.
    const otherOrg = await fx.makeOrg("roster-other");
    const elsewhere = await listedPerson("Elsewhere", photo.elsewhereHidden, null);
    // A second membership is a claim (drizzle/0009 presby_guard_membership_insert):
    // authorize it for this one person, transaction-locally, as presby_claim_person() does.
    await fx.platform.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.person_claim_authorized', ${elsewhere}, true)`);
      // No roll at the second org (one active roll per person): a relationship, not a second roll.
      await tx.execute(sql`insert into memberships (organization_id, person_id, engagement_status, current_roll)
                           values (${otherOrg}, ${elsewhere}, 'regular', null)`);
    });
    await q(sql`insert into person_privacy (person_id, organization_id, hide_photo) values (${elsewhere}, ${otherOrg}, true)`);
    await staff(elsewhere, "Choir Director");

    const officer = await listedPerson("Officer", photo.officerHidden, true);
    await q(sql`insert into officer_terms (organization_id, person_id, office, starts_on, public_listed)
                values (${org}, ${officer}, 'trustee', '2020-01-01', true)`);

    const [gt] = await q(sql`select id from group_types where key = 'committee'`);
    const [g] = await q(sql`insert into groups (organization_id, group_type_id, name, membership_source)
                            values (${org}, ${gt!.id}, ${`Mission Committee ${tag}`}, 'managed') returning id`);
    for (const [first, key, hide] of [
      ["CommitteeHidden", photo.committeeHidden, true],
      ["CommitteeShown", photo.committeeShown, false],
    ] as const) {
      const id = await listedPerson(first, key, hide);
      await q(sql`insert into group_memberships (organization_id, group_id, person_id, public_listed)
                  values (${org}, ${g!.id}, ${id}, true)`);
    }
  }, 90_000);

  afterAll(async () => {
    if (!fx) return;
    await q(sql`delete from organization_sites where organization_id = ${org}`);
    await fx.cleanup();
  }, 90_000);

  it("staff and officer branches: a hidden photo is withheld, the person stays listed", async () => {
    const rows = await asApp(sql`select kind, role_raw, display_name, photo_key from presby_public_staff_roster(${slug})`);
    const byName = Object.fromEntries(rows.map((r) => [String(r.display_name), r]));
    expect(rows).toHaveLength(5);
    expect(byName[`Hidden ${tag}`]).toMatchObject({ kind: "staff", role_raw: "Organist", photo_key: null });
    expect(byName[`Officer ${tag}`]).toMatchObject({ kind: "officer", role_raw: "trustee", photo_key: null });
    expect(byName[`Shown ${tag}`]).toMatchObject({ kind: "staff", photo_key: photo.staffShown });
    expect(byName[`Plain ${tag}`]).toMatchObject({ kind: "staff", photo_key: photo.staffNoPrivacyRow });
  });

  it("a photo hidden at ANOTHER org the person belongs to is withheld here too (one privacy row per person, fail closed)", async () => {
    const rows = await asApp(sql`select display_name, photo_key from presby_public_staff_roster(${slug}, 'staff', null)`);
    expect(rows.find((r) => r.display_name === `Elsewhere ${tag}`)).toEqual({ display_name: `Elsewhere ${tag}`, photo_key: null });
  });

  it("the filtered call shapes (p_kind) withhold it too", async () => {
    const officers = await asApp(sql`select display_name, photo_key from presby_public_staff_roster(${slug}, 'officer', null)`);
    expect(officers).toEqual([{ display_name: `Officer ${tag}`, photo_key: null }]);
  });

  it("committee function: a hidden photo is withheld, the member stays listed", async () => {
    const rows = await asApp(sql`select group_name, display_name, photo_key from presby_public_committee_roster(${slug})`);
    expect(rows).toHaveLength(2);
    const byName = Object.fromEntries(rows.map((r) => [String(r.display_name), r.photo_key]));
    expect(byName).toEqual({ [`CommitteeHidden ${tag}`]: null, [`CommitteeShown ${tag}`]: photo.committeeShown });
  });

  it("turning hide_photo off brings the photo back (the flag is read live, nothing is copied)", async () => {
    await q(sql`update person_privacy set hide_photo = false
                 where person_id = (select id from people where first_name = 'Hidden' and last_name = ${tag})`);
    try {
      const rows = await asApp(sql`select display_name, photo_key from presby_public_staff_roster(${slug}, 'staff', null)`);
      expect(rows.find((r) => r.display_name === `Hidden ${tag}`)?.photo_key).toBe(photo.staffHidden);
    } finally {
      await q(sql`update person_privacy set hide_photo = true
                   where person_id = (select id from people where first_name = 'Hidden' and last_name = ${tag})`);
    }
  });

  it("the asset door, called as presby_app, reaches both roster helpers and agrees with them (no permission error)", async () => {
    // The photo blobs exist (stored private, as person_photos_image_fk requires); add one
    // public_site site image and one private image that is nobody's photo.
    const png = (tag2: string) => Buffer.from(`\x89PNG f289 ${tag2} ${randomUUID()}`, "latin1");
    const insert = async (id: string, audience: string) => {
      const bytes = png(id);
      await q(sql`insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes, audience)
                  values (${id}, ${org}, encode(sha256(decode(${bytes.toString("hex")}, 'hex')), 'hex'), 'image/png',
                          ${bytes.byteLength}, decode(${bytes.toString("hex")}, 'hex'), ${audience})`);
    };
    const siteImage = randomUUID();
    const privateImage = randomUUID();
    await insert(siteImage, "public_site");
    await insert(privateImage, "private");

    const door = async (key: string) =>
      asApp(sql`select content_type, cache_class from presby_public_site_asset(${org}::uuid, ${key}::uuid)`);
    expect(await door(photo.staffShown)).toEqual([{ content_type: "image/jpeg", cache_class: "roster" }]);
    expect(await door(photo.committeeShown)).toEqual([{ content_type: "image/jpeg", cache_class: "roster" }]);
    expect(await door(photo.staffHidden)).toEqual([]);
    expect(await door(photo.officerHidden)).toEqual([]);
    expect(await door(photo.committeeHidden)).toEqual([]);
    expect(await door(siteImage)).toEqual([{ content_type: "image/png", cache_class: "site" }]);
    expect(await door(privateImage)).toEqual([]);
    // An uppercase key is the same key (the uuid parameter canonicalizes it)...
    expect(await door(photo.staffShown.toUpperCase())).toEqual([{ content_type: "image/jpeg", cache_class: "roster" }]);
    // ...and the STORED key can no longer differ in case: 0072's text photo_key is retired, the
    // keys are uuid columns, and the roster projects them as canonical lowercase text.
    const types = await q(sql`select column_name, data_type from information_schema.columns
                               where table_name = 'person_photos' and column_name in ('image_asset_key', 'thumb_asset_key')
                               order by column_name`);
    expect(types).toEqual([
      { column_name: "image_asset_key", data_type: "uuid" },
      { column_name: "thumb_asset_key", data_type: "uuid" },
    ]);
    const listed = (await asApp(sql`select photo_key from presby_public_staff_roster(${slug})`))
      .map((r) => r.photo_key)
      .filter((k): k is string => typeof k === "string");
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((k) => k === k.toLowerCase())).toBe(true);
  });

  it.each([
    ["presby_public_staff_roster", "p_slug text, p_kind text, p_has_priority boolean",
      "TABLE(kind text, role_raw text, department text, display_name text, photo_key text)"],
    ["presby_public_committee_roster", "p_slug text, p_committee text, p_has_priority boolean",
      "TABLE(group_name text, group_role text, display_name text, photo_key text)"],
  ])("%s keeps its hardening and its shape through create or replace", async (name, args, result) => {
    const rows = await q(sql`
      select p.prosecdef, p.proconfig, pg_get_function_identity_arguments(p.oid) as args,
             pg_get_function_result(p.oid) as result,
             (select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text)
                from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE') as executors,
             r.rolname as owner
        from pg_proc p join pg_roles r on r.oid = p.proowner
       where p.proname = ${name}`);
    expect(rows).toHaveLength(1);
    const [r] = rows;
    expect(r).toMatchObject({ prosecdef: true, proconfig: ["search_path=public, pg_temp"], args, result });
    expect(r!.executors).toEqual([r!.owner, "presby_app"].sort());
  });

  describe("drizzle/0078 on a live site: designations, thumbnails, removal, the toggle", () => {
    const door = async (key: string) =>
      asApp(sql`select cache_class from presby_public_site_asset(${org}::uuid, ${key}::uuid)`);
    const rosterKey = async (displayName: string) =>
      (await asApp(sql`select display_name, photo_key from presby_public_staff_roster(${slug})`)).find(
        (r) => r.display_name === displayName,
      )?.photo_key;

    it("a thumbnail key is never served, even for a listed, shown photo", async () => {
      expect(await door(seeded.Shown!.imageKey)).toEqual([{ cache_class: "roster" }]);
      expect(await door(seeded.Shown!.thumbKey)).toEqual([]);
    });

    it("the Q6 fallback: an ATTESTED directory photo stands in on the website; an unattested one never does", async () => {
      const attested = await fx.makePerson("DirAttested", tag);
      const unattested = await fx.makePerson("DirPlain", tag);
      for (const p of [attested, unattested]) await fx.addMember(org, p);
      const a = await seedPersonPhoto(fx.platform, {
        organizationId: org, personId: attested, userId: fx.actingUserId, purposes: ["directory"], attestDirectory: true,
      });
      const u = await seedPersonPhoto(fx.platform, {
        organizationId: org, personId: unattested, userId: fx.actingUserId, purposes: ["directory"], attestDirectory: false,
      });
      await staff(attested, "Treasurer");
      await staff(unattested, "Custodian");
      expect(await rosterKey(`DirAttested ${tag}`)).toBe(a.imageKey);
      expect(await door(a.imageKey)).toEqual([{ cache_class: "roster" }]);
      expect(await rosterKey(`DirPlain ${tag}`)).toBeNull();
      expect(await door(u.imageKey)).toEqual([]);
    });

    it("a website designation beats the attested directory photo; ending it falls back; removing the photo stops serving", async () => {
      const p = await fx.makePerson("Layered", tag);
      await fx.addMember(org, p);
      const dir = await seedPersonPhoto(fx.platform, {
        organizationId: org, personId: p, userId: fx.actingUserId, purposes: ["directory"], attestDirectory: true,
      });
      const web = await seedPersonPhoto(fx.platform, {
        organizationId: org, personId: p, userId: fx.actingUserId, purposes: ["website"],
      });
      await staff(p, "Choir Member");
      expect(await rosterKey(`Layered ${tag}`)).toBe(web.imageKey);
      expect(await door(dir.imageKey), "the directory photo is not listed while a website photo is").toEqual([]);

      await q(sql`update person_photo_designations set ended_at = now(), ended_by = ${fx.actingUserId}
                   where photo_id = ${web.photoId} and ended_at is null`);
      expect(await rosterKey(`Layered ${tag}`)).toBe(dir.imageKey);
      expect(await door(web.imageKey), "an ended website designation stops serving").toEqual([]);
      expect(await door(dir.imageKey)).toEqual([{ cache_class: "roster" }]);

      await removeSeededPersonPhoto(fx.platform, dir.photoId, fx.actingUserId);
      expect(await rosterKey(`Layered ${tag}`)).toBeNull();
      expect(await door(dir.imageKey), "a removed photo is the neutral miss, never the site branch").toEqual([]);
      expect(await asApp(sql`select display_name from presby_public_staff_roster(${slug}) where display_name = ${`Layered ${tag}`}`))
        .toHaveLength(1);
    });

    it("the toggle off withholds every roster photo and the door; back on restores them", async () => {
      await setPersonPhotosToggle(fx.platform, org, false);
      try {
        const rows = await asApp(sql`select photo_key from presby_public_staff_roster(${slug})`);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.photo_key === null)).toBe(true);
        expect(await door(photo.staffShown)).toEqual([]);
      } finally {
        await setPersonPhotosToggle(fx.platform, org, true);
      }
      expect(await rosterKey(`Shown ${tag}`)).toBe(photo.staffShown);
      expect(await door(photo.staffShown)).toEqual([{ cache_class: "roster" }]);
    });

    it("a person who is a minor is withheld at read time, with no one acting", async () => {
      const kid = await fx.makePerson("Younger", tag);
      await fx.addMember(org, kid);
      const k = await seedPersonPhoto(fx.platform, { organizationId: org, personId: kid, userId: fx.actingUserId });
      await staff(kid, "Acolyte");
      expect(await rosterKey(`Younger ${tag}`)).toBe(k.imageKey);
      await q(sql`update people set date_of_birth = current_date - interval '15 years' where id = ${kid}`);
      expect(await rosterKey(`Younger ${tag}`)).toBeNull();
      expect(await door(k.imageKey)).toEqual([]);
    });
  });
});
