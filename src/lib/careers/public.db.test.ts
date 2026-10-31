/**
 * drizzle/0071's presby_public_careers(), proven against a real database through
 * the application's own reader - docs/work-log/2026-10-25-careers-inc1.md,
 * Phase 3 T6 (the differential toggle test) and the driver half of T16.
 *
 * scripts/careers/test-rls-71.sql (as presby_app) carries the SQL-level T4. This
 * file holds what only the application can show: that the real Neon driver hands
 * the mappers a PARSED jsonb array and text dates (so a healthy read is
 * `available`, not `failed`), and that the definer's availability equals
 * `orgFeatureEnabledInTx` for every combination of category axis x category row x
 * toggle row. The owner (`getPlatformDb()`) writes the fixtures; the reader runs
 * on `db` (presby_app, no org GUC) exactly as the anonymous page calls it.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/careers/public.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled" },
  recordAudit: vi.fn(),
}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;
function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
}

describe.skipIf(!hasDb)("presby_public_careers through the reader (Postgres-backed)", () => {
  let fx: CalendarFixture;
  let reader: typeof import("./public");
  let app: { execute(query: SQL): Promise<unknown>; transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> };
  const slugs = new Map<string, string>();

  async function owner(query: SQL): Promise<Row[]> {
    return rowsOf(await fx.platform.execute(query));
  }

  /** A congregation with a LIVE site and the careers toggle on. */
  async function liveOrg(name: string, zone = "America/New_York"): Promise<string> {
    const id = await fx.makeOrg(name, { timeZone: zone });
    const [org] = await owner(sql`select slug from organizations where id = ${id}`);
    slugs.set(id, String(org!.slug));
    await owner(sql`
      insert into organization_sites (organization_id, repo, status)
      values (${id}, ${`fixture/careers-${id}`}, 'live')`);
    await owner(sql`
      insert into organization_feature_toggles (organization_id, feature_key, enabled)
      values (${id}, 'org_portal.careers', true)`);
    return id;
  }

  /** A posting, created as a draft and walked to `status` through the real triggers. */
  async function posting(
    org: string,
    slug: string,
    over: { status?: "draft" | "published" | "closed"; closing?: string | null; payMin?: number | null; payMax?: number | null; unit?: string | null } = {},
  ): Promise<void> {
    await owner(sql`
      insert into job_postings (organization_id, slug, title, summary, location, employment_type,
                                pay_min_cents, pay_max_cents, pay_unit, description_md, closing_date)
      values (${org}, ${slug}, ${`Title ${slug}`}, 'A summary.', 'Fernwood', 'part_time',
              ${over.payMin ?? null}::integer, ${over.payMax ?? null}::integer, ${over.unit ?? null},
              '## Duties' || chr(10) || chr(10) || 'Lead the choir.', ${over.closing ?? null}::date)`);
    const status = over.status ?? "published";
    if (status !== "draft") {
      await owner(sql`update job_postings set status = 'published' where organization_id = ${org} and slug = ${slug}`);
    }
    if (status === "closed") {
      await owner(sql`update job_postings set status = 'closed' where organization_id = ${org} and slug = ${slug}`);
    }
  }

  beforeAll(async () => {
    ({ db: app } = (await import("@/lib/db")) as unknown as { db: typeof app });
    const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
    fx = await createCalendarFixture("pubcareers");
    reader = await import("./public");
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("a healthy list read is AVAILABLE with parsed postings (the driver returns jsonb parsed and dates as text)", async () => {
    const org = await liveOrg("list");
    await posting(org, "music-director", { payMin: 4500, payMax: 6000, unit: "hour", closing: "2099-12-31" });
    await posting(org, "sexton", {});
    await posting(org, "a-draft", { status: "draft" });
    await posting(org, "a-closed", { status: "closed" });
    await owner(sql`
      insert into organization_profiles (organization_id, phone, updated_by)
      values (${org}, '555-0167', ${fx.actingUserId})`);

    const result = await reader.readPublicCareers(slugs.get(org)!);
    expect(result.state).toBe("available");
    if (result.state !== "available") return;
    expect(result.organizationName).toMatch(/^Fixture list for pubcareers/);
    expect(result.contactPhone).toBe("555-0167");
    expect(result.orgToday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.postings.map((p) => p.slug).sort()).toEqual(["music-director", "sexton"]);
    const md = result.postings.find((p) => p.slug === "music-director")!;
    expect(md).toMatchObject({
      title: "Title music-director",
      location: "Fernwood",
      employmentType: "part_time",
      payMinCents: 4500,
      payMaxCents: 6000,
      payUnit: "hour",
      summary: "A summary.",
      closingDate: "2099-12-31",
    });
    expect(md.postedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Nothing identifying leaks through the mapped object.
    expect(JSON.stringify(result)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(JSON.stringify(result)).not.toContain("a-draft");
    expect(JSON.stringify(result)).not.toContain("a-closed");
  });

  it("a healthy EMPTY list is available with no postings: distinct from failed", async () => {
    const org = await liveOrg("empty");
    expect(await reader.readPublicCareers(slugs.get(org)!)).toMatchObject({ state: "available", postings: [] });
  });

  it("the posting read: open carries the description; closed carries slug and title only; draft and unknown are not_found", async () => {
    const org = await liveOrg("one");
    await posting(org, "open-one", {});
    await posting(org, "closed-one", { status: "closed" });
    await posting(org, "draft-one", { status: "draft" });
    const slug = slugs.get(org)!;

    const open = await reader.readPublicPosting(slug, "open-one");
    expect(open).toMatchObject({ state: "open", posting: { slug: "open-one", descriptionMd: "## Duties\n\nLead the choir." } });

    const closed = await reader.readPublicPosting(slug, "closed-one");
    expect(closed).toMatchObject({ state: "closed", slug: "closed-one", title: "Title closed-one" });
    expect(JSON.stringify(closed)).not.toContain("Duties");
    expect(JSON.stringify(closed)).not.toContain("A summary");

    for (const key of ["draft-one", "no-such-posting", "Bad Key!", "../x", "UPPER", "a".repeat(81)]) {
      expect(await reader.readPublicPosting(slug, key), key).toEqual({ state: "not_found" });
    }
  });

  it("another organization's slug never shows this organization's postings, in either direction", async () => {
    const a = await liveOrg("iso-a");
    const b = await liveOrg("iso-b");
    await posting(a, "only-a", {});
    await posting(b, "only-b", {});
    const ra = await reader.readPublicCareers(slugs.get(a)!);
    const rb = await reader.readPublicCareers(slugs.get(b)!);
    expect(ra.state === "available" && ra.postings.map((p) => p.slug)).toEqual(["only-a"]);
    expect(rb.state === "available" && rb.postings.map((p) => p.slug)).toEqual(["only-b"]);
    expect(await reader.readPublicPosting(slugs.get(a)!, "only-b")).toEqual({ state: "not_found" });
    expect(await reader.readPublicPosting(slugs.get(b)!, "only-a")).toEqual({ state: "not_found" });
  });

  it("an unknown organization, a site that is not live and a toggle that is off are the same unavailable answer", async () => {
    const live = await liveOrg("gates");
    await posting(live, "p", {});
    const slug = slugs.get(live)!;
    expect(await reader.readPublicCareers("no-such-congregation-pubcareers")).toEqual({ state: "unavailable" });

    await owner(sql`update organization_sites set status = 'suspended' where organization_id = ${live}`);
    expect(await reader.readPublicCareers(slug)).toEqual({ state: "unavailable" });
    expect(await reader.readPublicPosting(slug, "p")).toEqual({ state: "unavailable" });
    await owner(sql`update organization_sites set status = 'live' where organization_id = ${live}`);

    await owner(sql`update organization_feature_toggles set enabled = false where organization_id = ${live}`);
    expect(await reader.readPublicCareers(slug)).toEqual({ state: "unavailable" });
    expect(await reader.readPublicPosting(slug, "p")).toEqual({ state: "unavailable" });
  });

  // -------------------------------------------------------------------------
  // T6: the SQL composition cannot drift from orgFeatureEnabledInTx
  // -------------------------------------------------------------------------
  describe("T6: the definer's availability equals orgFeatureEnabledInTx over axis x category x toggle", () => {
    type Tri = "on" | "off" | "missing";
    const TRI: Tri[] = ["on", "off", "missing"];
    const AXIS_FLAG = "org_portal.feature_categories";

    it("agrees across all 27 combinations (list and posting reads both)", async () => {
      const { orgFeatureEnabledInTx, isCategoryAxisOn } = await import("@/lib/org-features");
      const { CAREERS_FEATURE_KEY } = await import("./contract");

      // A live site and NO toggle or category rows: each combination writes its own.
      const org = await fx.makeOrg("t6-matrix", { timeZone: "America/New_York" });
      const [orgRow] = await owner(sql`select slug from organizations where id = ${org}`);
      const slug = String(orgRow!.slug);
      await owner(sql`
        insert into organization_sites (organization_id, repo, status)
        values (${org}, ${`fixture/careers-t6-${org}`}, 'live')`);
      await posting(org, "matrix-posting", {});

      // The global axis flag is captured and restored, whatever happens.
      const [original] = await owner(sql`select enabled from feature_flags where key = ${AXIS_FLAG}`);
      const setAxis = async (state: Tri) => {
        if (state === "missing") {
          await owner(sql`delete from feature_flags where key = ${AXIS_FLAG}`);
        } else {
          await owner(sql`
            insert into feature_flags (key, enabled) values (${AXIS_FLAG}, ${state === "on"})
            on conflict (key) do update set enabled = excluded.enabled`);
        }
      };
      const setCategory = async (state: Tri) => {
        await owner(sql`delete from organization_feature_categories where organization_id = ${org}`);
        if (state !== "missing") {
          await owner(sql`
            insert into organization_feature_categories (organization_id, category, enabled)
            values (${org}, 'people', ${state === "on"})`);
        }
      };
      const setToggle = async (state: Tri) => {
        await owner(sql`
          delete from organization_feature_toggles where organization_id = ${org} and feature_key = ${CAREERS_FEATURE_KEY}`);
        if (state !== "missing") {
          await owner(sql`
            insert into organization_feature_toggles (organization_id, feature_key, enabled)
            values (${org}, ${CAREERS_FEATURE_KEY}, ${state === "on"})`);
        }
      };
      const viaTs = async (axisOn: boolean) =>
        app.transaction(async (tx) => {
          await (tx as { execute(q: SQL): Promise<unknown> }).execute(
            sql`select set_config('app.current_org_id', ${org}, true)`,
          );
          return orgFeatureEnabledInTx(
            tx as Parameters<typeof orgFeatureEnabledInTx>[0],
            org,
            CAREERS_FEATURE_KEY,
            axisOn,
          );
        });

      let compared = 0;
      let sawAvailable = 0;
      let sawUnavailable = 0;
      try {
        for (const axis of TRI) {
          await setAxis(axis);
          const axisOn = await isCategoryAxisOn(); // the application's own read of the flag
          expect(axisOn, `axis ${axis}`).toBe(axis === "on");
          for (const category of TRI) {
            await setCategory(category);
            for (const toggle of TRI) {
              await setToggle(toggle);
              const label = `axis=${axis} category=${category} toggle=${toggle}`;
              const [row] = rowsOf(await app.execute(sql`select * from presby_public_careers(${slug}::text)`));
              const [one] = rowsOf(await app.execute(sql`select * from presby_public_careers(${slug}::text, 'matrix-posting')`));
              const ts = await viaTs(axisOn);
              expect(row!.state === "available", `${label}: list`).toBe(ts);
              expect(one!.state === "open", `${label}: posting`).toBe(ts);
              if (!ts) expect(one!.state, `${label}: posting`).toBe("unavailable");
              if (ts) sawAvailable += 1;
              else sawUnavailable += 1;
              compared += 1;
            }
          }
        }
      } finally {
        if (original) {
          await setAxis(original.enabled ? "on" : "off");
        } else {
          await setAxis("missing");
        }
      }
      expect(compared).toBe(27);
      expect(sawAvailable).toBeGreaterThan(0);
      expect(sawUnavailable).toBeGreaterThan(0);
    }, 300_000);
  });
});
