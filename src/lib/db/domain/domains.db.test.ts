/**
 * drizzle/0057_presby_org_domains.sql on a REAL Postgres connection - the
 * proofs scripts/domains/test-rls-47.sql cannot make because it runs as
 * presby_app:
 *
 *   - the three guards firing on the OWNER path (getPlatformDb() is
 *     neondb_owner, which no grant binds - F44): illegal edges, immutables,
 *     the six trigger-owned columns, the terminal freeze, the insert shape,
 *     the next_check_at cap, and the delete guard;
 *   - every positive path that needs a past clock, a closed org or the
 *     owner-only force_release_reason (lapsed_grace, a parked row's carried
 *     cause, org_closed, force_released, evicted, pending -> expired) - with
 *     the past clock supplied ONLY by e2e/support/domains-fixture.ts
 *     backdateDomainClock(), and the guards asserted re-enabled after each use;
 *   - lapsed -> parked KEEPING the running grace deadline;
 *   - the cap on the owner path, including two concurrent claims serialized
 *     by the per-org advisory lock;
 *   - the teardown cascade premise on a deletable_until fixture org;
 *   - the serving matrix: one committed serving fixture read back through the
 *     presby_app connection (the positive control test-rls-47 (e)/(f) cannot
 *     build, because presby_app holds no grant on organization_sites), then
 *     each serving condition flipped on its own to zero rows.
 *
 * Per-transition audit rows are NOT here: transitionDomain() arrives in Batch
 * 1a-ii, which owns those tests (Phase 3 Implementation Order).
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/domains.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";
import {
  backdateDomainClock,
  domainGuardStates,
  DOMAIN_GUARD_TRIGGERS,
} from "../../../../e2e/support/domains-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;
const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!hasDb)("drizzle/0057 organization_domains (Postgres-backed)", () => {
  let fx: CalendarFixture;
  let appDb: typeof import("@/lib/db").db;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let hostCounter = 0;

  /** A unique `*.invalid` claim name for this run (the holding index is global). */
  function claim(label: string): string {
    hostCounter += 1;
    return `${label}-${stamp}-${hostCounter}.invalid`;
  }

  function rowsOf(result: unknown): Row[] {
    const r = result as { rows?: Row[] } | Row[];
    return Array.isArray(r) ? r : (r.rows ?? []);
  }

  async function q(query: SQL): Promise<Row[]> {
    return rowsOf(await fx.platform.execute(query));
  }

  /** Drizzle wraps the Postgres error ("Failed query: ...") - match the whole cause chain. */
  async function expectRaise(p: Promise<unknown>, pattern: RegExp) {
    let caught: unknown = null;
    try {
      await p;
    } catch (err) {
      caught = err;
    }
    expect(caught, `expected a raise matching ${pattern}`).not.toBeNull();
    const messages: string[] = [];
    for (let e = caught as { message?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
      messages.push(String(e.message ?? e));
    }
    expect(messages.join(" | ")).toMatch(pattern);
  }

  /** Insert a pending row on the OWNER connection; returns its id. */
  async function insertDomain(
    org: string,
    opts: { host?: string; claimName?: string; purpose?: "web" | "mail"; webRole?: "canonical" | "alias" | null } = {},
  ): Promise<string> {
    const claimName = opts.claimName ?? opts.host ?? claim("d");
    const host = opts.host ?? claimName;
    const purpose = opts.purpose ?? "web";
    const webRole = purpose === "mail" ? null : (opts.webRole ?? "alias");
    const [row] = await q(sql`
      insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token,
                                        created_via, created_by_user_id)
      values (${org}, ${purpose}, ${host}, ${claimName}, ${webRole}, ${"t".repeat(32)}, 'platform', ${fx.actingUserId})
      returning id`);
    return String(row!.id);
  }

  async function setState(id: string, state: string, releaseCause?: string, reason?: string) {
    if (reason !== undefined) {
      await q(sql`update organization_domains set state = ${state}, release_cause = ${releaseCause ?? null},
                         force_release_reason = ${reason} where id = ${id}`);
    } else if (releaseCause !== undefined) {
      await q(sql`update organization_domains set state = ${state}, release_cause = ${releaseCause} where id = ${id}`);
    } else {
      await q(sql`update organization_domains set state = ${state} where id = ${id}`);
    }
  }

  /** Walk a pending web row to live along legal edges. */
  async function walkToLive(id: string) {
    for (const s of ["verified", "attach_pending", "attached", "live"]) await setState(id, s);
  }

  async function row(id: string): Promise<Row> {
    const [r] = await q(sql`select * from organization_domains where id = ${id}`);
    return r!;
  }

  async function expectGuardsEnabled() {
    const states = await domainGuardStates(fx.platform);
    for (const name of DOMAIN_GUARD_TRIGGERS) expect(states[name], name).toBe("O");
  }

  beforeAll(async () => {
    ({ db: appDb } = await import("@/lib/db"));
    const mod = await import("@/lib/testing/calendar-fixture");
    fx = await mod.createCalendarFixture("domains-db");
  }, 60_000);

  afterAll(async () => {
    if (fx) await fx.cleanup();
  }, 60_000);

  // -------------------------------------------------------------------------
  describe("the update guard binds the owner (F44)", () => {
    let org: string;
    // A fresh org per test: the cap (3 web / 1 mail) would otherwise refuse
    // a later test's fixture rows.
    beforeEach(async () => {
      org = await fx.makeOrg("guard");
    });

    it("refuses illegal edges, including a purpose-scoped one, on neondb_owner", async () => {
      const id = await insertDomain(org);
      await expectRaise(setState(id, "live"), /pending -> live is not a legal edge/);
      await expectRaise(setState(id, "attached"), /pending -> attached is not a legal edge/);
      const mail = await insertDomain(org, { purpose: "mail" });
      await setState(mail, "verified");
      await expectRaise(setState(mail, "attach_pending"), /verified -> attach_pending is not a legal edge for a mail row/);
      await setState(id, "verified");
      await setState(id, "lapsed");
      await expectRaise(setState(id, "released", "removed"), /lapsed -> released is not a legal edge for a web row/);
    });

    it("refuses every immutable column on neondb_owner", async () => {
      const id = await insertDomain(org);
      for (const set of [
        sql`hostname = 'other.invalid'`,
        sql`claim_name = 'other.invalid'`,
        sql`proof_token = ${"u".repeat(32)}`,
        sql`expires_at = now() - interval '1 day'`,
        sql`purpose = 'mail'`,
        sql`created_via = 'tenant'`,
        sql`created_at = now() - interval '1 day'`,
      ]) {
        await expectRaise(
          q(sql`update organization_domains set ${set} where id = ${id}`),
          /identity, token and provenance columns are immutable|organization_domains_/,
        );
      }
      const after = await row(id);
      expect(after.state).toBe("pending");
    });

    it("refuses all six trigger-owned columns on neondb_owner, grace_ends_at included (A1)", async () => {
      const id = await insertDomain(org);
      await walkToLive(id);
      for (const col of ["grace_ends_at", "state_changed_at", "proof_verified_at", "attached_at", "live_at", "released_at"]) {
        await expectRaise(
          q(sql`update organization_domains set ${sql.identifier(col)} = now() - interval '40 days' where id = ${id}`),
          /are trigger-owned/,
        );
      }
    });

    it("freezes a terminal row against every write on neondb_owner", async () => {
      const id = await insertDomain(org);
      await setState(id, "released", "removed");
      await expectRaise(q(sql`update organization_domains set observation = '{"x":1}' where id = ${id}`), /terminal and frozen/);
      await expectRaise(setState(id, "pending"), /terminal and frozen/);
    });

    it("the insert guard: rows are born pending with no hold and no edge stamp, on neondb_owner", async () => {
      const base = sql`(organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id`;
      const h = claim("born");
      await expectRaise(
        q(sql`insert into organization_domains ${base}, state) values (${org}, 'web', ${h}, ${h}, 'alias', ${"t".repeat(32)}, 'platform', ${fx.actingUserId}, 'live')`),
        /a domain row is created pending/,
      );
      await expectRaise(
        q(sql`insert into organization_domains ${base}, platform_hold) values (${org}, 'web', ${h}, ${h}, 'alias', ${"t".repeat(32)}, 'platform', ${fx.actingUserId}, 'paused')`),
        /created with no platform hold/,
      );
      await expectRaise(
        q(sql`insert into organization_domains ${base}, grace_ends_at) values (${org}, 'web', ${h}, ${h}, 'alias', ${"t".repeat(32)}, 'platform', ${fx.actingUserId}, now() - interval '1 day')`),
        /never inserted/,
      );
    });

    it("caps next_check_at on neondb_owner too (6 h; 24 h only while parked)", async () => {
      const id = await insertDomain(org);
      await expectRaise(
        q(sql`update organization_domains set next_check_at = now() + interval '7 hours' where id = ${id}`),
        /next_check_at may be at most 06:00:00 ahead/,
      );
      await q(sql`update organization_domains set next_check_at = now() + interval '5 hours' where id = ${id}`);
    });
  });

  // -------------------------------------------------------------------------
  describe("stamps, the trigger-owned grace, and the one backdating seam", () => {
    let org: string;
    // A fresh org per test: the cap (3 web / 1 mail) would otherwise refuse
    // a later test's fixture rows.
    beforeEach(async () => {
      org = await fx.makeOrg("grace");
    });

    it("stamps every edge timestamp and a 30-day grace on entering lapsed", async () => {
      const id = await insertDomain(org);
      await walkToLive(id);
      const live = await row(id);
      expect(live.proof_verified_at).toBeTruthy();
      expect(live.attached_at).toBeTruthy();
      expect(live.live_at).toBeTruthy();
      await setState(id, "lapsed");
      const lapsed = await row(id);
      const grace = new Date(String(lapsed.grace_ends_at)).getTime();
      expect(Math.abs(grace - (Date.now() + 30 * DAY_MS))).toBeLessThan(60_000);
    });

    it("lapsed -> parked KEEPS the running deadline (removing cannot extend a grace); live -> parked starts a fresh one", async () => {
      const id = await insertDomain(org);
      await walkToLive(id);
      await setState(id, "lapsed");
      const backdated = new Date(Date.now() + 3 * DAY_MS);
      await backdateDomainClock(fx.platform, id, { graceEndsAt: backdated });
      await expectGuardsEnabled();
      await setState(id, "parked", "removed");
      const parked = await row(id);
      expect(new Date(String(parked.grace_ends_at)).getTime()).toBe(backdated.getTime());

      const fresh = await insertDomain(org);
      await walkToLive(fresh);
      await setState(fresh, "parked", "removed");
      const freshParked = await row(fresh);
      const g = new Date(String(freshParked.grace_ends_at)).getTime();
      expect(Math.abs(g - (Date.now() + 30 * DAY_MS))).toBeLessThan(60_000);
    });

    it("entering verified clears the grace and the cause (parked -> verified reconnect)", async () => {
      const id = await insertDomain(org);
      await walkToLive(id);
      await setState(id, "parked", "removed");
      await setState(id, "verified");
      const r = await row(id);
      expect(r.grace_ends_at).toBeNull();
      expect(r.release_cause).toBeNull();
    });

    it("backdateDomainClock leaves all three guards enabled, and a failed backdate leaves them enabled too", async () => {
      await expectRaise(
        backdateDomainClock(fx.platform, "00000000-0000-4000-8000-000000000000", { graceEndsAt: new Date() }),
        /no organization_domains row/,
      );
      await expectGuardsEnabled();
    });
  });

  // -------------------------------------------------------------------------
  describe("release_cause evidence: the positive paths only the owner can reach (A2)", () => {
    let org: string;
    // A fresh org per test: the cap (3 web / 1 mail) would otherwise refuse
    // a later test's fixture rows.
    beforeEach(async () => {
      org = await fx.makeOrg("cause");
    });

    it("lapsed_grace: refused before the deadline, accepted after it", async () => {
      const id = await insertDomain(org);
      await walkToLive(id);
      await setState(id, "lapsed");
      await expectRaise(setState(id, "release_pending", "lapsed_grace"), /before the grace deadline requires force_release_reason/);
      await backdateDomainClock(fx.platform, id, { graceEndsAt: new Date(Date.now() - 60_000) });
      await expectGuardsEnabled();
      await expectRaise(setState(id, "release_pending", "removed"), /carries release_cause lapsed_grace/);
      await setState(id, "release_pending", "lapsed_grace");
      await expectRaise(setState(id, "released", "removed"), /carries its release_cause unchanged/);
      await setState(id, "released");
      const r = await row(id);
      expect(r.release_cause).toBe("lapsed_grace");
      expect(r.released_at).toBeTruthy();
    });

    it("parked -> release_pending by grace carries the cause set when the row was parked", async () => {
      const id = await insertDomain(org);
      await walkToLive(id);
      await setState(id, "parked", "removed");
      await backdateDomainClock(fx.platform, id, { graceEndsAt: new Date(Date.now() - 60_000) });
      await expectGuardsEnabled();
      await expectRaise(setState(id, "release_pending", "lapsed_grace"), /carries the cause set when the row was parked/);
      await setState(id, "release_pending");
      expect((await row(id)).release_cause).toBe("removed");
    });

    it("force_released and evicted need the owner-only reason, and a reason must carry one of them", async () => {
      const live = await insertDomain(org);
      await walkToLive(live);
      await expectRaise(setState(live, "release_pending", "force_released"), /requires force_release_reason/);
      await expectRaise(setState(live, "release_pending", "removed", "support ticket 0000"), /must carry force_released or evicted/);
      await expectRaise(setState(live, "parked", "evicted", "support ticket 0000"), /force_release_reason is written only on a force-release edge|never -> parked/);
      await setState(live, "release_pending", "force_released", "support ticket 0000");
      expect((await row(live)).force_release_reason).toBe("support ticket 0000");

      const pending = await insertDomain(org);
      await setState(pending, "released", "evicted", "dispute resolved for another organization");
      expect((await row(pending)).release_cause).toBe("evicted");
    });

    it("a reason cannot be parked on a live row ahead of time", async () => {
      const id = await insertDomain(org);
      await walkToLive(id);
      await expectRaise(
        q(sql`update organization_domains set force_release_reason = 'early' where id = ${id}`),
        /written only on a force-release edge/,
      );
      await expectRaise(
        q(sql`update organization_domains set force_release_reason = '   ' , state = 'release_pending', release_cause = 'force_released' where id = ${id}`),
        /organization_domains_reasons_shape/,
      );
    });

    it("org_closed: refused while the organization is active, accepted once its lifecycle_status is closed", async () => {
      const closing = await fx.makeOrg("closing");
      const id = await insertDomain(closing);
      await walkToLive(id);
      await expectRaise(setState(id, "parked", "org_closed"), /org_closed requires/);
      await q(sql`update organizations set lifecycle_status = 'dissolved' where id = ${closing}`);
      await setState(id, "parked", "org_closed");
      expect((await row(id)).release_cause).toBe("org_closed");
    });

    it("pending -> expired: refused before expires_at, accepted after it", async () => {
      const id = await insertDomain(org);
      await expectRaise(setState(id, "expired"), /expires only after expires_at/);
      await backdateDomainClock(fx.platform, id, { expiresAt: new Date(Date.now() - 60_000) });
      await expectGuardsEnabled();
      await setState(id, "expired");
      expect((await row(id)).state).toBe("expired");
    });
  });

  // -------------------------------------------------------------------------
  describe("the cap on the owner path", () => {
    it("refuses the 4th web host and the 2nd mail row for one org", async () => {
      const org = await fx.makeOrg("cap");
      const c = claim("cap");
      await insertDomain(org, { host: c, claimName: c, webRole: "canonical" });
      await insertDomain(org, { host: `www.${c}`, claimName: c });
      await insertDomain(org);
      await expectRaise(insertDomain(org), /organization_domains: cap - at most 3 web hosts/);
      await insertDomain(org, { purpose: "mail" });
      await expectRaise(insertDomain(org, { purpose: "mail" }), /organization_domains: cap - at most 1 mail domain/);
    });

    it("serializes two concurrent claims on the per-org advisory lock, so the second sees the first and is refused", async () => {
      const org = await fx.makeOrg("race");
      await insertDomain(org);
      await insertDomain(org);
      let releaseFirst!: () => void;
      const gate = new Promise<void>((r) => (releaseFirst = r));
      let firstInserted!: () => void;
      const inserted = new Promise<void>((r) => (firstInserted = r));
      const h1 = claim("race");
      const h2 = claim("race");
      const first = fx.platform.transaction(async (tx) => {
        await tx.execute(sql`
          insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
          values (${org}, 'web', ${h1}, ${h1}, 'alias', ${"t".repeat(32)}, 'platform', ${fx.actingUserId})`);
        firstInserted();
        await gate;
      });
      await inserted;
      const second = fx.platform
        .transaction(async (tx) => {
          await tx.execute(sql`
            insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
            values (${org}, 'web', ${h2}, ${h2}, 'alias', ${"t".repeat(32)}, 'platform', ${fx.actingUserId})`);
        })
        .then(
          () => null,
          (err: unknown) => err,
        );
      // The second claim is WAITING on the advisory lock, not racing past it.
      let waiting = 0;
      for (let i = 0; i < 40 && waiting === 0; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const [w] = await q(sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`);
        waiting = Number(w!.n);
      }
      expect(waiting).toBeGreaterThan(0);
      releaseFirst();
      await first;
      const err = (await second) as { message?: string; cause?: unknown } | null;
      expect(err, "the second concurrent claim must be refused").not.toBeNull();
      const messages: string[] = [];
      for (let e = err as typeof err | undefined; e; e = e.cause as typeof e) messages.push(String(e.message ?? e));
      expect(messages.join(" | ")).toMatch(/organization_domains: cap - at most 3 web hosts/);
      const [n] = await q(sql`select count(*)::int as n from organization_domains where organization_id = ${org}`);
      expect(Number(n!.n)).toBe(3);
    }, 30_000);
  });

  // -------------------------------------------------------------------------
  describe("Never Hard-Delete, and the teardown cascade premise", () => {
    it("refuses an owner-path DELETE of a domain row", async () => {
      const org = await fx.makeOrg("nodelete");
      const id = await insertDomain(org);
      await setState(id, "released", "removed");
      await expectRaise(q(sql`delete from organization_domains where id = ${id}`), /domain rows are permanent/);
      expect((await row(id)).state).toBe("released");
    });

    it("one `delete from organizations` of a deletable fixture org removes every domain row, guards and all", async () => {
      const org = await fx.makeOrg("teardown");
      const a = await insertDomain(org);
      await walkToLive(a);
      const b = await insertDomain(org);
      await setState(b, "released", "removed");
      await insertDomain(org, { purpose: "mail" });
      await q(sql`delete from organizations where id = ${org}`);
      const [n] = await q(sql`select count(*)::int as n from organization_domains where organization_id = ${org}`);
      expect(Number(n!.n)).toBe(0);
      await expectGuardsEnabled();
    });
  });

  // -------------------------------------------------------------------------
  describe("the serving matrix (DECISION-178): one positive control, then each condition alone", () => {
    let org: string;
    let slug: string;
    let canonical: string;
    let alias: string;
    let canonicalId: string;
    let aliasId: string;

    /** Read through the presby_app connection with NO org GUC - the anonymous public path. */
    async function anon<T extends Row>(query: SQL): Promise<T[]> {
      return appDb.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_org_id', '', true)`);
        return rowsOf(await tx.execute(query)) as T[];
      });
    }

    /** Apply `flip` and read by host and by slug INSIDE one owner transaction, then roll it back. */
    async function underFlip(flip: SQL[]): Promise<{ canon: number; alias: number; slugRows: Row[] }> {
      const sentinel = new Error("rollback-sentinel");
      let out: { canon: number; alias: number; slugRows: Row[] } | null = null;
      try {
        await fx.platform.transaction(async (tx) => {
          for (const f of flip) await tx.execute(f);
          const c = rowsOf(await tx.execute(sql`select * from presby_published_site_by_host(${canonical})`));
          const a = rowsOf(await tx.execute(sql`select * from presby_published_site_by_host(${alias})`));
          const s = rowsOf(await tx.execute(sql`select * from presby_published_site(${slug})`));
          out = { canon: c.length, alias: a.length, slugRows: s };
          throw sentinel;
        });
      } catch (err) {
        if (err !== sentinel) throw err;
      }
      return out!;
    }

    beforeAll(async () => {
      org = await fx.makeOrg("serving");
      const [o] = await q(sql`select slug from organizations where id = ${org}`);
      slug = String(o!.slug);
      await q(sql`insert into organization_sites (organization_id, repo, status) values (${org}, ${`presby-fixtures/site-${slug}`}, 'live')`);
      await q(sql`insert into organization_feature_toggles (organization_id, feature_key, enabled) values (${org}, 'org_portal.domains', true)`);
      canonical = claim("serving");
      alias = `www.${canonical}`;
      canonicalId = await insertDomain(org, { host: canonical, claimName: canonical, webRole: "canonical" });
      aliasId = await insertDomain(org, { host: alias, claimName: canonical, webRole: "alias" });
      await walkToLive(canonicalId);
      await walkToLive(aliasId);
    }, 60_000);

    it("POSITIVE CONTROL, through presby_app with no GUC: the canonical and the alias resolve; the slug read names the serving host", async () => {
      const c = await anon(sql`select * from presby_published_site_by_host(${canonical})`);
      expect(c).toHaveLength(1);
      expect(c[0]).toMatchObject({
        organization_id: org,
        slug,
        serving_host: canonical,
        canonical_host: canonical,
        request_is_canonical: true,
      });
      const a = await anon(sql`select * from presby_published_site_by_host(${alias})`);
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ slug, canonical_host: canonical, request_is_canonical: false });
      const s = await anon(sql`select organization_id, serving_host from presby_published_site(${slug})`);
      expect(s).toEqual([{ organization_id: org, serving_host: canonical }]);
    });

    it("the owner-path read agrees with the presby_app read (the matrix below reads on the owner, inside a rolled-back flip)", async () => {
      const r = await underFlip([]);
      expect(r.canon).toBe(1);
      expect(r.alias).toBe(1);
      expect(r.slugRows.map((x) => x.serving_host)).toEqual([canonical]);
    });

    type Ctx = { canonical: string; alias: string; org: string };
    const ctx = (): Ctx => ({ canonical, alias, org });

    it.each([
      ["canonical live -> attached (live_lost)", (c: Ctx) => sql`update organization_domains set state = 'attached' where hostname = ${c.canonical}`],
      ["canonical live -> lapsed", (c: Ctx) => sql`update organization_domains set state = 'lapsed' where hostname = ${c.canonical}`],
      ["canonical live -> parked", (c: Ctx) => sql`update organization_domains set state = 'parked', release_cause = 'removed' where hostname = ${c.canonical}`],
      ["canonical paused", (c: Ctx) => sql`update organization_domains set platform_hold = 'paused' where hostname = ${c.canonical}`],
      ["canonical disputed", (c: Ctx) => sql`update organization_domains set platform_hold = 'disputed' where hostname = ${c.canonical}`],
      ["org_portal.domains toggled off", (c: Ctx) => sql`update organization_feature_toggles set enabled = false where organization_id = ${c.org} and feature_key = 'org_portal.domains'`],
      ["org_portal.domains toggle row absent", (c: Ctx) => sql`delete from organization_feature_toggles where organization_id = ${c.org} and feature_key = 'org_portal.domains'`],
    ] as const)("%s: both hosts go dark, and the slug URL self-serves (serving_host null)", async (_label, flip) => {
      const r = await underFlip([flip(ctx())]);
      expect(r.canon).toBe(0);
      expect(r.alias).toBe(0);
      expect(r.slugRows.map((x) => x.serving_host)).toEqual([null]);
    });

    it.each([
      ["site suspended", (c: Ctx) => sql`update organization_sites set status = 'suspended' where organization_id = ${c.org}`],
      ["site provisioning", (c: Ctx) => sql`update organization_sites set status = 'provisioning' where organization_id = ${c.org}`],
      ["organization not active", (c: Ctx) => sql`update organizations set status = 'inactive' where id = ${c.org}`],
    ] as const)("%s: both hosts AND the slug read are the same zero rows", async (_label, flip) => {
      const r = await underFlip([flip(ctx())]);
      expect(r.canon).toBe(0);
      expect(r.alias).toBe(0);
      expect(r.slugRows).toHaveLength(0);
    });

    it("an alias that is itself dark (paused) goes dark alone; the canonical keeps serving", async () => {
      const r = await underFlip([sql`update organization_domains set platform_hold = 'paused' where id = ${aliasId}`]);
      expect(r.canon).toBe(1);
      expect(r.alias).toBe(0);
      expect(r.slugRows.map((x) => x.serving_host)).toEqual([canonical]);
    });

    it("a committed pause is seen through presby_app (dark), and clearing it restores service", async () => {
      await q(sql`update organization_domains set platform_hold = 'paused', hold_reason = 'fixture pause' where id = ${canonicalId}`);
      expect(await anon(sql`select 1 from presby_published_site_by_host(${canonical})`)).toHaveLength(0);
      expect(await anon(sql`select 1 from presby_published_site_by_host(${alias})`)).toHaveLength(0);
      await q(sql`update organization_domains set platform_hold = null, hold_reason = null where id = ${canonicalId}`);
      expect(await anon(sql`select 1 from presby_published_site_by_host(${canonical})`)).toHaveLength(1);
      expect(await anon(sql`select 1 from presby_published_site_by_host(${alias})`)).toHaveLength(1);
    });

    it("the predicate reads no category axis (R6: a curation preference never takes a site off the internet)", async () => {
      const [d] = await q(sql`select pg_get_functiondef('presby_org_serving_canonical_host(uuid)'::regprocedure) as def`);
      expect(String(d!.def)).not.toMatch(/categor/i);
    });

  });
});
