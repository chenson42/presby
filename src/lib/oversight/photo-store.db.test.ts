/**
 * D3 (Increment 2): src/lib/oversight/photo-store.ts and photo-reads.ts against a
 * REAL Postgres connection (docs/work-log/2026-11-17-congregation-profile.md,
 * Phase 3 "Test plan" D3 photo cases and "Edge Cases & Risks"; DECISION-344, 346).
 * Every write runs on `presby_app` inside `withOrgContext`, so RLS, the 0089
 * photo guards, the partial uniques and the CHECKs are all live. Generated
 * pictures only. Pinned here:
 *
 *   - no key, the other tier's key, a toggle that is off, a congregation of
 *     another presbytery, another congregation's building, a removed building
 *     and a never-affiliated congregation are each refused BEFORE any decode and
 *     write nothing;
 *   - two PRIVATE blobs owned by the presbytery, the first photo is the cover,
 *     exactly one audit row per write whose metadata is ids and booleans only (a
 *     sentinel caption appears in no audit row);
 *   - the cap is refused before the decode and is recounted under the building's
 *     row lock: two simultaneous uploads into a building holding nine end with ten;
 *   - the audit is IN THE SAME TRANSACTION: an audit insert that fails, and one
 *     that succeeds and is followed by a failure, both leave no photo row and no
 *     audit row;
 *   - cover moves one mark; two simultaneous cover changes end with one cover;
 *     removing the cover clears the mark and the building still has a cover
 *     (the oldest);
 *   - the readers: forbidden without the key, a `?view=` honoured only for a live
 *     photo of this building, one cover per building.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/oversight/photo-store.db.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import sharp from "sharp";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";
// Enter the domain cycle through the canonical entry point first (see oversight.db.test.ts).
import "@/lib/db/schema";
import type { OversightCtx } from "./contract";

vi.mock("server-only", () => ({}));
// audit.ts imports @/auth (next-auth), which this test environment cannot load.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const hooks = vi.hoisted(() => ({
  mode: "ok" as "ok" | "fail_before" | "fail_after",
  /** The global org_portal.oversight toggle, as the store reads it. */
  flag: true,
  /** How many times the image pipeline decoded. */
  decodes: 0,
}));
vi.mock("@/lib/flags", () => ({ isFlagEnabled: async () => hooks.flag }));
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return {
    ...actual,
    insertAuditRow: async (...args: Parameters<typeof actual.insertAuditRow>) => {
      if (hooks.mode === "fail_before") throw new Error("audit store unavailable");
      await actual.insertAuditRow(...args);
      if (hooks.mode === "fail_after") throw new Error("transaction failed after the audit insert");
    },
  };
});
vi.mock("@/lib/storage/image/photo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/image/photo")>();
  return {
    ...actual,
    processPhoto: async (...args: Parameters<typeof actual.processPhoto>) => {
      hooks.decodes += 1;
      return actual.processPhoto(...args);
    },
  };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
type Row = Record<string, unknown>;

const SIX = [
  "oversight_building_photos",
  "oversight_building_appraisals",
  "oversight_loans",
  "oversight_buildings",
  "oversight_insurance_years",
  "oversight_profiles",
] as const;

const rowsOf = (result: unknown): Row[] => {
  const r = result as { rows?: Row[] } | Row[];
  return Array.isArray(r) ? r : (r.rows ?? []);
};

describe.skipIf(!hasDb)("oversight/photo-store.ts and photo-reads.ts (Postgres-backed)", { timeout: 240_000 }, () => {
  let fx: CalendarFixture;
  let store: typeof import("./photo-store");
  let buildingStore: typeof import("./store");
  let reads: typeof import("./photo-reads");
  let P: string;
  let P2: string;
  let C1: string;
  let C2: string;
  let CX: string;
  let CN: string;
  const congregations: string[] = [];
  const person: Record<"manage" | "finance" | "none", string> = {} as never;
  let stamp: string;
  let counter = 0;

  const q = async (query: SQL): Promise<Row[]> => rowsOf(await fx.platform.execute(query));
  const ctxFor = (personId: string, organizationId = P): OversightCtx => ({
    personId,
    organizationId,
    actor: { userId: fx.actingUserId, email: "photos-test@example.invalid" },
  });
  const manage = () => ctxFor(person.manage);
  const viewer = (who: keyof typeof person) => ({ personId: person[who], organizationId: P });

  async function affiliate(subject: string, parent: string) {
    await q(sql`
      insert into organization_affiliations
        (organization_id, subject_org_id, parent_org_id, relationship_type, effective_from, authority, minute_reference)
      values (${parent}, ${subject}, ${parent}, 'member_congregation', '2000-01-01', 'recorded',
              'Fixture affiliation for oversight photo-store.db.test.ts')`);
  }

  /** A distinct, valid, generated JPEG on every call (the colour and the block differ, so the bytes and the hash do). */
  async function jpeg(): Promise<Buffer> {
    counter += 1;
    const n = counter * 37;
    return sharp({ create: { width: 320, height: 240, channels: 3, background: { r: n % 256, g: (n * 7) % 256, b: (n * 13) % 256 } } })
      .composite([
        {
          input: await sharp({ create: { width: 60, height: 60, channels: 3, background: { r: (n * 3) % 256, g: 20, b: (n * 11) % 256 } } })
            .png()
            .toBuffer(),
          left: (n * 5) % 200,
          top: (n * 9) % 150,
        },
      ])
      .jpeg()
      .toBuffer();
  }

  async function makeBuilding(about = C1): Promise<string> {
    counter += 1;
    const { parseBuilding } = await import("./validate");
    const parsed = parseBuilding(
      {
        name: `Hall ${stamp}-${counter}`, buildingType: "sanctuary", primary: false, yearBuilt: "", firstAdditionYear: "",
        secondAdditionYear: "", squareFeet: "", roofCondition: "", plumbingCondition: "", hvacCondition: "", boilerCondition: "",
        hasSprinklers: "", hasFireAlarm: "", hasSecuritySystem: "", notes: "",
      },
      { year: 2026, today: "2026-06-15" },
    );
    if (!parsed.ok) throw new Error(parsed.message);
    const r = await buildingStore.createBuilding(manage(), about, parsed.value);
    if (r.kind !== "ok") throw new Error(`createBuilding fixture refused: ${JSON.stringify(r)}`);
    return r.data.id;
  }

  async function addOk(building: string, about = C1, file?: Buffer): Promise<string> {
    const r = await store.addPhoto(manage(), about, building, file ?? (await jpeg()));
    if (r.kind !== "ok") throw new Error(`addPhoto refused: ${r.reason}`);
    return r.data.id;
  }

  const photosOf = (building: string) =>
    q(sql`select id, image_asset_key, thumb_asset_key, asset_audience, organization_id, about_org_id, building_id, width, height, caption,
                 is_cover, created_by, removed_at, removed_by
            from oversight_building_photos where building_id = ${building} order by created_at, id`);
  const live = async (building: string) => (await photosOf(building)).filter((r) => r.removed_at === null);
  const auditOf = (building: string) =>
    q(sql`select action, resource_type, resource_id, actor_user_id, metadata from audit_events
           where action like 'tenant.oversight_photo.%' and metadata->>'buildingId' = ${building} order by created_at, id`);
  const auditCount = async () =>
    Number((await q(sql`select count(*)::int as n from audit_events where action like 'tenant.oversight_photo.%' and metadata->>'organizationId' = ${P}`))[0]!.n);
  const photoCount = async () =>
    Number((await q(sql`select count(*)::int as n from oversight_building_photos where organization_id = ${P}`))[0]!.n);
  const snapshot = async () => ({
    photos: await q(sql`select md5(coalesce(string_agg(x::text, '|' order by x.id), '')) as h, count(*)::int as n from oversight_building_photos x where x.organization_id in (${P}, ${P2})`),
    audit: await auditCount(),
  });

  beforeAll(async () => {
    const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
    fx = await createCalendarFixture("ovrphoto");
    stamp = String(Date.now());
    P = await fx.makeOrg("Presbytery", { organizationType: "presbytery" });
    P2 = await fx.makeOrg("OtherPresbytery", { organizationType: "presbytery" });
    C1 = await fx.makeOrg("Cong1");
    C2 = await fx.makeOrg("Cong2");
    CX = await fx.makeOrg("CongX");
    CN = await fx.makeOrg("CongNever");
    congregations.push(C1, C2, CX, CN);
    await affiliate(C1, P);
    await affiliate(C2, P);
    await affiliate(CX, P2);

    const MANAGE = "congregation_oversight.manage";
    const FINANCE = "congregation_oversight.finance";
    person.manage = await fx.makePerson("Manage", `Photos${stamp}`);
    person.finance = await fx.makePerson("Finance", `Only${stamp}`);
    person.none = await fx.makePerson("Neither", `Key${stamp}`);
    await fx.enroll(P, person.manage, [MANAGE]);
    await fx.enroll(P, person.finance, [FINANCE]);
    await fx.enroll(P, person.none, []);

    store = await import("./photo-store");
    buildingStore = await import("./store");
    reads = await import("./photo-reads");
  });

  afterAll(async () => {
    hooks.mode = "ok";
    if (!fx) return;
    for (const t of SIX) await q(sql`delete from ${sql.identifier(t)} where organization_id in (${P}, ${P2})`);
    await q(sql`delete from audit_events where metadata->>'organizationId' in (${P}, ${P2})`);
    await q(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
    try {
      for (const c of congregations) await q(sql`delete from organizations where id = ${c}`);
    } finally {
      await q(sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
    }
    await fx.cleanup();
  });

  beforeEach(() => {
    hooks.mode = "ok";
    hooks.flag = true;
    hooks.decodes = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  // ---------------------------------------------------------------------------
  it("(precondition) the writer is presby_app", async () => {
    const { db } = await import("@/lib/db");
    const who = await db.transaction(async (tx) => rowsOf(await tx.execute(sql`select current_user as u`)));
    expect(who[0]).toEqual({ u: "presby_app" });
  });

  // ---------------------------------------------------------------------------
  describe("every refusal comes before the decode, and writes nothing", () => {
    it("no key, and the finance key alone, are `forbidden` for every photo write", async () => {
      const b = await makeBuilding();
      const photo = await addOk(b);
      const before = await snapshot();
      hooks.decodes = 0;
      for (const who of ["finance", "none"] as const) {
        const c = ctxFor(person[who]);
        expect(await store.addPhoto(c, C1, b, await jpeg()), `add as ${who}`).toEqual({ kind: "refused", reason: "forbidden" });
        expect(await store.setPhotoCaption(c, C1, b, photo, "x"), `caption as ${who}`).toEqual({ kind: "refused", reason: "forbidden" });
        expect(await store.setPhotoCover(c, C1, b, photo), `cover as ${who}`).toEqual({ kind: "refused", reason: "forbidden" });
        expect(await store.removePhoto(c, C1, b, photo), `remove as ${who}`).toEqual({ kind: "refused", reason: "forbidden" });
      }
      expect(hooks.decodes).toBe(0);
      expect(await snapshot()).toEqual(before);
    });

    it("a person with no membership at the presbytery is `forbidden` (OrgAccessError)", async () => {
      const b = await makeBuilding();
      const stranger = await fx.makePerson("Stranger", `NoMember${stamp}`);
      const before = await snapshot();
      expect(await store.addPhoto(ctxFor(stranger), C1, b, await jpeg())).toEqual({ kind: "refused", reason: "forbidden" });
      expect(hooks.decodes).toBe(0);
      expect(await snapshot()).toEqual(before);
    });

    it("the toggle off is `not_found`, with the key held, before the decode", async () => {
      const b = await makeBuilding();
      const before = await snapshot();
      hooks.flag = false;
      expect(await store.addPhoto(manage(), C1, b, await jpeg())).toEqual({ kind: "refused", reason: "not_found" });
      expect(hooks.decodes).toBe(0);
      expect(await snapshot()).toEqual(before);
    });

    it("a wrong type, an empty file and an oversized file are refused before the decode, and before the building is looked up", async () => {
      const before = await snapshot();
      // The building id is deliberately one that does not exist: the type answer comes first.
      const nowhere = "00000000-0000-4000-8000-00000000dead";
      expect(await store.addPhoto(manage(), C1, nowhere, Buffer.from("%PDF-1.7 not a picture"))).toEqual({ kind: "refused", reason: "unsupported_type" });
      expect(await store.addPhoto(manage(), C1, nowhere, Buffer.alloc(0))).toEqual({ kind: "refused", reason: "empty" });
      expect(await store.addPhoto(manage(), C1, nowhere, Buffer.alloc(1_000_001, 9))).toEqual({ kind: "refused", reason: "too_large" });
      expect(hooks.decodes).toBe(0);
      expect(await snapshot()).toEqual(before);
    });

    it("another presbytery's congregation, another congregation's building, a removed building and a never-affiliated congregation are all `not_found`", async () => {
      const b = await makeBuilding(C1);
      const other = await makeBuilding(C2);
      const gone = await makeBuilding(C1);
      expect(await buildingStore.removeBuilding(manage(), C1, gone)).toMatchObject({ kind: "ok" });
      const before = await snapshot();
      const file = await jpeg();
      expect(await store.addPhoto(manage(), CX, b, file), "a congregation of another presbytery").toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.addPhoto(manage(), CN, b, file), "a never-affiliated congregation").toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.addPhoto(manage(), C1, other, file), "another congregation's building").toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.addPhoto(manage(), C1, gone, file), "a removed building").toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.addPhoto(ctxFor(person.manage, P2), C1, b, file), "another presbytery's context").toMatchObject({ kind: "refused" });
      expect(hooks.decodes).toBe(0);
      expect(await snapshot()).toEqual(before);
    });

    it("the cap: a building at ten refuses the eleventh before the decode; removing one frees a slot", async () => {
      const b = await makeBuilding();
      for (let i = 0; i < 10; i += 1) await addOk(b);
      expect(await live(b)).toHaveLength(10);
      hooks.decodes = 0;
      const before = await snapshot();
      expect(await store.addPhoto(manage(), C1, b, await jpeg())).toEqual({ kind: "refused", reason: "cap_reached" });
      expect(hooks.decodes).toBe(0);
      expect(await snapshot()).toEqual(before);

      const victim = (await live(b))[3]!.id as string;
      expect(await store.removePhoto(manage(), C1, b, victim)).toMatchObject({ kind: "ok" });
      expect(await store.addPhoto(manage(), C1, b, await jpeg())).toMatchObject({ kind: "ok" });
      expect(await live(b)).toHaveLength(10);
    });
  });

  // ---------------------------------------------------------------------------
  describe("add", () => {
    it("stores two PRIVATE blobs owned by the presbytery, marks the first photo the cover, and writes exactly one audit row of ids and booleans", async () => {
      const b = await makeBuilding();
      const first = await addOk(b);
      const second = await addOk(b);

      const rows = await photosOf(b);
      expect(rows.map((r) => r.id)).toEqual([first, second]);
      expect(rows.map((r) => r.is_cover)).toEqual([true, false]);
      for (const r of rows) {
        expect(r).toMatchObject({ asset_audience: "private", organization_id: P, about_org_id: C1, created_by: fx.actingUserId, removed_at: null });
        expect(Number(r.width)).toBeLessThanOrEqual(1200);
        expect(Number(r.height)).toBeLessThanOrEqual(1200);
        const blobs = await q(sql`select audience, content_type, organization_id from blob_assets where id in (${String(r.image_asset_key)}, ${String(r.thumb_asset_key)})`);
        expect(blobs.map((x) => `${x.audience}:${x.content_type}:${x.organization_id}`).sort()).toEqual([`private:image/jpeg:${P}`, `private:image/webp:${P}`]);
      }

      const audit = (await auditOf(b)).filter((r) => r.action === "tenant.oversight_photo.added");
      expect(audit).toHaveLength(2);
      for (const row of audit) {
        expect(row.resource_type).toBe("oversight_photo");
        expect(row.actor_user_id).toBe(fx.actingUserId);
        expect(Object.keys(row.metadata as object).sort()).toEqual(["aboutOrgId", "buildingId", "cover", "organizationId", "photoId"]);
      }
      expect(audit.map((r) => (r.metadata as { cover: boolean }).cover)).toEqual([true, false]);
      expect(audit.map((r) => r.resource_id)).toEqual([first, second]);
    });

    it("the cover rule — regression for an upload taking the cover after the marked cover was removed: a new photo takes the mark only when the building has no live photo", async () => {
      const b = await makeBuilding();
      const first = await addOk(b);
      const second = await addOk(b);
      // The first-ever upload is the marked cover.
      expect((await photosOf(b)).find((r) => r.id === first)).toMatchObject({ is_cover: true });

      // Remove the marked cover: nothing is promoted, the oldest left (the second) shows as the cover.
      expect(await store.removePhoto(manage(), C1, b, first)).toMatchObject({ kind: "ok" });
      expect((await live(b)).filter((r) => r.is_cover)).toHaveLength(0);

      // A later upload must not take the mark.
      const third = await addOk(b);
      const rows = await live(b);
      expect(rows.map((r) => r.id)).toEqual([second, third]);
      expect(rows.map((r) => r.is_cover)).toEqual([false, false]);
      const view = await reads.readBuildingPhotos(viewer("manage"), C1, b);
      expect(view.kind).toBe("ok");
      if (view.kind === "ok") {
        expect(view.data.photos.filter((p) => p.isCover).map((p) => p.id)).toEqual([second]);
      }
      const covers = await reads.readBuildingCovers(viewer("manage"), C1);
      expect(covers.kind).toBe("ok");
      if (covers.kind === "ok") expect(covers.data[b]).toMatchObject({ photoId: second, count: 2 });
      const added = (await auditOf(b)).filter((r) => r.action === "tenant.oversight_photo.added");
      expect(added.map((r) => r.resource_id)).toEqual([first, second, third]);
      expect(added.map((r) => (r.metadata as { cover: boolean }).cover)).toEqual([true, false, false]);

      // Removing every photo leaves no live photo, so the next upload is the cover again.
      expect(await store.removePhoto(manage(), C1, b, second)).toMatchObject({ kind: "ok" });
      expect(await store.removePhoto(manage(), C1, b, third)).toMatchObject({ kind: "ok" });
      const fourth = await addOk(b);
      expect((await live(b)).map((r) => [r.id, r.is_cover])).toEqual([[fourth, true]]);
    });

    it("a byte-identical picture already live in the building is `duplicate`; once removed it can be added again", async () => {
      const b = await makeBuilding();
      const file = await jpeg();
      const first = await addOk(b, C1, file);
      const before = await snapshot();
      expect(await store.addPhoto(manage(), C1, b, file)).toEqual({ kind: "refused", reason: "duplicate" });
      expect(await snapshot()).toEqual(before);

      expect(await store.removePhoto(manage(), C1, b, first)).toMatchObject({ kind: "ok" });
      expect(await store.addPhoto(manage(), C1, b, file)).toMatchObject({ kind: "ok" });
      expect(await live(b)).toHaveLength(1);
    });

    it("the same picture in two buildings is fine (the dedup key is per building)", async () => {
      const a = await makeBuilding();
      const b = await makeBuilding();
      const file = await jpeg();
      await addOk(a, C1, file);
      await addOk(b, C1, file);
      expect(await live(a)).toHaveLength(1);
      expect(await live(b)).toHaveLength(1);
    });

    it("a file that passes the cheap checks and cannot be decoded is `unreadable`, and stores nothing", async () => {
      const b = await makeBuilding();
      const before = await snapshot();
      const blobsBefore = Number((await q(sql`select count(*)::int as n from blob_assets where organization_id = ${P}`))[0]!.n);
      const truncated = (await jpeg()).subarray(0, 150);
      expect(await store.addPhoto(manage(), C1, b, truncated)).toEqual({ kind: "refused", reason: "unreadable" });
      expect(Number((await q(sql`select count(*)::int as n from blob_assets where organization_id = ${P}`))[0]!.n)).toBe(blobsBefore);
      expect(await snapshot()).toEqual(before);
    });

    it("CONCURRENCY: two simultaneous uploads into a building holding nine end with ten; the other is cap_reached", async () => {
      const b = await makeBuilding();
      for (let i = 0; i < 9; i += 1) await addOk(b);
      const [one, two] = await Promise.all([
        store.addPhoto(manage(), C1, b, await jpeg()),
        store.addPhoto(manage(), C1, b, await jpeg()),
      ]);
      expect([one.kind, two.kind].sort()).toEqual(["ok", "refused"]);
      const refused = [one, two].find((r) => r.kind === "refused");
      expect(refused).toEqual({ kind: "refused", reason: "cap_reached" });
      expect(await live(b)).toHaveLength(10);
      expect((await live(b)).filter((r) => r.is_cover)).toHaveLength(1);
    });

    it("CONCURRENCY: two simultaneous first uploads end with exactly one cover", async () => {
      const b = await makeBuilding();
      const results = await Promise.all([
        store.addPhoto(manage(), C1, b, await jpeg()),
        store.addPhoto(manage(), C1, b, await jpeg()),
        store.addPhoto(manage(), C1, b, await jpeg()),
      ]);
      expect(results.every((r) => r.kind === "ok")).toBe(true);
      expect(await live(b)).toHaveLength(3);
      expect((await live(b)).filter((r) => r.is_cover)).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe("the audit is in the same transaction", () => {
    it("an audit insert that fails leaves no photo row (add, caption, cover, remove)", async () => {
      const b = await makeBuilding();
      const first = await addOk(b);
      const second = await addOk(b);
      const before = await snapshot();
      hooks.mode = "fail_before";
      expect(await store.addPhoto(manage(), C1, b, await jpeg())).toEqual({ kind: "refused", reason: "save_failed" });
      expect(await store.setPhotoCaption(manage(), C1, b, first, "Changed")).toEqual({ kind: "refused", reason: "save_failed" });
      expect(await store.setPhotoCover(manage(), C1, b, second)).toEqual({ kind: "refused", reason: "save_failed" });
      expect(await store.removePhoto(manage(), C1, b, first)).toEqual({ kind: "refused", reason: "save_failed" });
      hooks.mode = "ok";
      expect(await snapshot()).toEqual(before);
    });

    it("an audit insert that SUCCEEDS and is then followed by a failure leaves no audit row and no data change", async () => {
      const b = await makeBuilding();
      const first = await addOk(b);
      const before = await snapshot();
      hooks.mode = "fail_after";
      expect(await store.addPhoto(manage(), C1, b, await jpeg())).toEqual({ kind: "refused", reason: "save_failed" });
      expect(await store.setPhotoCaption(manage(), C1, b, first, "Changed")).toEqual({ kind: "refused", reason: "save_failed" });
      expect(await store.removePhoto(manage(), C1, b, first)).toEqual({ kind: "refused", reason: "save_failed" });
      hooks.mode = "ok";
      expect(await snapshot()).toEqual(before);
      expect((await live(b))[0]).toMatchObject({ caption: null, removed_at: null });
    });
  });

  // ---------------------------------------------------------------------------
  describe("caption, cover and remove", () => {
    it("caption: set, change, clear; the same caption writes nothing; the audit row carries no caption", async () => {
      const b = await makeBuilding();
      const p = await addOk(b);
      const SENTINEL = `SENTINEL-CAPTION-${stamp}`;
      expect(await store.setPhotoCaption(manage(), C1, b, p, SENTINEL)).toEqual({ kind: "ok", data: { id: p } });
      expect((await live(b))[0]).toMatchObject({ caption: SENTINEL });
      const before = await snapshot();
      expect(await store.setPhotoCaption(manage(), C1, b, p, SENTINEL)).toEqual({ kind: "ok", data: { id: p, unchanged: true } });
      expect(await snapshot()).toEqual(before);
      expect(await store.setPhotoCaption(manage(), C1, b, p, null)).toEqual({ kind: "ok", data: { id: p } });
      expect((await live(b))[0]).toMatchObject({ caption: null });

      const audit = (await auditOf(b)).filter((r) => r.action === "tenant.oversight_photo.caption_set");
      expect(audit).toHaveLength(2);
      for (const row of audit) {
        expect(Object.keys(row.metadata as object).sort()).toEqual(["aboutOrgId", "buildingId", "organizationId", "photoId"]);
        expect(JSON.stringify(row.metadata)).not.toContain(SENTINEL);
      }
    });

    it("a caption over the database's 200 characters is refused as save_failed (the action's parser stops it first)", async () => {
      const b = await makeBuilding();
      const p = await addOk(b);
      expect(await store.setPhotoCaption(manage(), C1, b, p, "a".repeat(201))).toEqual({ kind: "refused", reason: "save_failed" });
      expect((await live(b))[0]).toMatchObject({ caption: null });
    });

    it("cover: the mark moves, there is always at most one, the audit names the previous cover, and the same cover writes nothing", async () => {
      const b = await makeBuilding();
      const first = await addOk(b);
      const second = await addOk(b);
      expect(await store.setPhotoCover(manage(), C1, b, first)).toEqual({ kind: "ok", data: { id: first, unchanged: true } });
      expect(await store.setPhotoCover(manage(), C1, b, second)).toEqual({ kind: "ok", data: { id: second } });
      const marked = (await live(b)).filter((r) => r.is_cover);
      expect(marked.map((r) => r.id)).toEqual([second]);

      const audit = (await auditOf(b)).filter((r) => r.action === "tenant.oversight_photo.cover_set");
      expect(audit).toHaveLength(1);
      expect(audit[0]!.resource_id).toBe(second);
      expect(Object.keys(audit[0]!.metadata as object).sort()).toEqual(["aboutOrgId", "buildingId", "organizationId", "photoId", "previousCoverPhotoId"]);
      expect((audit[0]!.metadata as { previousCoverPhotoId: string }).previousCoverPhotoId).toBe(first);
    });

    it("CONCURRENCY: two simultaneous cover changes end with exactly one cover", async () => {
      const b = await makeBuilding();
      await addOk(b);
      const second = await addOk(b);
      const third = await addOk(b);
      const results = await Promise.all([store.setPhotoCover(manage(), C1, b, second), store.setPhotoCover(manage(), C1, b, third)]);
      expect(results.every((r) => r.kind === "ok")).toBe(true);
      expect((await live(b)).filter((r) => r.is_cover)).toHaveLength(1);
    });

    it("remove: the removal pair is set and the cover mark cleared in one write; a second remove is `already_removed`; the other photo ops on it are too", async () => {
      const b = await makeBuilding();
      const first = await addOk(b);
      const second = await addOk(b);
      expect(await store.removePhoto(manage(), C1, b, first)).toEqual({ kind: "ok", data: { id: first } });
      const row = (await photosOf(b)).find((r) => r.id === first)!;
      expect(row).toMatchObject({ removed_by: fx.actingUserId, is_cover: false });
      expect(row.removed_at).not.toBeNull();
      expect(await store.removePhoto(manage(), C1, b, first)).toEqual({ kind: "refused", reason: "already_removed" });
      expect(await store.setPhotoCaption(manage(), C1, b, first, "x")).toEqual({ kind: "refused", reason: "already_removed" });
      expect(await store.setPhotoCover(manage(), C1, b, first)).toEqual({ kind: "refused", reason: "already_removed" });

      const audit = (await auditOf(b)).filter((r) => r.action === "tenant.oversight_photo.removed");
      expect(audit).toHaveLength(1);
      expect(Object.keys(audit[0]!.metadata as object).sort()).toEqual(["aboutOrgId", "buildingId", "organizationId", "photoId"]);

      // The building still has a cover: its oldest live photo (no unaudited promotion write).
      const view = await reads.readBuildingPhotos(viewer("manage"), C1, b);
      expect(view.kind).toBe("ok");
      if (view.kind === "ok") {
        expect(view.data.photos.map((p) => p.id)).toEqual([second]);
        expect(view.data.photos[0]!.isCover).toBe(true);
      }
      expect((await live(b)).filter((r) => r.is_cover)).toHaveLength(0);
    });

    it("an id that is not this building's photo is `not_found`, whatever the operation", async () => {
      const b = await makeBuilding();
      const other = await makeBuilding();
      const foreign = await addOk(other);
      const before = await snapshot();
      expect(await store.setPhotoCaption(manage(), C1, b, foreign, "x")).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.setPhotoCover(manage(), C1, b, foreign)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.removePhoto(manage(), C1, b, foreign)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.removePhoto(manage(), C1, b, "00000000-0000-4000-8000-00000000beef")).toEqual({ kind: "refused", reason: "not_found" });
      expect(await snapshot()).toEqual(before);
    });

    it("the photos of a removed building are untouchable", async () => {
      const b = await makeBuilding();
      const p = await addOk(b);
      expect(await buildingStore.removeBuilding(manage(), C1, b)).toMatchObject({ kind: "ok" });
      const before = await snapshot();
      expect(await store.setPhotoCaption(manage(), C1, b, p, "x")).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.setPhotoCover(manage(), C1, b, p)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.removePhoto(manage(), C1, b, p)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await store.addPhoto(manage(), C1, b, await jpeg())).toEqual({ kind: "refused", reason: "not_found" });
      expect(await snapshot()).toEqual(before);
    });
  });

  // ---------------------------------------------------------------------------
  describe("photo-reads.ts", () => {
    it("each reader is `forbidden` without the manage key (the finance key alone is not enough), with no data", async () => {
      const b = await makeBuilding();
      await addOk(b);
      for (const who of ["finance", "none"] as const) {
        expect(await reads.readBuildingPhotos(viewer(who), C1, b)).toEqual({ kind: "forbidden" });
        expect(await reads.readBuildingCovers(viewer(who), C1)).toEqual({ kind: "forbidden" });
        expect(await reads.readBuildingPhotoSummary(viewer(who), C1, b)).toEqual({ kind: "forbidden" });
      }
    });

    it("a congregation of another presbytery, another congregation's building and a removed building are `not_found`", async () => {
      const b = await makeBuilding(C1);
      const gone = await makeBuilding(C1);
      await buildingStore.removeBuilding(manage(), C1, gone);
      expect(await reads.readBuildingPhotos(viewer("manage"), CX, b)).toEqual({ kind: "not_found" });
      expect(await reads.readBuildingPhotos(viewer("manage"), C2, b)).toEqual({ kind: "not_found" });
      expect(await reads.readBuildingPhotos(viewer("manage"), C1, gone)).toEqual({ kind: "not_found" });
      expect(await reads.readBuildingCovers(viewer("manage"), CX)).toEqual({ kind: "not_found" });
      expect(await reads.readBuildingPhotoSummary(viewer("manage"), C2, b)).toEqual({ kind: "not_found" });
    });

    it("the grid: thumbnails as data URIs, oldest first, one cover, the cap, and no master unless a live photo of this building is named", async () => {
      const b = await makeBuilding();
      const other = await makeBuilding();
      const foreign = await addOk(other);
      const first = await addOk(b);
      const second = await addOk(b);
      const removed = await addOk(b);
      await store.removePhoto(manage(), C1, b, removed);
      await store.setPhotoCaption(manage(), C1, b, second, "The north door");

      const plain = await reads.readBuildingPhotos(viewer("manage"), C1, b);
      expect(plain.kind).toBe("ok");
      if (plain.kind !== "ok") return;
      expect(plain.data).toMatchObject({ buildingId: b, count: 2, cap: 10, atCap: false, viewed: null });
      expect(plain.data.photos.map((p) => p.id)).toEqual([first, second]);
      expect(plain.data.photos.map((p) => p.isCover)).toEqual([true, false]);
      expect(plain.data.photos[1]!.caption).toBe("The north door");
      for (const tile of plain.data.photos) expect(tile.thumbSrc).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/);

      const viewed = await reads.readBuildingPhotos(viewer("manage"), C1, b, { viewPhotoId: second });
      expect(viewed.kind === "ok" && viewed.data.viewed).toMatchObject({ id: second, caption: "The north door" });
      expect(viewed.kind === "ok" && viewed.data.viewed?.src).toMatch(/^data:image\/jpeg;base64,/);

      // A removed photo, another building's photo and a made-up id are each ignored: no master is returned.
      for (const id of [removed, foreign, "00000000-0000-4000-8000-00000000cafe", "not-a-uuid"]) {
        const r = await reads.readBuildingPhotos(viewer("manage"), C1, b, { viewPhotoId: id });
        expect(r.kind === "ok" && r.data.viewed, id).toBeNull();
      }
    });

    it("covers: one per building that has photos, the marked one else the oldest, with its photo count; a building with none is absent", async () => {
      const a = await makeBuilding();
      const bare = await makeBuilding();
      const a1 = await addOk(a);
      const a2 = await addOk(a);
      await store.setPhotoCover(manage(), C1, a, a2);
      const covers = await reads.readBuildingCovers(viewer("manage"), C1);
      expect(covers.kind).toBe("ok");
      if (covers.kind !== "ok") return;
      expect(covers.data[a]).toMatchObject({ buildingId: a, photoId: a2, count: 2 });
      expect(covers.data[a]!.thumbSrc).toMatch(/^data:image\/webp;base64,/);
      expect(covers.data[bare]).toBeUndefined();
      expect(a1).not.toBe(a2);

      const summary = await reads.readBuildingPhotoSummary(viewer("manage"), C1, a);
      expect(summary.kind === "ok" && summary.data).toMatchObject({ photoId: a2, count: 2 });
      expect(await reads.readBuildingPhotoSummary(viewer("manage"), C1, bare)).toEqual({ kind: "ok", data: null });
    });

    it("atCap is true at ten live photos", async () => {
      const b = await makeBuilding();
      for (let i = 0; i < 10; i += 1) await addOk(b);
      const r = await reads.readBuildingPhotos(viewer("manage"), C1, b);
      expect(r.kind === "ok" && r.data).toMatchObject({ count: 10, atCap: true });
    });
  });
});
