/**
 * drizzle/0071_presby_careers.sql on a REAL Postgres connection - the proofs
 * scripts/careers/test-rls-71.sql cannot make because it runs as presby_app
 * (docs/work-log/2026-10-25-careers-inc1.md, T3-T5, owner half):
 *
 *   - the three guards firing on the OWNER path (getPlatformDb() is
 *     neondb_owner, which no grant binds - F44): born a draft with the stamps
 *     forced, the immutables, the illegal edges, the slug fixed after
 *     publish (and after a reopen), the owner-supplied posted_on honoured at
 *     first publish only, writes to the trigger-owned columns ignored, and
 *     the delete guard;
 *   - the teardown cascade through a deletable_until fixture organization;
 *   - D13 on the owner path, including two concurrent publishes racing for
 *     the 100th place (two connections, serialized by the advisory lock);
 *   - the public list's 100-row limit, which needs the cap trigger disabled
 *     (inside a rolled-back transaction) to build 101 published rows;
 *   - an inactive organization reads as the same `unavailable` row;
 *   - the sweep (owner-only): closes only published postings past their
 *     closing date in the ORGANIZATION's zone, ignores the toggle, leaves
 *     drafts, closed, no-date and future-date rows, returns one
 *     posting_closed row per posting, a second run finds nothing, and the
 *     limit and its clamp hold;
 *   - the 0057-style backfill, re-run from the migration file's own text
 *     against a founding_administrator role that lacks the careers keys.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/careers.db.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;

const MIGRATION = readFileSync(
  path.join(__dirname, "../../../../drizzle/0071_presby_careers.sql"),
  "utf8",
);

describe.skipIf(!hasDb)("drizzle/0071 job_postings (Postgres-backed, owner path)", () => {
  let fx: CalendarFixture;
  let siteCounter = 0;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  function rowsOf(result: unknown): Row[] {
    const r = result as { rows?: Row[] } | Row[];
    return Array.isArray(r) ? r : (r.rows ?? []);
  }

  async function q(query: SQL): Promise<Row[]> {
    return rowsOf(await fx.platform.execute(query));
  }

  /** Drizzle wraps the Postgres error - match the message chain and the SQLSTATE. */
  async function expectRaise(p: Promise<unknown>, pattern: RegExp, code?: string) {
    let caught: unknown = null;
    try {
      await p;
    } catch (err) {
      caught = err;
    }
    expect(caught, `expected a raise matching ${pattern}`).not.toBeNull();
    const messages: string[] = [];
    const codes: string[] = [];
    for (let e = caught as { message?: string; code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
      messages.push(String(e.message ?? e));
      if (e.code) codes.push(e.code);
    }
    expect(messages.join(" | ")).toMatch(pattern);
    if (code) expect(codes).toContain(code);
  }

  /** A fixture organization with a LIVE site and the careers toggle (or none). */
  async function liveOrg(
    name: string,
    opts: { timeZone?: string | null; toggle?: boolean | null } = {},
  ): Promise<string> {
    const org = await fx.makeOrg(name, { timeZone: opts.timeZone ?? null });
    siteCounter += 1;
    await q(sql`insert into organization_sites (organization_id, repo, status)
                values (${org}, ${`careers-db/${stamp}-${siteCounter}`}, 'live')`);
    const toggle = opts.toggle === undefined ? true : opts.toggle;
    if (toggle !== null) {
      await q(sql`insert into organization_feature_toggles (organization_id, feature_key, enabled)
                  values (${org}, 'org_portal.careers', ${toggle})`);
    }
    return org;
  }

  async function orgSlug(org: string): Promise<string> {
    const [r] = await q(sql`select slug from organizations where id = ${org}`);
    return String(r!.slug);
  }

  /** Insert a complete draft on the OWNER connection; returns its id. */
  async function draft(org: string, slug: string, extra: { closingDate?: string | null } = {}): Promise<string> {
    const [r] = await q(sql`
      insert into job_postings (organization_id, slug, title, summary, location, description_md, closing_date, created_by)
      values (${org}, ${slug}, ${`Title ${slug}`}, 'Summary', 'Location', 'Description', ${extra.closingDate ?? null},
              ${fx.actingUserId})
      returning id`);
    return String(r!.id);
  }

  async function posting(id: string): Promise<Row> {
    const [r] = await q(sql`select *, to_char(posted_on, 'YYYY-MM-DD') as posted_on_text,
                                   to_char(closing_date, 'YYYY-MM-DD') as closing_date_text
                              from job_postings where id = ${id}`);
    return r!;
  }

  async function guardStates(): Promise<Record<string, string>> {
    const rows = await q(sql`select tgname, tgenabled from pg_trigger
                              where tgrelid = 'job_postings'::regclass and not tgisinternal`);
    return Object.fromEntries(rows.map((r) => [String(r.tgname), String(r.tgenabled)]));
  }

  /** The organization's today as YYYY-MM-DD, computed independently of the helper. */
  async function todayIn(zone: string, offsetDays = 0): Promise<string> {
    const [r] = await q(sql`select to_char((now() at time zone ${zone})::date + ${offsetDays}::int, 'YYYY-MM-DD') as d`);
    return String(r!.d);
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/calendar-fixture");
    fx = await mod.createCalendarFixture("careers-db");
  }, 60_000);

  afterAll(async () => {
    if (fx) await fx.cleanup();
  }, 120_000);

  // -------------------------------------------------------------------------
  describe("the guards bind the owner (F44)", () => {
    let org: string;
    beforeAll(async () => {
      org = await liveOrg("guards", { timeZone: "America/Chicago" });
    });

    it("a posting is born a draft: a supplied status other than draft is refused (check_violation)", async () => {
      await expectRaise(
        q(sql`insert into job_postings (organization_id, slug, title, status)
              values (${org}, 'owner-born-published', 'x', 'published')`),
        /job_postings: a posting is created as a draft/,
        "23514",
      );
    });

    it("on insert, version and the four stamps are FORCED whatever the owner supplies", async () => {
      const [r] = await q(sql`
        insert into job_postings (organization_id, slug, title, version, first_published_at, posted_on, closed_at,
                                  created_at, updated_at)
        values (${org}, 'owner-forced', 'x', 9, now() - interval '9 days', date '2020-01-01', now(),
                now() - interval '9 days', now() - interval '9 days')
        returning id`);
      const p = await posting(String(r!.id));
      expect(p.status).toBe("draft");
      expect(p.version).toBe(1);
      expect(p.first_published_at).toBeNull();
      expect(p.posted_on).toBeNull();
      expect(p.closed_at).toBeNull();
      expect(Date.now() - new Date(String(p.created_at)).getTime()).toBeLessThan(60 * 60 * 1000);
    });

    it("id, organization_id, created_at and created_by are immutable on the owner path", async () => {
      const id = await draft(org, "owner-immutables");
      const other = await fx.makeOrg("immutables-other");
      for (const stmt of [
        sql`update job_postings set organization_id = ${other} where id = ${id}`,
        sql`update job_postings set created_at = now() - interval '1 day' where id = ${id}`,
        sql`update job_postings set created_by = null where id = ${id}`,
        sql`update job_postings set id = gen_random_uuid() where id = ${id}`,
      ]) {
        await expectRaise(q(stmt), /job_postings: id, organization_id, created_at and created_by are immutable/, "23514");
      }
    });

    it("the four legal edges pass and the two edges back into draft are refused, on the owner path", async () => {
      const a = await draft(org, "owner-edges-a");
      await q(sql`update job_postings set status = 'published' where id = ${a}`); // draft -> published
      await expectRaise(
        q(sql`update job_postings set status = 'draft' where id = ${a}`),
        /published -> draft is not a legal status change/,
        "23514",
      );
      await q(sql`update job_postings set status = 'closed' where id = ${a}`); // published -> closed
      await expectRaise(
        q(sql`update job_postings set status = 'draft' where id = ${a}`),
        /closed -> draft is not a legal status change/,
        "23514",
      );
      await q(sql`update job_postings set status = 'published' where id = ${a}`); // closed -> published
      const b = await draft(org, "owner-edges-b");
      await q(sql`update job_postings set status = 'closed' where id = ${b}`); // draft -> closed (discard)
      expect((await posting(a)).status).toBe("published");
      const pb = await posting(b);
      expect(pb.status).toBe("closed");
      expect(pb.first_published_at).toBeNull();
      await expectRaise(
        q(sql`update job_postings set status = 'archived' where id = ${a}`),
        /published -> archived is not a legal status change|job_postings_status_allowed/,
        "23514",
      );
    });

    it("the slug is fixed after the first publish for the owner too, including after a reopen", async () => {
      const id = await draft(org, "owner-slug");
      await q(sql`update job_postings set slug = 'owner-slug-renamed' where id = ${id}`);
      await q(sql`update job_postings set status = 'published' where id = ${id}`);
      await expectRaise(
        q(sql`update job_postings set slug = 'owner-slug-again' where id = ${id}`),
        /the slug is fixed once a posting has been published/,
        "23514",
      );
      await q(sql`update job_postings set status = 'closed' where id = ${id}`);
      await q(sql`update job_postings set status = 'published' where id = ${id}`);
      await expectRaise(
        q(sql`update job_postings set slug = 'owner-slug-after-reopen' where id = ${id}`),
        /the slug is fixed/,
        "23514",
      );
      expect((await posting(id)).slug).toBe("owner-slug-renamed");
    });

    it("the owner may supply posted_on at the FIRST publish only (Track K); later writes to it and to the other stamps are ignored", async () => {
      const id = await draft(org, "owner-posted-on");
      await q(sql`update job_postings set status = 'published', posted_on = date '2024-03-05' where id = ${id}`);
      const first = await posting(id);
      expect(first.posted_on_text).toBe("2024-03-05");
      const firstPublishedAt = String(first.first_published_at);

      await q(sql`update job_postings set posted_on = date '2025-01-01', first_published_at = now() - interval '400 days',
                                         version = 77, updated_at = now() - interval '9 days'
                   where id = ${id}`);
      const edited = await posting(id);
      expect(edited.posted_on_text).toBe("2024-03-05");
      expect(String(edited.first_published_at)).toBe(firstPublishedAt);
      expect(edited.version).toBe(first.version); // no content change: no bump, and 77 ignored

      await q(sql`update job_postings set status = 'closed' where id = ${id}`);
      await q(sql`update job_postings set status = 'published', posted_on = date '2025-06-06' where id = ${id}`);
      const reopened = await posting(id);
      expect(reopened.posted_on_text).toBe("2024-03-05");
      expect(String(reopened.first_published_at)).toBe(firstPublishedAt);
      expect(reopened.closed_at).toBeNull();
    });

    it("a first publish without a supplied posted_on stamps the ORGANIZATION's today", async () => {
      const id = await draft(org, "owner-posted-today");
      await q(sql`update job_postings set status = 'published' where id = ${id}`);
      expect((await posting(id)).posted_on_text).toBe(await todayIn("America/Chicago"));
    });

    it("version bumps by one on a content or status change and not on a sort_order change", async () => {
      const id = await draft(org, "owner-version");
      expect((await posting(id)).version).toBe(1);
      await q(sql`update job_postings set title = 'Renamed' where id = ${id}`);
      expect((await posting(id)).version).toBe(2);
      const before = await posting(id);
      await q(sql`update job_postings set sort_order = 17 where id = ${id}`);
      const after = await posting(id);
      expect(after.version).toBe(2);
      expect(String(after.updated_at)).toBe(String(before.updated_at));
      await q(sql`update job_postings set closing_date = date '2099-01-01' where id = ${id}`);
      expect((await posting(id)).version).toBe(3);
    });

    it("publishing with a passed closing date (in the organization's zone) is refused for the owner", async () => {
      const id = await draft(org, "owner-late", { closingDate: await todayIn("America/Chicago", -1) });
      await expectRaise(
        q(sql`update job_postings set status = 'published' where id = ${id}`),
        /job_postings: the closing date .* has passed/,
        "23514",
      );
    });

    it("DELETE is refused for the owner (insufficient_privilege): postings are permanent", async () => {
      const id = await draft(org, "owner-delete");
      await expectRaise(
        q(sql`delete from job_postings where id = ${id}`),
        /job_postings: postings are permanent; close them instead/,
        "42501",
      );
      expect(await q(sql`select 1 from job_postings where id = ${id}`)).toHaveLength(1);
    });

    it("the teardown cascade passes: deleting a deletable_until organization removes its postings", async () => {
      const doomed = await fx.makeOrg("cascade");
      const id = await draft(doomed, "cascade-me");
      await q(sql`update job_postings set status = 'published' where id = ${id}`);
      await q(sql`delete from organizations where id = ${doomed}`);
      expect(await q(sql`select 1 from job_postings where id = ${id}`)).toHaveLength(0);
    });

    it("the guards are left ENABLED by every test above", async () => {
      expect(await guardStates()).toEqual({
        job_postings_guard_insert: "O",
        job_postings_guard_update: "O",
        job_postings_guard_delete: "O",
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("D13: at most 100 published postings per organization", () => {
    it("the 101st is refused on the owner path", async () => {
      const org = await liveOrg("cap-owner");
      await q(sql`insert into job_postings (organization_id, slug, title, summary, location, description_md)
                  select ${org}, 'cap-' || g, 'Cap ' || g, 'S', 'L', 'D' from generate_series(1, 101) g`);
      await q(sql`update job_postings set status = 'published'
                   where organization_id = ${org} and slug <> 'cap-101'`);
      const [c] = await q(sql`select count(*)::int as n from job_postings where organization_id = ${org} and status = 'published'`);
      expect(c!.n).toBe(100);
      await expectRaise(
        q(sql`update job_postings set status = 'published' where organization_id = ${org} and slug = 'cap-101'`),
        /cap - at most 100 published postings per organization/,
        "23514",
      );
    });

    it("two concurrent publishes cannot both take the 100th place (the per-organization advisory lock)", async () => {
      const org = await liveOrg("cap-race");
      await q(sql`insert into job_postings (organization_id, slug, title, summary, location, description_md)
                  select ${org}, 'race-' || g, 'Race ' || g, 'S', 'L', 'D' from generate_series(1, 101) g`);
      await q(sql`update job_postings set status = 'published'
                   where organization_id = ${org} and slug not in ('race-100', 'race-101')`);
      const [a] = await q(sql`select id from job_postings where organization_id = ${org} and slug = 'race-100'`);
      const [b] = await q(sql`select id from job_postings where organization_id = ${org} and slug = 'race-101'`);

      const results = await Promise.allSettled([
        fx.platform.transaction(async (tx) => {
          await tx.execute(sql`update job_postings set status = 'published' where id = ${a!.id}`);
          await tx.execute(sql`select pg_sleep(1.5)`);
        }),
        (async () => {
          await new Promise((resolve) => setTimeout(resolve, 400));
          return fx.platform.transaction(async (tx) => {
            await tx.execute(sql`update job_postings set status = 'published' where id = ${b!.id}`);
          });
        })(),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      await expectRaise(Promise.reject(rejected[0]!.reason), /cap - at most 100 published postings/, "23514");
      const [c] = await q(sql`select count(*)::int as n from job_postings where organization_id = ${org} and status = 'published'`);
      expect(c!.n).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  describe("presby_public_careers on the owner path", () => {
    it("the list never returns more than 100 entries (built with the guards disabled inside a rolled-back transaction)", async () => {
      const org = await liveOrg("list-cap");
      const slug = await orgSlug(org);
      let listed = -1;
      await expectRaise(
        fx.platform.transaction(async (tx) => {
          await tx.execute(sql`alter table job_postings disable trigger job_postings_guard_insert`);
          await tx.execute(sql`alter table job_postings disable trigger job_postings_guard_update`);
          await tx.execute(sql`
            insert into job_postings (organization_id, slug, title, summary, location, description_md, status,
                                      first_published_at, posted_on, sort_order)
            select ${org}, 'many-' || g, 'Many ' || g, 'S', 'L', 'D', 'published', now(), current_date, g
              from generate_series(1, 101) g`);
          const [r] = rowsOf(await tx.execute(sql`
            select state, jsonb_array_length(postings_json) as n,
                   postings_json -> 0 ->> 'slug' as first, postings_json -> 99 ->> 'slug' as last
              from presby_public_careers(${slug})`));
          expect(r!.state).toBe("available");
          listed = Number(r!.n);
          expect(r!.first).toBe("many-1");
          expect(r!.last).toBe("many-100");
          throw new Error("rollback-on-purpose");
        }),
        /rollback-on-purpose/,
      );
      expect(listed).toBe(100);
      expect(await guardStates()).toEqual({
        job_postings_guard_insert: "O",
        job_postings_guard_update: "O",
        job_postings_guard_delete: "O",
      });
      expect(await q(sql`select 1 from job_postings where organization_id = ${org}`)).toHaveLength(0);
    });

    it("an organization that is not active reads as the same bare unavailable row as an unknown slug", async () => {
      const org = await liveOrg("inactive");
      const slug = await orgSlug(org);
      const id = await draft(org, "inactive-posting");
      await q(sql`update job_postings set status = 'published' where id = ${id}`);
      const [live] = await q(sql`select state from presby_public_careers(${slug})`);
      expect(live!.state).toBe("available");

      await q(sql`update organizations set status = 'inactive' where id = ${org}`);
      const [inactive] = await q(sql`select (x.*)::text as r from presby_public_careers(${slug}) x`);
      const [inactivePosting] = await q(sql`select (x.*)::text as r from presby_public_careers(${slug}, 'inactive-posting') x`);
      const [unknown] = await q(sql`select (x.*)::text as r from presby_public_careers(${`no-such-${stamp}`}) x`);
      expect(inactive!.r).toBe("(unavailable,,,,,)");
      expect(inactivePosting!.r).toBe(unknown!.r);
      expect(inactive!.r).toBe(unknown!.r);
    });
  });

  // -------------------------------------------------------------------------
  describe("presby_careers_sweep (owner-only, v1: auto-close)", () => {
    it("closes only published postings past their closing date in the ORGANIZATION's zone, ignores the toggle, and returns one posting_closed row each", async () => {
      // Clear anything already due on the branch, so the limit test below
      // starts from zero due rows.
      await q(sql`select * from presby_careers_sweep(1000)`);

      // D = Pago Pago's today. Kiritimati (UTC+14) is always at least one
      // day ahead of Pago Pago (UTC-11), so closing date D is PAST in
      // Kiritimati and NOT past in Pago Pago: the same stored date, two
      // answers, decided by the organization's zone.
      const d = await todayIn("Pacific/Pago_Pago");
      const kiri = await liveOrg("sweep-kiri", { timeZone: "Pacific/Kiritimati" });
      const pago = await liveOrg("sweep-pago", { timeZone: "Pacific/Pago_Pago" });
      const off = await liveOrg("sweep-off", { timeZone: "Pacific/Kiritimati", toggle: null });

      async function publishedWithClosing(org: string, slug: string, closing: string | null): Promise<string> {
        const id = await draft(org, slug);
        await q(sql`update job_postings set status = 'published' where id = ${id}`);
        if (closing !== null) await q(sql`update job_postings set closing_date = ${closing}::date where id = ${id}`);
        return id;
      }

      const dueKiri = await publishedWithClosing(kiri, "due-kiri", d);
      const notDuePago = await publishedWithClosing(pago, "not-due-pago", d);
      const dueToggleOff = await publishedWithClosing(off, "due-toggle-off", d);
      const noDate = await publishedWithClosing(kiri, "no-date", null);
      const future = await publishedWithClosing(kiri, "future", "2099-12-31");
      const draftPast = await draft(kiri, "draft-past", { closingDate: "2001-01-01" });
      const closedPast = await publishedWithClosing(kiri, "closed-past", null);
      await q(sql`update job_postings set closing_date = date '2001-01-01' where id = ${closedPast}`);
      await q(sql`update job_postings set status = 'closed' where id = ${closedPast}`);
      const closedPastBefore = await posting(closedPast);

      const rows = await q(sql`select * from presby_careers_sweep(1000)`);
      const mine = rows.filter((r) => [kiri, pago, off].includes(String(r.organization_id)));
      expect(mine.map((r) => String(r.posting_id)).sort()).toEqual([dueKiri, dueToggleOff].sort());
      for (const r of mine) {
        expect(r.kind).toBe("posting_closed");
        expect(r.application_id).toBeNull();
      }
      expect(mine.find((r) => r.posting_id === dueKiri)!.organization_id).toBe(kiri);

      for (const id of [dueKiri, dueToggleOff]) {
        const p = await posting(id);
        expect(p.status).toBe("closed");
        expect(p.closed_at).not.toBeNull();
        expect(p.first_published_at).not.toBeNull();
      }
      expect((await posting(notDuePago)).status).toBe("published");
      expect((await posting(noDate)).status).toBe("published");
      expect((await posting(future)).status).toBe("published");
      expect((await posting(draftPast)).status).toBe("draft");
      expect(String((await posting(closedPast)).closed_at)).toBe(String(closedPastBefore.closed_at));

      const again = await q(sql`select * from presby_careers_sweep(1000)`);
      expect(again.filter((r) => [kiri, pago, off].includes(String(r.organization_id)))).toHaveLength(0);
    });

    it("honours p_limit, clamps 0 up to 1, and treats null as the default (200)", async () => {
      await q(sql`select * from presby_careers_sweep(1000)`);
      const org = await liveOrg("sweep-limit", { timeZone: "Pacific/Kiritimati" });
      const d = await todayIn("Pacific/Pago_Pago");
      const ids: string[] = [];
      for (const s of ["lim-1", "lim-2", "lim-3", "lim-4"]) {
        const id = await draft(org, s);
        await q(sql`update job_postings set status = 'published' where id = ${id}`);
        await q(sql`update job_postings set closing_date = ${d}::date where id = ${id}`);
        ids.push(id);
      }
      expect(await q(sql`select * from presby_careers_sweep(1)`)).toHaveLength(1);
      expect(await q(sql`select * from presby_careers_sweep(0)`)).toHaveLength(1);
      // null is NOT clamped to 1: it means the default (200), so both remaining rows close.
      expect(await q(sql`select * from presby_careers_sweep(null)`)).toHaveLength(2);
      const closed = await q(sql`select count(*)::int as n from job_postings where organization_id = ${org} and status = 'closed'`);
      expect(closed[0]!.n).toBe(4);
      // The upper clamp (1000) is pinned on the definition, not by building 1001 due rows.
      expect(MIGRATION).toContain("v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);");
    });
  });

  // -------------------------------------------------------------------------
  describe("the founding-administrator backfill (F292), re-run from the migration text", () => {
    it("tops up an org-owned founding_administrator role that lacks the careers keys, and is idempotent", async () => {
      const org = await fx.makeOrg("backfill");
      const roleId = await fx.makeRole(org, "founding_administrator", ["domains.manage"]);
      const match = MIGRATION.match(
        /insert into app_role_permissions \(role_id, permission_key\)\nselect r\.id, k\.key\n[^;]*?where r\.key = 'founding_administrator'[^;]*;/,
      );
      expect(match, "0071 section 2b's backfill statement").not.toBeNull();
      await q(sql.raw(match![0]));
      await q(sql.raw(match![0]));
      const keys = await q(sql`select permission_key from app_role_permissions where role_id = ${roleId} order by 1`);
      expect(keys.map((k) => k.permission_key)).toEqual(["careers.applicants", "careers.manage", "domains.manage"]);
    });

    it("leaves template roles alone (organization_id is null is excluded)", async () => {
      const rows = await q(sql`
        select r.key from app_roles r
          join app_role_permissions rp on rp.role_id = r.id
         where r.organization_id is null and rp.permission_key in ('careers.manage', 'careers.applicants')
         group by r.key order by r.key`);
      expect(rows.map((r) => r.key)).toEqual(["hiring_committee"]);
    });
  });
});
