/**
 * D1: person-photos/store.ts against a REAL Postgres connection
 * (docs/work-log/2026-10-26-person-photos-inc1.md, Phase 3 Test Plan D1).
 * Every mutation runs on the `presby_app` connection with an organization
 * context (`withOrgContext`), so RLS, the 0078 guards, the partial uniques and
 * the CHECKs are all live.
 *
 *   - each mutation writes its audit row(s) with exactly the documented
 *     metadata keys and no others; a failing audit insert rolls the change back;
 *   - add auto-designates the directory slot only when it is empty, never the
 *     website; the cap of ten; a removed photo frees a slot;
 *   - a minor is refused on add and on designate (including a date of birth
 *     corrected between the two) but never blocks removing or un-designating;
 *   - refusals (toggle, permission, membership, cross-org id) leave no blob
 *     and no row, and an unauthorized caller reaches NO decode (a spy on
 *     `processPhoto`);
 *   - permission or toggle lost between authorization and the final
 *     transaction (edge cases 7 and 8);
 *   - two simultaneous adds of one file: one ok, one `duplicate`; designate
 *     racing remove leaves no active designation on a removed photo;
 *   - removal ends designations (`undesignated via remove`), a shared blob
 *     survives one removal, and teardown is confirmed by SELECT.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/person-photos/store.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import sharp from "sharp";
import type { InvitationFixture, Row } from "@/lib/testing/invitation-fixture";
import { setPersonPhotosToggle } from "@/lib/testing/person-photo-fixture";
import { PHOTO_CAP_PER_PERSON } from "./limits";

vi.mock("server-only", () => ({}));
// audit.ts imports @/auth (next-auth), which this test environment cannot load.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

// A spy in front of the real decoder, and a switch in front of the real audit insert.
const hooks = vi.hoisted(() => ({
  processed: [] as number[],
  beforeDecode: null as null | (() => Promise<void>),
  auditFails: false,
}));
vi.mock("./image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./image")>();
  return {
    ...actual,
    processPhoto: async (bytes: Buffer) => {
      hooks.processed.push(bytes.byteLength);
      if (hooks.beforeDecode) await hooks.beforeDecode();
      return actual.processPhoto(bytes);
    },
  };
});
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return {
    ...actual,
    insertAuditRow: (...args: Parameters<typeof actual.insertAuditRow>) =>
      hooks.auditFails ? Promise.reject(new Error("audit store unavailable")) : actual.insertAuditRow(...args),
  };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("person-photos/store.ts (Postgres-backed)", { timeout: 180_000 }, () => {
  let fx: InvitationFixture;
  let store: typeof import("./store");
  let orgA: string;
  let orgB: string;
  let editor: string;
  let bystander: string; // a member of orgA with no permission
  let stranger: string; // a person with no membership at orgA
  let stamp: string;
  let counter = 0;

  const q = (query: SQL): Promise<Row[]> => fx.q(query);
  const ctxFor = (actorPersonId: string, organizationId = orgA) => ({
    organizationId,
    actorPersonId,
    actor: { userId: fx.actingUserId, email: "editor@example.invalid" },
  });
  const ctx = () => ctxFor(editor);

  /** A distinct, valid JPEG on every call (the colour and texture differ, so the bytes and the hash do). */
  async function jpeg(): Promise<Buffer> {
    counter += 1;
    const n = counter * 37;
    return sharp({ create: { width: 320, height: 400, channels: 3, background: { r: n % 256, g: (n * 7) % 256, b: (n * 13) % 256 } } })
      .composite([
        {
          input: await sharp({ create: { width: 90, height: 90, channels: 3, background: { r: (n * 3) % 256, g: 20, b: (n * 11) % 256 } } })
            .png()
            .toBuffer(),
          left: (n * 5) % 200,
          top: (n * 9) % 300,
        },
      ])
      .jpeg()
      .toBuffer();
  }

  async function person(first: string, org = orgA): Promise<string> {
    const id = await fx.makePerson(first, `Photo${stamp}`);
    await fx.addMember(org, id);
    return id;
  }
  const setDob = (personId: string, iso: string | null) => q(sql`update people set date_of_birth = ${iso}::date where id = ${personId}`);

  const photosOf = (personId: string, org = orgA) =>
    q(sql`select id, image_asset_key, thumb_asset_key, asset_audience, width, height, created_by, removed_at, removed_by
            from person_photos where organization_id = ${org} and person_id = ${personId} order by created_at, id`);
  const livePhotos = async (personId: string) => (await photosOf(personId)).filter((r) => r.removed_at === null);
  const designationsOf = (personId: string, org = orgA) =>
    q(sql`select id, photo_id, purpose, public_attested_at, public_attested_by, designated_by, ended_at, ended_by
            from person_photo_designations where organization_id = ${org} and person_id = ${personId} order by designated_at, id`);
  const activeDesignations = async (personId: string) => (await designationsOf(personId)).filter((r) => r.ended_at === null);
  const auditOf = (personId: string) =>
    q(sql`select action, resource_type, resource_id, actor_user_id, metadata from audit_events
           where resource_id = ${personId} and action like 'tenant.person_photo.%' order by created_at, id`);
  // Rows written in ONE transaction share created_at (the column default is now()), so their relative
  // order is not observable: every assertion below is order-insensitive within a transaction.
  const actionsOf = async (personId: string) => (await auditOf(personId)).map((r) => String(r.action)).sort();
  const auditNamed = async (personId: string, action: string) => (await auditOf(personId)).filter((r) => r.action === action);
  const blobCount = async (org = orgA) => Number((await q(sql`select count(*)::int as n from blob_assets where organization_id = ${org}`))[0]!.n);
  const snapshot = async (personId: string) => ({
    photos: await photosOf(personId),
    designations: await designationsOf(personId),
    audit: await auditOf(personId),
    blobs: await blobCount(),
  });

  async function add(personId: string, file?: Buffer, c = ctx()) {
    return store.addPhoto(c, personId, file ?? (await jpeg()));
  }
  async function addOk(personId: string, file?: Buffer) {
    const r = await add(personId, file);
    if (r.kind !== "ok") throw new Error(`addPhoto refused: ${r.reason}`);
    return r;
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/invitation-fixture");
    fx = await mod.createInvitationFixture("photos-store");
    store = await import("./store");
    stamp = `${Date.now()}`;
    orgA = await fx.makeOrg("a");
    orgB = await fx.makeOrg("b");
    await q(sql`
      insert into permissions (key, module, description, sensitivity_tier)
      values ('people.manage', 'people', 'Create and edit people, households, and contact/address detail', 1)
      on conflict do nothing`);
    editor = await fx.makePerson("Edith", `Editor${stamp}`);
    await fx.enroll(orgA, editor, ["people.manage"]);
    bystander = await person("Bobby");
    stranger = await fx.makePerson("Sam", `Stranger${stamp}`);
    await setPersonPhotosToggle(fx.platform, orgA, true);
  }, 180_000);

  beforeEach(() => {
    hooks.processed.length = 0;
    hooks.beforeDecode = null;
    hooks.auditFails = false;
  });

  afterAll(async () => {
    hooks.beforeDecode = null;
    hooks.auditFails = false;
    if (!fx) return;
    try {
      for (const id of [orgA, orgB]) {
        if (id) await q(sql`delete from audit_events where metadata->>'organizationId' = ${id}`);
      }
    } finally {
      await fx.cleanup();
    }
    const left = await q(sql`
      select (select count(*) from person_photos where organization_id in (${orgA}, ${orgB}))::int
           + (select count(*) from person_photo_designations where organization_id in (${orgA}, ${orgB}))::int
           + (select count(*) from blob_assets where organization_id in (${orgA}, ${orgB}))::int as n`);
    expect(left[0]!.n, "the fixture orgs' photo rows and blobs are gone").toBe(0);
  }, 180_000);

  // -------------------------------------------------------------------------
  describe("addPhoto", () => {
    it("stores two PRIVATE blobs, a person_photos row, and auto-designates the DIRECTORY slot (never the website), with exactly the documented audit rows", async () => {
      const p = await person("Ada");
      const r = await addOk(p);
      expect(r.usedForDirectory).toBe(true);

      const [photo] = await photosOf(p);
      expect(photo).toMatchObject({ id: r.photoId, asset_audience: "private", created_by: fx.actingUserId, removed_at: null });
      expect(Number(photo!.width)).toBeLessThanOrEqual(1200);
      expect(Number(photo!.height)).toBeLessThanOrEqual(1200);
      const blobs = await q(sql`select id, audience, content_type from blob_assets where id in (${String(photo!.image_asset_key)}, ${String(photo!.thumb_asset_key)})`);
      expect(blobs.map((b) => `${b.audience}:${b.content_type}`).sort()).toEqual(["private:image/jpeg", "private:image/webp"]);

      const designations = await designationsOf(p);
      expect(designations).toHaveLength(1);
      expect(designations[0]).toMatchObject({
        photo_id: r.photoId,
        purpose: "directory",
        public_attested_at: null,
        public_attested_by: null,
        designated_by: fx.actingUserId,
        ended_at: null,
      });

      expect(await actionsOf(p)).toEqual(["tenant.person_photo.added", "tenant.person_photo.designated"]);
      const [added] = await auditNamed(p, "tenant.person_photo.added");
      const [designated] = await auditNamed(p, "tenant.person_photo.designated");
      expect(added).toMatchObject({ resource_type: "person", resource_id: p, actor_user_id: fx.actingUserId });
      expect(added!.metadata).toEqual({ organizationId: orgA, personId: p, photoId: r.photoId, autoDirectory: true });
      expect(designated!.metadata).toEqual({
        organizationId: orgA,
        personId: p,
        photoId: r.photoId,
        purpose: "directory",
        attested: false,
        replacedPhotoId: null,
        via: "add",
      });
    });

    it("a second photo does not take the directory slot: no designation, only an `added` audit row", async () => {
      const p = await person("Bea");
      const first = await addOk(p);
      const second = await addOk(p);
      expect(second.usedForDirectory).toBe(false);
      const active = await activeDesignations(p);
      expect(active.map((d) => [d.purpose, d.photo_id])).toEqual([["directory", first.photoId]]);
      expect(await actionsOf(p)).toEqual(["tenant.person_photo.added", "tenant.person_photo.added", "tenant.person_photo.designated"]);
      const secondAdded = (await auditNamed(p, "tenant.person_photo.added")).find((a) => (a.metadata as { photoId: string }).photoId === second.photoId);
      expect(secondAdded!.metadata).toEqual({ organizationId: orgA, personId: p, photoId: second.photoId, autoDirectory: false });
    });

    it("an add after the directory photo was un-designated takes the empty slot again", async () => {
      const p = await person("Cal");
      await addOk(p);
      await store.undesignatePhoto(ctx(), p, "directory");
      const again = await addOk(p);
      expect(again.usedForDirectory).toBe(true);
    });

    it(`refuses the ${PHOTO_CAP_PER_PERSON + 1}th live photo (cap_reached) with no decode and no blob, and a removed photo frees a slot`, async () => {
      const p = await person("Dee");
      const ids: string[] = [];
      for (let i = 0; i < PHOTO_CAP_PER_PERSON; i += 1) ids.push((await addOk(p)).photoId);
      const before = await snapshot(p);
      hooks.processed.length = 0;
      const refused = await add(p);
      expect(refused).toEqual({ kind: "refused", reason: "cap_reached", first: "Dee" });
      expect(hooks.processed, "the cap is checked before any decode").toEqual([]);
      expect(await snapshot(p)).toEqual(before);

      expect((await store.removePhoto(ctx(), p, ids[3]!)).kind).toBe("ok");
      expect((await add(p)).kind).toBe("ok");
      expect(await livePhotos(p)).toHaveLength(PHOTO_CAP_PER_PERSON);
    });

    it("refuses a duplicate of one of the person's own live photos, and says nothing about any other person's", async () => {
      const p = await person("Eli");
      const q2 = await person("Fay");
      const file = await jpeg();
      await addOk(p, file);
      expect(await add(p, file)).toEqual({ kind: "refused", reason: "duplicate", first: "Eli" });
      // The same bytes for a different person are fine: no oracle on whose photo it is.
      expect((await add(q2, file)).kind).toBe("ok");
    });

    it("refuses what image.ts refuses, each with its own kind, and writes nothing", async () => {
      const p = await person("Gus");
      const before = await snapshot(p);
      expect(await add(p, Buffer.alloc(0))).toEqual({ kind: "refused", reason: "empty" });
      expect(await add(p, Buffer.from("%PDF-1.7 not a picture"))).toEqual({ kind: "refused", reason: "unsupported_type" });
      expect(await add(p, Buffer.alloc(1_000_001, 0xff))).toEqual({ kind: "refused", reason: "too_large" });
      expect(await snapshot(p)).toEqual(before);
    });

    it("a malformed or cross-organization person id is `not_found`", async () => {
      const inB = await person("Hal", orgB);
      expect(await add("not-a-uuid")).toEqual({ kind: "refused", reason: "not_found" });
      expect(await add(inB)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await add(stranger)).toEqual({ kind: "refused", reason: "not_found" });
      expect(hooks.processed).toEqual([]);
      expect(await photosOf(inB, orgB)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("authorize before decode (R7)", () => {
    it("the toggle off, no people.manage, a non-member actor and a stranger target each leave no decode, no row, no blob and no audit row", async () => {
      const p = await person("Ida");
      const before = await snapshot(p);
      const blobsBefore = await blobCount();

      // permission missing: a member of the org who holds nothing
      expect(await add(p, undefined, ctxFor(bystander))).toEqual({ kind: "refused", reason: "forbidden" });
      // the actor is not a member of the organization at all
      expect(await add(p, undefined, ctxFor(stranger))).toEqual({ kind: "refused", reason: "forbidden" });
      // toggle off: refused as feature_off even for someone without the permission (toggle is checked first)
      await setPersonPhotosToggle(fx.platform, orgA, false);
      try {
        expect(await add(p)).toEqual({ kind: "refused", reason: "feature_off" });
        expect(await add(p, undefined, ctxFor(bystander))).toEqual({ kind: "refused", reason: "feature_off" });
      } finally {
        await setPersonPhotosToggle(fx.platform, orgA, true);
      }

      expect(hooks.processed, "processPhoto was never called").toEqual([]);
      expect(await snapshot(p)).toEqual(before);
      expect(await blobCount()).toBe(blobsBefore);
    });

    it("the other three mutations refuse the same way, and leave the set untouched", async () => {
      const p = await person("Jan");
      const r = await addOk(p);
      const before = await snapshot(p);
      const attempt = { photoId: r.photoId, purpose: "website" as const, attested: true };
      for (const c of [ctxFor(bystander), ctxFor(stranger)]) {
        expect(await store.designatePhoto(c, p, attempt)).toEqual({ kind: "refused", reason: "forbidden" });
        expect(await store.undesignatePhoto(c, p, "directory")).toEqual({ kind: "refused", reason: "forbidden" });
        expect(await store.removePhoto(c, p, r.photoId)).toEqual({ kind: "refused", reason: "forbidden" });
      }
      await setPersonPhotosToggle(fx.platform, orgA, false);
      try {
        expect(await store.designatePhoto(ctx(), p, attempt)).toEqual({ kind: "refused", reason: "feature_off" });
        expect(await store.undesignatePhoto(ctx(), p, "directory")).toEqual({ kind: "refused", reason: "feature_off" });
        expect(await store.removePhoto(ctx(), p, r.photoId)).toEqual({ kind: "refused", reason: "feature_off" });
      } finally {
        await setPersonPhotosToggle(fx.platform, orgA, true);
      }
      expect(await snapshot(p)).toEqual(before);
    });

    it("a toggle turned off between authorization and the final transaction refuses the add (edge case 7), leaving the blobs unreferenced", async () => {
      const p = await person("Kay");
      const before = await snapshot(p);
      const blobsBefore = await blobCount();
      hooks.beforeDecode = async () => {
        await setPersonPhotosToggle(fx.platform, orgA, false);
      };
      try {
        expect(await add(p)).toEqual({ kind: "refused", reason: "feature_off" });
      } finally {
        hooks.beforeDecode = null;
        await setPersonPhotosToggle(fx.platform, orgA, true);
      }
      expect(await photosOf(p)).toEqual(before.photos);
      expect(await designationsOf(p)).toEqual(before.designations);
      expect(await auditOf(p)).toEqual(before.audit);
      expect(await blobCount(), "the accepted residual: two blobs stored, unreferenced").toBe(blobsBefore + 2);
    });

    it("people.manage revoked between authorization and the final transaction refuses the add (edge case 8)", async () => {
      const temp = await fx.makePerson("Lee", `Temp${stamp}`);
      await fx.enroll(orgA, temp, ["people.manage"]);
      const p = await person("Mo");
      hooks.beforeDecode = async () => {
        await q(sql`delete from role_grants where organization_id = ${orgA} and person_id = ${temp}`);
      };
      expect(await add(p, undefined, ctxFor(temp))).toEqual({ kind: "refused", reason: "forbidden" });
      expect(hooks.processed.length, "authorization passed once, so the decode did run").toBe(1);
      expect(await photosOf(p)).toHaveLength(0);
      expect(await auditOf(p)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("minors (R4)", () => {
    const yearsAgo = (n: number, extraDays = 0) => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - n);
      d.setDate(d.getDate() + extraDays);
      return d.toISOString().slice(0, 10);
    };

    it("refuses an add for a person under 18 by date of birth, by the child marker, and allows null DOB and exactly 18 (the SQL predicate decides)", async () => {
      const kid = await person("Ned");
      await setDob(kid, yearsAgo(10));
      const marked = await person("Opal");
      await q(sql`update memberships set household_role = 'child' where organization_id = ${orgA} and person_id = ${marked}`);
      const adult = await person("Pam");
      await setDob(adult, yearsAgo(18, -2));
      const unknown = await person("Quin"); // null DOB, no marker: an adult (operator ruling Q4)

      hooks.processed.length = 0;
      expect(await add(kid)).toEqual({ kind: "refused", reason: "minor", first: "Ned" });
      expect(await add(marked)).toEqual({ kind: "refused", reason: "minor", first: "Opal" });
      expect(hooks.processed, "a minor reaches no decode").toEqual([]);
      expect((await add(adult)).kind).toBe("ok");
      expect((await add(unknown)).kind).toBe("ok");
      expect(await photosOf(kid)).toHaveLength(0);
    });

    it("a date of birth corrected between add and designate refuses the designate (`minor`), but removing and un-designating still work", async () => {
      const p = await person("Rex");
      const r = await addOk(p);
      await setDob(p, yearsAgo(9));
      expect(await store.designatePhoto(ctx(), p, { photoId: r.photoId, purpose: "directory", attested: false })).toEqual({
        kind: "refused",
        reason: "minor",
        first: "Rex",
      });
      expect((await store.undesignatePhoto(ctx(), p, "directory")).kind).toBe("ok");
      expect((await store.removePhoto(ctx(), p, r.photoId)).kind).toBe("ok");
      expect(await activeDesignations(p)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("designatePhoto", () => {
    it("the website needs the attestation: `attested: false` is refused, writes nothing, and a true one records who and when", async () => {
      const p = await person("Sue");
      const r = await addOk(p);
      const before = await snapshot(p);
      expect(await store.designatePhoto(ctx(), p, { photoId: r.photoId, purpose: "website", attested: false })).toEqual({
        kind: "refused",
        reason: "attestation_required",
      });
      expect(await snapshot(p)).toEqual(before);

      expect((await store.designatePhoto(ctx(), p, { photoId: r.photoId, purpose: "website", attested: true })).kind).toBe("ok");
      const website = (await activeDesignations(p)).find((d) => d.purpose === "website")!;
      expect(website.public_attested_at).not.toBeNull();
      expect(website.public_attested_by).toBe(fx.actingUserId);
      const audit = (await auditOf(p)).at(-1)!;
      expect(audit.action).toBe("tenant.person_photo.designated");
      expect(audit.metadata).toEqual({
        organizationId: orgA,
        personId: p,
        photoId: r.photoId,
        purpose: "website",
        attested: true,
        replacedPhotoId: null,
        via: "designate",
      });
    });

    it("choosing another photo ends the active designation and inserts the new one (one active per purpose), auditing the replaced photo", async () => {
      const p = await person("Tom");
      const a = await addOk(p);
      const b = await addOk(p);
      expect((await store.designatePhoto(ctx(), p, { photoId: b.photoId, purpose: "directory", attested: true })).kind).toBe("ok");

      const all = await designationsOf(p);
      const directory = all.filter((d) => d.purpose === "directory");
      expect(directory).toHaveLength(2);
      expect(directory.filter((d) => d.ended_at === null).map((d) => d.photo_id)).toEqual([b.photoId]);
      const ended = directory.find((d) => d.ended_at !== null)!;
      expect(ended).toMatchObject({ photo_id: a.photoId, ended_by: fx.actingUserId });
      const active = directory.find((d) => d.ended_at === null)!;
      expect(active.public_attested_at, "the clearance for the website was recorded on the directory designation").not.toBeNull();

      const audit = (await auditOf(p)).at(-1)!;
      expect(audit.metadata).toEqual({
        organizationId: orgA,
        personId: p,
        photoId: b.photoId,
        purpose: "directory",
        attested: true,
        replacedPhotoId: a.photoId,
        via: "designate",
      });
    });

    it("the same photo with a changed attestation takes the same path (end, insert); unchanged writes nothing and no audit row", async () => {
      const p = await person("Uma");
      const a = await addOk(p);
      const input = { photoId: a.photoId, purpose: "directory" as const, attested: false };
      const unchanged = await snapshot(p);
      expect((await store.designatePhoto(ctx(), p, input)).kind).toBe("ok");
      expect(await snapshot(p)).toEqual(unchanged);

      expect((await store.designatePhoto(ctx(), p, { ...input, attested: true })).kind).toBe("ok");
      const designations = await designationsOf(p);
      expect(designations).toHaveLength(2);
      expect(designations.filter((d) => d.ended_at === null).map((d) => d.public_attested_at !== null)).toEqual([true]);
      expect((await auditOf(p)).at(-1)!.metadata).toMatchObject({ attested: true, replacedPhotoId: null });
    });

    it("another person's photo, another organization's photo, a removed photo and a malformed id are refused; the purpose is a closed pair", async () => {
      const p = await person("Val");
      const other = await person("Wes");
      const mine = await addOk(p);
      const theirs = await addOk(other);
      const gone = await addOk(p);
      await store.removePhoto(ctx(), p, gone.photoId);
      const before = await snapshot(p);

      const one = (photoId: string, purpose: "directory" | "website" = "directory") =>
        store.designatePhoto(ctx(), p, { photoId, purpose, attested: true });
      expect(await one(theirs.photoId)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await one("00000000-0000-4000-8000-000000000000")).toEqual({ kind: "refused", reason: "not_found" });
      expect(await one("not-a-uuid")).toEqual({ kind: "refused", reason: "not_found" });
      expect(await one(gone.photoId)).toEqual({ kind: "refused", reason: "already_removed" });
      expect(await store.designatePhoto(ctx(), p, { photoId: mine.photoId, purpose: "profile" as never, attested: true })).toEqual({
        kind: "refused",
        reason: "not_found",
      });
      expect(await snapshot(p)).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  describe("undesignatePhoto", () => {
    it("ends the active designation and audits `undesignated via undesignate`; with none active it writes nothing and no audit row", async () => {
      const p = await person("Xan");
      const r = await addOk(p);
      expect((await store.undesignatePhoto(ctx(), p, "directory")).kind).toBe("ok");
      expect(await activeDesignations(p)).toHaveLength(0);
      const last = (await auditOf(p)).at(-1)!;
      expect(last.action).toBe("tenant.person_photo.undesignated");
      expect(last.metadata).toEqual({ organizationId: orgA, personId: p, photoId: r.photoId, purpose: "directory", via: "undesignate" });

      const before = await snapshot(p);
      expect((await store.undesignatePhoto(ctx(), p, "directory")).kind).toBe("ok");
      expect((await store.undesignatePhoto(ctx(), p, "website")).kind).toBe("ok");
      expect(await snapshot(p)).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  describe("removePhoto", () => {
    it("ends every active designation (one `undesignated via remove` each, then `removed`), keeps the blobs, and a second removal is `already_removed`", async () => {
      const p = await person("Yan");
      const r = await addOk(p);
      await store.designatePhoto(ctx(), p, { photoId: r.photoId, purpose: "website", attested: true });
      const blobs = await blobCount();
      const before = (await auditOf(p)).length;

      expect((await store.removePhoto(ctx(), p, r.photoId)).kind).toBe("ok");
      const [photo] = await photosOf(p);
      expect(photo!.removed_at).not.toBeNull();
      expect(photo!.removed_by).toBe(fx.actingUserId);
      expect(await activeDesignations(p)).toHaveLength(0);
      expect(await blobCount(), "no blob is deleted").toBe(blobs);

      const written = (await auditOf(p)).slice(before);
      expect(written.map((a) => String(a.action)).sort()).toEqual([
        "tenant.person_photo.removed",
        "tenant.person_photo.undesignated",
        "tenant.person_photo.undesignated",
      ]);
      const undesignated = written.filter((a) => a.action === "tenant.person_photo.undesignated");
      expect(undesignated.map((a) => (a.metadata as { purpose: string }).purpose).sort()).toEqual(["directory", "website"]);
      for (const a of undesignated) {
        expect(a.metadata).toEqual({ organizationId: orgA, personId: p, photoId: r.photoId, purpose: (a.metadata as { purpose: string }).purpose, via: "remove" });
      }
      const removed = written.find((a) => a.action === "tenant.person_photo.removed")!.metadata as { endedPurposes: string[] };
      expect(removed).toEqual({ organizationId: orgA, personId: p, photoId: r.photoId, endedPurposes: expect.any(Array) });
      expect([...removed.endedPurposes].sort()).toEqual(["directory", "website"]);

      expect(await store.removePhoto(ctx(), p, r.photoId)).toEqual({ kind: "refused", reason: "already_removed" });
    });

    it("a photo of another person or organization is `not_found`", async () => {
      const p = await person("Zed");
      const other = await person("Ann");
      const theirs = await addOk(other);
      expect(await store.removePhoto(ctx(), p, theirs.photoId)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.removePhoto(ctx(), p, "not-a-uuid")).toEqual({ kind: "refused", reason: "not_found" });
      expect(await livePhotos(other)).toHaveLength(1);
    });

    it("byte-identical photos for two people share blobs; removing one person's photo leaves the other's intact and the blobs in place", async () => {
      const p = await person("Bo");
      const q2 = await person("Cy");
      const file = await jpeg();
      const a = await addOk(p, file);
      const b = await addOk(q2, file);
      const [pa] = await photosOf(p);
      const [pb] = await photosOf(q2);
      expect(pa!.image_asset_key).toBe(pb!.image_asset_key);
      expect(pa!.thumb_asset_key).toBe(pb!.thumb_asset_key);

      await store.removePhoto(ctx(), p, a.photoId);
      expect(await livePhotos(q2)).toHaveLength(1);
      expect(await activeDesignations(q2)).toHaveLength(1);
      const blobs = await q(sql`select count(*)::int as n from blob_assets where id = ${String(pb!.image_asset_key)}`);
      expect(blobs[0]!.n).toBe(1);
      expect((await livePhotos(q2))[0]!.id).toBe(b.photoId);
    });
  });

  // -------------------------------------------------------------------------
  describe("a failing audit insert undoes the change (edge case 18)", () => {
    it("add: no photo, no designation, no audit row (the blobs are the accepted unreferenced residual)", async () => {
      const p = await person("Di");
      const before = await snapshot(p);
      hooks.auditFails = true;
      const r = await add(p);
      hooks.auditFails = false;
      expect(r).toEqual({ kind: "refused", reason: "save_failed" });
      expect(await photosOf(p)).toEqual(before.photos);
      expect(await designationsOf(p)).toEqual(before.designations);
      expect(await auditOf(p)).toEqual(before.audit);
    });

    it("designate, undesignate and remove: the designation and the photo are exactly as they were", async () => {
      const p = await person("Em");
      const a = await addOk(p);
      const b = await addOk(p);
      const before = await snapshot(p);
      hooks.auditFails = true;
      try {
        expect(await store.designatePhoto(ctx(), p, { photoId: b.photoId, purpose: "directory", attested: false })).toEqual({
          kind: "refused",
          reason: "save_failed",
        });
        expect(await store.undesignatePhoto(ctx(), p, "directory")).toEqual({ kind: "refused", reason: "save_failed" });
        expect(await store.removePhoto(ctx(), p, a.photoId)).toEqual({ kind: "refused", reason: "save_failed" });
      } finally {
        hooks.auditFails = false;
      }
      expect(await snapshot(p)).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  describe("concurrency (edge cases 4 and 5)", () => {
    it("two simultaneous adds of the same file: one succeeds, the other is `duplicate`, and exactly one photo row exists", async () => {
      const p = await person("Flo");
      const file = await jpeg();
      const results = await Promise.all([add(p, file), add(p, file)]);
      expect(results.map((r) => (r.kind === "ok" ? "ok" : r.reason)).sort()).toEqual(["duplicate", "ok"]);
      expect(await livePhotos(p)).toHaveLength(1);
      expect(await activeDesignations(p)).toHaveLength(1);
    });

    it("two simultaneous adds of different files both succeed and exactly one becomes the directory photo", async () => {
      const p = await person("Gil");
      const results = await Promise.all([add(p), add(p)]);
      expect(results.every((r) => r.kind === "ok")).toBe(true);
      expect(results.filter((r) => r.kind === "ok" && r.usedForDirectory)).toHaveLength(1);
      expect((await activeDesignations(p)).filter((d) => d.purpose === "directory")).toHaveLength(1);
    });

    it("designate racing remove never leaves an active designation on a removed photo", async () => {
      for (let i = 0; i < 3; i += 1) {
        const p = await person(`Hux${i}`);
        const r = await addOk(p);
        const [d, rm] = await Promise.all([
          store.designatePhoto(ctx(), p, { photoId: r.photoId, purpose: "website", attested: true }),
          store.removePhoto(ctx(), p, r.photoId),
        ]);
        expect(rm.kind).toBe("ok");
        expect(d.kind === "ok" || (d.kind === "refused" && d.reason === "already_removed")).toBe(true);
        expect(await activeDesignations(p)).toHaveLength(0);
        expect((await photosOf(p))[0]!.removed_at).not.toBeNull();
      }
    });
  });
});
