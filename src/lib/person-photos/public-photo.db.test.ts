/**
 * D2: the photos page and the public website cannot drift
 * (docs/work-log/2026-10-26-person-photos-inc1.md, Phase 3 Test Plan D2;
 * DECISION-289). Real Postgres.
 *
 *   - the R3/R5 matrix again, through `presby_person_public_photo_status()` (the
 *     wrapper `reader.ts` calls) AND the public staff roster function, for every
 *     person: served, the Q6 fall-back, an unattested directory photo, hide_photo,
 *     a minor by date of birth, by birth year only and by the child marker, a
 *     merged tombstone, a removed photo, an ended designation, nobody, the toggle off;
 *   - **the parity property**: for every person in the matrix, the wrapper's image
 *     key EQUALS the roster function's `photo_key`, so the page and the public
 *     site cannot disagree;
 *   - `readPhotoSet()` end to end: authorization order, the status lines chosen
 *     from those answers, thumbnails inlined, `?view=` honoured only for this
 *     person's live photo, and the toggle-off warning count;
 *   - the toggle SQL (`presby_person_photos_enabled`) against
 *     `orgFeatureEnabledInTx` over axis x category x toggle (27 combinations);
 *   - the minor predicate against `children.ts`'s roster on date-of-birth cases.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/person-photos/public-photo.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";
import {
  removeSeededPersonPhoto,
  seedPersonPhoto,
  setPersonPhotosToggle,
  type SeededPersonPhoto,
} from "@/lib/testing/person-photo-fixture";
import { DIRECTORY_LINES, WEBSITE_LINES, listingLine } from "./copy";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []));

describe.skipIf(!hasDb)("person photos: page and public site agree (Postgres-backed)", { timeout: 240_000 }, () => {
  let fx: CalendarFixture;
  let appDb: typeof import("@/lib/db").db;
  let authz: typeof import("@/lib/authz");
  let reader: typeof import("./reader");
  let org: string;
  let slug: string;
  let editor: string;
  let bystander: string;
  const tag = `D2${Date.now().toString(36)}`;

  const q = async (query: SQL): Promise<Row[]> => rowsOf(await fx.platform.execute(query));
  const asApp = async (query: SQL): Promise<Row[]> => rowsOf(await appDb.execute(query));
  const ctx = () => ({ organizationId: org, actorPersonId: editor });

  /** Every matrix person: name -> id, with their listing and (optional) photo. */
  const people: Record<string, string> = {};
  const photos: Record<string, SeededPersonPhoto> = {};

  async function listed(name: string): Promise<string> {
    const id = await fx.makePerson(name, tag);
    await fx.addMember(org, id);
    await q(sql`insert into staff_positions (organization_id, person_id, position, position_key, starts_on, public_listed)
                values (${org}, ${id}, ${`Role ${name}`}, ${`role-${name.toLowerCase()}`}, '2020-01-01', true)`);
    people[name] = id;
    return id;
  }
  const seed = async (name: string, purposes: Array<"directory" | "website">, attestDirectory = false) => {
    photos[name] = await seedPersonPhoto(fx.platform, {
      organizationId: org,
      personId: people[name]!,
      userId: fx.actingUserId,
      purposes,
      attestDirectory,
    });
  };

  const statusOf = async (personId: string): Promise<Row | null> => {
    const rows = await authz.withOrgContext(editor, org, async (tx) =>
      rowsOf(await tx.execute(sql`select image_key::text as image_key, source, withheld from presby_person_public_photo_status(${personId}::uuid)`)),
    );
    return rows[0] ?? null;
  };
  const rosterKeyOf = async (name: string): Promise<string | null> => {
    const rows = await asApp(sql`select display_name, photo_key from presby_public_staff_roster(${slug})`);
    const row = rows.find((r) => r.display_name === `${name} ${tag}`);
    if (!row) throw new Error(`${name} is not on the roster`);
    return (row.photo_key as string | null) ?? null;
  };

  beforeAll(async () => {
    ({ db: appDb } = await import("@/lib/db"));
    authz = await import("@/lib/authz");
    reader = await import("./reader");
    const mod = await import("@/lib/testing/calendar-fixture");
    fx = await mod.createCalendarFixture("photo-d2");
    org = await fx.makeOrg("d2");
    const [o] = await q(sql`select slug from organizations where id = ${org}`);
    slug = String(o!.slug);
    await q(sql`insert into organization_sites (organization_id, repo, status) values (${org}, ${`presby-fixtures/site-${slug}`}, 'live')`);
    await q(sql`
      insert into permissions (key, module, description, sensitivity_tier)
      values ('people.manage', 'people', 'Create and edit people, households, and contact/address detail', 1),
             ('children.roster', 'children', 'The children''s ministry roster', 1)
      on conflict do nothing`);
    editor = await fx.makePerson("Edith", `Editor${tag}`);
    await fx.enroll(org, editor, ["people.manage"]);
    bystander = await fx.makePerson("Bobby", `Bystander${tag}`);
    await fx.addMember(org, bystander);
    await setPersonPhotosToggle(fx.platform, org, true);

    // The merged tombstone is created BEFORE its target so the fixture's in-order delete clears it first.
    await listed("Merged");
    await listed("Website");
    await listed("WebsiteWins");
    await listed("DirAttested");
    await listed("DirPlain");
    await listed("Hidden");
    await listed("MinorDob");
    await listed("MinorYear");
    await listed("MinorChild");
    await listed("Removed");
    await listed("Ended");
    await listed("Nobody");
    const target = await fx.makePerson("MergeTarget", tag);

    await seed("Website", ["website"]);
    await seed("WebsiteWins", ["directory", "website"], true);
    await seed("DirAttested", ["directory"], true);
    await seed("DirPlain", ["directory"], false);

    await seed("Hidden", ["website"]);
    await q(sql`insert into person_privacy (person_id, organization_id, hide_photo) values (${people.Hidden}, ${org}, true)`);

    await seed("MinorDob", ["website"]);
    await q(sql`update people set date_of_birth = (current_date - interval '12 years')::date where id = ${people.MinorDob}`);
    await seed("MinorYear", ["website"]);
    await q(sql`update people set date_of_birth = make_date(extract(year from current_date)::int - 10, 1, 1), birth_year_only = true
                 where id = ${people.MinorYear}`);
    await seed("MinorChild", ["website"]);
    await q(sql`update memberships set household_role = 'child' where organization_id = ${org} and person_id = ${people.MinorChild}`);

    await seed("Merged", ["website"]);
    await q(sql`update people set merged_into_id = ${target} where id = ${people.Merged}`);

    await seed("Removed", ["website"]);
    await removeSeededPersonPhoto(fx.platform, photos.Removed!.photoId, fx.actingUserId);
    await seed("Ended", ["website"]);
    await q(sql`update person_photo_designations set ended_at = now(), ended_by = ${fx.actingUserId}
                 where photo_id = ${photos.Ended!.photoId} and ended_at is null`);
  }, 180_000);

  afterAll(async () => {
    if (!fx) return;
    await q(sql`update people set merged_into_id = null where id = ${people.Merged ?? null}`).catch(() => undefined);
    await q(sql`delete from organization_sites where organization_id = ${org}`);
    await fx.cleanup();
  }, 180_000);

  // -------------------------------------------------------------------------
  describe("the R3/R5 matrix, status wrapper vs roster function", () => {
    const expectations: Array<[name: string, withheld: string | null, served: "website" | "directory" | null, source?: string]> = [
      ["Website", null, "website", "website"],
      ["WebsiteWins", null, "website", "website"], // a website designation beats the attested directory photo
      ["DirAttested", null, "directory", "directory_attested"], // the Q6 fall-back
      ["DirPlain", "no-row", null], // an unattested directory photo only: not eligible, so no answer at all
      ["Hidden", "hide_photo", null],
      ["MinorDob", "minor", null],
      ["MinorYear", "minor", null], // birth year only: could be under 18, so withheld
      ["MinorChild", "minor", null], // the child marker alone
      ["Merged", "merged", null],
      ["Removed", "no-row", null],
      ["Ended", "no-row", null],
      ["Nobody", "no-row", null],
    ];

    it.each(expectations)("%s: withheld=%s", async (name, withheld, served, source) => {
      const status = await statusOf(people[name]!);
      if (withheld === "no-row") {
        expect(status, `${name}: no eligible designation, so the wrapper returns zero rows`).toBeNull();
      } else {
        expect(status).not.toBeNull();
        expect(status!.withheld ?? null).toBe(withheld);
        if (source) expect(status!.source).toBe(source);
      }
      const expectedKey =
        served === "website" ? photos[name]!.imageKey : served === "directory" ? photos[name]!.imageKey : null;
      // WebsiteWins: the website designation is a SECOND photo row in the fixture helper only if seeded
      // separately; the helper seeds one photo with two designations, so the key is that photo's.
      expect(await rosterKeyOf(name)).toBe(expectedKey);
    });

    it("PARITY: for every person in the matrix the wrapper's image key equals the roster function's photo_key", async () => {
      let compared = 0;
      for (const name of Object.keys(people)) {
        if (name === "MergeTarget") continue;
        const status = await statusOf(people[name]!);
        const roster = await rosterKeyOf(name);
        expect(status?.image_key ?? null, `${name}: page vs public roster`).toBe(roster);
        compared += 1;
      }
      expect(compared).toBe(12);
    });

    it("with the toggle OFF every candidate reports toggle_off, the roster serves none, and parity still holds", async () => {
      await setPersonPhotosToggle(fx.platform, org, false);
      try {
        const status = await statusOf(people.Website!);
        expect(status).toMatchObject({ image_key: null, withheld: "toggle_off" });
        for (const name of Object.keys(people)) {
          if (name === "MergeTarget") continue;
          expect(await rosterKeyOf(name), name).toBeNull();
          expect((await statusOf(people[name]!))?.image_key ?? null, name).toBeNull();
        }
      } finally {
        await setPersonPhotosToggle(fx.platform, org, true);
      }
      expect(await rosterKeyOf("Website")).toBe(photos.Website!.imageKey);
    });

    it("hide_photo set at ANOTHER organization withholds here too (public) while the directory function stays scoped to the viewing org", async () => {
      const other = await fx.makeOrg("d2-other");
      const p = people.Website!;
      await fx.platform.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.person_claim_authorized', ${p}, true)`);
        await tx.execute(sql`insert into memberships (organization_id, person_id, engagement_status, current_roll) values (${other}, ${p}, 'regular', null)`);
      });
      await q(sql`insert into person_privacy (person_id, organization_id, hide_photo) values (${p}, ${other}, true)`);
      try {
        expect(await statusOf(p)).toMatchObject({ image_key: null, withheld: "hide_photo" });
        expect(await rosterKeyOf("Website")).toBeNull();
        const dir = await authz.withOrgContext(editor, org, async (tx) =>
          rowsOf(await tx.execute(sql`select withheld from presby_person_directory_photo(${org}::uuid, ${p}::uuid)`)),
        );
        // No directory designation for this person, so no row: and crucially no hide_photo reason scoped from the other org.
        expect(dir.every((r) => r.withheld !== "hide_photo")).toBe(true);
      } finally {
        await q(sql`delete from person_privacy where person_id = ${p} and organization_id = ${other}`);
      }
      expect(await rosterKeyOf("Website")).toBe(photos.Website!.imageKey);
    });
  });

  // -------------------------------------------------------------------------
  describe("readPhotoSet", () => {
    it("authorization: the toggle first, then people.manage, then the target; a stranger and a malformed id are not_found", async () => {
      expect(await reader.readPhotoSet({ organizationId: org, actorPersonId: bystander }, people.Website!)).toEqual({ kind: "forbidden" });
      expect(await reader.readPhotoSet(ctx(), "not-a-uuid")).toEqual({ kind: "not_found" });
      expect(await reader.readPhotoSet(ctx(), "00000000-0000-4000-8000-000000000000")).toEqual({ kind: "not_found" });
      const otherOrg = await fx.makeOrg("d2-read-other");
      const inOther = await fx.makePerson("Elsewhere", tag);
      await fx.addMember(otherOrg, inOther);
      expect(await reader.readPhotoSet(ctx(), inOther)).toEqual({ kind: "not_found" });

      await setPersonPhotosToggle(fx.platform, org, false);
      try {
        expect(await reader.readPhotoSet(ctx(), people.Website!)).toEqual({ kind: "feature_off" });
        expect(await reader.readPhotoSet({ organizationId: org, actorPersonId: bystander }, people.Website!)).toEqual({ kind: "feature_off" });
        expect(await reader.personPhotosEnabled(ctx())).toBe(false);
      } finally {
        await setPersonPhotosToggle(fx.platform, org, true);
      }
      expect(await reader.personPhotosEnabled(ctx())).toBe(true);
    });

    it("a website photo: tiles carry the thumbnail as a data: URI and the right chips, and the lines agree with the SQL", async () => {
      const r = await reader.readPhotoSet(ctx(), people.Website!);
      if (r.kind !== "ok") throw new Error(`expected ok, got ${r.kind}`);
      const { set } = r;
      expect(set.count).toBe(1);
      expect(set.photos[0]).toMatchObject({ id: photos.Website!.photoId, isWebsite: true, isDirectory: false });
      expect(set.photos[0]!.thumbSrc).toMatch(/^data:image\/webp;base64,/);
      expect(set.firstName).toBe("Website");
      expect(set.displayName).toBe(`Website ${tag}`);
      expect(set.organizationName).toContain("Fixture d2");
      expect(set.website).toMatchObject({ imageKey: photos.Website!.imageKey, source: "website", withheld: null });
      expect(set.lines.website).toBe(WEBSITE_LINES.website);
      expect(set.lines.directory).toBe(DIRECTORY_LINES.none("Website"));
      expect(set.listings).toEqual(["staff"]);
      expect(set.lines.listing).toBe(listingLine("Website", ["staff"]));
      expect(set.state).toEqual({
        first: "Website",
        listed: true,
        website: { photoId: photos.Website!.photoId },
        directory: null,
        minor: false,
        directoryWithheld: null,
        websiteWithheld: null,
      });
      expect(set.isMinor).toBe(false);
    });

    it("the Q6 fall-back, the unattested remedy, hide_photo, a minor and a merged record each get their line", async () => {
      const line = async (name: string) => {
        const r = await reader.readPhotoSet(ctx(), people[name]!);
        if (r.kind !== "ok") throw new Error(`${name}: ${r.kind}`);
        return r.set;
      };
      const attested = await line("DirAttested");
      expect(attested.lines.website).toBe(WEBSITE_LINES.fallback);
      expect(attested.lines.directory).toBe(DIRECTORY_LINES.shown("DirAttested"));
      expect(attested.photos[0]).toMatchObject({ isDirectory: true, isWebsite: false, directoryAttested: true });

      const plain = await line("DirPlain");
      expect(plain.lines.website).toBe(WEBSITE_LINES.unattested);
      expect(plain.website.unattestedDirectoryOnly).toBe(true);
      expect(plain.photos[0]).toMatchObject({ isDirectory: true, directoryAttested: false });

      expect((await line("Hidden")).lines.website).toBe(WEBSITE_LINES.hide("Hidden"));
      const minor = await line("MinorDob");
      expect(minor.isMinor).toBe(true);
      expect(minor.lines.website).toBe(WEBSITE_LINES.minor("MinorDob"));
      expect((await line("MinorYear")).isMinor).toBe(true);
      expect((await line("MinorChild")).isMinor).toBe(true);
      expect((await line("Merged")).lines.website).toBe(WEBSITE_LINES.merged);

      const none = await line("Nobody");
      expect(none.count).toBe(0);
      expect(none.lines.website).toBe(WEBSITE_LINES.none);
      expect(none.lines.directory).toBe(DIRECTORY_LINES.none("Nobody"));
    });

    it("a removed photo and an ended designation are not tiles / not chips", async () => {
      const removed = await reader.readPhotoSet(ctx(), people.Removed!);
      const ended = await reader.readPhotoSet(ctx(), people.Ended!);
      if (removed.kind !== "ok" || ended.kind !== "ok") throw new Error("expected ok");
      expect(removed.set.count).toBe(0);
      expect(ended.set.photos).toHaveLength(1);
      expect(ended.set.photos[0]).toMatchObject({ isWebsite: false, isDirectory: false });
    });

    it("?view= returns the MASTER only for this person's live photo; another person's photo id, a removed one and junk are ignored", async () => {
      const own = await reader.readPhotoSet(ctx(), people.Website!, { viewPhotoId: photos.Website!.photoId });
      if (own.kind !== "ok") throw new Error("expected ok");
      expect(own.set.viewed).toMatchObject({ photoId: photos.Website!.photoId });
      expect(own.set.viewed!.src).toMatch(/^data:image\/jpeg;base64,/);
      for (const view of [photos.DirAttested!.photoId, photos.Removed!.photoId, "not-a-uuid", "00000000-0000-4000-8000-000000000000", null]) {
        const r = await reader.readPhotoSet(ctx(), people.Website!, { viewPhotoId: view });
        if (r.kind !== "ok") throw new Error("expected ok");
        expect(r.set.viewed, String(view)).toBeNull();
      }
    });

    it("the snapshot carries what SQL withholds: hide_photo, merged and under 18 (T5); the two SQL reasons are unknown without a designation", async () => {
      const snapshotOf = async (personId: string) => {
        const r = await reader.readPhotoSet(ctx(), personId);
        if (r.kind !== "ok") throw new Error(`expected ok, got ${r.kind}`);
        return r.set.state;
      };

      // (i) a website designation and hide_photo, no directory designation: the website reports it, the directory has no row.
      expect(await snapshotOf(people.Hidden!)).toMatchObject({ minor: false, websiteWithheld: "hide_photo", directoryWithheld: null });

      // (ii) both a directory and a website designation, hide_photo: both report it.
      const both = await fx.makePerson("HiddenBoth", tag);
      await fx.addMember(org, both);
      await seedPersonPhoto(fx.platform, { organizationId: org, personId: both, userId: fx.actingUserId, purposes: ["directory", "website"], attestDirectory: true });
      await q(sql`insert into person_privacy (person_id, organization_id, hide_photo) values (${both}, ${org}, true)`);
      expect(await snapshotOf(both)).toMatchObject({ minor: false, directoryWithheld: "hide_photo", websiteWithheld: "hide_photo" });

      // (iii) a merged tombstone with a website designation.
      expect(await snapshotOf(people.Merged!)).toMatchObject({ minor: false, websiteWithheld: "merged", directoryWithheld: null });

      // (iv) a minor with NO designation: minor is always known, the SQL reasons are not (the functions return no row).
      const child = await fx.makePerson("ChildNone", tag);
      await fx.addMember(org, child);
      await q(sql`update people set date_of_birth = (current_date - interval '9 years')::date where id = ${child}`);
      expect(await snapshotOf(child)).toEqual({
        first: "ChildNone",
        listed: false,
        website: null,
        directory: null,
        minor: true,
        directoryWithheld: null,
        websiteWithheld: null,
      });

      // The same limit for a person who has hidden their photo but has no designation: unknown, so null (the dialogs hedge).
      const quiet = await fx.makePerson("HiddenNone", tag);
      await fx.addMember(org, quiet);
      await q(sql`insert into person_privacy (person_id, organization_id, hide_photo) values (${quiet}, ${org}, true)`);
      expect(await snapshotOf(quiet)).toMatchObject({ minor: false, directoryWithheld: null, websiteWithheld: null });

      // A minor with an existing website designation: minor is the `minor` field, never put in the withheld fields.
      expect(await snapshotOf(people.MinorDob!)).toMatchObject({ minor: true, websiteWithheld: null, directoryWithheld: null });
    });

    it("countChosenPhotos counts DISTINCT photos with an active designation on live photos (worded 'chosen for', never 'shown')", async () => {
      const [expected] = await q(sql`
        select count(distinct d.photo_id)::int as n from person_photo_designations d
          join person_photos ph on ph.id = d.photo_id and ph.organization_id = d.organization_id
         where d.organization_id = ${org} and d.ended_at is null and ph.removed_at is null`);
      const [rows] = await q(sql`
        select count(*)::int as n from person_photo_designations d
          join person_photos ph on ph.id = d.photo_id and ph.organization_id = d.organization_id
         where d.organization_id = ${org} and d.ended_at is null and ph.removed_at is null`);
      const n = await authz.withOrgContext(editor, org, (tx) => reader.countChosenPhotos(tx));
      expect(n).toBe(Number(expected!.n));
      expect(n).toBeGreaterThan(5);
      // WebsiteWins is ONE photo carrying two designations: the row count is larger than the photo count.
      expect(Number(rows!.n)).toBeGreaterThan(n);
    });

    it("one photo chosen for both the directory and the website is ONE photo; two photos, one doubly chosen, are two (T9)", async () => {
      const solo = await fx.makeOrg("d2-count-solo");
      await setPersonPhotosToggle(fx.platform, solo, true);
      const soloEditor = await fx.makePerson("Count", `Solo${tag}`);
      await fx.enroll(solo, soloEditor, ["people.manage"]);
      const person = await fx.makePerson("Both", tag);
      await fx.addMember(solo, person);
      const count = () => authz.withOrgContext(soloEditor, solo, (tx) => reader.countChosenPhotos(tx));
      expect(await count()).toBe(0);

      await seedPersonPhoto(fx.platform, {
        organizationId: solo,
        personId: person,
        userId: fx.actingUserId,
        purposes: ["directory", "website"],
        attestDirectory: true,
      });
      const [rows] = await q(sql`select count(*)::int as n from person_photo_designations where organization_id = ${solo} and ended_at is null`);
      expect(Number(rows!.n), "two designation rows").toBe(2);
      expect(await count(), "but one photo").toBe(1);

      await seedPersonPhoto(fx.platform, { organizationId: solo, personId: person, userId: fx.actingUserId, purposes: [] });
      expect(await count(), "an unchosen photo is not counted").toBe(1);
      const other = await fx.makePerson("Other", tag);
      await fx.addMember(solo, other);
      await seedPersonPhoto(fx.platform, { organizationId: solo, personId: other, userId: fx.actingUserId, purposes: ["website"] });
      expect(await count()).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  describe("the toggle SQL equals orgFeatureEnabledInTx over axis x category x toggle (27 combinations)", () => {
    type Tri = "on" | "off" | "missing";
    const TRI: Tri[] = ["on", "off", "missing"];
    const AXIS_FLAG = "org_portal.feature_categories";
    const KEY = "org_portal.person_photos";

    it("agrees on every combination, and both outcomes are exercised", async () => {
      const { orgFeatureEnabledInTx, isCategoryAxisOn } = await import("@/lib/org-features");
      const matrixOrg = await fx.makeOrg("d2-matrix");
      const [original] = await q(sql`select enabled from feature_flags where key = ${AXIS_FLAG}`);
      const setAxis = async (s: Tri) => {
        if (s === "missing") await q(sql`delete from feature_flags where key = ${AXIS_FLAG}`);
        else
          await q(sql`insert into feature_flags (key, enabled) values (${AXIS_FLAG}, ${s === "on"})
                        on conflict (key) do update set enabled = excluded.enabled`);
      };
      const setCategory = async (s: Tri) => {
        await q(sql`delete from organization_feature_categories where organization_id = ${matrixOrg}`);
        if (s !== "missing")
          await q(sql`insert into organization_feature_categories (organization_id, category, enabled) values (${matrixOrg}, 'people', ${s === "on"})`);
      };
      const setToggle = async (s: Tri) => {
        await q(sql`delete from organization_feature_toggles where organization_id = ${matrixOrg} and feature_key = ${KEY}`);
        if (s !== "missing")
          await q(sql`insert into organization_feature_toggles (organization_id, feature_key, enabled) values (${matrixOrg}, ${KEY}, ${s === "on"})`);
      };
      // Both sides run on the presby_app connection with the organization context set, exactly as the
      // store, the reader and the directory call them (the SQL function is an invoker: RLS applies to its reads).
      type Tx = { execute(q: SQL): Promise<unknown> };
      const inOrg = <T,>(fn: (tx: Tx) => Promise<T>) =>
        (appDb as unknown as { transaction<T2>(f: (tx: unknown) => Promise<T2>): Promise<T2> }).transaction(async (tx) => {
          await (tx as Tx).execute(sql`select set_config('app.current_org_id', ${matrixOrg}, true)`);
          return fn(tx as Tx);
        });
      const viaSql = () =>
        inOrg(async (tx) => rowsOf(await tx.execute(sql`select presby_person_photos_enabled(${matrixOrg}::uuid) as enabled`))[0]!.enabled as boolean);
      const viaTs = (axisOn: boolean) =>
        inOrg((tx) => orgFeatureEnabledInTx(tx as unknown as Parameters<typeof orgFeatureEnabledInTx>[0], matrixOrg, KEY, axisOn));

      let compared = 0;
      let enabled = 0;
      let disabled = 0;
      try {
        for (const axis of TRI) {
          await setAxis(axis);
          const axisOn = await isCategoryAxisOn();
          expect(axisOn, `axis ${axis}`).toBe(axis === "on");
          for (const category of TRI) {
            await setCategory(category);
            for (const toggle of TRI) {
              await setToggle(toggle);
              const label = `axis=${axis} category=${category} toggle=${toggle}`;
              const fromSql = await viaSql();
              expect(fromSql, label).toBe(await viaTs(axisOn));
              if (fromSql) enabled += 1;
              else disabled += 1;
              compared += 1;
            }
          }
        }
      } finally {
        if (original) await setAxis(original.enabled ? "on" : "off");
        else await setAxis("missing");
      }
      expect(compared).toBe(27);
      expect(enabled).toBeGreaterThan(0);
      expect(disabled).toBeGreaterThan(0);
    }, 240_000);
  });

  // -------------------------------------------------------------------------
  describe("the minor predicate equals children.ts's roster on date-of-birth cases", () => {
    it("agrees for exactly 18, 18 minus a day, 17, an infant, 40 and no date of birth", async () => {
      const viewer = await fx.makePerson("Rosa", `Roster${tag}`);
      await fx.enroll(org, viewer, ["children.roster"]);
      const cases: Array<[string, string | null]> = [
        ["Exactly18", "(current_date - interval '18 years')::date"],
        ["Day short of 18", "(current_date - interval '18 years' + interval '1 day')::date"],
        ["Day past 18", "(current_date - interval '18 years' - interval '1 day')::date"],
        ["Seventeen", "(current_date - interval '17 years')::date"],
        ["Infant", "(current_date - interval '6 months')::date"],
        ["Forty", "(current_date - interval '40 years')::date"],
        ["NoDob", null],
      ];
      const ids: Record<string, string> = {};
      for (const [name, expr] of cases) {
        const id = await fx.makePerson(name.replace(/\s/g, ""), tag);
        await fx.addMember(org, id);
        if (expr) await q(sql`update people set date_of_birth = ${sql.raw(expr)} where id = ${id}`);
        ids[name] = id;
      }
      const { getChildrenRoster } = await import("@/lib/children");
      const roster = await getChildrenRoster(viewer, org);
      if (roster.kind !== "ok") throw new Error("expected ok");
      const childIds = new Set(roster.children.map((c) => c.personId));
      for (const [name] of cases) {
        // An invoker function: it reads people and memberships under RLS, so it needs the org context.
        const [row] = await authz.withOrgContext(editor, org, async (tx) =>
          rowsOf(await tx.execute(sql`select presby_photo_subject_is_minor(${org}::uuid, ${ids[name]}::uuid) as minor`)),
        );
        expect(row!.minor, name).toBe(childIds.has(ids[name]!));
      }
      expect(childIds.has(ids["Day short of 18"]!)).toBe(true);
      expect(childIds.has(ids["Exactly18"]!)).toBe(false);
    });
  });
});
