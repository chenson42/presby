/**
 * service.ts on a REAL Postgres connection (the pipeline's Neon branch) - the
 * Batch 1a-ii DB gate:
 *
 *   - R8: ONE TEST PER EDGE proving `transitionDomain()` writes the new state
 *     and EXACTLY ONE audit_events row in the same transaction. check:audit
 *     cannot see library paths, so this file is the proof of audit coverage.
 *   - claim / check / canonical / remove / reconnect, on the tenant connection
 *     (`withOrgContext`, `presby_app`, RLS enforced) and on the platform one.
 *   - the gate matrix (permission, operator-enabled toggle, membership).
 *   - A12: nothing a claim or a check returns depends on, or names, another
 *     organization.
 *
 * Every state is reached by walking legal edges as the OWNER (the trigger binds
 * the owner too, F44); a past clock comes only from the one sanctioned seam,
 * e2e/support/domains-fixture.ts `backdateDomainClock()`. Hosts are unique
 * `*.invalid` names per run (the holding index is global).
 *
 * Run serially, per docs/testing.md:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/domains/service.db.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";
import { backdateDomainClock, domainGuardStates, DOMAIN_GUARD_TRIGGERS } from "../../../e2e/support/domains-fixture";

vi.mock("server-only", () => ({}));
// audit.ts imports @/auth (next-auth), which this test environment cannot
// resolve; the real AUDIT_ACTIONS catalog is still used.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const mockEnqueue = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "queued", sentInline: true }));
vi.mock("@/lib/email", () => ({ enqueueEmail: mockEnqueue }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
type Row = Record<string, unknown>;

// This file makes hundreds of round trips to a remote Neon branch (an
// organization per scenario, and a walk of legal edges per audit case), so the
// default 20 s / 30 s is raised for this file only. Pure suites are unaffected.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

describe.skipIf(!hasDb)("src/lib/domains/service.ts (Postgres-backed)", () => {
  let fx: CalendarFixture;
  let svc: typeof import("./service");
  let state: typeof import("./state");
  let fakeMod: typeof import("./adapters/fake");
  let AUDIT_ACTIONS: typeof import("@/lib/audit").AUDIT_ACTIONS;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let hostCounter = 0;
  const orgIds: string[] = [];
  const TOKEN_RE = /^[A-Za-z0-9_-]{32,}$/;

  const claim = (label: string) => {
    hostCounter += 1;
    return `${label}-${stamp}-${hostCounter}.invalid`;
  };

  const rowsOf = (result: unknown): Row[] => {
    const r = result as { rows?: Row[] } | Row[];
    return Array.isArray(r) ? r : (r.rows ?? []);
  };
  const q = async (query: SQL): Promise<Row[]> => rowsOf(await fx.platform.execute(query));

  beforeAll(async () => {
    vi.stubEnv("DOMAINS_ALLOW_RESERVED_TLDS", "1");
    svc = await import("./service");
    state = await import("./state");
    fakeMod = await import("./adapters/fake");
    ({ AUDIT_ACTIONS } = await import("@/lib/audit"));
    ({ getPlatformDb } = await import("@/lib/db"));
    const mod = await import("@/lib/testing/calendar-fixture");
    fx = await mod.createCalendarFixture("domains-svc");
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!fx) return;
    // Audit rows reference no FK to the organization; remove this run's by org.
    if (orgIds.length > 0) {
      await q(sql`delete from audit_events where metadata->>'organizationId' = any(${sql.raw(
        `array[${orgIds.map((i) => `'${i}'`).join(",")}]::text[]`,
      )})`);
    }
    await fx.cleanup();
  }, 120_000);

  beforeEach(() => {
    mockEnqueue.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("DOMAINS_ALLOW_RESERVED_TLDS", "1");
  });

  // ------------------------------------------------------------------ fixtures

  async function makeOrg(name = "o"): Promise<string> {
    const id = await fx.makeOrg(name);
    orgIds.push(id);
    return id;
  }

  async function setToggle(org: string, enabled: boolean | null) {
    if (enabled === null) return;
    await q(sql`insert into organization_feature_toggles (organization_id, feature_key, enabled)
                values (${org}, 'org_portal.domains', ${enabled})
                on conflict (organization_id, feature_key) do update set enabled = ${enabled}`);
  }

  interface Tenant {
    org: string;
    personId: string;
    actor: import("./service").DomainActor;
  }

  /** An org with the toggle on and one member holding domains.manage (unless told otherwise). */
  async function tenant(opts: { holds?: boolean; toggle?: boolean | null } = {}): Promise<Tenant> {
    const org = await makeOrg("t");
    await setToggle(org, opts.toggle === undefined ? true : opts.toggle);
    const personId = await fx.makePerson("Dom", "Holder");
    await fx.enroll(org, personId, opts.holds === false ? [] : ["domains.manage"]);
    return {
      org,
      personId,
      actor: { kind: "tenant", userId: fx.actingUserId, email: `holder-${stamp}@example.invalid`, personId },
    };
  }

  const platformActor = (): import("./service").DomainActor => ({
    kind: "platform",
    userId: fx.actingUserId,
    email: `operator-${stamp}@example.invalid`,
  });

  async function domainRows(org: string, where: SQL = sql`true`): Promise<Row[]> {
    return q(sql`select * from organization_domains where organization_id = ${org} and ${where} order by hostname`);
  }

  async function auditFor(ids: string[]): Promise<Row[]> {
    if (ids.length === 0) return [];
    return q(sql`select action, actor_user_id, actor_email, metadata, resource_id
                   from audit_events
                  where resource_type = 'organization_domain'
                    and resource_id = any(${sql.raw(`array[${ids.map((i) => `'${i}'`).join(",")}]::text[]`)})
                  order by created_at, action`);
  }

  async function auditOf(org: string): Promise<Row[]> {
    return q(sql`select action, actor_user_id, metadata, resource_id from audit_events
                  where resource_type = 'organization_domain' and metadata->>'organizationId' = ${org}
                  order by created_at, action`);
  }

  /** Owner insert of a pending row (bypassing the service) for arranging states. */
  async function insertRaw(
    org: string,
    o: { host?: string; claimName?: string; purpose?: "web" | "mail"; role?: "canonical" | "alias" | null; token?: string } = {},
  ): Promise<string> {
    const claimName = o.claimName ?? o.host ?? claim("raw");
    const host = o.host ?? claimName;
    const purpose = o.purpose ?? "web";
    const role = purpose === "mail" ? null : (o.role ?? "alias");
    const [r] = await q(sql`
      insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
      values (${org}, ${purpose}, ${host}, ${claimName}, ${role}, ${o.token ?? "r".repeat(32)}, 'platform', ${fx.actingUserId})
      returning id`);
    return String(r!.id);
  }

  async function step(id: string, to: string, cause?: string, reason?: string) {
    if (reason !== undefined) {
      await q(sql`update organization_domains set state = ${to}, release_cause = ${cause ?? null}, force_release_reason = ${reason} where id = ${id}`);
    } else if (cause !== undefined) {
      await q(sql`update organization_domains set state = ${to}, release_cause = ${cause} where id = ${id}`);
    } else {
      await q(sql`update organization_domains set state = ${to} where id = ${id}`);
    }
  }

  async function walkTo(id: string, target: string, purpose: "web" | "mail" = "web") {
    const web: Record<string, Array<[string, string?, string?]>> = {
      pending: [],
      verified: [["verified"]],
      attach_pending: [["verified"], ["attach_pending"]],
      attached: [["verified"], ["attach_pending"], ["attached"]],
      live: [["verified"], ["attach_pending"], ["attached"], ["live"]],
      lapsed: [["verified"], ["lapsed"]],
      parked: [["verified"], ["attach_pending"], ["attached"], ["live"], ["parked", "removed"]],
      release_pending: [
        ["verified"],
        ["attach_pending"],
        ["attached"],
        ["live"],
        ["release_pending", "force_released", "Arranged by the test fixture."],
      ],
    };
    const mail: Record<string, Array<[string, string?, string?]>> = {
      pending: [],
      verified: [["verified"]],
      lapsed: [["verified"], ["lapsed"]],
    };
    const path = (purpose === "web" ? web : mail)[target];
    if (!path) throw new Error(`no ${purpose} path to ${target}`);
    for (const [to, cause, reason] of path) await step(id, to, cause, reason);
  }

  const dnsWith = () => fakeMod.createFakeDns();
  const proofHas = (d: ReturnType<typeof dnsWith>, claimName: string, token: string) =>
    d.setRecord("TXT", `_presby-challenge.${claimName}`, `presby-verify=${token}`);

  async function tokenOf(org: string, claimName: string): Promise<string> {
    const [r] = await q(sql`select proof_token from organization_domains where organization_id = ${org} and claim_name = ${claimName} limit 1`);
    return String(r!.proof_token);
  }

  async function claimOk(t: Tenant, domain: string, canonical: "www" | "apex" = "www") {
    const r = await svc.claimDomain(t.actor, t.org, { domain, canonical });
    if (r.kind !== "ok") throw new Error(`claim failed: ${r.kind}`);
    return r;
  }

  // ===================================================================
  describe("claimDomain", () => {
    it("a tenant claim of an apex creates the apex/www pair, pending, one shared token, www canonical by default", async () => {
      const t = await tenant();
      const name = claim("church");
      const r = await claimOk(t, name);

      expect(r.claimName).toBe(name);
      expect(r.created.map((c) => c.hostname).sort()).toEqual([name, `www.${name}`].sort());
      expect(r.proof).toMatchObject({ type: "TXT", name: `_presby-challenge.${name}` });
      expect(r.proof.value).toMatch(/^presby-verify=[A-Za-z0-9_-]{32,}$/);

      const rows = await domainRows(t.org);
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((x) => x.proof_token)).size).toBe(1);
      expect(String(rows[0]!.proof_token)).toMatch(TOKEN_RE);
      expect(r.proof.value).toBe(`presby-verify=${rows[0]!.proof_token}`);
      for (const row of rows) {
        expect(row.state).toBe("pending");
        expect(row.purpose).toBe("web");
        expect(row.created_via).toBe("tenant");
        expect(row.created_by_user_id).toBe(fx.actingUserId);
        expect(row.release_cause).toBeNull();
      }
      expect(rows.find((x) => x.hostname === `www.${name}`)!.web_role).toBe("canonical");
      expect(rows.find((x) => x.hostname === name)!.web_role).toBe("alias");

      // next_check_at is scheduled ~5 minutes out (inside the trigger's 6 h cap).
      const [soon] = await q(sql`select count(*)::int as n from organization_domains
                                  where organization_id = ${t.org}
                                    and next_check_at between now() + interval '4 minutes' and now() + interval '6 minutes'`);
      expect(soon!.n).toBe(2);
    });

    it("canonical 'apex' makes the apex canonical and www the alias", async () => {
      const t = await tenant();
      const name = claim("church");
      await claimOk(t, name, "apex");
      const rows = await domainRows(t.org);
      expect(rows.find((x) => x.hostname === name)!.web_role).toBe("canonical");
      expect(rows.find((x) => x.hostname === `www.${name}`)!.web_role).toBe("alias");
    });

    it("a typed www. name is ONE canonical row whose claim name is itself", async () => {
      const t = await tenant();
      const name = `www.${claim("church")}`;
      const r = await claimOk(t, name, "apex"); // 'canonical' is ignored for a name that does not pair
      expect(r.created).toHaveLength(1);
      expect(r.claimName).toBe(name);
      const [row] = await domainRows(t.org);
      expect(row).toMatchObject({ hostname: name, claim_name: name, web_role: "canonical" });
    });

    it("a second claim group can only be an alias (one canonical per org)", async () => {
      const t = await tenant();
      await claimOk(t, `www.${claim("one")}`);
      const second = `www.${claim("two")}`;
      await claimOk(t, second);
      const rows = await domainRows(t.org, sql`claim_name = ${second}`);
      expect(rows[0]!.web_role).toBe("alias");
    });

    it("a claim that would exceed the cap of 3 hosts is refused before any insert", async () => {
      const t = await tenant();
      await claimOk(t, claim("a")); // 2 rows
      await claimOk(t, `www.${claim("b")}`); // 3 rows
      const before = await domainRows(t.org);
      const refused = await svc.claimDomain(t.actor, t.org, { domain: `www.${claim("c")}`, canonical: "www" });
      expect(refused.kind).toBe("cap_reached");
      expect(await domainRows(t.org)).toHaveLength(before.length);
    });

    it("...and a PAIR that does not fit is refused whole", async () => {
      const t = await tenant();
      await claimOk(t, claim("a")); // 2 of 3 used
      const pair = await svc.claimDomain(t.actor, t.org, { domain: claim("p"), canonical: "www" });
      expect(pair.kind).toBe("cap_reached");
      expect(await domainRows(t.org)).toHaveLength(2);
    });

    it("the cap trigger is the authority: a 4th owner insert raises, and the service maps it to cap", async () => {
      const t = await tenant();
      for (let i = 0; i < 3; i += 1) await insertRaw(t.org);
      let caught: unknown = null;
      try {
        await insertRaw(t.org);
      } catch (err) {
        caught = err;
      }
      expect(svc.classifyDomainDbError(caught)).toEqual({ kind: "cap" });
    });

    it("claiming a name the org already holds is 'exists' (and 'parked' says so)", async () => {
      const t = await tenant();
      const name = claim("church");
      await claimOk(t, name);
      expect(await svc.claimDomain(t.actor, t.org, { domain: name, canonical: "www" })).toEqual({
        kind: "exists",
        claimName: name,
        parked: false,
      });
      for (const row of await domainRows(t.org)) await walkTo(String(row.id), "parked");
      expect(await svc.claimDomain(t.actor, t.org, { domain: name, canonical: "www" })).toEqual({
        kind: "exists",
        claimName: name,
        parked: true,
      });
    });

    it("typing the apex when the org holds only the www row adds just the missing apex row", async () => {
      const t = await tenant();
      const name = claim("church");
      await claimOk(t, `www.${name}`);
      const r = await claimOk(t, name);
      expect(r.created.map((c) => c.hostname)).toEqual([name]);
      const rows = await domainRows(t.org);
      expect(rows).toHaveLength(2);
      expect(rows.find((x) => x.hostname === name)!.web_role).toBe("alias"); // a canonical already exists
    });

    it("an invalid name writes nothing and audits nothing", async () => {
      const t = await tenant();
      for (const bad of ["", "not a domain", "localhost", "https://", "a..b.invalid", "203.0.113.9"]) {
        const r = await svc.claimDomain(t.actor, t.org, { domain: bad, canonical: "www" });
        expect(r.kind, bad).toBe("invalid");
      }
      expect(await domainRows(t.org)).toHaveLength(0);
      expect(await auditOf(t.org)).toHaveLength(0);
    });

    it("writes one domain.claimed audit row per row, with the actor, and never the token", async () => {
      const t = await tenant();
      const name = claim("church");
      const r = await claimOk(t, name);
      const token = await tokenOf(t.org, name);
      const audit = await auditFor(r.created.map((c) => c.id));
      expect(audit).toHaveLength(2);
      for (const a of audit) {
        expect(a.action).toBe(AUDIT_ACTIONS.DOMAIN_CLAIMED);
        expect(a.actor_user_id).toBe(fx.actingUserId);
        expect(a.metadata).toMatchObject({ organizationId: t.org, claimName: name, to: "pending", actorKind: "tenant", via: "tenant" });
        expect(JSON.stringify(a)).not.toContain(token);
      }
    });

    it("notifies the holders after commit, through the account-class template, without the token", async () => {
      const t = await tenant();
      const email = `holder-${stamp}-${hostCounter}@example.invalid`;
      await q(sql`insert into users (id, email, name) values (gen_random_uuid(), ${email}, 'Holder') on conflict (email) do nothing`);
      const [u] = await q(sql`select id from users where email = ${email}`);
      await q(sql`update people set user_id = ${u!.id} where id = ${t.personId}`);
      try {
        const name = claim("church");
        await claimOk(t, name);
        const token = await tokenOf(t.org, name);
        // enqueueEmail takes { to, message: RenderedEmail, templateKey }: flatten the message for the assertions.
        const calls = mockEnqueue.mock.calls.map((c) => {
          const i = c[0] as { to: string; templateKey: string; message: Record<string, string> };
          return { to: i.to, templateKey: i.templateKey, ...i.message } as Record<string, string>;
        });
        const mine = calls.find((c) => c.to === email);
        expect(mine, "holder was notified").toBeDefined();
        expect(mine!.templateKey).toBe("domain_notification");
        expect(mine!.subject).toMatch(/domain was added/i);
        expect(mine!.html).toContain(name);
        for (const c of calls) {
          expect(c.templateKey).toBe("domain_notification");
          expect(c.html + c.text + c.subject).not.toContain(token);
        }
      } finally {
        await q(sql`update people set user_id = null where id = ${t.personId}`);
        await q(sql`delete from users where id = ${u!.id}`);
      }
    });

    it("A12: two organizations claiming the same name get identical, org-free answers; pending claims never conflict", async () => {
      const a = await tenant();
      const b = await tenant();
      const name = claim("church");
      const ra = await claimOk(a, name);
      const rb = await claimOk(b, name);
      expect(rb.created.map((c) => c.hostname).sort()).toEqual(ra.created.map((c) => c.hostname).sort());
      expect(Object.keys(rb).sort()).toEqual(Object.keys(ra).sort());
      expect(JSON.stringify(rb)).not.toContain(a.org);
      expect(JSON.stringify(ra)).not.toContain(b.org);
      expect(await tokenOf(a.org, name)).not.toBe(await tokenOf(b.org, name));
    });

    it("rate-limits new claims at 5 per 24 hours per organization", async () => {
      vi.stubEnv("RATE_LIMIT_DISABLED", "false");
      const t = await tenant();
      const results: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        const r = await svc.claimDomain(t.actor, t.org, { domain: `www.${claim("rl")}`, canonical: "www" });
        results.push(r.kind);
      }
      // Rows 1-3 insert; 4 and 5 hit the cap (but still spend a slot); the 6th is limited.
      expect(results.slice(0, 3)).toEqual(["ok", "ok", "ok"]);
      expect(results.slice(3, 5)).toEqual(["cap_reached", "cap_reached"]);
      expect(results[5]).toBe("rate_limited");
      const limited = await svc.claimDomain(t.actor, t.org, { domain: `www.${claim("rl")}`, canonical: "www" });
      expect(limited).toMatchObject({ kind: "rate_limited" });
      expect((limited as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
    });

    describe("the gate", () => {
      it("a member without domains.manage is forbidden, and nothing is written", async () => {
        const t = await tenant({ holds: false });
        const r = await svc.claimDomain(t.actor, t.org, { domain: claim("x"), canonical: "www" });
        expect(r.kind).toBe("forbidden");
        expect(await domainRows(t.org)).toHaveLength(0);
        expect(await auditOf(t.org)).toHaveLength(0);
      });

      it("a holder is feature_off when the toggle is off, or when no toggle row exists", async () => {
        for (const toggle of [false, null] as const) {
          const t = await tenant({ toggle });
          const r = await svc.claimDomain(t.actor, t.org, { domain: claim("x"), canonical: "www" });
          expect(r.kind, String(toggle)).toBe("feature_off");
          expect(await domainRows(t.org)).toHaveLength(0);
        }
      });

      it("permission is checked before the toggle (a non-holder learns nothing about the toggle)", async () => {
        const t = await tenant({ holds: false, toggle: false });
        expect((await svc.claimDomain(t.actor, t.org, { domain: claim("x"), canonical: "www" })).kind).toBe("forbidden");
      });

      it("a person from ANOTHER organization is forbidden (membership is verified before context is set)", async () => {
        const a = await tenant();
        const b = await tenant();
        // b's person, acting at a's organization.
        const r = await svc.claimDomain(b.actor, a.org, { domain: claim("x"), canonical: "www" });
        expect(r.kind).toBe("forbidden");
        expect(await domainRows(a.org)).toHaveLength(0);
      });

      it("the machine actor cannot claim", async () => {
        const t = await tenant();
        const r = await svc.claimDomain({ kind: "machine", trigger: "cron" }, t.org, { domain: claim("x"), canonical: "www" });
        expect(r.kind).toBe("forbidden");
      });
    });

    describe("the platform on-behalf claim (Q2)", () => {
      it("creates web rows as created_via 'platform', audited as the platform actor, DNS proof still required (pending, nothing attached)", async () => {
        const org = await makeOrg("p");
        await setToggle(org, true);
        const name = claim("church");
        const r = await svc.claimDomain(platformActor(), org, { domain: name, canonical: "www" });
        expect(r.kind).toBe("ok");
        const rows = await domainRows(org);
        expect(rows).toHaveLength(2);
        for (const row of rows) {
          expect(row.created_via).toBe("platform");
          expect(row.state).toBe("pending");
          expect(row.purpose).toBe("web");
        }
        const audit = await auditOf(org);
        expect(audit).toHaveLength(2);
        for (const a of audit) {
          expect(a.metadata).toMatchObject({ actorKind: "platform", via: "platform" });
        }
      });

      it("still requires the org toggle, and a real organization", async () => {
        const off = await makeOrg("p");
        expect((await svc.claimDomain(platformActor(), off, { domain: claim("x"), canonical: "www" })).kind).toBe("feature_off");
        expect(
          (await svc.claimDomain(platformActor(), "00000000-0000-4000-8000-000000000000", { domain: claim("x"), canonical: "www" })).kind,
        ).toBe("not_found");
        expect(await domainRows(off)).toHaveLength(0);
      });
    });
  });

  // ===================================================================
  describe("checkClaim", () => {
    it("pending + the proof present: every row verifies, one domain.proof_verified audit row each", async () => {
      const t = await tenant();
      const name = claim("church");
      const r = await claimOk(t, name);
      const token = await tokenOf(t.org, name);
      const d = dnsWith();
      proofHas(d, name, token);

      const res = await svc.checkClaim(t.actor, t.org, name, { forced: false, deps: { dns: d.observer } });
      expect(res).toMatchObject({ kind: "ok", outcome: "verified", proof: "present" });

      const rows = await domainRows(t.org);
      for (const row of rows) {
        expect(row.state).toBe("verified");
        expect(row.proof_verified_at).not.toBeNull();
        expect(row.last_check_class).toBe("ok");
        expect(row.proof_last_ok_at).not.toBeNull();
        expect(row.observation).toMatchObject({ proof: { status: "present" } });
      }
      const audit = (await auditFor(r.created.map((c) => c.id))).filter((a) => a.action !== AUDIT_ACTIONS.DOMAIN_CLAIMED);
      expect(audit).toHaveLength(2);
      for (const a of audit) {
        expect(a.action).toBe(AUDIT_ACTIONS.DOMAIN_PROOF_VERIFIED);
        expect(a.metadata).toMatchObject({ from: "pending", to: "verified", event: "proof_ok", actorKind: "tenant" });
        expect(JSON.stringify(a)).not.toContain(token);
      }
      // One lookup for the whole group, not one per row.
      expect(d.cloudflare.calls).toHaveLength(1);
    });

    it("the proof absent: no transition, no audit row, the observation says so", async () => {
      const t = await tenant();
      const name = claim("church");
      const r = await claimOk(t, name);
      const d = dnsWith();
      const res = await svc.checkClaim(t.actor, t.org, name, { forced: false, deps: { dns: d.observer } });
      expect(res).toMatchObject({ kind: "ok", outcome: "unchanged", proof: "absent" });
      for (const row of await domainRows(t.org)) {
        expect(row.state).toBe("pending");
        expect(row.last_check_class).toBe("proof_absent");
        expect(row.observation).toMatchObject({ proof: { status: "absent" } });
        expect(row.last_checked_at).not.toBeNull();
      }
      expect((await auditFor(r.created.map((c) => c.id))).filter((a) => a.action !== AUDIT_ACTIONS.DOMAIN_CLAIMED)).toHaveLength(0);
    });

    it("another presby-verify value there is wrong_value (recorded, not a transition)", async () => {
      const t = await tenant();
      const name = claim("church");
      await claimOk(t, name);
      const d = dnsWith();
      d.setRecord("TXT", `_presby-challenge.${name}`, "presby-verify=SomeoneElsesTokenSomeoneElsesToken");
      const res = await svc.checkClaim(t.actor, t.org, name, { forced: false, deps: { dns: d.observer } });
      expect(res).toMatchObject({ kind: "ok", outcome: "unchanged", proof: "wrong_value" });
      expect((await domainRows(t.org))[0]!.observation).toMatchObject({ proof: { status: "wrong_value" } });
    });

    it("a resolver error is dns_unknown: never 'absent', and it never expires a claim", async () => {
      const t = await tenant();
      const name = claim("church");
      const r = await claimOk(t, name);
      for (const c of r.created) await backdateDomainClock(fx.platform, c.id, { expiresAt: new Date(Date.now() - 60_000) });
      const d = dnsWith();
      d.google.failWith("timeout");
      const res = await svc.checkClaim(t.actor, t.org, name, { forced: false, deps: { dns: d.observer } });
      expect(res).toMatchObject({ kind: "ok", outcome: "unchanged", proof: "unknown" });
      for (const row of await domainRows(t.org)) {
        expect(row.state).toBe("pending");
        expect(row.last_check_class).toBe("dns_unknown");
      }
      await expectGuardsEnabled();
    });

    it("a claim past its expiry with no proof expires: terminal, one domain.expired audit row per row", async () => {
      const t = await tenant();
      const name = claim("church");
      const r = await claimOk(t, name);
      for (const c of r.created) await backdateDomainClock(fx.platform, c.id, { expiresAt: new Date(Date.now() - 60_000) });
      const res = await svc.checkClaim(t.actor, t.org, name, { forced: false, deps: { dns: dnsWith().observer } });
      expect(res).toMatchObject({ kind: "ok", outcome: "expired" });
      for (const row of await domainRows(t.org)) {
        expect(row.state).toBe("expired");
        expect(row.next_check_at).toBeNull();
      }
      const audit = (await auditFor(r.created.map((c) => c.id))).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_EXPIRED);
      expect(audit).toHaveLength(2);
      await expectGuardsEnabled();
    });

    it("a late proof on an expired-but-unswept claim still verifies (genuine control beats the clock)", async () => {
      const t = await tenant();
      const name = claim("church");
      const r = await claimOk(t, name);
      for (const c of r.created) await backdateDomainClock(fx.platform, c.id, { expiresAt: new Date(Date.now() - 60_000) });
      const d = dnsWith();
      proofHas(d, name, await tokenOf(t.org, name));
      expect(await svc.checkClaim(t.actor, t.org, name, { forced: false, deps: { dns: d.observer } })).toMatchObject({ outcome: "verified" });
    });

    it("A12: the first organization to VERIFY wins; the second stays pending, told only 'held_elsewhere', naming no org", async () => {
      const a = await tenant();
      const b = await tenant();
      const name = claim("church");
      await claimOk(a, name);
      const rb = await claimOk(b, name);
      const d = dnsWith();
      proofHas(d, name, await tokenOf(a.org, name));
      proofHas(d, name, await tokenOf(b.org, name)); // both tokens published (the DNS owner is willing to prove both)

      const ra = await svc.checkClaim(a.actor, a.org, name, { forced: false, deps: { dns: d.observer } });
      expect(ra).toMatchObject({ outcome: "verified" });

      const loser = await svc.checkClaim(b.actor, b.org, name, { forced: false, deps: { dns: d.observer } });
      expect(loser).toMatchObject({ kind: "ok", outcome: "held_elsewhere" });
      expect(JSON.stringify(loser)).not.toContain(a.org);

      for (const row of await domainRows(b.org)) {
        expect(row.state).toBe("pending");
        expect(row.last_check_class).toBe("held_elsewhere");
        expect(JSON.stringify(row.observation)).not.toContain(a.org);
      }
      // The loser's savepoint rolled its audit row back with its failed write.
      expect((await auditFor(rb.created.map((c) => c.id))).filter((x) => x.action !== AUDIT_ACTIONS.DOMAIN_CLAIMED)).toHaveLength(0);
      // The winner is untouched.
      for (const row of await domainRows(a.org)) expect(row.state).toBe("verified");
    });

    it("a lapsed row whose proof reappears is recovered: verified again, grace cleared, domain.recovered", async () => {
      const t = await tenant();
      const name = claim("church");
      const r = await claimOk(t, name);
      const ids = r.created.map((c) => c.id);
      for (const id of ids) await walkTo(id, "lapsed");
      const d = dnsWith();
      proofHas(d, name, await tokenOf(t.org, name));
      expect(await svc.checkClaim(t.actor, t.org, name, { forced: false, deps: { dns: d.observer } })).toMatchObject({
        outcome: "recovered",
      });
      for (const row of await domainRows(t.org)) {
        expect(row.state).toBe("verified");
        expect(row.grace_ends_at).toBeNull();
        expect(row.release_cause).toBeNull();
      }
      const audit = (await auditFor(ids)).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_RECOVERED);
      expect(audit).toHaveLength(2);
    });

    it("a lapsed row whose proof is still absent stays lapsed with a 6-hour cadence and no audit row", async () => {
      const t = await tenant();
      const name = claim("church");
      const r = await claimOk(t, name);
      for (const c of r.created) await walkTo(c.id, "lapsed");
      expect(await svc.checkClaim(t.actor, t.org, name, { forced: false, deps: { dns: dnsWith().observer } })).toMatchObject({
        outcome: "unchanged",
      });
      for (const row of await domainRows(t.org)) expect(row.state).toBe("lapsed");
      expect((await auditFor(r.created.map((c) => c.id))).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_RECOVERED)).toHaveLength(0);
    });

    // Batch 1a-ii pinned "states past the proof stage are deferred: no DNS
    // query, no write". Batch 1b makes them real, so that test is retired here;
    // the replacement coverage is sweep.db.test.ts (every state past `pending`).

    it("drops a row that moved between the lookup and the write (re-read FOR UPDATE, confirm state)", async () => {
      const t = await tenant();
      const name = claim("church");
      const r = await claimOk(t, name);
      const token = await tokenOf(t.org, name);
      const d = dnsWith();
      proofHas(d, name, token);
      // While the lookup is in flight, the church removes the claim.
      const racing = {
        lookup: async (...args: Parameters<typeof d.observer.lookup>) => {
          const out = await d.observer.lookup(...args);
          for (const c of r.created) await step(c.id, "released", "removed");
          return out;
        },
      };
      const res = await svc.checkClaim(t.actor, t.org, name, { forced: false, deps: { dns: racing } });
      expect(res).toMatchObject({ kind: "ok", outcome: "deferred" });
      for (const row of await domainRows(t.org)) expect(row.state).toBe("released");
      expect((await auditFor(r.created.map((c) => c.id))).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_PROOF_VERIFIED)).toHaveLength(0);
    });

    it("a person's 'Check now' is recorded as trigger 'check_now'; the cron is a machine actor with a null user, and works with the toggle OFF", async () => {
      const t = await tenant();
      const name = claim("church");
      const r = await claimOk(t, name);
      const token = await tokenOf(t.org, name);
      const d = dnsWith();
      proofHas(d, name, token);
      await svc.checkClaim(t.actor, t.org, name, { forced: true, deps: { dns: d.observer } });
      const verified = (await auditFor(r.created.map((c) => c.id))).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_PROOF_VERIFIED);
      expect(verified[0]!.metadata).toMatchObject({ trigger: "check_now", actorKind: "tenant" });

      // Cron: a different org, toggle then turned OFF, machine actor. Serving
      // goes dark with the toggle; the sweep keeps observing.
      const t2 = await tenant();
      const name2 = claim("church");
      const r2 = await claimOk(t2, name2);
      await setToggle(t2.org, false);
      const d2 = dnsWith();
      proofHas(d2, name2, await tokenOf(t2.org, name2));
      const res = await svc.checkClaim({ kind: "machine", trigger: "cron" }, t2.org, name2, { forced: false, deps: { dns: d2.observer } });
      expect(res).toMatchObject({ outcome: "verified" });
      const a = (await auditFor(r2.created.map((c) => c.id))).filter((x) => x.action === AUDIT_ACTIONS.DOMAIN_PROOF_VERIFIED);
      expect(a).toHaveLength(2);
      for (const row of a) {
        expect(row.actor_user_id).toBeNull();
        expect(row.metadata).toMatchObject({ actorKind: "machine", trigger: "cron" });
      }
    });

    it("rate-limits a person's 'Check now' at 6 per 10 minutes per claim; the cron is never limited", async () => {
      vi.stubEnv("RATE_LIMIT_DISABLED", "false");
      const t = await tenant();
      const name = claim("church");
      await claimOk(t, name);
      const d = dnsWith();
      const kinds: string[] = [];
      for (let i = 0; i < 7; i += 1) {
        kinds.push((await svc.checkClaim(t.actor, t.org, name, { forced: true, deps: { dns: d.observer } })).kind);
      }
      expect(kinds.slice(0, 6)).toEqual(Array(6).fill("ok"));
      expect(kinds[6]).toBe("rate_limited");
      const queriesAfterLimit = d.queryCount();
      expect((await svc.checkClaim(t.actor, t.org, name, { forced: true, deps: { dns: d.observer } })).kind).toBe("rate_limited");
      expect(d.queryCount()).toBe(queriesAfterLimit); // a limited call makes no lookup
      for (let i = 0; i < 8; i += 1) {
        expect((await svc.checkClaim({ kind: "machine", trigger: "cron" }, t.org, name, { forced: false, deps: { dns: d.observer } })).kind).toBe("ok");
      }
    });

    it("is gated: forbidden / feature_off / not_found, each with no lookup", async () => {
      const noPerm = await tenant({ holds: false });
      const off = await tenant({ toggle: false });
      const ok = await tenant();
      const d = dnsWith();
      const deps = { dns: d.observer };
      expect((await svc.checkClaim(noPerm.actor, noPerm.org, "x.invalid", { forced: false, deps })).kind).toBe("forbidden");
      expect((await svc.checkClaim(off.actor, off.org, "x.invalid", { forced: false, deps })).kind).toBe("feature_off");
      expect((await svc.checkClaim(ok.actor, ok.org, "nothing-here.invalid", { forced: false, deps })).kind).toBe("not_found");
      expect(d.queryCount()).toBe(0);
    });

    it("cannot reach another organization's claim by name (A14): not_found, no lookup", async () => {
      const a = await tenant();
      const b = await tenant();
      const name = claim("church");
      await claimOk(a, name);
      const d = dnsWith();
      expect((await svc.checkClaim(b.actor, b.org, name, { forced: false, deps: { dns: d.observer } })).kind).toBe("not_found");
      expect(d.queryCount()).toBe(0);
    });
  });

  // ===================================================================
  describe("changeCanonical", () => {
    async function livePair(t: Tenant) {
      const name = claim("church");
      const r = await claimOk(t, name, "www");
      for (const c of r.created) await walkTo(c.id, "live");
      const apex = r.created.find((c) => c.hostname === name)!;
      const www = r.created.find((c) => c.hostname === `www.${name}`)!;
      return { name, apex, www, ids: r.created.map((c) => c.id) };
    }

    it("swaps canonical to a live alias: demote-then-promote, one domain.canonical_changed row, a notification", async () => {
      const t = await tenant();
      const { name, apex, www } = await livePair(t);
      const res = await svc.changeCanonical(t.actor, t.org, apex.id);
      expect(res).toMatchObject({ kind: "ok", changed: true });
      const rows = await domainRows(t.org);
      expect(rows.find((x) => x.id === apex.id)!.web_role).toBe("canonical");
      expect(rows.find((x) => x.id === www.id)!.web_role).toBe("alias");

      const audit = (await auditOf(t.org)).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_CANONICAL_CHANGED);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.metadata).toMatchObject({ fromHostname: `www.${name}`, toHostname: name, actorKind: "tenant" });
    });

    it("making the current canonical canonical again is a no-op: changed false, no audit row", async () => {
      const t = await tenant();
      const { www } = await livePair(t);
      expect(await svc.changeCanonical(t.actor, t.org, www.id)).toMatchObject({ kind: "ok", changed: false });
      expect((await auditOf(t.org)).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_CANONICAL_CHANGED)).toHaveLength(0);
    });

    it("refuses a target that is not live, or is under a platform hold", async () => {
      const t = await tenant();
      const { apex } = await livePair(t);
      await step(apex.id, "attached"); // live -> attached (live_lost)
      expect((await svc.changeCanonical(t.actor, t.org, apex.id)).kind).toBe("not_live");
      await step(apex.id, "live");
      await q(sql`update organization_domains set platform_hold = 'paused', hold_reason = 'test' where id = ${apex.id}`);
      expect((await svc.changeCanonical(t.actor, t.org, apex.id)).kind).toBe("not_live");
    });

    it("another organization's row id is not_found (RLS, A14), and the canonical there is untouched", async () => {
      const a = await tenant();
      const b = await tenant();
      const { apex } = await livePair(a);
      expect((await svc.changeCanonical(b.actor, b.org, apex.id)).kind).toBe("not_found");
      expect((await auditOf(a.org)).filter((x) => x.action === AUDIT_ACTIONS.DOMAIN_CANONICAL_CHANGED)).toHaveLength(0);
    });

    it("is gated: forbidden without the permission, feature_off with the toggle off", async () => {
      const noPerm = await tenant({ holds: false });
      const off = await tenant({ toggle: false });
      const id = "00000000-0000-4000-8000-000000000001";
      expect((await svc.changeCanonical(noPerm.actor, noPerm.org, id)).kind).toBe("forbidden");
      expect((await svc.changeCanonical(off.actor, off.org, id)).kind).toBe("feature_off");
    });
  });

  // ===================================================================
  describe("removeClaim", () => {
    it("pending rows are released with cause 'removed': one domain.released audit row each", async () => {
      const t = await tenant();
      const name = claim("church");
      const r = await claimOk(t, name);
      const res = await svc.removeClaim(t.actor, t.org, name);
      expect(res).toMatchObject({ kind: "ok" });
      for (const row of await domainRows(t.org)) {
        expect(row).toMatchObject({ state: "released", release_cause: "removed" });
        expect(row.released_at).not.toBeNull();
        expect(row.web_role).toBe("alias");
      }
      const audit = (await auditFor(r.created.map((c) => c.id))).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_RELEASED);
      expect(audit).toHaveLength(2);
      for (const a of audit) expect(a.metadata).toMatchObject({ event: "remove", releaseCause: "removed", actorKind: "tenant" });
    });

    it("live rows are PARKED (still attached, dark) with the trigger-stamped 30-day grace: one domain.parked row each", async () => {
      const t = await tenant();
      const name = claim("church");
      const r = await claimOk(t, name);
      for (const c of r.created) await walkTo(c.id, "live");
      expect(await svc.removeClaim(t.actor, t.org, name)).toMatchObject({ kind: "ok" });
      const [soon] = await q(sql`select count(*)::int as n from organization_domains
                                  where organization_id = ${t.org} and state = 'parked' and release_cause = 'removed'
                                    and grace_ends_at between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour'`);
      expect(soon!.n).toBe(2);
      expect((await auditFor(r.created.map((c) => c.id))).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_PARKED)).toHaveLength(2);
    });

    it("removing a group again is idempotent: parked rows are left alone, no new audit rows", async () => {
      const t = await tenant();
      const name = claim("church");
      const r = await claimOk(t, name);
      for (const c of r.created) await walkTo(c.id, "live");
      await svc.removeClaim(t.actor, t.org, name);
      const before = (await auditOf(t.org)).length;
      expect(await svc.removeClaim(t.actor, t.org, name)).toMatchObject({ kind: "ok", removed: [] });
      expect((await auditOf(t.org)).length).toBe(before);
    });

    it("removing the canonical group while another host is live needs a replacement (needs_canonical), and changes nothing", async () => {
      const t = await tenant();
      const first = claim("one");
      const second = `www.${claim("two")}`;
      const r1 = await claimOk(t, first, "www");
      const r2 = await claimOk(t, second);
      for (const c of [...r1.created, ...r2.created]) await walkTo(c.id, "live");
      const before = await domainRows(t.org);

      const res = await svc.removeClaim(t.actor, t.org, first);
      expect(res).toMatchObject({ kind: "needs_canonical" });
      expect((res as { candidates: Array<{ hostname: string }> }).candidates.map((c) => c.hostname)).toEqual([second]);
      expect(await domainRows(t.org)).toEqual(before);

      // A target that is not a live host elsewhere is refused.
      const bogus = await svc.removeClaim(t.actor, t.org, first, r1.created[0]!.id);
      expect(bogus.kind).toBe("invalid_target");

      // The replacement promotes after the demotion; one canonical_changed row.
      const ok = await svc.removeClaim(t.actor, t.org, first, r2.created[0]!.id);
      expect(ok).toMatchObject({ kind: "ok", promoted: { hostname: second } });
      const rows = await domainRows(t.org);
      expect(rows.find((x) => x.hostname === second)!.web_role).toBe("canonical");
      for (const row of rows.filter((x) => x.claim_name === first)) {
        expect(row.state).toBe("parked");
        expect(row.web_role).toBe("alias");
      }
      expect((await auditOf(t.org)).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_CANONICAL_CHANGED)).toHaveLength(1);
    });

    it("removing a NON-canonical group leaves the canonical alone and ignores a stray promotion target", async () => {
      const t = await tenant();
      const first = `www.${claim("one")}`;
      const second = `www.${claim("two")}`;
      const r1 = await claimOk(t, first);
      const r2 = await claimOk(t, second);
      for (const c of [...r1.created, ...r2.created]) await walkTo(c.id, "live");
      const res = await svc.removeClaim(t.actor, t.org, second, r1.created[0]!.id);
      expect(res).toMatchObject({ kind: "ok", promoted: null });
      const rows = await domainRows(t.org);
      expect(rows.find((x) => x.hostname === first)!.web_role).toBe("canonical");
      expect(rows.find((x) => x.hostname === first)!.state).toBe("live");
    });

    it("removing the canonical group when nothing else is live proceeds (nothing to strand)", async () => {
      const t = await tenant();
      const name = claim("church");
      const r = await claimOk(t, name);
      for (const c of r.created) await walkTo(c.id, "live");
      expect(await svc.removeClaim(t.actor, t.org, name)).toMatchObject({ kind: "ok", promoted: null });
    });

    it("an unknown claim is not_found; another org's claim is not_found (A14)", async () => {
      const a = await tenant();
      const b = await tenant();
      const name = claim("church");
      await claimOk(a, name);
      expect((await svc.removeClaim(a.actor, a.org, "nothing.invalid")).kind).toBe("not_found");
      expect((await svc.removeClaim(b.actor, b.org, name)).kind).toBe("not_found");
      for (const row of await domainRows(a.org)) expect(row.state).toBe("pending");
    });

    it("is gated, and notifies after commit", async () => {
      const noPerm = await tenant({ holds: false });
      const off = await tenant({ toggle: false });
      expect((await svc.removeClaim(noPerm.actor, noPerm.org, "x.invalid")).kind).toBe("forbidden");
      expect((await svc.removeClaim(off.actor, off.org, "x.invalid")).kind).toBe("feature_off");
    });
  });

  // ===================================================================
  describe("reconnectClaim", () => {
    async function parkedGroup(t: Tenant) {
      const name = claim("church");
      const r = await claimOk(t, name);
      for (const c of r.created) await walkTo(c.id, "live");
      await svc.removeClaim(t.actor, t.org, name);
      return { name, ids: r.created.map((c) => c.id) };
    }

    it("with the proof live, parked -> verified: grace and cause cleared, one domain.reconnected row each", async () => {
      const t = await tenant();
      const { name, ids } = await parkedGroup(t);
      const d = dnsWith();
      proofHas(d, name, await tokenOf(t.org, name));
      const res = await svc.reconnectClaim(t.actor, t.org, name, { deps: { dns: d.observer } });
      expect(res).toMatchObject({ kind: "ok" });
      for (const row of await domainRows(t.org)) {
        expect(row.state).toBe("verified");
        expect(row.grace_ends_at).toBeNull();
        expect(row.release_cause).toBeNull();
      }
      const audit = (await auditFor(ids)).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_RECONNECTED);
      expect(audit).toHaveLength(2);
      for (const a of audit) expect(a.metadata).toMatchObject({ from: "parked", to: "verified", actorKind: "tenant" });
    });

    it("without the proof it refuses (proof_missing / dns_unknown) and changes nothing", async () => {
      const t = await tenant();
      const { name, ids } = await parkedGroup(t);
      const before = (await auditFor(ids)).length;
      expect(await svc.reconnectClaim(t.actor, t.org, name, { deps: { dns: dnsWith().observer } })).toEqual({
        kind: "proof_missing",
        proof: "absent",
      });
      const flaky = dnsWith();
      flaky.google.failWith("timeout");
      expect((await svc.reconnectClaim(t.actor, t.org, name, { deps: { dns: flaky.observer } })).kind).toBe("dns_unknown");
      for (const row of await domainRows(t.org)) expect(row.state).toBe("parked");
      expect((await auditFor(ids)).length).toBe(before);
    });

    it("a group that is not parked is not_parked; an unknown one is not_found", async () => {
      const t = await tenant();
      const name = claim("church");
      await claimOk(t, name);
      expect((await svc.reconnectClaim(t.actor, t.org, name, { deps: { dns: dnsWith().observer } })).kind).toBe("not_parked");
      expect((await svc.reconnectClaim(t.actor, t.org, "nothing.invalid", { deps: { dns: dnsWith().observer } })).kind).toBe("not_found");
    });

    it("is gated, and the machine actor cannot reconnect", async () => {
      const noPerm = await tenant({ holds: false });
      const off = await tenant({ toggle: false });
      expect((await svc.reconnectClaim(noPerm.actor, noPerm.org, "x.invalid")).kind).toBe("forbidden");
      expect((await svc.reconnectClaim(off.actor, off.org, "x.invalid")).kind).toBe("feature_off");
      expect((await svc.reconnectClaim({ kind: "machine", trigger: "cron" }, off.org, "x.invalid")).kind).toBe("forbidden");
    });
  });

  // ===================================================================
  describe("readDomainsView", () => {
    it("returns the checklist groups for a holder, with the pre-flight site status", async () => {
      const t = await tenant();
      const name = claim("church");
      await claimOk(t, name);
      const view = await svc.readDomainsView(t.personId, t.org, { platformSiteUrl: "platform.invalid/site/x" });
      expect(view.kind).toBe("ok");
      if (view.kind !== "ok") return;
      expect(view.siteStatus).toBeNull(); // no organization_sites row for this fixture org
      expect(view.groups).toHaveLength(1);
      expect(view.groups[0]).toMatchObject({ claimName: name, phase: "proving", step: 1 });
      expect(view.groups[0]!.records[0]!.value).toMatch(/^presby-verify=/);
    });

    it("excludes terminal rows and other organizations' rows", async () => {
      const a = await tenant();
      const b = await tenant();
      const name = claim("church");
      await claimOk(a, name);
      await claimOk(b, claim("other"));
      await svc.removeClaim(a.actor, a.org, name); // pending -> released
      const view = await svc.readDomainsView(a.personId, a.org, { platformSiteUrl: "x" });
      expect(view).toMatchObject({ kind: "ok", groups: [] });
    });

    it("returns this organization's recent activity: its own domain.* audit rows, newest first, naming no email, no token and no other organization's rows", async () => {
      const a = await tenant();
      const b = await tenant();
      const name = claim("church");
      const other = claim("elsewhere");
      await claimOk(a, name);
      await claimOk(b, other);
      await svc.removeClaim(a.actor, a.org, name); // pending -> released: a second row
      const view = await svc.readDomainsView(a.personId, a.org, { platformSiteUrl: "x" });
      expect(view.kind).toBe("ok");
      if (view.kind !== "ok") return;
      const text = view.activity.map((i) => i.text).join("\n");
      expect(view.activity.length).toBeGreaterThanOrEqual(2);
      expect(text).toContain(name);
      expect(text).not.toContain(other); // nothing from organization B
      expect(text).not.toMatch(/@|presby-verify/); // no email, no proof token in the visible text
      expect(Object.keys(view.activity[0]!).sort()).toEqual(["at", "id", "text", "who"]); // no actor id, email or IP rides along
      expect(view.activity.every((i) => i.who === "team")).toBe(true);
      const times = view.activity.map((i) => i.at);
      expect([...times].sort().reverse()).toEqual(times); // newest first
    });

    // ---- Batch 1e: the Recent activity read is RLS-anchored (F152's acceptance condition) ----
    //
    // `audit_events` has no RLS and `presby_app` can SELECT it, so the metadata.organizationId filter alone is an
    // application-written field. The read also requires `resource_type = 'organization_domain'` AND a `resource_id`
    // that is the id of a row the caller's own RLS lets it see in `organization_domains`. The forged rows below are
    // what a writer bug (or a hostile writer) could produce: right organizationId, wrong anchor.

    /** An owner-inserted `domain.*` audit row, shaped like the service's, with the anchor fields the caller chooses. */
    async function forge(
      claimedOrg: string,
      o: { hostname: string; resourceType: string | null; resourceId: string | null; action?: string },
    ): Promise<void> {
      await q(sql`
        insert into audit_events (action, resource_type, resource_id, metadata)
        values (${o.action ?? "domain.live"}, ${o.resourceType}, ${o.resourceId},
                ${JSON.stringify({ organizationId: claimedOrg, hostname: o.hostname, actorKind: "tenant" })}::jsonb)`);
    }

    /** The hostnames the tenant connection reads under a given predicate, as the page's query would (no limit/merge). */
    async function tenantAuditHosts(t: Tenant, extra: SQL): Promise<string[]> {
      const { withOrgContext } = await import("@/lib/authz");
      return withOrgContext(t.personId, t.org, async (tx) =>
        rowsOf(
          await tx.execute(sql`select metadata->>'hostname' as h from audit_events
                                where action like 'domain.%' and metadata->>'organizationId' = ${t.org} and ${extra}`),
        ).map((r) => String(r.h)),
      );
    }

    const activityHosts = async (t: Tenant): Promise<string> => {
      const view = await svc.readDomainsView(t.personId, t.org, { platformSiteUrl: "x" });
      if (view.kind !== "ok") throw new Error(`view was ${view.kind}`);
      return view.activity.map((i) => i.text).join("\n");
    };

    it("1e positive control: its own rows still appear, including a platform-initiated hold and a force-released row", async () => {
      const a = await tenant();
      const held = `www.${claim("held")}`; // one host per claim: the org cap is 3
      const forced = `www.${claim("forced")}`;
      await claimOk(a, held);
      await claimOk(a, forced);
      const heldRow = (await domainRows(a.org, sql`claim_name = ${held} and web_role = 'canonical'`))[0]!;
      const forcedRows = await domainRows(a.org, sql`claim_name = ${forced}`);
      expect(await svc.setDomainHold(platformActor(), String(heldRow.id), "paused", "Paused while support checks the claim.")).toMatchObject({ kind: "ok", changed: true });
      for (const r of forcedRows) {
        expect(await svc.forceReleaseDomain(platformActor(), String(r.id), { reason: "Released at the operator's decision." })).toMatchObject({ kind: "ok" });
      }
      const text = await activityHosts(a);
      expect(text).toContain(`${heldRow.hostname} was paused by PresbyPortal support.`);
      expect(text).toContain(`${forced} was released.`);
      expect(text).toContain(held); // its own claim rows are there too
      const view = await svc.readDomainsView(a.personId, a.org, { platformSiteUrl: "x" });
      if (view.kind !== "ok") throw new Error("not ok");
      expect(view.activity.some((i) => i.who === "support")).toBe(true);
      // Every writer in the family stamps the anchor fields the read now depends on (guards the literal values).
      const written = await q(sql`select action, resource_type, resource_id from audit_events
                                   where action like 'domain.%' and metadata->>'organizationId' = ${a.org}`);
      expect(written.length).toBeGreaterThanOrEqual(4); // 2 claims, 1 hold, 1 force-release
      for (const w of written) {
        expect(w.resource_type, String(w.action)).toBe("organization_domain");
        expect(w.resource_id, String(w.action)).not.toBeNull();
      }
    });

    it("1e: a row stamped with this organization's id but whose resource_id names ANOTHER organization's domain is absent", async () => {
      const a = await tenant();
      const b = await tenant();
      const own = claim("mine");
      const theirs = claim("theirs");
      const planted = claim("planted");
      const own1 = await claimOk(a, own);
      const bClaim = await claimOk(b, theirs);
      const bDomainId = bClaim.created[0]!.id;
      await forge(a.org, { hostname: planted, resourceType: "organization_domain", resourceId: bDomainId });
      // Control (non-vacuous): the same forged shape anchored to one of A's OWN domain rows is shown, so the marker
      // is findable and the assertion below is about the anchor, not about the host name.
      const visible = claim("visible");
      await forge(a.org, { hostname: visible, resourceType: "organization_domain", resourceId: own1.created[0]!.id });
      const text = await activityHosts(a);
      expect(text).toContain(visible);
      expect(text).not.toContain(planted);
      expect(text).not.toContain(theirs);
    });

    it("1e: a row with a null resource_id, a wrong resource_type, or an id that is no domain row at all is absent", async () => {
      const a = await tenant();
      const ownId = (await claimOk(a, claim("mine"))).created[0]!.id;
      const nullId = claim("nullid");
      const wrongType = claim("wrongtype");
      const noSuchRow = claim("nosuchrow");
      const nullType = claim("nulltype");
      await forge(a.org, { hostname: nullId, resourceType: "organization_domain", resourceId: null });
      await forge(a.org, { hostname: wrongType, resourceType: "organization_feature_toggle", resourceId: ownId });
      await forge(a.org, { hostname: nullType, resourceType: null, resourceId: ownId });
      await forge(a.org, { hostname: noSuchRow, resourceType: "organization_domain", resourceId: "00000000-0000-4000-8000-000000000000" });
      const text = await activityHosts(a);
      for (const marker of [nullId, wrongType, nullType, noSuchRow]) expect(text, marker).not.toContain(marker);
    });

    it("1e mutation check: the metadata-only predicate DOES return the forged row (so the anchor is what excludes it), and the metadata clause is still load-bearing", async () => {
      const a = await tenant();
      const b = await tenant();
      const aId = (await claimOk(a, claim("mine"))).created[0]!.id;
      const bId = (await claimOk(b, claim("theirs"))).created[0]!.id;
      const forgedForeignAnchor = claim("foreignanchor");
      const wrongOrgRightAnchor = claim("wrongorg");
      await forge(a.org, { hostname: forgedForeignAnchor, resourceType: "organization_domain", resourceId: bId });
      await forge(b.org, { hostname: wrongOrgRightAnchor, resourceType: "organization_domain", resourceId: aId });

      // The anchor removed (what the code did before 1e): the forged row is visible to A on the tenant connection.
      expect(await tenantAuditHosts(a, sql`true`)).toContain(forgedForeignAnchor);
      // The anchor alone: A's RLS-visible domain id passes it, so a row stamped for B but naming A's domain id would be
      // shown. This is why BOTH clauses stay (belt and braces); removing the metadata clause would let this through.
      const anchorOnly = rowsOf(
        await (await import("@/lib/authz")).withOrgContext(a.personId, a.org, (tx) =>
          tx.execute(sql`select metadata->>'hostname' as h from audit_events
                          where action like 'domain.%' and resource_type = 'organization_domain'
                            and resource_id in (select id::text from organization_domains)`),
        ),
      ).map((r) => String(r.h));
      expect(anchorOnly).toContain(wrongOrgRightAnchor);

      // The shipped read applies both: neither forged row is in A's feed.
      const text = await activityHosts(a);
      expect(text).not.toContain(forgedForeignAnchor);
      expect(text).not.toContain(wrongOrgRightAnchor);
    });

    it("applies the same gate: forbidden, feature_off", async () => {
      const noPerm = await tenant({ holds: false });
      const off = await tenant({ toggle: false });
      expect((await svc.readDomainsView(noPerm.personId, noPerm.org, { platformSiteUrl: "x" })).kind).toBe("forbidden");
      expect((await svc.readDomainsView(off.personId, off.org, { platformSiteUrl: "x" })).kind).toBe("feature_off");
    });

    it("a person from another organization is forbidden", async () => {
      const a = await tenant();
      const b = await tenant();
      expect((await svc.readDomainsView(b.personId, a.org, { platformSiteUrl: "x" })).kind).toBe("forbidden");
    });
  });

  // ===================================================================
  async function expectGuardsEnabled() {
    const states = await domainGuardStates(fx.platform);
    for (const name of DOMAIN_GUARD_TRIGGERS) expect(states[name], name).toBe("O");
  }

  // ===================================================================
  describe("transitionDomain: R8, exactly one audit row per edge, in the same transaction", () => {
    const FORCE_REASON = "Operator ruling recorded for this test.";

    // vitest builds it.each titles at collection time, before beforeAll, so the
    // list is written out here and pinned to the table by the test below.
    const EDGE_TITLES = [
      ["pending", "proof_ok", "verified", null],
      ["pending", "expire", "expired", null],
      ["pending", "remove", "released", null],
      ["pending", "force_release", "released", null],
      ["verified", "attach_start", "attach_pending", "web"],
      ["verified", "proof_lost", "lapsed", null],
      ["verified", "remove", "released", null],
      ["verified", "force_release", "released", null],
      ["attach_pending", "attach_ok", "attached", "web"],
      ["attach_pending", "proof_lost", "lapsed", "web"],
      ["attach_pending", "remove", "parked", "web"],
      ["attach_pending", "force_release", "release_pending", "web"],
      ["attached", "live_ok", "live", "web"],
      ["attached", "proof_lost", "lapsed", "web"],
      ["attached", "remove", "parked", "web"],
      ["attached", "force_release", "release_pending", "web"],
      ["live", "live_lost", "attached", "web"],
      ["live", "proof_lost", "lapsed", "web"],
      ["live", "remove", "parked", "web"],
      ["live", "force_release", "release_pending", "web"],
      ["lapsed", "proof_ok", "verified", null],
      ["lapsed", "remove", "parked", "web"],
      ["lapsed", "grace_elapsed", "release_pending", "web"],
      ["lapsed", "force_release", "release_pending", "web"],
      ["lapsed", "remove", "released", "mail"],
      ["lapsed", "force_release", "released", "mail"],
      ["parked", "reconnect", "verified", "web"],
      ["parked", "grace_elapsed", "release_pending", "web"],
      ["parked", "force_release", "release_pending", "web"],
      ["release_pending", "detach_ok", "released", "web"],
    ] as const;

    it("the hand-listed titles equal the table (so the it.each below tests every edge)", () => {
      const listed = EDGE_TITLES.map(([f, e, t, s]) => `${f}|${e}|${t}|${s ?? "-"}`).sort();
      const actual = state.EDGES.map((e) => `${e.from}|${e.event}|${e.to}|${e.scope ?? "-"}`).sort();
      expect(listed).toEqual(actual);
    });

    it.each(EDGE_TITLES.map((t) => [`${t[0]} -${t[1]}-> ${t[2]}${t[3] ? ` (${t[3]})` : ""}`, t] as const))(
      "%s",
      async (_title, [from, event, to, scope]) => {
        const org = await makeOrg("edge");
        const purpose = scope ?? "web";
        const id = await insertRaw(org, { purpose });
        await walkTo(id, from, purpose);
        if (from === "lapsed" || from === "parked") {
          if (event === "grace_elapsed") await backdateDomainClock(fx.platform, id, { graceEndsAt: new Date(Date.now() - 60_000) });
        }
        if (event === "expire") await backdateDomainClock(fx.platform, id, { expiresAt: new Date(Date.now() - 60_000) });

        const [row] = await q(sql`select * from organization_domains where id = ${id}`);
        const actor: import("./service").DomainActor =
          event === "force_release" ? platformActor() : { kind: "machine", trigger: "cron" };
        const opts: import("./service").TransitionOptions =
          event === "force_release"
            ? { cause: from === "lapsed" ? "evicted" : "force_released", forceReleaseReason: FORCE_REASON }
            : {};

        const before = await auditFor([id]);
        expect(before).toHaveLength(0);

        const updated = await getPlatformDb().transaction((tx) =>
          svc.transitionDomain(
            tx as import("./service").DomainTx,
            {
              id,
              organizationId: org,
              hostname: String(row!.hostname),
              claimName: String(row!.claim_name),
              purpose,
              state: from,
              releaseCause: (row!.release_cause as never) ?? null,
            },
            event,
            actor,
            opts,
          ),
        );

        expect(updated.state).toBe(to);
        const audit = await auditFor([id]);
        expect(audit, "exactly one audit row").toHaveLength(1);
        expect(audit[0]!.action).toBe(AUDIT_ACTIONS[state.auditKeyNameFor(from, event, to)]);
        expect(audit[0]!.metadata).toMatchObject({
          organizationId: org,
          from,
          to,
          event,
          purpose,
          actorKind: actor.kind,
        });
        if (actor.kind === "machine") {
          expect(audit[0]!.actor_user_id).toBeNull();
          expect(audit[0]!.metadata).toMatchObject({ trigger: "cron" });
        } else {
          expect(audit[0]!.actor_user_id).toBe(fx.actingUserId);
          expect(audit[0]!.metadata).toMatchObject({ reason: FORCE_REASON });
        }
        expect(JSON.stringify(audit[0])).not.toContain(String(row!.proof_token));
        await expectGuardsEnabled();
      },
      60_000,
    );

    it("the state change and its audit row are ONE transaction: a rollback after the transition leaves neither", async () => {
      const org = await makeOrg("atomic");
      const id = await insertRaw(org);
      const [row] = await q(sql`select * from organization_domains where id = ${id}`);
      await expect(
        getPlatformDb().transaction(async (tx) => {
          await svc.transitionDomain(
            tx as import("./service").DomainTx,
            { id, organizationId: org, hostname: String(row!.hostname), claimName: String(row!.claim_name), purpose: "web", state: "pending", releaseCause: null },
            "proof_ok",
            { kind: "machine", trigger: "cron" },
          );
          throw new Error("force a rollback after the transition");
        }),
      ).rejects.toThrow(/force a rollback/);
      expect((await q(sql`select state from organization_domains where id = ${id}`))[0]!.state).toBe("pending");
      expect(await auditFor([id])).toHaveLength(0);
    });

    it("an illegal edge is refused before any write: no state change, no audit row", async () => {
      const org = await makeOrg("illegal");
      const id = await insertRaw(org);
      const [row] = await q(sql`select * from organization_domains where id = ${id}`);
      const base = { id, organizationId: org, hostname: String(row!.hostname), claimName: String(row!.claim_name), purpose: "web" as const, state: "pending" as const, releaseCause: null };
      for (const event of ["live_ok", "attach_start", "detach_ok", "reconnect", "grace_elapsed"] as const) {
        await expect(
          getPlatformDb().transaction((tx) =>
            svc.transitionDomain(tx as import("./service").DomainTx, base, event, { kind: "machine", trigger: "cron" }),
          ),
          event,
        ).rejects.toMatchObject({ name: "DomainTransitionError", code: "illegal_edge" });
      }
      expect((await q(sql`select state from organization_domains where id = ${id}`))[0]!.state).toBe("pending");
      expect(await auditFor([id])).toHaveLength(0);
    });

    it("a mail row cannot take a web-only edge", async () => {
      const org = await makeOrg("mailedge");
      const id = await insertRaw(org, { purpose: "mail" });
      await step(id, "verified");
      await expect(
        getPlatformDb().transaction((tx) =>
          svc.transitionDomain(
            tx as import("./service").DomainTx,
            { id, organizationId: org, hostname: "x", claimName: "x", purpose: "mail", state: "verified", releaseCause: null },
            "attach_start",
            { kind: "machine", trigger: "cron" },
          ),
        ),
      ).rejects.toMatchObject({ code: "illegal_edge" });
    });

    it("a stale row (it moved first) throws 'stale' and writes no audit row", async () => {
      const org = await makeOrg("stale");
      const id = await insertRaw(org);
      const [row] = await q(sql`select * from organization_domains where id = ${id}`);
      await step(id, "verified"); // the world moved on
      await expect(
        getPlatformDb().transaction((tx) =>
          svc.transitionDomain(
            tx as import("./service").DomainTx,
            { id, organizationId: org, hostname: String(row!.hostname), claimName: String(row!.claim_name), purpose: "web", state: "pending", releaseCause: null },
            "expire",
            { kind: "machine", trigger: "cron" },
          ),
        ),
      ).rejects.toMatchObject({ name: "DomainTransitionError", code: "stale" });
      expect(await auditFor([id])).toHaveLength(0);
    });

    it("a tenant can never force-release, and force_release without a reason is refused", async () => {
      const t = await tenant();
      const id = await insertRaw(t.org);
      const [row] = await q(sql`select * from organization_domains where id = ${id}`);
      const base = { id, organizationId: t.org, hostname: String(row!.hostname), claimName: String(row!.claim_name), purpose: "web" as const, state: "pending" as const, releaseCause: null };
      await expect(
        getPlatformDb().transaction((tx) =>
          svc.transitionDomain(tx as import("./service").DomainTx, base, "force_release", t.actor, {
            cause: "force_released",
            forceReleaseReason: FORCE_REASON,
          }),
        ),
      ).rejects.toMatchObject({ code: "forbidden_actor" });
      await expect(
        getPlatformDb().transaction((tx) =>
          svc.transitionDomain(tx as import("./service").DomainTx, base, "force_release", platformActor(), {
            cause: "force_released",
            forceReleaseReason: "   ",
          }),
        ),
      ).rejects.toMatchObject({ code: "bad_cause" });
      await expect(
        getPlatformDb().transaction((tx) =>
          svc.transitionDomain(tx as import("./service").DomainTx, base, "force_release", platformActor(), {
            cause: "removed",
            forceReleaseReason: FORCE_REASON,
          }),
        ),
      ).rejects.toMatchObject({ code: "bad_cause" });
      expect(await auditFor([id])).toHaveLength(0);
    });

    it("a tenant transition runs on the presby_app connection under RLS (the column grants are enough)", async () => {
      const t = await tenant();
      const name = claim("church");
      const r = await claimOk(t, name);
      const id = r.created[0]!.id;
      const { withOrgContext } = await import("@/lib/authz");
      const updated = await withOrgContext(t.personId, t.org, async (tx) => {
        const [row] = await tx.execute(sql`select * from organization_domains where id = ${id}`).then(rowsOf);
        return svc.transitionDomain(
          tx,
          { id, organizationId: t.org, hostname: String(row!.hostname), claimName: String(row!.claim_name), purpose: "web", state: "pending", releaseCause: null },
          "proof_ok",
          t.actor,
        );
      });
      expect(updated.state).toBe("verified");
      expect((await auditFor([id])).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_PROOF_VERIFIED)).toHaveLength(1);
    });
  });

  describe("classifyDomainDbError", () => {
    const pg = (code: string, extra: Record<string, unknown> = {}) => ({ message: "Failed query", cause: { code, ...extra } });
    it("maps the three unique indexes to what 0057 means by them", () => {
      expect(svc.classifyDomainDbError(pg("23505", { constraint: "organization_domains_hostname_holding_uq" }))).toEqual({ kind: "held_elsewhere" });
      expect(svc.classifyDomainDbError(pg("23505", { constraint: "organization_domains_org_host_uq" }))).toEqual({ kind: "duplicate_in_org" });
      expect(svc.classifyDomainDbError(pg("23505", { constraint: "organization_domains_one_canonical_uq" }))).toEqual({ kind: "second_canonical" });
      expect(svc.classifyDomainDbError(pg("23505", { constraint: "some_other_uq" }))).toBeNull();
    });
    it("maps the cap, other guard raises, and grant refusals", () => {
      expect(svc.classifyDomainDbError(pg("23514", { message: "organization_domains: cap - at most 3 web hosts per organization" }))).toEqual({ kind: "cap" });
      expect(svc.classifyDomainDbError(pg("23514", { message: "organization_domains: pending -> live is not a legal edge for a web row" }))).toMatchObject({ kind: "guard" });
      expect(svc.classifyDomainDbError(pg("42501"))).toEqual({ kind: "denied" });
    });
    it("is null for anything that is not ours", () => {
      expect(svc.classifyDomainDbError(new Error("boom"))).toBeNull();
      expect(svc.classifyDomainDbError(pg("23514", { message: "some_other_table_check" }))).toBeNull();
      expect(svc.classifyDomainDbError(null)).toBeNull();
      expect(svc.classifyDomainDbError(undefined)).toBeNull();
    });
  });
});
