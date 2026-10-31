/**
 * src/lib/careers/postings.ts against a REAL Postgres (the pipeline branch), as
 * `presby_app` through `withOrgContext` - docs/work-log/2026-10-25-careers-inc1.md,
 * Phase 3 T15. Written BEFORE the lib and seen to fail; the harness is
 * `events.test.ts`'s: `hasDb` skip-guard, dynamic imports inside `beforeAll`,
 * throwaway organizations (`deletable_until`) from the calendar fixture, and a
 * wrapper around the REAL `insertAuditRow` that can be told to throw, to prove
 * an audit row rolls back with a change that fails.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/careers/postings.db.test.ts
 *
 * Synthetic names and `example.invalid` addresses only (No Real Data).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 90_000, hookTimeout: 240_000 });

// `@/lib/audit` reaches next-auth, which this environment cannot resolve; the
// keys this module writes (and org-features' toggle writer, which is never
// called here) are all that is needed.
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled",
    CAREERS_POSTING_PUBLISHED: "careers.posting.published",
    CAREERS_POSTING_CLOSED: "careers.posting.closed",
    CAREERS_POSTING_REOPENED: "careers.posting.reopened",
  },
  recordAudit: vi.fn(),
}));
const auditControl = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return {
    ...actual,
    insertAuditRow: async (...args: Parameters<typeof actual.insertAuditRow>) => {
      if (auditControl.fail) throw new Error("audit insert failed (test-injected)");
      return actual.insertAuditRow(...args);
    },
  };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;
function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
}

const GOOD = {
  title: "Music Director",
  summary: "Lead our choirs and plan the music.",
  location: "Fernwood",
  employmentType: "part_time" as const,
  payMinCents: 4500,
  payMaxCents: 6000,
  payUnit: "hour" as const,
  descriptionMd: "## Duties\n\nLead the adult choir.\n\n- Plan the music",
  closingDate: null as string | null,
};

describe.skipIf(!hasDb)("careers postings lib (Postgres-backed)", () => {
  let fx: CalendarFixture;
  let api: typeof import("./postings");
  let addDays: typeof import("@/lib/calendar/month").addDays;

  const actor = { userId: "", email: "actor@example.invalid" };
  const orgIds: string[] = [];

  async function owner(query: SQL): Promise<Row[]> {
    return rowsOf(await fx.platform.execute(query));
  }

  /** A congregation with the toggle on, a manager, a no-permission member, and the two lone-permission holders. */
  async function world(name: string, options: { toggle?: boolean } = {}) {
    const org = await fx.makeOrg(name, { timeZone: "America/New_York" });
    orgIds.push(org);
    if (options.toggle !== false) {
      await owner(sql`
        insert into organization_feature_toggles (organization_id, feature_key, enabled)
        values (${org}, 'org_portal.careers', true)`);
    }
    const manager = await fx.makePerson("Pat", `Manager-${name}`);
    await fx.enroll(org, manager, ["careers.manage"]);
    const plain = await fx.makePerson("Sam", `Member-${name}`);
    await fx.enroll(org, plain, []);
    const applicantsOnly = await fx.makePerson("Ana", `Applicants-${name}`);
    await fx.enroll(org, applicantsOnly, ["careers.applicants"]);
    const featuresOnly = await fx.makePerson("Flo", `Features-${name}`);
    await fx.enroll(org, featuresOnly, ["org_features.manage"]);
    const outsider = await fx.makePerson("Otto", `Outsider-${name}`);
    return { org, manager, plain, applicantsOnly, featuresOnly, outsider };
  }

  let A: Awaited<ReturnType<typeof world>>;
  let B: Awaited<ReturnType<typeof world>>;
  let OFF: Awaited<ReturnType<typeof world>>;

  async function count(org: string): Promise<number> {
    const [r] = await owner(sql`select count(*)::int as n from job_postings where organization_id = ${org}`);
    return Number(r!.n);
  }

  async function rowOf(id: string): Promise<Row> {
    const [r] = await owner(sql`
      select status, version, slug, title, sort_order, posted_on::text as posted_on,
             first_published_at, closed_at, closing_date::text as closing_date, updated_by
        from job_postings where id = ${id}`);
    return r!;
  }

  async function auditFor(org: string): Promise<Row[]> {
    return owner(sql`
      select action, resource_type, resource_id, metadata, actor_user_id
        from audit_events
       where metadata->>'organizationId' = ${org} and action like 'careers.%'
       order by created_at, id`);
  }

  async function create(w: typeof A, over: Partial<typeof GOOD> & { slug?: string } = {}): Promise<string> {
    const result = await api.createPosting(w.manager, w.org, actor, { ...GOOD, ...over });
    if (result.kind !== "ok") throw new Error(`create failed: ${JSON.stringify(result)}`);
    return result.data.id;
  }

  async function publish(w: typeof A, id: string): Promise<number> {
    const current = await rowOf(id);
    const result = await api.setPostingStatus(w.manager, w.org, actor, {
      id,
      version: Number(current.version),
      to: "published",
    });
    if (result.kind !== "ok") throw new Error(`publish failed: ${JSON.stringify(result)}`);
    return result.data.version;
  }

  beforeAll(async () => {
    const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
    fx = await createCalendarFixture("careers");
    actor.userId = fx.actingUserId;
    api = await import("./postings");
    ({ addDays } = await import("@/lib/calendar/month"));
    A = await world("a");
    B = await world("b");
    OFF = await world("off", { toggle: false });
  });

  afterAll(async () => {
    auditControl.fail = false;
    if (orgIds.length > 0) {
      await fx.platform.execute(
        sql`delete from audit_events where metadata->>'organizationId' in (${sql.join(orgIds.map((id) => sql`${id}`), sql`, `)})`,
      );
    }
    await fx?.cleanup();
  });

  // -------------------------------------------------------------------------
  // The gate: toggle, then careers.manage. Nothing is written when it refuses.
  // -------------------------------------------------------------------------
  describe("the gate", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const calls = (w: () => typeof A, who: (x: typeof A) => string) => ({
      list: () => api.listPostings(who(w()), w().org),
      get: () => api.getPosting(who(w()), w().org, id),
      create: () => api.createPosting(who(w()), w().org, actor, GOOD),
      update: () => api.updatePosting(who(w()), w().org, actor, { ...GOOD, id, version: 1 }),
      status: () => api.setPostingStatus(who(w()), w().org, actor, { id, version: 1, to: "published" }),
      move: () => api.movePosting(who(w()), w().org, actor, { id, direction: "up" }),
    });

    it("toggle off: every call is feature_off and nothing is written; canManageFeatures is true only for an org_features.manage holder", async () => {
      const before = await count(OFF.org);
      for (const [name, call] of Object.entries(calls(() => OFF, (x) => x.manager))) {
        expect(await call(), `manager ${name}`).toEqual({ kind: "feature_off", canManageFeatures: false });
      }
      for (const [name, call] of Object.entries(calls(() => OFF, (x) => x.featuresOnly))) {
        expect(await call(), `features holder ${name}`).toEqual({ kind: "feature_off", canManageFeatures: true });
      }
      // ANY member sees the same honest state (Copy S1), not forbidden.
      expect(await api.listPostings(OFF.plain, OFF.org)).toEqual({ kind: "feature_off", canManageFeatures: false });
      expect(await count(OFF.org)).toBe(before);
    });

    it("toggle row explicitly false is off, like a missing row", async () => {
      await owner(sql`
        insert into organization_feature_toggles (organization_id, feature_key, enabled)
        values (${OFF.org}, 'org_portal.careers', false)`);
      expect(await api.listPostings(OFF.manager, OFF.org)).toMatchObject({ kind: "feature_off" });
    });

    it("no careers.manage: forbidden for every call, and nothing is written", async () => {
      const before = await count(A.org);
      for (const who of ["plain", "featuresOnly"] as const) {
        for (const [name, call] of Object.entries(calls(() => A, (x) => x[who]))) {
          expect(await call(), `${who} ${name}`).toEqual({ kind: "forbidden" });
        }
      }
      expect(await count(A.org)).toBe(before);
    });

    it("a holder of careers.applicants ALONE is forbidden: neither key implies the other", async () => {
      const before = await count(A.org);
      for (const [name, call] of Object.entries(calls(() => A, (x) => x.applicantsOnly))) {
        expect(await call(), name).toEqual({ kind: "forbidden" });
      }
      expect(await count(A.org)).toBe(before);
    });

    it("a person with no membership at the organization is refused by withOrgContext, not by the lib", async () => {
      await expect(api.listPostings(A.outsider, A.org)).rejects.toThrow(/no active membership/);
    });

    it("a manager of A cannot act in B (RLS plus the membership check)", async () => {
      await expect(api.listPostings(A.manager, B.org)).rejects.toThrow(/no active membership/);
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  describe("createPosting", () => {
    it("creates a draft at version 1 with a slug from the title; nothing public, nothing audited", async () => {
      const auditBefore = (await auditFor(A.org)).length;
      const id = await create(A, { title: "Church Administrator" });
      const row = await rowOf(id);
      expect(row).toMatchObject({ status: "draft", version: 1, slug: "church-administrator", posted_on: null, first_published_at: null, closed_at: null });
      expect(row.updated_by).toBe(fx.actingUserId);
      expect((await auditFor(A.org)).length).toBe(auditBefore);
    });

    it("suffixes -2, -3 on a generated collision", async () => {
      const first = await create(A, { title: "Sexton Collision" });
      const second = await create(A, { title: "Sexton Collision" });
      const third = await create(A, { title: "Sexton Collision" });
      expect([(await rowOf(first)).slug, (await rowOf(second)).slug, (await rowOf(third)).slug]).toEqual([
        "sexton-collision",
        "sexton-collision-2",
        "sexton-collision-3",
      ]);
    });

    it("a supplied slug is used as given (lower-cased by the schema), and a collision on it is slug_taken, never silently suffixed", async () => {
      const id = await create(A, { title: "Supplied", slug: "Fixed-Slug" });
      expect((await rowOf(id)).slug).toBe("fixed-slug");
      const before = await count(A.org);
      const result = await api.createPosting(A.manager, A.org, actor, { ...GOOD, title: "Other", slug: "fixed-slug" });
      expect(result).toEqual({ kind: "slug_taken" });
      expect(await count(A.org)).toBe(before);
    });

    it("the same slug in another organization is fine", async () => {
      await create(B, { title: "Supplied", slug: "fixed-slug" });
    });

    it("a draft needs only a title: summary, location and description may be empty", async () => {
      const id = await create(A, { title: "Barely", summary: "", location: "", descriptionMd: "" });
      expect((await rowOf(id)).status).toBe("draft");
    });

    it("invalid input is invalid_input naming the field, and writes nothing", async () => {
      const before = await count(A.org);
      expect(await api.createPosting(A.manager, A.org, actor, { ...GOOD, closingDate: "2026-02-30" })).toMatchObject({
        kind: "invalid_input",
        field: "closingDate",
        message: "Enter a date.",
      });
      expect(await api.createPosting(A.manager, A.org, actor, { ...GOOD, title: "  " })).toMatchObject({
        kind: "invalid_input",
        field: "title",
        message: "Enter a title.",
      });
      expect(await api.createPosting(A.manager, A.org, actor, { ...GOOD, payUnit: null })).toMatchObject({
        kind: "invalid_input",
        field: "payUnit",
      });
      expect(await count(A.org)).toBe(before);
    });

    it("a description the validator refuses is invalid_input on descriptionMd, with the line-numbered message", async () => {
      const result = await api.createPosting(A.manager, A.org, actor, {
        ...GOOD,
        descriptionMd: "ok\n\n# Not allowed",
      });
      expect(result).toEqual({
        kind: "invalid_input",
        field: "descriptionMd",
        message: 'Line 3 ("# Not allowed") starts with a single #. Use the Heading or Subheading button for section titles.',
      });
    });

    it("stores the validator's normalised description, not the raw text", async () => {
      const id = await create(A, { title: "Normalised", descriptionMd: "\r\n\r\nLine one‮\r\n\r\nLine two  \r\n" });
      const [r] = await owner(sql`select description_md from job_postings where id = ${id}`);
      expect(r!.description_md).toBe("Line one\n\nLine two");
    });

    it("a past closing date is allowed on a draft (publishing refuses it)", async () => {
      const list = await api.listPostings(A.manager, A.org);
      if (list.kind !== "ok") throw new Error("list failed");
      const id = await create(A, { title: "Past date draft", closingDate: addDays(list.data.orgToday, -3) });
      expect((await rowOf(id)).status).toBe("draft");
    });
  });

  // -------------------------------------------------------------------------
  // read
  // -------------------------------------------------------------------------
  describe("listPostings and getPosting", () => {
    it("returns rows with the org's today, derives visibleToPublic, and groups published, drafts, then closed", async () => {
      const w = await world("list");
      const draft = await create(w, { title: "L Draft" });
      const pub = await create(w, { title: "L Published" });
      await publish(w, pub);
      const expired = await create(w, { title: "L Expired" });
      await publish(w, expired);
      const result = await api.listPostings(w.manager, w.org);
      if (result.kind !== "ok") throw new Error("list failed");
      const today = result.data.orgToday;
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // The owner moves a published posting's closing date into the past: published, not visible, sweep pending.
      await owner(sql`update job_postings set closing_date = ${addDays(today, -2)}::date where id = ${expired}`);
      const again = await api.listPostings(w.manager, w.org);
      if (again.kind !== "ok") throw new Error("list failed");
      const byTitle = Object.fromEntries(again.data.postings.map((p) => [p.title, p]));
      expect(byTitle["L Published"]).toMatchObject({ status: "published", visibleToPublic: true });
      expect(byTitle["L Expired"]).toMatchObject({ status: "published", visibleToPublic: false, closingDate: addDays(today, -2) });
      expect(byTitle["L Draft"]).toMatchObject({ status: "draft", visibleToPublic: false, postedOn: null, firstPublishedAt: null });
      expect(byTitle["L Published"]!.postedOn).toBe(today);
      expect(typeof byTitle["L Published"]!.firstPublishedAt).toBe("string");
      expect(typeof byTitle["L Published"]!.updatedAt).toBe("string");
      const order = again.data.postings.map((p) => p.status);
      expect(order.indexOf("draft")).toBeGreaterThan(order.lastIndexOf("published"));
      expect(draft).toBeTruthy();
    });

    it("never returns another organization's rows", async () => {
      const mine = await api.listPostings(A.manager, A.org);
      if (mine.kind !== "ok") throw new Error("list failed");
      const bId = await create(B, { title: "B only posting" });
      const again = await api.listPostings(A.manager, A.org);
      if (again.kind !== "ok") throw new Error("list failed");
      expect(again.data.postings.map((p) => p.id)).not.toContain(bId);
      expect(await api.getPosting(A.manager, A.org, bId)).toEqual({ kind: "not_found" });
    });

    it("getPosting: ok, not_found for an unknown id, and not_found (not an error) for text that is not a uuid", async () => {
      const id = await create(A, { title: "Get me" });
      const ok = await api.getPosting(A.manager, A.org, id);
      expect(ok).toMatchObject({ kind: "ok", data: { posting: { id, title: "Get me", version: 1, status: "draft" } } });
      expect(await api.getPosting(A.manager, A.org, "22222222-2222-2222-2222-222222222222")).toEqual({ kind: "not_found" });
      expect(await api.getPosting(A.manager, A.org, "not-a-uuid")).toEqual({ kind: "not_found" });
      expect(await api.getPosting(A.manager, A.org, "'; drop table job_postings; --")).toEqual({ kind: "not_found" });
    });
  });

  // -------------------------------------------------------------------------
  // update (compare-and-set)
  // -------------------------------------------------------------------------
  describe("updatePosting", () => {
    it("saves a change, bumps the version, and returns it", async () => {
      const id = await create(A, { title: "Edit me" });
      const result = await api.updatePosting(A.manager, A.org, actor, { ...GOOD, title: "Edited", id, version: 1 });
      expect(result).toEqual({ kind: "ok", data: { version: 2 } });
      expect(await rowOf(id)).toMatchObject({ title: "Edited", version: 2 });
    });

    it("an unchanged save bumps nothing", async () => {
      const id = await create(A, { title: "Same" });
      const result = await api.updatePosting(A.manager, A.org, actor, { ...GOOD, title: "Same", id, version: 1 });
      expect(result).toEqual({ kind: "ok", data: { version: 1 } });
    });

    it("a stale version is stale: nothing is written and the typed text is not applied", async () => {
      const id = await create(A, { title: "Race" });
      await api.updatePosting(A.manager, A.org, actor, { ...GOOD, title: "First writer", id, version: 1 });
      const result = await api.updatePosting(A.manager, A.org, actor, { ...GOOD, title: "Second writer", id, version: 1 });
      expect(result).toEqual({ kind: "stale" });
      expect(await rowOf(id)).toMatchObject({ title: "First writer", version: 2 });
    });

    it("a reorder by someone else does not make an editor's save stale (sort_order bumps no version)", async () => {
      const w = await world("reorder-stale");
      const one = await create(w, { title: "RS One" });
      const two = await create(w, { title: "RS Two" });
      await publish(w, one);
      await publish(w, two);
      const v = Number((await rowOf(one)).version);
      expect(await api.movePosting(w.manager, w.org, actor, { id: one, direction: "up" })).toMatchObject({ kind: "ok" });
      expect(await api.updatePosting(w.manager, w.org, actor, { ...GOOD, title: "RS One edited", id: one, version: v })).toMatchObject({ kind: "ok" });
    });

    it("not_found for an unknown id and for another organization's posting", async () => {
      const bId = await create(B, { title: "B update target" });
      expect(await api.updatePosting(A.manager, A.org, actor, { ...GOOD, id: bId, version: 1 })).toEqual({ kind: "not_found" });
      expect(await api.updatePosting(A.manager, A.org, actor, { ...GOOD, id: "33333333-3333-3333-3333-333333333333", version: 1 })).toEqual({ kind: "not_found" });
      expect((await rowOf(bId)).title).toBe("B update target");
    });

    it("the slug is editable before the first publish and refused after, including after a reopen", async () => {
      const id = await create(A, { title: "Slug rules" });
      expect(await api.updatePosting(A.manager, A.org, actor, { ...GOOD, title: "Slug rules", id, version: 1, slug: "renamed-before" })).toMatchObject({ kind: "ok" });
      expect((await rowOf(id)).slug).toBe("renamed-before");

      await publish(A, id);
      const afterPublish = await api.updatePosting(A.manager, A.org, actor, {
        ...GOOD, title: "Slug rules", id, version: Number((await rowOf(id)).version), slug: "renamed-after",
      });
      expect(afterPublish).toEqual({
        kind: "invalid_input",
        field: "slug",
        message: "The web address can't be changed after an opening is published, because people may have saved or shared it.",
      });
      expect((await rowOf(id)).slug).toBe("renamed-before");

      // Close, then reopen: still fixed.
      const closed = await api.setPostingStatus(A.manager, A.org, actor, { id, version: Number((await rowOf(id)).version), to: "closed" });
      expect(closed).toMatchObject({ kind: "ok" });
      const afterClose = await api.updatePosting(A.manager, A.org, actor, {
        ...GOOD, title: "Slug rules", id, version: Number((await rowOf(id)).version), slug: "renamed-closed",
      });
      expect(afterClose).toMatchObject({ kind: "invalid_input", field: "slug" });

      // Re-sending the SAME slug is not a change.
      expect(await api.updatePosting(A.manager, A.org, actor, {
        ...GOOD, title: "Slug rules", id, version: Number((await rowOf(id)).version), slug: "renamed-before",
      })).toMatchObject({ kind: "ok" });
    });

    it("renaming to a slug another posting uses is slug_taken", async () => {
      await create(A, { title: "Holder", slug: "holder-slug" });
      const id = await create(A, { title: "Wants it" });
      expect(await api.updatePosting(A.manager, A.org, actor, { ...GOOD, title: "Wants it", id, version: 1, slug: "holder-slug" })).toEqual({ kind: "slug_taken" });
    });

    it("a published posting cannot be saved with an empty summary, location or description: incomplete, naming them", async () => {
      const id = await create(A, { title: "Stays complete" });
      await publish(A, id);
      const v = Number((await rowOf(id)).version);
      expect(await api.updatePosting(A.manager, A.org, actor, { ...GOOD, title: "Stays complete", summary: "", location: "", id, version: v })).toEqual({
        kind: "incomplete",
        missing: ["summary", "location"],
      });
      expect(await api.updatePosting(A.manager, A.org, actor, { ...GOOD, title: "Stays complete", descriptionMd: "  ", id, version: v })).toEqual({
        kind: "incomplete",
        missing: ["description"],
      });
      expect((await rowOf(id)).version).toBe(v);
    });

    it("editing a published posting's closing date to a passed date is invalid_input on closingDate; an unchanged passed date may be saved", async () => {
      const id = await create(A, { title: "Date edit" });
      await publish(A, id);
      const list = await api.listPostings(A.manager, A.org);
      if (list.kind !== "ok") throw new Error("list failed");
      const yesterday = addDays(list.data.orgToday, -1);
      const v = Number((await rowOf(id)).version);
      expect(await api.updatePosting(A.manager, A.org, actor, { ...GOOD, title: "Date edit", closingDate: yesterday, id, version: v })).toEqual({
        kind: "invalid_input",
        field: "closingDate",
        message: "The closing date can't be in the past.",
      });
      // Today is still open (inclusive).
      expect(await api.updatePosting(A.manager, A.org, actor, { ...GOOD, title: "Date edit", closingDate: list.data.orgToday, id, version: v })).toMatchObject({ kind: "ok" });
      // The date has since passed (the owner moves it, as time would): saving OTHER changes with that date left alone works.
      await owner(sql`update job_postings set closing_date = ${yesterday}::date where id = ${id}`);
      const v2 = Number((await rowOf(id)).version);
      expect(await api.updatePosting(A.manager, A.org, actor, { ...GOOD, title: "Date edit 2", closingDate: yesterday, id, version: v2 })).toMatchObject({ kind: "ok" });
    });

    it("a draft or closed posting may be saved with a passed closing date", async () => {
      const list = await api.listPostings(A.manager, A.org);
      if (list.kind !== "ok") throw new Error("list failed");
      const id = await create(A, { title: "Draft past" });
      expect(await api.updatePosting(A.manager, A.org, actor, { ...GOOD, title: "Draft past", closingDate: addDays(list.data.orgToday, -9), id, version: 1 })).toMatchObject({ kind: "ok" });
    });

    it("never audited", async () => {
      const id = await create(A, { title: "Quiet edit" });
      const before = (await auditFor(A.org)).length;
      await api.updatePosting(A.manager, A.org, actor, { ...GOOD, title: "Quiet edit 2", id, version: 1 });
      expect((await auditFor(A.org)).length).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // status changes: the whole matrix
  // -------------------------------------------------------------------------
  describe("setPostingStatus", () => {
    it("draft -> published: stamps, bumps, audits PUBLISHED with ids only", async () => {
      const w = await world("pub");
      const id = await create(w, { title: "Secret Title Words" });
      const result = await api.setPostingStatus(w.manager, w.org, actor, { id, version: 1, to: "published" });
      expect(result).toEqual({ kind: "ok", data: { status: "published", version: 2 } });
      const row = await rowOf(id);
      expect(row.first_published_at).not.toBeNull();
      expect(row.posted_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const audit = await auditFor(w.org);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: "careers.posting.published",
        resource_type: "job_posting",
        resource_id: id,
        metadata: { organizationId: w.org, postingId: id, via: "staff" },
        actor_user_id: fx.actingUserId,
      });
      // Ids and an enum only: no title, no slug.
      const text = JSON.stringify(audit[0]);
      expect(text).not.toContain("Secret Title Words");
      expect(text).not.toContain("secret-title-words");
      expect(Object.keys(audit[0]!.metadata as object).sort()).toEqual(["organizationId", "postingId", "via"]);
    });

    it("published -> closed audits CLOSED; closed -> published audits REOPENED; draft -> closed (discard) audits nothing", async () => {
      const w = await world("cycle");
      const id = await create(w, { title: "Cycle" });
      await publish(w, id);
      const closed = await api.setPostingStatus(w.manager, w.org, actor, { id, version: Number((await rowOf(id)).version), to: "closed" });
      expect(closed).toMatchObject({ kind: "ok", data: { status: "closed" } });
      expect((await rowOf(id)).closed_at).not.toBeNull();
      const reopened = await api.setPostingStatus(w.manager, w.org, actor, { id, version: Number((await rowOf(id)).version), to: "published" });
      expect(reopened).toMatchObject({ kind: "ok", data: { status: "published" } });
      expect((await rowOf(id)).closed_at).toBeNull();

      const discard = await create(w, { title: "Discard me", summary: "", location: "", descriptionMd: "" });
      expect(await api.setPostingStatus(w.manager, w.org, actor, { id: discard, version: 1, to: "closed" })).toMatchObject({ kind: "ok", data: { status: "closed" } });

      const actions = (await auditFor(w.org)).map((a) => a.action);
      expect(actions).toEqual(["careers.posting.published", "careers.posting.closed", "careers.posting.reopened"]);
    });

    it("reopening a never-published closed posting is its first publication and is audited as PUBLISHED, not REOPENED", async () => {
      const w = await world("discarded-reopen");
      const id = await create(w, { title: "Second thoughts" });
      await api.setPostingStatus(w.manager, w.org, actor, { id, version: 1, to: "closed" });
      const result = await api.setPostingStatus(w.manager, w.org, actor, { id, version: Number((await rowOf(id)).version), to: "published" });
      expect(result).toMatchObject({ kind: "ok", data: { status: "published" } });
      const row = await rowOf(id);
      expect(row.first_published_at).not.toBeNull();
      expect(row.posted_on).not.toBeNull();
      expect((await auditFor(w.org)).map((a) => a.action)).toEqual(["careers.posting.published"]);
    });

    it("the other edges are invalid_transition and change nothing", async () => {
      const w = await world("edges");
      const pub = await create(w, { title: "Edge pub" });
      await publish(w, pub);
      expect(await api.setPostingStatus(w.manager, w.org, actor, { id: pub, version: Number((await rowOf(pub)).version), to: "published" })).toEqual({ kind: "invalid_transition" });
      const closed = await create(w, { title: "Edge closed" });
      await api.setPostingStatus(w.manager, w.org, actor, { id: closed, version: 1, to: "closed" });
      expect(await api.setPostingStatus(w.manager, w.org, actor, { id: closed, version: Number((await rowOf(closed)).version), to: "closed" })).toEqual({ kind: "invalid_transition" });
      expect(await auditFor(w.org)).toHaveLength(1); // the one publish above
    });

    it("a stale version is stale and writes no audit row", async () => {
      const w = await world("stale");
      const id = await create(w, { title: "Stale status" });
      await api.updatePosting(w.manager, w.org, actor, { ...GOOD, title: "Stale status 2", id, version: 1 });
      expect(await api.setPostingStatus(w.manager, w.org, actor, { id, version: 1, to: "published" })).toEqual({ kind: "stale" });
      expect((await rowOf(id)).status).toBe("draft");
      expect(await auditFor(w.org)).toHaveLength(0);
    });

    it("not_found: unknown id, another organization's id, text that is not a uuid", async () => {
      const bId = await create(B, { title: "B status target" });
      expect(await api.setPostingStatus(A.manager, A.org, actor, { id: bId, version: 1, to: "published" })).toEqual({ kind: "not_found" });
      expect(await api.setPostingStatus(A.manager, A.org, actor, { id: "44444444-4444-4444-4444-444444444444", version: 1, to: "closed" })).toEqual({ kind: "not_found" });
      expect((await rowOf(bId)).status).toBe("draft");
    });

    it("publishing requires title, summary, location and description: incomplete names only the missing ones, in order", async () => {
      const w = await world("incomplete");
      const none = await create(w, { title: "Needs everything", summary: "", location: "", descriptionMd: "" });
      expect(await api.setPostingStatus(w.manager, w.org, actor, { id: none, version: 1, to: "published" })).toEqual({
        kind: "incomplete",
        missing: ["summary", "location", "description"],
      });
      const some = await create(w, { title: "Needs location", location: "" });
      expect(await api.setPostingStatus(w.manager, w.org, actor, { id: some, version: 1, to: "published" })).toEqual({
        kind: "incomplete",
        missing: ["location"],
      });
      expect(await auditFor(w.org)).toHaveLength(0);
    });

    it("closing_date_passed on publish and on reopen; today is still allowed", async () => {
      const w = await world("datepass");
      const list = await api.listPostings(w.manager, w.org);
      if (list.kind !== "ok") throw new Error("list failed");
      const today = list.data.orgToday;
      const late = await create(w, { title: "Late", closingDate: addDays(today, -1) });
      expect(await api.setPostingStatus(w.manager, w.org, actor, { id: late, version: 1, to: "published" })).toEqual({ kind: "closing_date_passed", reopening: false });

      const todayOk = await create(w, { title: "Today ok", closingDate: today });
      expect(await api.setPostingStatus(w.manager, w.org, actor, { id: todayOk, version: 1, to: "published" })).toMatchObject({ kind: "ok" });

      // Reopen: the posting closed, then its closing date is in the past.
      const reopen = await create(w, { title: "Reopen late" });
      await publish(w, reopen);
      await api.setPostingStatus(w.manager, w.org, actor, { id: reopen, version: Number((await rowOf(reopen)).version), to: "closed" });
      await owner(sql`update job_postings set closing_date = ${addDays(today, -2)}::date where id = ${reopen}`);
      expect(await api.setPostingStatus(w.manager, w.org, actor, { id: reopen, version: Number((await rowOf(reopen)).version), to: "published" })).toEqual({ kind: "closing_date_passed", reopening: true });
    });

    it("publish_limit at 100 published postings; closing one makes room", async () => {
      const w = await world("limit");
      await owner(sql`
        insert into job_postings (organization_id, slug, title, summary, location, description_md)
        select ${w.org}, 'cap-' || g, 'Cap ' || g, 's', 'l', 'd' from generate_series(1, 100) g`);
      await owner(sql`update job_postings set status = 'published' where organization_id = ${w.org}`);
      const [n] = await owner(sql`select count(*)::int as n from job_postings where organization_id = ${w.org} and status = 'published'`);
      expect(n!.n).toBe(100);
      const extra = await create(w, { title: "The 101st" });
      expect(await api.setPostingStatus(w.manager, w.org, actor, { id: extra, version: 1, to: "published" })).toEqual({ kind: "publish_limit" });
      expect(await auditFor(w.org)).toHaveLength(0);

      const [one] = await owner(sql`select id, version from job_postings where organization_id = ${w.org} and slug = 'cap-1'`);
      expect(await api.setPostingStatus(w.manager, w.org, actor, { id: String(one!.id), version: Number(one!.version), to: "closed" })).toMatchObject({ kind: "ok" });
      expect(await api.setPostingStatus(w.manager, w.org, actor, { id: extra, version: 1, to: "published" })).toMatchObject({ kind: "ok" });
    });

    it("a description that fails the validator cannot be published (a path that skipped it)", async () => {
      const w = await world("baddesc");
      const id = await create(w, { title: "Bypassed" });
      await owner(sql`update job_postings set description_md = '# bad heading' where id = ${id}`);
      const result = await api.setPostingStatus(w.manager, w.org, actor, { id, version: Number((await rowOf(id)).version), to: "published" });
      expect(result).toMatchObject({ kind: "invalid_input", field: "descriptionMd" });
      expect((await rowOf(id)).status).toBe("draft");
    });

    it("the audit row rolls back with a change that fails, and the change rolls back with a failed audit insert", async () => {
      const w = await world("rollback");
      const id = await create(w, { title: "Rollback" });
      auditControl.fail = true;
      try {
        await expect(api.setPostingStatus(w.manager, w.org, actor, { id, version: 1, to: "published" })).rejects.toThrow(/audit insert failed/);
      } finally {
        auditControl.fail = false;
      }
      expect(await rowOf(id)).toMatchObject({ status: "draft", version: 1, first_published_at: null, posted_on: null });
      expect(await auditFor(w.org)).toHaveLength(0);

      // And the converse: a change the database refuses (the stale compare) leaves no audit row.
      expect(await api.setPostingStatus(w.manager, w.org, actor, { id, version: 99, to: "published" })).toEqual({ kind: "stale" });
      expect(await auditFor(w.org)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // reorder
  // -------------------------------------------------------------------------
  describe("movePosting", () => {
    async function threePublished(name: string) {
      const w = await world(name);
      const a = await create(w, { title: `${name} A` });
      const b = await create(w, { title: `${name} B` });
      const c = await create(w, { title: `${name} C` });
      // Each publish goes to the TOP, so the public order is C, B, A.
      await publish(w, a);
      await publish(w, b);
      await publish(w, c);
      return { w, a, b, c };
    }
    async function order(org: string): Promise<string[]> {
      const rows = await owner(sql`
        select title from job_postings where organization_id = ${org} and status = 'published'
         order by sort_order, posted_on desc, id`);
      return rows.map((r) => String(r.title).split(" ").pop()!);
    }

    it("newest published goes on top, and a move swaps with the neighbour and renumbers densely", async () => {
      const { w, a, b, c } = await threePublished("mv");
      expect(await order(w.org)).toEqual(["C", "B", "A"]);

      expect(await api.movePosting(w.manager, w.org, actor, { id: a, direction: "up" })).toEqual({ kind: "ok", data: { moved: true } });
      expect(await order(w.org)).toEqual(["C", "A", "B"]);
      const rows = await owner(sql`select sort_order from job_postings where organization_id = ${w.org} and status = 'published' order by sort_order`);
      expect(rows.map((r) => Number(r.sort_order))).toEqual([0, 1, 2]);

      expect(await api.movePosting(w.manager, w.org, actor, { id: c, direction: "down" })).toMatchObject({ kind: "ok", data: { moved: true } });
      expect(await order(w.org)).toEqual(["A", "C", "B"]);
      expect(b).toBeTruthy();
    });

    it("the ends do not move; the answer is moved:false and nothing is written", async () => {
      const { w, a, c } = await threePublished("ends");
      const before = await owner(sql`select id, sort_order from job_postings where organization_id = ${w.org} order by id`);
      expect(await api.movePosting(w.manager, w.org, actor, { id: c, direction: "up" })).toEqual({ kind: "ok", data: { moved: false } });
      expect(await api.movePosting(w.manager, w.org, actor, { id: a, direction: "down" })).toEqual({ kind: "ok", data: { moved: false } });
      const after = await owner(sql`select id, sort_order from job_postings where organization_id = ${w.org} order by id`);
      expect(after).toEqual(before);
    });

    it("a move bumps no version and no updated_at, and writes no audit row", async () => {
      const { w, b } = await threePublished("noversion");
      const before = await owner(sql`select id, version, updated_at from job_postings where organization_id = ${w.org} order by id`);
      const auditBefore = (await auditFor(w.org)).length;
      expect(await api.movePosting(w.manager, w.org, actor, { id: b, direction: "down" })).toMatchObject({ kind: "ok", data: { moved: true } });
      const after = await owner(sql`select id, version, updated_at from job_postings where organization_id = ${w.org} order by id`);
      expect(after).toEqual(before);
      expect((await auditFor(w.org)).length).toBe(auditBefore);
    });

    it("only changed rows are rewritten", async () => {
      const w = await world("changed-only");
      const ids: string[] = [];
      for (const n of ["1", "2", "3", "4"]) ids.push(await create(w, { title: `CO ${n}` }));
      for (const id of ids) await publish(w, id);
      // Order is 4,3,2,1 with sort_orders -3..0 from the trigger; the first move renumbers densely.
      expect(await api.movePosting(w.manager, w.org, actor, { id: ids[1]!, direction: "up" })).toMatchObject({ kind: "ok", data: { moved: true } });
      const rows = await owner(sql`select sort_order from job_postings where organization_id = ${w.org} and status = 'published' order by sort_order`);
      expect(rows.map((r) => Number(r.sort_order))).toEqual([0, 1, 2, 3]);
    });

    it("only published postings are orderable: a draft or closed one is invalid_transition", async () => {
      const w = await world("draftmove");
      const draft = await create(w, { title: "DM Draft" });
      expect(await api.movePosting(w.manager, w.org, actor, { id: draft, direction: "up" })).toEqual({ kind: "invalid_transition" });
    });

    it("not_found for an unknown id or another organization's id", async () => {
      const bId = await create(B, { title: "B move target" });
      expect(await api.movePosting(A.manager, A.org, actor, { id: bId, direction: "up" })).toEqual({ kind: "not_found" });
      expect(await api.movePosting(A.manager, A.org, actor, { id: "55555555-5555-5555-5555-555555555555", direction: "up" })).toEqual({ kind: "not_found" });
    });

    it("unpublishing leaves a gap that the next move closes (dense renumber)", async () => {
      const { w, a, b, c } = await threePublished("gap");
      await api.setPostingStatus(w.manager, w.org, actor, { id: b, version: Number((await rowOf(b)).version), to: "closed" });
      expect(await api.movePosting(w.manager, w.org, actor, { id: a, direction: "up" })).toMatchObject({ kind: "ok", data: { moved: true } });
      expect(await order(w.org)).toEqual(["A", "C"]);
      const rows = await owner(sql`select sort_order from job_postings where organization_id = ${w.org} and status = 'published' order by sort_order`);
      expect(rows.map((r) => Number(r.sort_order))).toEqual([0, 1]);
      expect(c).toBeTruthy();
    });
  });
});
