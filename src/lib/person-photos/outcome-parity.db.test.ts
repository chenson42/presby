/**
 * T28: THE MIRROR CANNOT DRIFT FROM THE SQL (docs/work-log/2026-10-26-person-photos-inc1.md, Phase 5 run
 * 3, R-e4). Real Postgres. `outcome.ts` is a pure mirror of `presby_person_public_photo`,
 * `presby_person_directory_photo` and the roster gates, and `consequences.claims.test.ts` trusts it; this
 * file pins it, and the reader's idea of what the page can read, to the real database over the full
 * product of the dimensions in `src/lib/testing/person-photo-world.ts` (the World type IS the checklist:
 * a new SQL gate that is not a field there fails here).
 *
 *   P1 mirror = SQL          one person per world (the 360 published worlds), seeded set-based, compared
 *                            with: the owner-only core, its page wrapper, the directory function, and the
 *                            PUBLIC STAFF ROSTER (present iff listed; photo iff shown). Then a not-live
 *                            slice: a site that is not `live` shows nothing on any roster read.
 *   P2 projection = reader   `buildSnapshot(first, await loadAnswers(...))` (the very code the page runs)
 *                            deep-equals `snapshotOfWorld` for every world: the page's "what I can read"
 *                            rules are the real queries'.
 *   P3 transition = store    the 15 designation states x listed x hide{none, other org} x the ten intents
 *                            through the REAL `designatePhoto` / `undesignatePhoto` / `removePhoto`, each
 *                            on its own person; re-read, then P1's comparison against the after-world,
 *                            P2's against its projection, and the mirror's own `applyIntent` /
 *                            `afterIntent` against what the store really did. Plus a minor slice: the
 *                            store refuses every designate and the re-read equals the before-world.
 *
 * Every world below is `published` (the site is live) except in the not-live slice: publication is the
 * one dimension the page never reads, and it is exactly one site-status flip on the same persons.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/person-photos/outcome-parity.db.test.ts
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";
import { setPersonPhotosToggle } from "@/lib/testing/person-photo-fixture";
import {
  DIRECTORIES,
  INTENTS,
  WORLDS,
  applyIntentToWorld,
  factsOfWorld,
  snapshotOfWorld,
  worldKey,
  type PhotoName,
  type World,
} from "@/lib/testing/person-photo-world";
import type { PhotoIntent, PhotoStateSnapshot } from "./consequences";
import { afterIntent, applyIntent, outcomeOfFacts, selectedId, type Outcomes, type WebsiteGate } from "./outcome";
import { buildSnapshot } from "./snapshot";

vi.mock("server-only", () => ({}));
// audit.ts imports @/auth (next-auth), which this test environment cannot load.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []));
const chunk = <T,>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};
/** Runs `fn` over `items` with at most `n` in flight. */
async function pool<T>(items: readonly T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++]!;
        await fn(item);
      }
    }),
  );
}

interface Seed {
  w: World;
  first: string;
  display: string;
  personId: string;
  photoId: Record<PhotoName, string>;
  image: Record<PhotoName, string>;
  thumb: Record<PhotoName, string>;
}

const NAMES: PhotoName[] = ["A", "B"];
/** What `presby_person_public_photo` reports as `withheld` for each mirror gate (the roster gates are not its business). */
const sqlWithheld = (g: WebsiteGate): string | null => (g === "minor" || g === "merged" || g === "hide_photo" ? g : null);

describe.skipIf(!hasDb)("person photos: the outcome mirror equals the SQL, the reader and the store (Postgres-backed)", { timeout: 900_000 }, () => {
  let fx: CalendarFixture;
  let appDb: typeof import("@/lib/db").db;
  let authz: typeof import("@/lib/authz");
  let reader: typeof import("./reader");
  let store: typeof import("./store");
  let org: string;
  let otherOrg: string;
  let slug: string;
  let editor: string;
  let mergeTarget: string;
  const tag = `Par${Date.now().toString(36)}`;
  const allPeople: string[] = [];
  let counter = 0;

  const q = async (query: SQL): Promise<Row[]> => rowsOf(await fx.platform.execute(query));
  const ctx = () => ({ organizationId: org, actorPersonId: editor, actor: { userId: fx.actingUserId, email: "editor@example.invalid" } });

  // ---------------------------------------------------------------------------------------------------
  // Seeding: one statement per table per chunk, one person per world.
  async function seedWorlds(worlds: readonly World[]): Promise<Seed[]> {
    const { fixtureDeletableUntil } = await import("@/lib/db/fixture-deletable");
    const deletable = fixtureDeletableUntil().toISOString();
    const seeds: Seed[] = worlds.map((w) => {
      counter += 1;
      const first = `W${counter}`;
      return {
        w,
        first,
        display: `${first} ${tag}`,
        personId: randomUUID(),
        photoId: { A: randomUUID(), B: randomUUID() },
        image: { A: randomUUID(), B: randomUUID() },
        thumb: { A: randomUUID(), B: randomUUID() },
      };
    });
    allPeople.push(...seeds.map((s) => s.personId));
    const join = (parts: SQL[]) => sql.join(parts, sql`, `);

    for (const part of chunk(seeds, 150)) {
      await q(sql`
        insert into people (id, first_name, last_name, deletable_until, date_of_birth)
        values ${join(
          part.map(
            (s) =>
              sql`(${s.personId}::uuid, ${s.first}, ${tag}, ${deletable}::timestamptz,
                   ${s.w.minor ? sql`(current_date - interval '12 years')::date` : sql`null::date`})`,
          ),
        )}`);
      await q(sql`
        insert into memberships (organization_id, person_id, engagement_status, current_roll)
        values ${join(part.map((s) => sql`(${org}::uuid, ${s.personId}::uuid, 'regular', 'active')`))}`);
    }

    const merged = seeds.filter((s) => s.w.merged);
    for (const part of chunk(merged, 150))
      await q(sql`update people set merged_into_id = ${mergeTarget}::uuid where id in (${join(part.map((s) => sql`${s.personId}::uuid`))})`);

    // A hide at ANOTHER organization needs a membership there (person_privacy's FK); the link guard accepts one
    // person per transaction, so this one statement loops and authorizes each.
    const elsewhere = seeds.filter((s) => s.w.hide === "other_org");
    for (const part of chunk(elsewhere, 100)) {
      const ids = part.map((s) => `'${s.personId}'::uuid`).join(", "); // ids are randomUUID() output
      await q(sql`
        do $$
        declare pid uuid;
        begin
          foreach pid in array array[${sql.raw(ids)}] loop
            perform set_config('app.person_claim_authorized', pid::text, true);
            insert into memberships (organization_id, person_id, engagement_status, current_roll)
            values (${sql.raw(`'${otherOrg}'::uuid`)}, pid, 'regular', null);
          end loop;
        end $$`);
    }
    const hidden = seeds.filter((s) => s.w.hide !== "none");
    for (const part of chunk(hidden, 150))
      await q(sql`
        insert into person_privacy (person_id, organization_id, hide_photo)
        values ${join(part.map((s) => sql`(${s.personId}::uuid, ${s.w.hide === "this_org" ? org : otherOrg}::uuid, true)`))}`);

    const listed = seeds.filter((s) => s.w.listed);
    for (const part of chunk(listed, 150))
      await q(sql`
        insert into staff_positions (organization_id, person_id, position, position_key, starts_on, public_listed)
        values ${join(part.map((s) => sql`(${org}::uuid, ${s.personId}::uuid, ${`Role ${s.first}`}, ${`role-${s.first.toLowerCase()}`}, '2020-01-01', true)`))}`);

    // Photos: four private blobs per person (two masters, two thumbnails), two photo rows A and B.
    for (const part of chunk(seeds, 100)) {
      const blobs: SQL[] = [];
      for (const s of part)
        for (const n of NAMES)
          for (const [id, type, magic] of [
            [s.image[n], "image/jpeg", "ffd8ffe0"],
            [s.thumb[n], "image/webp", "52494646"],
          ] as const) {
            const bytes = Buffer.concat([Buffer.from(magic, "hex"), Buffer.from(` outcome-parity ${id}`)]);
            blobs.push(
              sql`(${id}::uuid, ${org}::uuid, ${createHash("sha256").update(bytes).digest("hex")}, ${type}, ${bytes.byteLength},
                   decode(${bytes.toString("hex")}, 'hex'), 'private')`,
            );
          }
      await q(sql`insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes, audience) values ${join(blobs)}`);
      await q(sql`
        insert into person_photos (id, organization_id, person_id, image_asset_key, thumb_asset_key, width, height, created_by)
        values ${join(
          part.flatMap((s) =>
            NAMES.map((n) => sql`(${s.photoId[n]}::uuid, ${org}::uuid, ${s.personId}::uuid, ${s.image[n]}::uuid, ${s.thumb[n]}::uuid, 800, 1000, ${fx.actingUserId}::uuid)`),
          ),
        )}`);
      const designations: SQL[] = [];
      for (const s of part) {
        if (s.w.website)
          designations.push(
            sql`(${org}::uuid, ${s.personId}::uuid, ${s.photoId[s.w.website]}::uuid, 'website', now(), ${fx.actingUserId}::uuid, ${fx.actingUserId}::uuid)`,
          );
        if (s.w.directory) {
          const att = s.w.directory.attested;
          designations.push(
            sql`(${org}::uuid, ${s.personId}::uuid, ${s.photoId[s.w.directory.photo]}::uuid, 'directory',
                 ${att ? sql`now()` : sql`null::timestamptz`}, ${att ? sql`${fx.actingUserId}::uuid` : sql`null::uuid`}, ${fx.actingUserId}::uuid)`,
          );
        }
      }
      if (designations.length > 0)
        await q(sql`
          insert into person_photo_designations (organization_id, person_id, photo_id, purpose, public_attested_at, public_attested_by, designated_by)
          values ${join(designations)}`);
    }
    return seeds;
  }

  // ---------------------------------------------------------------------------------------------------
  // The reads: one statement per function for ALL persons.
  interface Reads {
    core: Map<string, Row>;
    wrapper: Map<string, Row>;
    directory: Map<string, Row>;
    roster: Map<string, string | null>;
  }
  const idList = (seeds: readonly Seed[]) => sql.join(seeds.map((s) => sql`(${s.personId}::uuid)`), sql`, `);
  const byPid = (rows: Row[]) => new Map(rows.map((r) => [String(r.pid), r]));

  async function readRoster(): Promise<Map<string, string | null>> {
    const rows = rowsOf(await appDb.execute(sql`select display_name, photo_key from presby_public_staff_roster(${slug})`));
    const out = new Map<string, string | null>();
    for (const r of rows) out.set(String(r.display_name), (r.photo_key as string | null) ?? null);
    return out;
  }

  async function readAll(seeds: readonly Seed[]): Promise<Reads> {
    const core = byPid(
      await q(sql`select t.pid::text as pid, c.image_key::text as image_key, c.source, c.withheld
                    from (values ${idList(seeds)}) as t(pid)
                    left join lateral presby_person_public_photo(${org}::uuid, t.pid) c on true`),
    );
    const { wrapper, directory } = await authz.withOrgContext(editor, org, async (tx) => ({
      wrapper: byPid(
        rowsOf(
          await tx.execute(sql`select t.pid::text as pid, c.image_key::text as image_key, c.source, c.withheld
                                 from (values ${idList(seeds)}) as t(pid)
                                 left join lateral presby_person_public_photo_status(t.pid) c on true`),
        ),
      ),
      directory: byPid(
        rowsOf(
          await tx.execute(sql`select t.pid::text as pid, c.thumb_key::text as thumb_key, c.photo_id::text as photo_id, c.withheld
                                 from (values ${idList(seeds)}) as t(pid)
                                 left join lateral presby_person_directory_photo(${org}::uuid, t.pid) c on true`),
        ),
      ),
    }));
    return { core, wrapper, directory, roster: await readRoster() };
  }

  /** P1's comparison of one person against the outcomes the mirror predicts for `world`. Returns the mismatches. */
  function compareP1(s: Seed, world: World, reads: Reads, published: boolean): string[] {
    const bad: string[] = [];
    const O: Outcomes = outcomeOfFacts({ ...factsOfWorld(world), published });
    const who = `${s.first} ${worldKey(world)}`;
    const w = O.website;
    const core = reads.core.get(s.personId)!;
    const wrapper = reads.wrapper.get(s.personId)!;
    const dir = reads.directory.get(s.personId)!;
    for (const [name, row] of [["core", core], ["wrapper", wrapper]] as const) {
      if (w.photoId === null) {
        if (row.source !== null || row.image_key !== null || row.withheld !== null) bad.push(`${who}: ${name} returned a row (${JSON.stringify(row)}) for no candidate`);
        continue;
      }
      const withheld = sqlWithheld(w.gate);
      if (row.source !== w.source) bad.push(`${who}: ${name} source ${row.source} != ${w.source}`);
      if ((row.withheld ?? null) !== withheld) bad.push(`${who}: ${name} withheld ${row.withheld} != ${withheld} (mirror gate ${w.gate})`);
      const wantKey = withheld === null ? s.image[w.photoId as PhotoName] : null;
      // photoId in the mirror is the symbolic name here: the seeds use real ids, so map through the world below
      if ((row.image_key ?? null) !== wantKey) bad.push(`${who}: ${name} image_key ${row.image_key} != ${wantKey}`);
    }
    // the roster: present iff listed (staff row), photo iff the mirror says it shows
    const rosterHas = reads.roster.has(s.display);
    if (rosterHas !== world.listed) bad.push(`${who}: roster presence ${rosterHas} != listed ${world.listed}`);
    if (world.listed) {
      const shown = published && w.photoId !== null && w.gate === "clear";
      const want = shown ? s.image[w.photoId as PhotoName] : null;
      if ((reads.roster.get(s.display) ?? null) !== want) bad.push(`${who}: roster photo_key ${reads.roster.get(s.display)} != ${want} (gate ${w.photoId === null ? "none" : w.gate})`);
    }
    // the directory function
    const d = O.directory;
    if (d.photoId === null) {
      if (dir.photo_id !== null || dir.withheld !== null || dir.thumb_key !== null) bad.push(`${who}: directory returned a row for no designation`);
    } else {
      if (dir.photo_id !== s.photoId[d.photoId as PhotoName]) bad.push(`${who}: directory photo_id ${dir.photo_id} != ${s.photoId[d.photoId as PhotoName]}`);
      const withheld = d.gate === "clear" ? null : d.gate;
      if ((dir.withheld ?? null) !== withheld) bad.push(`${who}: directory withheld ${dir.withheld} != ${withheld}`);
      const wantThumb = d.gate === "clear" ? s.thumb[d.photoId as PhotoName] : null;
      if ((dir.thumb_key ?? null) !== wantThumb) bad.push(`${who}: directory thumb_key ${dir.thumb_key} != ${wantThumb}`);
    }
    return bad;
  }

  /** The reader's snapshot of a person, through the page's own two steps. */
  async function realSnapshots(seeds: readonly Seed[]): Promise<Map<string, PhotoStateSnapshot>> {
    const out = new Map<string, PhotoStateSnapshot>();
    await pool(chunk(seeds, 40), 6, async (part) => {
      await authz.withOrgContext(editor, org, async (tx) => {
        for (const s of part) out.set(s.personId, buildSnapshot(s.first, await reader.loadAnswers(tx, org, s.personId)));
      });
    });
    return out;
  }

  /** `snapshotOfWorld` with the symbolic photo names replaced by this person's real ids. */
  function projected(s: Seed, world: World): PhotoStateSnapshot {
    const snap = snapshotOfWorld(world, s.first);
    return {
      ...snap,
      website: snap.website ? { photoId: s.photoId[snap.website.photoId as PhotoName] } : null,
      directory: snap.directory ? { photoId: s.photoId[snap.directory.photoId as PhotoName], attested: snap.directory.attested } : null,
    };
  }

  const names = (s: Seed): Record<string, string> => Object.fromEntries(NAMES.map((n) => [s.photoId[n], n]));
  /** Real photo ids to symbolic names, for comparing the mirror's selections with a world's. */
  const symbolic = (s: Seed, id: string | null): string | null => (id === null ? null : (names(s)[id] ?? id));
  const real = (s: Seed, intent: PhotoIntent): PhotoIntent => ("photoId" in intent ? { ...intent, photoId: s.photoId[intent.photoId as PhotoName] } : intent);
  const report = (bad: string[]) => bad.slice(0, 12).concat(bad.length > 12 ? [`... and ${bad.length - 12} more (${bad.length} total)`] : []);

  beforeAll(async () => {
    ({ db: appDb } = await import("@/lib/db"));
    authz = await import("@/lib/authz");
    reader = await import("./reader");
    store = await import("./store");
    const mod = await import("@/lib/testing/calendar-fixture");
    fx = await mod.createCalendarFixture("photo-parity");
    org = await fx.makeOrg("parity");
    otherOrg = await fx.makeOrg("parity-other");
    const [o] = await q(sql`select slug from organizations where id = ${org}`);
    slug = String(o!.slug);
    await q(sql`insert into organization_sites (organization_id, repo, status) values (${org}, ${`presby-fixtures/site-${slug}`}, 'live')`);
    await q(sql`
      insert into permissions (key, module, description, sensitivity_tier)
      values ('people.manage', 'people', 'Create and edit people, households, and contact/address detail', 1)
      on conflict do nothing`);
    editor = await fx.makePerson("Edith", `Editor${tag}`);
    await fx.enroll(org, editor, ["people.manage"]);
    mergeTarget = await fx.makePerson("MergeTarget", tag);
    await setPersonPhotosToggle(fx.platform, org, true);
  }, 300_000);

  afterAll(async () => {
    if (!fx) return;
    for (const part of chunk(allPeople, 200))
      await q(sql`update people set merged_into_id = null where id in (${sql.join(part.map((id) => sql`${id}::uuid`), sql`, `)})`).catch(() => undefined);
    await q(sql`delete from organization_sites where organization_id = ${org}`);
    await fx.cleanup();
    // The fixture's people are deleted by fx.cleanup; ours are no longer members of anything.
    for (const part of chunk(allPeople, 200))
      await q(sql`delete from people where id in (${sql.join(part.map((id) => sql`${id}::uuid`), sql`, `)})`);
  }, 300_000);

  // ---------------------------------------------------------------------------------------------------
  describe("P1 and P2: every published world, seeded once", () => {
    let seeds: Seed[] = [];
    let reads: Reads;

    beforeAll(async () => {
      const worlds = WORLDS.filter((w) => w.published);
      expect(worlds).toHaveLength(360);
      seeds = await seedWorlds(worlds);
      reads = await readAll(seeds);
    }, 600_000);

    it("P1 mirror = SQL: the core, the page wrapper, the directory function and the public staff roster agree with outcomeOfFacts for every world", () => {
      const bad: string[] = [];
      for (const s of seeds) bad.push(...compareP1(s, s.w, reads, true));
      expect(report(bad)).toEqual([]);
    });

    it("P1: the page wrapper equals the owner-only core it wraps, row for row", () => {
      const bad = seeds.filter((s) => JSON.stringify(reads.wrapper.get(s.personId)) !== JSON.stringify(reads.core.get(s.personId))).map((s) => worldKey(s.w));
      expect(report(bad)).toEqual([]);
    });

    it("P1: the product contains the same-photo states, with the clearance and without it", () => {
      const sameCleared = seeds.filter((s) => s.w.website === "A" && s.w.directory?.photo === "A" && s.w.directory.attested);
      const samePlain = seeds.filter((s) => s.w.website === "A" && s.w.directory?.photo === "A" && !s.w.directory.attested);
      expect(sameCleared.length).toBe(2 * 2 * 2 * 3);
      expect(samePlain.length).toBe(2 * 2 * 2 * 3);
      // and the roster really does serve a listed, unwithheld person's photo through BOTH designations of one photo
      const served = sameCleared.filter((s) => s.w.listed && !s.w.minor && !s.w.merged && s.w.hide === "none");
      expect(served.length).toBe(1);
      expect(reads.roster.get(served[0]!.display)).toBe(served[0]!.image.A);
    });

    it("P1 not-live slice: a site that is not live shows nothing on any roster read, whatever the world", async () => {
      expect([...reads.roster.values()].some((v) => v !== null)).toBe(true); // the published reads are not vacuous
      await q(sql`update organization_sites set status = 'provisioning' where organization_id = ${org}`);
      try {
        const roster = await readRoster();
        expect([...roster.keys()], "no person is on a roster of a site that is not live").toEqual([]);
        // the unpublished mirror agrees: not_published (or a stronger gate) for every person with a candidate
        for (const s of seeds) {
          const O = outcomeOfFacts({ ...factsOfWorld(s.w), published: false });
          if (O.website.photoId !== null) expect(O.website.gate, worldKey(s.w)).not.toBe("clear");
        }
      } finally {
        await q(sql`update organization_sites set status = 'live' where organization_id = ${org}`);
      }
      expect((await readRoster()).size).toBe(seeds.filter((s) => s.w.listed).length);
    });

    it("P2 projection = reader: buildSnapshot over loadAnswers deep-equals snapshotOfWorld for every world", async () => {
      const snaps = await realSnapshots(seeds);
      const bad: string[] = [];
      for (const s of seeds) {
        const got = snaps.get(s.personId);
        const want = projected(s, s.w);
        if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${worldKey(s.w)}\n   page: ${JSON.stringify(got)}\n   world: ${JSON.stringify(want)}`);
      }
      expect(report(bad)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------------------------------
  describe("P3 transition = store: the real mutations, one person per (state, listed, hide, intent)", () => {
    interface Run {
      seed: Seed;
      intent: PhotoIntent;
      before: PhotoStateSnapshot;
      result: Awaited<ReturnType<typeof runStore>>;
    }

    async function runStore(s: Seed, intent: PhotoIntent) {
      const i = real(s, intent);
      switch (i.kind) {
        case "designate_directory":
          return store.designatePhoto(ctx(), s.personId, { photoId: i.photoId, purpose: "directory", attested: i.attested });
        case "designate_website":
          return store.designatePhoto(ctx(), s.personId, { photoId: i.photoId, purpose: "website", attested: true });
        case "undesignate_directory":
          return store.undesignatePhoto(ctx(), s.personId, "directory");
        case "undesignate_website":
          return store.undesignatePhoto(ctx(), s.personId, "website");
        case "remove":
          return store.removePhoto(ctx(), s.personId, i.photoId);
      }
    }

    const baseWorld = (over: Partial<World>): World => ({
      listed: false,
      published: true,
      minor: false,
      merged: false,
      hide: "none",
      website: null,
      directory: null,
      ...over,
    });

    it("the 600 transitions: the re-read equals the after-world (P1), the page's projection of it (P2), and the mirror's own applyIntent / afterIntent", async () => {
      const worlds: Array<{ w: World; intent: PhotoIntent }> = [];
      for (const website of [null, "A", "B"] as const)
        for (const directory of DIRECTORIES)
          for (const listed of [false, true])
            for (const hide of ["none", "other_org"] as const)
              for (const intent of INTENTS) worlds.push({ w: baseWorld({ website, directory, listed, hide }), intent });
      expect(worlds).toHaveLength(600);

      const seeds = await seedWorlds(worlds.map((x) => x.w));
      const intentOf = new Map(seeds.map((s, n) => [s.personId, worlds[n]!.intent]));
      const started = Date.now();
      const runs: Run[] = [];
      await pool(seeds, 8, async (s) => {
        const intent = intentOf.get(s.personId)!;
        const result = await runStore(s, intent);
        runs.push({ seed: s, intent, before: projected(s, s.w), result });
      });
      console.info(`[outcome-parity] 600 store calls in ${Math.round((Date.now() - started) / 1000)}s`);
      const refused = runs.filter((r) => r.result.kind !== "ok");
      expect(refused.map((r) => `${worldKey(r.seed.w)} ${JSON.stringify(r.intent)} -> ${JSON.stringify(r.result)}`)).toEqual([]);

      const afterSeeds = runs.map((r) => r.seed);
      const reads = await readAll(afterSeeds);
      const snaps = await realSnapshots(afterSeeds);
      const bad: string[] = [];
      for (const r of runs) {
        const s = r.seed;
        const afterWorld = applyIntentToWorld(s.w, r.intent);
        const label = `${worldKey(s.w)} :: ${JSON.stringify(r.intent)}`;
        // P1 against the after-world (the world's own transition, written independently of the mirror)
        bad.push(...compareP1(s, afterWorld, reads, true).map((m) => `P1 ${label}: ${m}`));
        // P2 against its projection
        const got = snaps.get(s.personId)!;
        if (JSON.stringify(got) !== JSON.stringify(projected(s, afterWorld))) bad.push(`P2 ${label}: page ${JSON.stringify(got)} != world ${JSON.stringify(projected(s, afterWorld))}`);
        // The mirror's own transition, from the page's real before-snapshot, against what the store did
        const intent = real(s, r.intent);
        const mirrored = applyIntent(r.before, intent);
        if (JSON.stringify([mirrored.website, mirrored.directory]) !== JSON.stringify([got.website, got.directory]))
          bad.push(`applyIntent ${label}: mirror ${JSON.stringify([mirrored.website, mirrored.directory])} != store ${JSON.stringify([got.website, got.directory])}`);
        const predicted = afterIntent(r.before, intent);
        const truth = outcomeOfFacts(factsOfWorld(afterWorld));
        if (symbolic(s, selectedId(predicted.website)) !== selectedId(truth.website) || symbolic(s, selectedId(predicted.directory)) !== selectedId(truth.directory))
          bad.push(`afterIntent ${label}: mirror selects ${selectedId(predicted.website)}/${selectedId(predicted.directory)} but the store left ${selectedId(truth.website)}/${selectedId(truth.directory)}`);
      }
      expect(report(bad)).toEqual([]);
    });

    it("the minor slice: the store refuses every designate, and the re-read equals the before-world", async () => {
      const designates = INTENTS.filter((i) => i.kind === "designate_directory" || i.kind === "designate_website");
      expect(designates).toHaveLength(6);
      const worlds: Array<{ w: World; intent: PhotoIntent }> = [];
      for (const over of [{ website: "A" as const, directory: { photo: "A" as const, attested: true } }, { website: null, directory: null }])
        for (const intent of designates) worlds.push({ w: baseWorld({ listed: true, minor: true, ...over }), intent });
      expect(worlds).toHaveLength(12);
      const seeds = await seedWorlds(worlds.map((x) => x.w));
      const results: Array<[Seed, PhotoIntent, Awaited<ReturnType<typeof runStore>>]> = [];
      await pool(seeds, 6, async (s) => {
        const intent = worlds[seeds.indexOf(s)]!.intent;
        results.push([s, intent, await runStore(s, intent)]);
      });
      for (const [s, intent, result] of results) expect(result, `${worldKey(s.w)} ${JSON.stringify(intent)}`).toMatchObject({ kind: "refused", reason: "minor" });

      const reads = await readAll(seeds);
      const snaps = await realSnapshots(seeds);
      const bad: string[] = [];
      for (const s of seeds) {
        bad.push(...compareP1(s, s.w, reads, true));
        if (JSON.stringify(snaps.get(s.personId)) !== JSON.stringify(projected(s, s.w))) bad.push(`P2 ${worldKey(s.w)}`);
        // the mirror agrees the click changes nothing
        expect(applyIntent(projected(s, s.w), real(s, worlds[seeds.indexOf(s)]!.intent))).toEqual(projected(s, s.w));
      }
      expect(report(bad)).toEqual([]);
    });
  });
});
