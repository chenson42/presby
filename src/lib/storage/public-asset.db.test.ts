/**
 * D1 - the public asset door through the REAL `resolvePublic()` on the
 * `presby_app` connection (F289, DECISION-277; docs/work-log/
 * 2026-10-25-public-asset-allowlist.md, Phase 3 "Test Plan" D1).
 *
 * `presby_public_site_asset(org, key)` is the only thing the public route asks.
 * It serves a `public_site` image, or the photo of a person a roster function
 * currently lists, and nothing else. Seeded on the owner connection (fixture
 * orgs and people carry `deletable_until`; every id is random; torn down in
 * afterAll with confirming SELECTs), asked on the app connection with no org GUC,
 * exactly as the route does.
 *
 * The "Tier 1" case is named as such: a `public_site` image no bundle
 * references IS served (R8) - takedown by reference is the Tier 2 follow-up.
 *
 * The parity property (Gap 5): for every person in the matrix, the door serves
 * the photo IFF the key is in `presby_public_staff_roster` UNION
 * `presby_public_committee_roster`, so the page and the predicate cannot drift.
 *
 * drizzle/0078 (person photos, F331): photos are seeded as person_photos plus
 * a website designation (src/lib/testing/person-photo-fixture.ts) with the
 * org's `org_portal.person_photos` toggle on; people.photo_key is retired and a
 * write to it is refused. Two 0072 cases are now UNREPRESENTABLE rather than
 * served-or-not, and are asserted as such: a photo stored public_site (the FK
 * pins private) and a photo key stored in upper case (the key is a uuid
 * column). The merged person is withheld by 0078 (the roster says so, and the
 * parity test follows the roster).
 *
 * Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/storage/public-asset.db.test.ts
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { GivingFixture } from "@/lib/testing/giving-fixture";
import { seedPersonPhoto, setPersonPhotosToggle } from "@/lib/testing/person-photo-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;

const PNG_MAGIC = Buffer.from("89504e470d0a1a0a", "hex");
const png = (seed: string) => Buffer.concat([PNG_MAGIC, Buffer.from(`f289 d1 ${seed} ${randomUUID()}`)]);

describe.skipIf(!hasDb)("F289 the public asset door (Postgres-backed)", () => {
  let fx: GivingFixture;
  let appDb: typeof import("@/lib/db").db;
  let resolvePublic: (input: { organizationId: string; key: string }) => ReturnType<
    ReturnType<typeof import("@/lib/storage/blob-store").getBlobStore>["resolvePublic"]
  >;

  let org: string; // the live, active site: the subject
  let slug: string;
  let otherOrg: string; // a foreign org with its own live site
  let otherSlug: string;
  let inactiveOrg: string;
  let suspendedOrg: string;
  let provisioningOrg: string;

  const tag = `D1${Date.now().toString(36)}`;
  const q = async (query: SQL): Promise<Row[]> => fx.rowsOf(await fx.platform.execute(query));

  /** Inserts a blob, optionally under an explicit id. Person photos go through person-photo-fixture. */
  async function blob(o: {
    org?: string;
    id?: string;
    bytes?: Buffer;
    contentType?: string;
    audience: "public_site" | "private";
  }): Promise<{ id: string; bytes: Buffer }> {
    const id = o.id ?? randomUUID();
    const bytes = o.bytes ?? png(id);
    const hex = bytes.toString("hex");
    await q(sql`
      insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes, audience)
      values (${id}, ${o.org ?? org}, encode(sha256(decode(${hex}, 'hex')), 'hex'), ${o.contentType ?? "image/png"},
              ${bytes.byteLength}, decode(${hex}, 'hex'), ${o.audience})`);
    return { id, bytes };
  }

  async function liveSite(orgId: string, status: "live" | "suspended" | "provisioning" = "live") {
    const [o] = await q(sql`select slug from organizations where id = ${orgId}`);
    await q(sql`insert into organization_sites (organization_id, repo, status)
                values (${orgId}, ${`presby-fixtures/site-${String(o!.slug)}`}, ${status})`);
    return String(o!.slug);
  }

  const asApp = async (orgId: string, key: string) => resolvePublic({ organizationId: orgId, key });

  // ---- the people matrix -----------------------------------------------------
  interface Person {
    id: string;
    photo: string; // the master's blob id: what the roster projects as photo_key
    label: string;
  }
  const people: Record<string, Person> = {};

  async function person(name: string, opts: { imageKey?: string } = {}): Promise<Person> {
    const id = await fx.makePerson(name, tag);
    await fx.addMember(org, id);
    const { imageKey: photo } = await seedPersonPhoto(fx.platform, {
      organizationId: org,
      personId: id,
      userId: fx.actingUserId,
      imageKey: opts.imageKey,
      purposes: ["website"],
    });
    const p = { id, photo, label: name };
    people[name] = p;
    return p;
  }

  const staff = (p: Person, extra: { endsOn?: string | null; listed?: boolean } = {}) =>
    q(sql`insert into staff_positions (organization_id, person_id, position, position_key, starts_on, ends_on, public_listed)
          values (${org}, ${p.id}, ${`Role ${p.label}`}, ${`role-${p.label.toLowerCase()}`}, '2020-01-01',
                  ${extra.endsOn ?? null}, ${extra.listed ?? true})`);

  let committee: string;
  let derivedCommittee: string;
  const member = (groupId: string, p: Person) =>
    q(sql`insert into group_memberships (organization_id, group_id, person_id, public_listed)
          values (${org}, ${groupId}, ${p.id}, true)`);

  // ---- the non-person blobs -----------------------------------------------------
  const b: Record<string, string> = {};

  beforeAll(async () => {
    ({ db: appDb } = await import("@/lib/db"));
    const { getBlobStore } = await import("@/lib/storage/blob-store");
    resolvePublic = (input) => getBlobStore().resolvePublic(input);
    const mod = await import("@/lib/testing/giving-fixture");
    fx = await mod.createGivingFixture("public-asset");

    org = await fx.makeOrg("subject", { givingToggle: true });
    otherOrg = await fx.makeOrg("foreign");
    inactiveOrg = await fx.makeOrg("inactive");
    suspendedOrg = await fx.makeOrg("suspended");
    provisioningOrg = await fx.makeOrg("provisioning");
    slug = await liveSite(org);
    await setPersonPhotosToggle(fx.platform, org, true);
    otherSlug = await liveSite(otherOrg);
    await liveSite(inactiveOrg);
    await q(sql`update organizations set status = 'inactive' where id = ${inactiveOrg}`);
    await liveSite(suspendedOrg, "suspended");
    await liveSite(provisioningOrg, "provisioning");

    // ---- Tier 1 and the brand ---------------------------------------------------
    b.siteImage = (await blob({ audience: "public_site" })).id;
    b.tier1Unreferenced = (await blob({ audience: "public_site" })).id; // R8: documents Tier 1
    b.mark = (await blob({ audience: "public_site" })).id;
    b.privateImage = (await blob({ audience: "private" })).id;
    b.wordmark = (await blob({ audience: "private" })).id;
    b.historicalMark = (await blob({ audience: "private" })).id;
    b.bundle = (
      await blob({
        audience: "private",
        contentType: "application/json",
        bytes: Buffer.from(JSON.stringify({ schemaVersion: 1, pages: [], imageKeys: { hero: b.siteImage } })),
      })
    ).id;
    await q(sql`update organization_sites set content_bundle_key = ${b.bundle} where organization_id = ${org}`);
    await q(sql`insert into organization_brands (organization_id, seed_hex, mark_asset_key, wordmark_asset_key, brand_token_version, updated_by)
                values (${org}, '#336699', ${b.mark}, ${b.wordmark}, 1, ${fx.actingUserId})`);
    await q(sql`insert into organization_brand_history (organization_id, action, mark_asset_key, changed_by)
                values (${org}, 'updated', ${b.historicalMark}, ${fx.actingUserId})`);

    // ---- private consumers: a ticket attachment and a statement PDF -------------
    const submitter = await fx.makePerson("Wren", tag);
    await fx.addMember(org, submitter);
    const [t] = await q(sql`insert into tickets (organization_id, submitter_person_id, subject, change_class, area)
                            values (${org}, ${submitter}, 'F289 D1 fixture ticket', 'bug', 'website') returning id`);
    b.ticketImage = (await blob({ audience: "private" })).id;
    await q(sql`insert into ticket_messages (organization_id, ticket_id, author_kind, author_person_id, body, attachment_asset_key)
                values (${org}, ${String(t!.id)}, 'submitter', ${submitter}, 'F289 D1 fixture message', ${b.ticketImage})`);

    await fx.makeGivingSettings(org);
    const fund = await fx.makeFund(org, "General Fund");
    const issuer = (await fx.makeActor(org, "Odile", "Fenwright", ["giving.manage", "giving.view", "giving.record"])).userId;
    const donor = await fx.makeDonor(org, "Barnaby Tillinghast");
    const year = new Date().getUTCFullYear() - 1;
    await fx.makeOfflineGift(org, donor, fund, 2500, { occurredOn: `${year}-04-01` });
    const issued = await appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${org}, true)`);
      return mod.issueStatement(tx, { organizationId: org, donorId: donor, taxYear: year, issuedBy: issuer });
    });
    b.statementPdf = issued.blobId;

    // ---- the roster matrix ----------------------------------------------------------
    const [gt] = await q(sql`select id from group_types where key = 'committee'`);
    const group = async (name: string, source: "managed" | "derived") =>
      String(
        (
          await q(sql`insert into groups (organization_id, group_type_id, name, membership_source)
                      values (${org}, ${gt!.id}, ${name}, ${source}) returning id`)
        )[0]!.id,
      );
    committee = await group(`Mission ${tag}`, "managed");
    derivedCommittee = await group(`Derived ${tag}`, "managed");
    // A derived-source group's rows are written by trigger and refuse direct inserts; the group's
    // own membership_source is what the roster function reads, so flip it AFTER the row exists.
    // (see "committee member of a derived (session) group" below)

    await staff(await person("StaffListed"));
    const officer = await person("OfficerListed");
    await q(sql`insert into officer_terms (organization_id, person_id, office, starts_on, public_listed)
                values (${org}, ${officer.id}, 'trustee', '2020-01-01', true)`);
    await member(committee, await person("CommitteeListed"));
    await staff(await person("StaffEnded"), { endsOn: "2021-01-01" });
    await staff(await person("StaffUnlisted"), { listed: false });
    await member(derivedCommittee, await person("CommitteeDerived"));
    await q(sql`update groups set membership_source = 'derived', derived_from = 'session' where id = ${derivedCommittee}`);

    const hidden = await person("StaffHidden");
    await staff(hidden);
    await q(sql`insert into person_privacy (person_id, organization_id, hide_photo) values (${hidden.id}, ${org}, true)`);

    // Hidden at ANOTHER org the person belongs to (one privacy row per person, fail closed).
    const elsewhere = await person("HiddenElsewhere");
    await staff(elsewhere);
    await fx.platform.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.person_claim_authorized', ${elsewhere.id}, true)`);
      await tx.execute(sql`insert into memberships (organization_id, person_id, engagement_status, current_roll)
                           values (${otherOrg}, ${elsewhere.id}, 'regular', null)`);
    });
    await q(sql`insert into person_privacy (person_id, organization_id, hide_photo) values (${elsewhere.id}, ${otherOrg}, true)`);

    // A listed person whose listing is toggled below (0072's "stored public_site" variant is
    // unrepresentable since 0078: person_photos_image_fk pins 'private').
    await staff(await person("ListedToggled"));

    // One blob that is the photo of two people, one listed and one not (two person_photos rows,
    // one shared master blob).
    const sharedListed = await person("SharedListed");
    await staff(sharedListed);
    const sharedUnlisted = await person("SharedUnlisted", { imageKey: sharedListed.photo });
    await staff(sharedUnlisted, { listed: false });

    // A listed person who is merged_into_id-linked: whatever the roster says is the answer.
    const survivor = await person("MergeSurvivor");
    const merged = await person("MergedAway");
    await staff(merged);
    await q(sql`update people set merged_into_id = ${survivor.id} where id = ${merged.id}`);
  }, 180_000);

  afterAll(async () => {
    if (!fx) return;
    for (const o of [org, otherOrg, inactiveOrg, suspendedOrg, provisioningOrg]) {
      await q(sql`delete from ticket_messages where organization_id = ${o}`);
      await q(sql`delete from tickets where organization_id = ${o}`);
      await q(sql`delete from organization_brand_history where organization_id = ${o}`);
      await q(sql`delete from organization_brands where organization_id = ${o}`);
      await q(sql`delete from organization_sites where organization_id = ${o}`);
      await q(sql`delete from person_privacy where organization_id = ${o}`);
    }
    await q(sql`update people set merged_into_id = null where last_name = ${tag}`);
    await fx.cleanup();
    const left = await q(sql`select count(*)::int as n from organizations where id in (${org}, ${otherOrg}, ${inactiveOrg}, ${suspendedOrg}, ${provisioningOrg})`);
    expect(left[0]!.n, "fixture organizations are gone").toBe(0);
  }, 180_000);

  // ---------------------------------------------------------------------------
  describe("what a public page may reference", () => {
    it("a public_site image is served, class site, with its exact bytes as a Buffer", async () => {
      const got = await asApp(org, b.siteImage);
      expect(got).not.toBeNull();
      expect(got!.cacheClass).toBe("site");
      expect(got!.contentType).toBe("image/png");
      expect(Buffer.isBuffer(got!.bytes)).toBe(true);
      const [stored] = await q(sql`select encode(bytes, 'hex') as hex from blob_assets where id = ${b.siteImage}`);
      expect(got!.bytes.toString("hex")).toBe(stored!.hex);
    });

    it("the brand mark (public_site) is served, class site", async () => {
      expect((await asApp(org, b.mark))?.cacheClass).toBe("site");
    });

    it("Tier 1: a public_site image NO bundle references is still served (R8; takedown by reference is the Tier 2 follow-up)", async () => {
      expect((await asApp(org, b.tier1Unreferenced))?.cacheClass).toBe("site");
    });
  });

  describe("what it never serves", () => {
    it.each([
      ["a private image", () => b.privateImage],
      ["a ticket-attachment image, referenced by a real ticket_messages row", () => b.ticketImage],
      ["a statement PDF, referenced by a real giving_statements row", () => b.statementPdf],
      ["the content bundle JSON", () => b.bundle],
      ["the wordmark (private: mark only until a page renders it)", () => b.wordmark],
      ["a historical brand-history mark (private)", () => b.historicalMark],
      ["a random uuid", () => randomUUID()],
      ["the nil uuid", () => "00000000-0000-0000-0000-000000000000"],
    ])("%s", async (_label, key) => {
      expect(await asApp(org, key())).toBeNull();
    });

    it("a malformed key returns null without an error", async () => {
      for (const bad of ["not-a-uuid", "", `${b.siteImage}\n`, `${b.siteImage}0`]) {
        expect(await asApp(org, bad)).toBeNull();
      }
    });
  });

  describe("roster photos (stored private): governed by listing alone", () => {
    it.each(["StaffListed", "OfficerListed", "CommitteeListed"])("%s: served, class roster", async (name) => {
      const got = await asApp(org, people[name]!.photo);
      expect(got?.cacheClass).toBe("roster");
    });

    it.each([
      ["StaffEnded", "ends_on set"],
      ["StaffUnlisted", "public_listed = false"],
      ["CommitteeDerived", "a derived (session) group"],
      ["StaffHidden", "listed but person_privacy.hide_photo"],
      ["HiddenElsewhere", "hide_photo set at ANOTHER org the person belongs to (one privacy row per person, fail closed)"],
    ])("%s is not served (%s)", async (name) => {
      expect(await asApp(org, people[name]!.photo)).toBeNull();
    });

    it("a photo can never be stored public_site: the FK pins private (0072's 'mistakenly public_site' case is unrepresentable)", async () => {
      const p = people.StaffListed!;
      const publicImage = (await blob({ audience: "public_site" })).id;
      const thumb = (await blob({ audience: "private" })).id;
      await expect(
        q(sql`insert into person_photos (organization_id, person_id, image_asset_key, thumb_asset_key, width, height, created_by)
              values (${org}, ${p.id}, ${publicImage}, ${thumb}, 10, 10, ${fx.actingUserId})`),
      ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23503", constraint: "person_photos_image_fk" }) });
      // ...and the public_site blob, being nobody's photo, is simply a site image.
      expect((await asApp(org, publicImage))?.cacheClass).toBe("site");
    });

    it("a listed photo is roster-class (a day, private) - never site-class - and stops being served the moment they are un-listed", async () => {
      const p = people.ListedToggled!;
      expect((await asApp(org, p.photo))?.cacheClass).toBe("roster");
      await q(sql`update staff_positions set public_listed = false where person_id = ${p.id}`);
      try {
        expect(await asApp(org, p.photo)).toBeNull();
      } finally {
        await q(sql`update staff_positions set public_listed = true where person_id = ${p.id}`);
      }
      expect((await asApp(org, p.photo))?.cacheClass).toBe("roster");
    });

    it("the exclusion: an UNLISTED person's photo is NOT served (it is private, and nobody lists it)", async () => {
      expect(await asApp(org, people.StaffUnlisted!.photo)).toBeNull();
    });

    it("a key asked in UPPERCASE answers the same as lowercase, listed and unlisted (a stored key cannot vary: uuid columns)", async () => {
      expect((await asApp(org, people.StaffListed!.photo))?.cacheClass).toBe("roster");
      expect((await asApp(org, people.StaffListed!.photo.toUpperCase()))?.cacheClass).toBe("roster");
      expect(await asApp(org, people.StaffUnlisted!.photo)).toBeNull();
      expect(await asApp(org, people.StaffUnlisted!.photo.toUpperCase())).toBeNull();
      const [col] = await q(sql`select data_type from information_schema.columns
                                 where table_name = 'person_photos' and column_name = 'image_asset_key'`);
      expect(col!.data_type).toBe("uuid");
    });

    it("a merged tombstone is withheld (0078), and the door agrees with the roster", async () => {
      expect(await asApp(org, people.MergedAway!.photo)).toBeNull();
    });

    it("hide_photo set live withholds a listed photo; clearing it brings it back (read live, nothing copied)", async () => {
      const p = people.StaffListed!;
      await q(sql`insert into person_privacy (person_id, organization_id, hide_photo) values (${p.id}, ${org}, true)`);
      try {
        expect(await asApp(org, p.photo)).toBeNull();
      } finally {
        await q(sql`delete from person_privacy where person_id = ${p.id}`);
      }
      expect((await asApp(org, p.photo))?.cacheClass).toBe("roster");
    });

    it("one blob that is the photo of two people is served while EITHER is listed", async () => {
      const key = people.SharedListed!.photo;
      expect((await asApp(org, key))?.cacheClass).toBe("roster");
      await q(sql`update staff_positions set public_listed = false where person_id = ${people.SharedListed!.id}`);
      try {
        expect(await asApp(org, key)).toBeNull();
        await q(sql`update staff_positions set public_listed = true where person_id = ${people.SharedUnlisted!.id}`);
        expect((await asApp(org, key))?.cacheClass).toBe("roster");
      } finally {
        await q(sql`update staff_positions set public_listed = true where person_id = ${people.SharedListed!.id}`);
        await q(sql`update staff_positions set public_listed = false where person_id = ${people.SharedUnlisted!.id}`);
      }
    });
  });

  describe("the gates", () => {
    it("a foreign org gets nothing for the subject's keys, public or private", async () => {
      for (const key of [b.siteImage, b.mark, b.privateImage, people.StaffListed!.photo]) {
        expect(await asApp(otherOrg, key), key).toBeNull();
      }
      expect(otherSlug).not.toBe(slug);
    });

    it("an inactive org, a suspended site and a provisioning site serve nothing", async () => {
      for (const [o, label] of [
        [inactiveOrg, "inactive org"],
        [suspendedOrg, "suspended site"],
        [provisioningOrg, "provisioning site"],
      ] as const) {
        const img = await blob({ org: o, audience: "public_site" });
        expect(await asApp(o, img.id), label).toBeNull();
      }
    });

    it("a site that is live serves the image its own org stored (positive control for the gates above)", async () => {
      const img = await blob({ org: otherOrg, audience: "public_site" });
      expect((await asApp(otherOrg, img.id))?.cacheClass).toBe("site");
    });

    it("flipping the subject's site to suspended takes every key dark, and back", async () => {
      await q(sql`update organization_sites set status = 'suspended' where organization_id = ${org}`);
      try {
        expect(await asApp(org, b.siteImage)).toBeNull();
        expect(await asApp(org, people.StaffListed!.photo)).toBeNull();
      } finally {
        await q(sql`update organization_sites set status = 'live' where organization_id = ${org}`);
      }
      expect(await asApp(org, b.siteImage)).not.toBeNull();
    });
  });

  describe("parity with the roster functions (Gap 5)", () => {
    it("for EVERY person in the matrix, the door serves the photo IFF a roster function lists the key", async () => {
      const staffRows = (await appDb.execute(sql`select photo_key from presby_public_staff_roster(${slug})`)) as unknown as { rows: Row[] };
      const committeeRows = (await appDb.execute(sql`select photo_key from presby_public_committee_roster(${slug})`)) as unknown as { rows: Row[] };
      const listed = new Set(
        [...staffRows.rows, ...committeeRows.rows]
          .map((r) => r.photo_key)
          .filter((k): k is string => typeof k === "string")
          .map((k) => k.toLowerCase()),
      );
      expect(listed.size, "the roster matrix is not vacuous").toBeGreaterThanOrEqual(5);

      const disagreements: string[] = [];
      for (const [name, p] of Object.entries(people)) {
        const served = (await asApp(org, p.photo)) !== null;
        const onRoster = listed.has(p.photo.toLowerCase());
        if (served !== onRoster) disagreements.push(`${name}: door ${served}, roster ${onRoster}`);
      }
      expect(disagreements).toEqual([]);
    });
  });

  describe("the definer is the only door", () => {
    it("is not callable by presby_platform or PUBLIC (privilege, not logic)", async () => {
      const [r] = await q(sql`
        select has_function_privilege('presby_platform', 'presby_public_site_asset(uuid, uuid)', 'execute') as platform,
               has_function_privilege('presby_app', 'presby_public_site_asset(uuid, uuid)', 'execute') as app,
               (select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.proname = 'presby_public_site_asset' and a.grantee = 0)::int as public_grants`);
      expect(r).toEqual({ platform: false, app: true, public_grants: 0 });
    });
  });
});
