/**
 * The Batch 1b DB gate: the domain lifecycle past `pending`, driven through the
 * cron sweep and "Check now" on a REAL Postgres connection (the pipeline's Neon
 * branch), with the fake DNS / hosting / probe adapters. No Vercel, Resend or
 * public-DNS call is ever made.
 *
 * WHAT THIS FILE PROVES (the per-transition audit coverage `check:audit`
 * cannot see - the cron route and service.ts are invisible to it, R8):
 *   - every edge Batch 1b DRIVES is taken by the sweep with EXACTLY ONE audit
 *     row, the machine actor (null user, `metadata.trigger = "cron"`), and no
 *     proof token anywhere;
 *   - the debounce: a single miss, an `unknown`, a flapping resolver never
 *     transition; a lapse needs six consecutive definitive misses over 10 h;
 *   - no provider call without the proof; provider failures keep the row where
 *     it is, back off, and alert the operator once;
 *   - the sweep is idempotent and a second concurrent sweep cannot take a row
 *     the first holds (the lease and `skip locked`);
 *   - reconciliation of `attach_pending` / `release_pending` after a "crash";
 *   - canonical promotion (the 1a-ii deviation 6 ruling);
 *   - the platform operations (pause, resume, force-release).
 *
 * Every state is reached by walking legal edges as the OWNER (the trigger binds
 * the owner too); a past clock comes only from the one sanctioned seam,
 * `backdateDomainClock`. Hosts are unique `*.invalid` names per run.
 *
 * Run serially, per docs/testing.md:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/domains/sweep.db.test.ts
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

// Hundreds of round trips to a remote Neon branch: raise the file's timeouts only.
//
// `retry: 1`: the Neon websocket pool intermittently drops a connection
// ("Connection terminated unexpectedly" - recorded by the 1a-i, 1a-ii and
// giving pipelines too), which fails whichever test happens to be mid-sweep.
// Every test here builds its own organizations and `*.invalid` hosts, so a
// second attempt starts clean; a real defect fails both attempts. The two tests
// that exist to catch RACES (the concurrent sweeps and the `skip locked` row)
// opt out with `retry: 0` so a timing bug can never be retried away.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

describe.skipIf(!hasDb)("the domain lifecycle past pending, via the sweep (Postgres-backed)", { retry: 1 }, () => {
  let fx: CalendarFixture;
  let svc: typeof import("./service");
  let fakeMod: typeof import("./adapters/fake");
  let policyMod: typeof import("./policy");
  let AUDIT_ACTIONS: typeof import("@/lib/audit").AUDIT_ACTIONS;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let hostCounter = 0;
  const orgIds: string[] = [];
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  const claim = (label: string) => {
    hostCounter += 1;
    return `${label}-${stamp}-${hostCounter}.invalid`;
  };
  const rowsOf = (result: unknown): Row[] => {
    const r = result as { rows?: Row[] } | Row[];
    return Array.isArray(r) ? r : (r.rows ?? []);
  };
  const q = async (query: SQL): Promise<Row[]> => rowsOf(await fx.platform.execute(query));
  const textList = (ids: string[]) => sql.raw(`array[${ids.map((i) => `'${i}'`).join(",")}]::text[]`);

  beforeAll(async () => {
    vi.stubEnv("DOMAINS_ALLOW_RESERVED_TLDS", "1");
    svc = await import("./service");
    fakeMod = await import("./adapters/fake");
    policyMod = await import("./policy");
    ({ AUDIT_ACTIONS } = await import("@/lib/audit"));
    ({ getPlatformDb } = await import("@/lib/db"));
    const mod = await import("@/lib/testing/calendar-fixture");
    fx = await mod.createCalendarFixture("domains-sweep");
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!fx) return;
    if (orgIds.length > 0) {
      await q(sql`delete from audit_events where metadata->>'organizationId' = any(${sql.raw(
        `array[${orgIds.map((i) => `'${i}'`).join(",")}]::text[]`,
      )})`);
    }
    // The fixture's teardown is idempotent (deleting what is already gone is a
    // no-op), so a dropped Neon connection at the very end of a long run is
    // simply retried rather than turning an all-green run red.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await fx.cleanup();
        return;
      } catch (err) {
        if (attempt >= 3) throw err;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
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

  async function setToggle(org: string, enabled: boolean) {
    await q(sql`insert into organization_feature_toggles (organization_id, feature_key, enabled)
                values (${org}, 'org_portal.domains', ${enabled})
                on conflict (organization_id, feature_key) do update set enabled = ${enabled}`);
  }

  interface Tenant {
    org: string;
    personId: string;
    actor: import("./service").DomainActor;
  }

  /** An org with the toggle on and one member holding domains.manage. */
  async function tenant(): Promise<Tenant> {
    const org = await makeOrg("t");
    await setToggle(org, true);
    const personId = await fx.makePerson("Dom", "Holder");
    await fx.enroll(org, personId, ["domains.manage"]);
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
  const machine: import("./service").DomainActor = { kind: "machine", trigger: "cron" };

  interface World {
    dns: ReturnType<typeof fakeMod.createFakeDns>;
    hosting: InstanceType<typeof fakeMod.FakeHosting>;
    probe: InstanceType<typeof fakeMod.FakeProbe>;
    clock: { t: number };
    deps: import("./service").DomainServiceDeps;
  }

  /** Fresh fakes and a controllable application clock. */
  function world(): World {
    const dns = fakeMod.createFakeDns();
    const hosting = new fakeMod.FakeHosting();
    const probe = new fakeMod.FakeProbe();
    const clock = { t: Date.now() };
    return { dns, hosting, probe, clock, deps: { dns: dns.observer, hosting, probe, now: () => new Date(clock.t) } };
  }

  async function domainRows(org: string, where: SQL = sql`true`): Promise<Row[]> {
    return q(sql`select * from organization_domains where organization_id = ${org} and ${where} order by hostname`);
  }
  const stateOf = async (id: string) => String((await q(sql`select state from organization_domains where id = ${id}`))[0]!.state);

  async function auditFor(ids: string[]): Promise<Row[]> {
    if (ids.length === 0) return [];
    return q(sql`select action, actor_user_id, actor_email, metadata, resource_id
                   from audit_events
                  where resource_type = 'organization_domain' and resource_id = any(${textList(ids)})
                  order by created_at, action`);
  }
  /** The audit actions for one row, oldest first. */
  async function trail(id: string): Promise<string[]> {
    return (await auditFor([id])).map((a) => String(a.action));
  }

  async function tokenOf(org: string, claimName: string): Promise<string> {
    const [r] = await q(sql`select proof_token from organization_domains where organization_id = ${org} and claim_name = ${claimName} limit 1`);
    return String(r!.proof_token);
  }

  /** Marks every live (non-terminal) row of the org due now. */
  async function makeDue(org: string) {
    await q(sql`update organization_domains set next_check_at = now() - interval '1 minute'
                 where organization_id = ${org} and state not in ('expired','released')`);
  }

  async function sweep(w: World, orgs: string[], opts: { limit?: number; concurrency?: number } = {}) {
    return svc.sweepDueDomains({ organizationIds: orgs, deps: w.deps, ...opts });
  }
  /** Make everything due, advance the clock, sweep, return the summary. */
  async function tick(w: World, org: string, advanceMs = 0) {
    w.clock.t += advanceMs;
    await makeDue(org);
    return sweep(w, [org]);
  }

  async function claimOk(t: Tenant, domain: string, canonical: "www" | "apex" = "www") {
    const r = await svc.claimDomain(t.actor, t.org, { domain, canonical });
    if (r.kind !== "ok") throw new Error(`claim failed: ${r.kind}`);
    return r;
  }

  const proofName = (name: string) => `_presby-challenge.${name}`;
  function publishProof(w: World, name: string, token: string) {
    w.dns.setRecord("TXT", proofName(name), `presby-verify=${token}`);
  }
  /** Realistic routing: apex A at the fake provider's recommended address, www CNAME at its target. */
  function pointDns(w: World, name: string) {
    // A real apex is a zone apex: an SOA answers at the exact name (that is how the checks tell it from a subdomain).
    w.dns.setRecord("SOA", name, "ns1.dns-host.invalid hostmaster.invalid 1 7200 3600 1209600 300");
    w.dns.setRecord("A", name, "192.0.2.10");
    w.dns.setRecord("CNAME", `www.${name}`, "cname.vercel-dns.invalid");
  }

  /** A pair (apex + www) claimed by a tenant, proof published, DNS pointed, probe acknowledging. */
  async function readyPair(t: Tenant, w: World, label = "church") {
    const name = claim(label);
    const r = await claimOk(t, name);
    const token = await tokenOf(t.org, name);
    publishProof(w, name, token);
    pointDns(w, name);
    for (const c of r.created) w.probe.set(c.hostname, "ack");
    return { name, token, ids: r.created.map((c) => c.id), hosts: r.created.map((c) => c.hostname) };
  }

  /** Walk legal edges as the owner, for arranging a state without the sweep. */
  async function step(id: string, to: string, cause?: string, reason?: string) {
    if (reason !== undefined) {
      await q(sql`update organization_domains set state = ${to}, release_cause = ${cause ?? null}, force_release_reason = ${reason} where id = ${id}`);
    } else if (cause !== undefined) {
      await q(sql`update organization_domains set state = ${to}, release_cause = ${cause} where id = ${id}`);
    } else {
      await q(sql`update organization_domains set state = ${to} where id = ${id}`);
    }
  }
  async function walkTo(id: string, target: string) {
    const paths: Record<string, Array<[string, string?, string?]>> = {
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
    const path = paths[target];
    if (!path) throw new Error(`no path to ${target}`);
    for (const [to, cause, reason] of path) await step(id, to, cause, reason);
  }
  async function expectGuardsEnabled() {
    const states = await domainGuardStates(fx.platform);
    for (const name of DOMAIN_GUARD_TRIGGERS) expect(states[name], name).toBe("O");
  }

  const emails = () => mockEnqueue.mock.calls.map((c) => c[0] as { to: string; subject: string; text: string; html: string; templateKey: string });
  const subjectsLike = (re: RegExp) => emails().filter((e) => re.test(e.subject));

  // ===================================================================
  describe("the whole lifecycle through the sweep (the cron walk)", () => {
    it("pending -> verified -> attach_pending -> attached -> live -> lapsed -> release_pending -> released, one audit row per edge, all by the machine", async () => {
      const t = await tenant();
      const w = world();
      const p = await readyPair(t, w);
      const [www] = (await domainRows(t.org, sql`hostname like 'www.%'`)).map((r) => String(r.id));

      // No provider call can happen before the proof has been seen.
      expect(w.hosting.calls).toHaveLength(0);

      // Tick 1: the proof is there -> verified (and nothing is attached yet).
      await tick(w, t.org);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["verified", "verified"]);
      expect(w.hosting.calls).toHaveLength(0);

      // Tick 2: verified -> attach_pending (committed) -> the provider call -> attached, in ONE sweep.
      await tick(w, t.org);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["attached", "attached"]);
      expect(w.hosting.callsOf("add").sort()).toEqual([...p.hosts].sort());

      // Tick 3: the probe acks -> live.
      await tick(w, t.org);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["live", "live"]);

      for (const id of p.ids) {
        expect(await trail(id)).toEqual([
          AUDIT_ACTIONS.DOMAIN_CLAIMED,
          AUDIT_ACTIONS.DOMAIN_PROOF_VERIFIED,
          AUDIT_ACTIONS.DOMAIN_ATTACH_REQUESTED,
          AUDIT_ACTIONS.DOMAIN_ATTACHED,
          AUDIT_ACTIONS.DOMAIN_LIVE,
        ]);
      }
      // Machine transitions: a null actor and metadata.trigger = cron; claims carry the tenant.
      const transitions = (await auditFor(p.ids)).filter((a) => a.action !== AUDIT_ACTIONS.DOMAIN_CLAIMED);
      expect(transitions).toHaveLength(8);
      for (const a of transitions) {
        expect(a.actor_user_id).toBeNull();
        expect(a.metadata).toMatchObject({ actorKind: "machine", trigger: "cron" });
        expect(JSON.stringify(a)).not.toContain(p.token);
      }
      // The www host stayed canonical and nothing was "promoted".
      expect((await domainRows(t.org, sql`web_role = 'canonical'`)).map((r) => r.hostname)).toEqual([`www.${p.name}`]);

      // Lapse: take the proof away. Six definitive misses, two hours apart, span 10 hours.
      w.dns.clearRecords("TXT", proofName(p.name));
      for (let i = 0; i < 5; i += 1) {
        await tick(w, t.org, 2 * HOUR);
        expect((await domainRows(t.org)).map((r) => r.state), `miss ${i + 1}`).toEqual(["live", "live"]);
      }
      await tick(w, t.org, 2 * HOUR);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["lapsed", "lapsed"]);
      for (const row of await domainRows(t.org)) {
        expect(row.grace_ends_at).not.toBeNull();
        expect(Number(new Date(String(row.grace_ends_at))) - Date.now()).toBeGreaterThan(29 * DAY);
      }
      for (const id of p.ids) expect((await trail(id)).slice(-1)).toEqual([AUDIT_ACTIONS.DOMAIN_LAPSED]);
      // The first miss emailed once per recipient (not once per miss, not once per row); the lapse emailed too. All account-class.
      const firstMiss = subjectsLike(/can't find a domain's ownership record/i);
      const recipients = new Set(firstMiss.map((e) => e.to));
      expect(firstMiss.length).toBe(recipients.size);
      expect(recipients.size).toBeGreaterThan(0);
      expect(subjectsLike(/can no longer verify a domain/i).length).toBe(recipients.size);
      for (const e of emails()) expect(e.templateKey).toBe("domain_notification");

      // Grace elapses -> release_pending (cause lapsed_grace), then the detach -> released.
      for (const id of p.ids) await backdateDomainClock(fx.platform, id, { graceEndsAt: new Date(Date.now() - 60_000) });
      await tick(w, t.org, HOUR);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["release_pending", "release_pending"]);
      for (const row of await domainRows(t.org)) expect(row.release_cause).toBe("lapsed_grace");
      expect(w.hosting.callsOf("remove")).toHaveLength(0); // intent first; the detach is the NEXT tick
      await tick(w, t.org, HOUR);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["released", "released"]);
      expect(w.hosting.isAttached(p.hosts[0]!)).toBe(false);
      expect(w.hosting.isAttached(p.hosts[1]!)).toBe(false);
      for (const id of p.ids) {
        expect((await trail(id)).slice(-3)).toEqual([
          AUDIT_ACTIONS.DOMAIN_LAPSED,
          AUDIT_ACTIONS.DOMAIN_RELEASE_REQUESTED,
          AUDIT_ACTIONS.DOMAIN_RELEASED,
        ]);
      }
      expect(www).toBeTruthy();
      await expectGuardsEnabled();
    });

    it("a removed (parked) domain goes dark, is held through its grace, then released and detached", async () => {
      const t = await tenant();
      const w = world();
      const p = await readyPair(t, w);
      await tick(w, t.org);
      await tick(w, t.org);
      await tick(w, t.org);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["live", "live"]);

      const removed = await svc.removeClaim(t.actor, t.org, p.name);
      expect(removed.kind).toBe("ok");
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["parked", "parked"]);
      // Still attached while parked: that is the point of the grace.
      expect(w.hosting.isAttached(p.hosts[0]!)).toBe(true);
      await tick(w, t.org, DAY);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["parked", "parked"]);

      for (const id of p.ids) await backdateDomainClock(fx.platform, id, { graceEndsAt: new Date(Date.now() - 60_000) });
      await tick(w, t.org);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["release_pending", "release_pending"]);
      await tick(w, t.org);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["released", "released"]);
      for (const row of await domainRows(t.org)) expect(row.release_cause).toBe("removed");
      expect(w.hosting.isAttached(p.hosts[0]!)).toBe(false);
      for (const id of p.ids) {
        expect((await trail(id)).slice(-4)).toEqual([
          AUDIT_ACTIONS.DOMAIN_LIVE,
          AUDIT_ACTIONS.DOMAIN_PARKED,
          AUDIT_ACTIONS.DOMAIN_RELEASE_REQUESTED,
          AUDIT_ACTIONS.DOMAIN_RELEASED,
        ]);
      }
      await expectGuardsEnabled();
    });
  });

  /** A pair that has walked pending -> live through three sweeps. */
  async function livePair(t: Tenant, w: World, label = "church") {
    const p = await readyPair(t, w, label);
    await tick(w, t.org);
    await tick(w, t.org);
    await tick(w, t.org);
    expect((await domainRows(t.org)).map((r) => r.state), "livePair setup").toEqual(["live", "live"]);
    return p;
  }

  // ===================================================================
  describe("the debounce: a single failed check does not flip a live site (G9)", () => {
    it("a single definitive miss records the streak and emails ONCE; nothing transitions", async () => {
      const t = await tenant();
      const w = world();
      const p = await livePair(t, w);
      mockEnqueue.mockClear();

      w.dns.clearRecords("TXT", proofName(p.name));
      await tick(w, t.org, 2 * HOUR);

      const rows = await domainRows(t.org);
      expect(rows.map((r) => r.state)).toEqual(["live", "live"]);
      for (const row of rows) {
        expect(row.proof_miss_count).toBe(1);
        expect(row.last_check_class).toBe("proof_absent");
        expect(row.observation).toMatchObject({ proof: { status: "absent" } });
        expect((row.observation as { proofMissSince?: string }).proofMissSince).toBeTruthy();
        expect(row.notify_state).toMatchObject({ proofMissing: true });
      }
      const mails = subjectsLike(/can't find a domain's ownership record/i);
      const recipients = new Set(mails.map((m) => m.to));
      expect(recipients.size).toBeGreaterThan(0);
      expect(mails.length).toBe(recipients.size);

      // The second miss does not email again.
      mockEnqueue.mockClear();
      await tick(w, t.org, 2 * HOUR);
      expect(subjectsLike(/can't find/i)).toHaveLength(0);
      // ...and no audit row at all was written by either observation-only check.
      for (const id of p.ids) expect((await trail(id)).slice(-1)).toEqual([AUDIT_ACTIONS.DOMAIN_LIVE]);
    });

    it("a positive observation resets the streak, clears the flag, and a LATER miss is a new episode that emails again", async () => {
      const t = await tenant();
      const w = world();
      const p = await livePair(t, w);

      w.dns.clearRecords("TXT", proofName(p.name));
      await tick(w, t.org, 2 * HOUR);
      expect((await domainRows(t.org))[0]!.proof_miss_count).toBe(1);

      publishProof(w, p.name, p.token);
      await tick(w, t.org, 2 * HOUR);
      for (const row of await domainRows(t.org)) {
        expect(row.proof_miss_count).toBe(0);
        expect(row.state).toBe("live");
        expect((row.observation as { proofMissSince?: string }).proofMissSince).toBeUndefined();
        expect((row.notify_state as { proofMissing?: boolean }).proofMissing).toBeUndefined();
      }
      mockEnqueue.mockClear();
      w.dns.clearRecords("TXT", proofName(p.name));
      await tick(w, t.org, 2 * HOUR);
      expect(subjectsLike(/can't find/i).length).toBeGreaterThan(0);
    });

    it("UNKNOWN never counts: eight checks with the proof gone AND a resolver down change nothing and email nobody", async () => {
      const t = await tenant();
      const w = world();
      const p = await livePair(t, w);
      mockEnqueue.mockClear();
      w.dns.clearRecords("TXT", proofName(p.name));
      w.dns.google.failWith("timeout"); // one resolver says "absent", the other cannot answer: not a verdict
      for (let i = 0; i < 8; i += 1) await tick(w, t.org, 2 * HOUR);
      for (const row of await domainRows(t.org)) {
        expect(row.state).toBe("live");
        expect(row.proof_miss_count).toBe(0);
        expect(row.last_check_class).toBe("dns_unknown");
      }
      expect(emails()).toHaveLength(0);
    });

    it("...but one resolver down while the OTHER still shows the proof is simply present (a positive needs only one)", async () => {
      const t = await tenant();
      const w = world();
      await livePair(t, w);
      w.dns.google.failWith("timeout");
      for (let i = 0; i < 3; i += 1) await tick(w, t.org, 2 * HOUR);
      for (const row of await domainRows(t.org)) {
        expect(row.state).toBe("live");
        expect(row.proof_miss_count).toBe(0);
        expect(row.last_check_class).toBe("ok");
      }
    });

    it("a disagreement between the two resolvers is unknown, never a miss", async () => {
      const t = await tenant();
      const w = world();
      const p = await livePair(t, w);
      // Cloudflare says the proof is gone; Google still shows it: `present` wins (one positive suffices).
      w.dns.cloudflare.clearRecords("TXT", proofName(p.name));
      for (let i = 0; i < 7; i += 1) await tick(w, t.org, 2 * HOUR);
      for (const row of await domainRows(t.org)) {
        expect(row.state).toBe("live");
        expect(row.proof_miss_count).toBe(0);
      }
    });

    it("a flapping resolver (absent / present / absent ...) never lapses a live site", async () => {
      const t = await tenant();
      const w = world();
      const p = await livePair(t, w);
      for (let i = 0; i < 10; i += 1) {
        if (i % 2 === 0) w.dns.clearRecords("TXT", proofName(p.name));
        else publishProof(w, p.name, p.token);
        await tick(w, t.org, 2 * HOUR);
      }
      for (const row of await domainRows(t.org)) {
        expect(row.state).toBe("live");
        expect(Number(row.proof_miss_count)).toBeLessThanOrEqual(1);
      }
    });

    it("six misses inside thirty minutes do NOT lapse (the 10 hour span is part of the rule); the first miss after the span does", async () => {
      const t = await tenant();
      const w = world();
      const p = await livePair(t, w);
      w.dns.clearRecords("TXT", proofName(p.name));
      for (let i = 0; i < 7; i += 1) await tick(w, t.org, 5 * 60_000);
      for (const row of await domainRows(t.org)) {
        expect(row.state).toBe("live");
        expect(Number(row.proof_miss_count)).toBe(7);
      }
      await tick(w, t.org, 10 * HOUR);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["lapsed", "lapsed"]);
    });

    it.each(["verified", "attach_pending", "attached", "live"] as const)(
      "%s -> lapsed when the proof is gone for good: ONE domain.lapsed audit row, grace stamped, the holders told",
      async (from) => {
        const t = await tenant();
        const w = world();
        const p = await readyPair(t, w);
        for (const id of p.ids) await walkTo(id, from);
        // Six definitive misses already on record, the first 11 hours ago.
        const since = new Date(w.clock.t - 11 * HOUR).toISOString();
        await q(sql`update organization_domains set proof_miss_count = 5,
                           observation = jsonb_build_object('proofMissSince', ${since}::text)
                     where organization_id = ${t.org}`);
        w.dns.clearRecords("TXT", proofName(p.name));
        mockEnqueue.mockClear();

        const summary = await tick(w, t.org);
        expect(summary.outcomes).toMatchObject({ lapsed: 1 });
        for (const row of await domainRows(t.org)) {
          expect(row.state).toBe("lapsed");
          expect(row.grace_ends_at).not.toBeNull();
        }
        for (const id of p.ids) {
          const lapsed = (await auditFor([id])).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_LAPSED);
          expect(lapsed).toHaveLength(1);
          expect(lapsed[0]!.metadata).toMatchObject({ from, to: "lapsed", event: "proof_lost", actorKind: "machine", trigger: "cron" });
          expect(lapsed[0]!.actor_user_id).toBeNull();
        }
        expect(subjectsLike(/can no longer verify a domain/i).length).toBeGreaterThan(0);
        // A lapsed host makes no provider call to find out; it only watches for the proof.
        expect(w.hosting.calls).toHaveLength(0);
      },
    );

    it("a lapsed host whose proof returns is recovered (verified), grace cleared, and re-attaches idempotently", async () => {
      const t = await tenant();
      const w = world();
      const p = await livePair(t, w);
      w.dns.clearRecords("TXT", proofName(p.name));
      for (let i = 0; i < 6; i += 1) await tick(w, t.org, 2 * HOUR);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["lapsed", "lapsed"]);

      publishProof(w, p.name, p.token);
      await tick(w, t.org, HOUR); // recovered
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["verified", "verified"]);
      for (const row of await domainRows(t.org)) expect(row.grace_ends_at).toBeNull();
      const addsBefore = w.hosting.callsOf("add").length;
      await tick(w, t.org, HOUR); // attach_start -> add (already on the project) -> attached
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["attached", "attached"]);
      expect(w.hosting.callsOf("add").length).toBe(addsBefore + 2);
      await tick(w, t.org, HOUR);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["live", "live"]);
    });
  });

  // ===================================================================
  describe("live -> attached on the probe", () => {
    it("one scheduled negative probe does not demote; two consecutive ones do (domain.live_lost), and an ack restores it", async () => {
      const t = await tenant();
      const w = world();
      const p = await livePair(t, w);
      for (const h of p.hosts) w.probe.set(h, "negative");

      await tick(w, t.org, 2 * HOUR);
      for (const row of await domainRows(t.org)) {
        expect(row.state).toBe("live");
        expect(row.probe_miss_count).toBe(1);
      }
      await tick(w, t.org, 2 * HOUR);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["attached", "attached"]);
      for (const row of await domainRows(t.org)) expect(row.probe_miss_count).toBe(0);
      for (const id of p.ids) {
        const lost = (await auditFor([id])).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_LIVE_LOST);
        expect(lost).toHaveLength(1);
        expect(lost[0]!.metadata).toMatchObject({ from: "live", to: "attached", event: "live_lost", actorKind: "machine" });
      }

      for (const h of p.hosts) w.probe.set(h, "ack");
      await tick(w, t.org, HOUR);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["live", "live"]);
      for (const id of p.ids) {
        expect((await trail(id)).slice(-3)).toEqual([AUDIT_ACTIONS.DOMAIN_LIVE, AUDIT_ACTIONS.DOMAIN_LIVE_LOST, AUDIT_ACTIONS.DOMAIN_LIVE]);
      }
    });

    it("an unknown probe (timeout, TLS failure) never counts, and an ack between two negatives resets the streak", async () => {
      const t = await tenant();
      const w = world();
      const p = await livePair(t, w);
      for (const h of p.hosts) w.probe.set(h, "unknown");
      for (let i = 0; i < 5; i += 1) await tick(w, t.org, 2 * HOUR);
      for (const row of await domainRows(t.org)) {
        expect(row.state).toBe("live");
        expect(row.probe_miss_count).toBe(0);
      }
      for (const h of p.hosts) w.probe.set(h, "negative");
      await tick(w, t.org, 2 * HOUR);
      for (const h of p.hosts) w.probe.set(h, "ack");
      await tick(w, t.org, 2 * HOUR);
      for (const h of p.hosts) w.probe.set(h, "negative");
      await tick(w, t.org, 2 * HOUR);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["live", "live"]);
    });

    it("a person's FORCED check demotes on a single definitive negative", async () => {
      const t = await tenant();
      const w = world();
      const p = await livePair(t, w);
      for (const h of p.hosts) w.probe.set(h, "negative");
      const res = await svc.checkClaim(t.actor, t.org, p.name, { forced: true, deps: w.deps });
      expect(res).toMatchObject({ kind: "ok", outcome: "live_lost" });
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["attached", "attached"]);
      const lost = (await auditFor(p.ids)).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_LIVE_LOST);
      expect(lost).toHaveLength(2);
      expect(lost[0]!.metadata).toMatchObject({ actorKind: "tenant", trigger: "check_now" });
      expect(lost[0]!.actor_user_id).toBe(fx.actingUserId);
    });
  });

  // ===================================================================
  describe("no provider call without the proof (G1)", () => {
    async function attachPendingPair(w: World, t: Tenant) {
      const name = claim("church");
      const r = await claimOk(t, name);
      for (const c of r.created) await walkTo(c.id, "attach_pending");
      return { name, ids: r.created.map((c) => c.id), hosts: r.created.map((c) => c.hostname) };
    }

    it("attach_pending with the proof ABSENT: no provider call of any kind, the state holds, the class says why", async () => {
      const t = await tenant();
      const w = world();
      const p = await attachPendingPair(w, t);
      await tick(w, t.org);
      expect(w.hosting.calls).toHaveLength(0);
      expect(w.probe.calls).toHaveLength(0);
      for (const row of await domainRows(t.org)) {
        expect(row.state).toBe("attach_pending");
        expect(row.last_check_class).toBe("proof_absent");
      }
      expect(p.ids).toHaveLength(2);
    });

    it("...WRONG VALUE (someone else's token at the name): no provider call", async () => {
      const t = await tenant();
      const w = world();
      const p = await attachPendingPair(w, t);
      w.dns.setRecord("TXT", proofName(p.name), "presby-verify=SomeoneElsesTokenSomeoneElsesToken");
      await tick(w, t.org);
      expect(w.hosting.calls).toHaveLength(0);
      for (const row of await domainRows(t.org)) expect(row.last_check_class).toBe("proof_absent");
    });

    it("...UNKNOWN (a resolver is down): no provider call, class dns_unknown", async () => {
      const t = await tenant();
      const w = world();
      await attachPendingPair(w, t);
      w.dns.google.failWith("timeout");
      await tick(w, t.org);
      expect(w.hosting.calls).toHaveLength(0);
      for (const row of await domainRows(t.org)) expect(row.last_check_class).toBe("dns_unknown");
    });

    it("verified with no proof does not even start attaching; attached and live with no proof make no provider or probe call", async () => {
      const t = await tenant();
      const w = world();
      const name = claim("church");
      const r = await claimOk(t, name);
      for (const c of r.created) await walkTo(c.id, "verified");
      await tick(w, t.org);
      expect((await domainRows(t.org)).map((x) => x.state)).toEqual(["verified", "verified"]);

      const t2 = await tenant();
      const r2 = await claimOk(t2, claim("church"));
      for (const c of r2.created) await walkTo(c.id, "live");
      await tick(w, t2.org);
      expect(w.hosting.calls).toHaveLength(0);
      expect(w.probe.calls).toHaveLength(0);
    });
  });

  /** A pair claimed with its proof published, with both rows walked (owner) to `attach_pending`: the state a crash right after the intent commit leaves. */
  async function pairAt(t: Tenant, w: World, state: string, label = "church") {
    const p = await readyPair(t, w, label);
    for (const id of p.ids) await walkTo(id, state);
    return p;
  }

  async function withPlatformAdmin<T>(fn: () => Promise<T>): Promise<T> {
    await q(sql`update users set is_platform_admin = true where id = ${fx.actingUserId}`);
    try {
      return await fn();
    } finally {
      await q(sql`update users set is_platform_admin = false where id = ${fx.actingUserId}`);
    }
  }

  // ===================================================================
  describe("provider-unconfigured honesty", () => {
    it("with no provider configured the row waits in attach_pending, says so, shows the records to publish, and backs off - it never pretends", async () => {
      vi.stubEnv("DOMAINS_PROVIDER", "");
      const t = await tenant();
      const w = world();
      const p = await readyPair(t, w);
      // The REAL default adapter selection (no `hosting` injected): DOMAINS_PROVIDER unset -> unconfigured.
      const deps = { dns: w.dns.observer, probe: w.probe, now: w.deps.now };
      const run = async () => {
        await makeDue(t.org);
        return svc.sweepDueDomains({ organizationIds: [t.org], deps });
      };

      await run(); // verified
      await run(); // attach_start, then the provider call fails "unavailable"
      let rows = await domainRows(t.org);
      expect(rows.map((r) => r.state)).toEqual(["attach_pending", "attach_pending"]);
      for (const row of rows) {
        expect(row.last_check_class).toBe("provider_unavailable");
        expect(row.observation).toMatchObject({ attempts: 1 });
        expect((row.observation as { failingSince?: string }).failingSince).toBeTruthy();
        // The records to publish are known without the provider: Vercel's generic targets, flagged as such.
        expect(row.observation).toMatchObject({ targets: { source: "generic" } });
      }
      for (const id of p.ids) {
        expect(await trail(id)).toEqual([
          AUDIT_ACTIONS.DOMAIN_CLAIMED,
          AUDIT_ACTIONS.DOMAIN_PROOF_VERIFIED,
          AUDIT_ACTIONS.DOMAIN_ATTACH_REQUESTED,
        ]);
      }
      // Backoff: 1 minute after the first failure...
      const secondsAhead = async () =>
        Number((await q(sql`select extract(epoch from (min(next_check_at) - now()))::float as s from organization_domains where organization_id = ${t.org}`))[0]!.s);
      expect(await secondsAhead()).toBeGreaterThan(30);
      expect(await secondsAhead()).toBeLessThan(90);
      // ...2 minutes after the second.
      await run();
      rows = await domainRows(t.org);
      for (const row of rows) expect(row.observation).toMatchObject({ attempts: 2 });
      expect(await secondsAhead()).toBeGreaterThan(90);
      expect(await secondsAhead()).toBeLessThan(150);

      // What the church sees: the honest banner, and the records they CAN publish now.
      const view = await svc.readDomainsView(t.personId, t.org, { platformSiteUrl: "platform.invalid/site/x" });
      expect(view.kind).toBe("ok");
      if (view.kind !== "ok") return;
      const g = view.groups[0]!;
      expect(g.banners.map((b) => b.code)).toContain("provider_unavailable");
      expect(g.banners.find((b) => b.code === "provider_unavailable")!.message).toContain("Your DNS changes are safe to make");
      const routing = g.records.filter((r) => r.kind === "routing");
      expect(routing.map((r) => r.type).sort()).toEqual(["A", "CNAME"]);

      // The provider arrives: the very next due check attaches, the failure run is cleared.
      const live = world();
      live.clock = w.clock;
      for (const h of p.hosts) live.probe.set(h, "ack");
      await makeDue(t.org);
      await svc.sweepDueDomains({ organizationIds: [t.org], deps: { ...live.deps, dns: w.dns.observer, now: w.deps.now } });
      rows = await domainRows(t.org);
      expect(rows.map((r) => r.state)).toEqual(["attached", "attached"]);
      for (const row of rows) {
        expect((row.observation as { attempts?: number }).attempts).toBeUndefined();
        expect((row.observation as { failingSince?: string }).failingSince).toBeUndefined();
      }
    });
  });

  // ===================================================================
  describe("provider failures keep the row where it is, back off, and alert the operator only for what only they can fix", () => {
    const alerts = (re: RegExp) => subjectsLike(re);

    it("rate_limited honours retry-after, capped at the trigger's 6 hour ceiling", async () => {
      const t = await tenant();
      const w = world();
      await pairAt(t, w, "attach_pending");
      w.hosting.failWith("add", "rate_limited", { retryAfterSeconds: 3 * 3600 });
      await tick(w, t.org);
      for (const row of await domainRows(t.org)) {
        expect(row.state).toBe("attach_pending");
        expect(row.last_check_class).toBe("rate_limited");
      }
      const ahead = async () =>
        Number((await q(sql`select extract(epoch from (min(next_check_at) - now()))::float as s from organization_domains where organization_id = ${t.org}`))[0]!.s);
      expect(await ahead()).toBeGreaterThan(2.9 * 3600);
      expect(await ahead()).toBeLessThan(3.1 * 3600);

      w.hosting.failWith("add", "rate_limited", { retryAfterSeconds: 20 * 3600 });
      await tick(w, t.org);
      expect(await ahead()).toBeLessThanOrEqual(6 * 3600 + 5);
      expect(await ahead()).toBeGreaterThan(5.9 * 3600);
    });

    it("deployment_not_ready is retried until it works; no alert, and the failure run is cleared on success", async () => {
      const t = await tenant();
      const w = world();
      const p = await pairAt(t, w, "attach_pending");
      w.hosting.failWith("add", "deployment_not_ready", { times: 4 }); // 2 rows x 2 ticks
      mockEnqueue.mockClear(); // the claim's own "domain was added" notice is not under test
      await tick(w, t.org);
      await tick(w, t.org);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["attach_pending", "attach_pending"]);
      for (const row of await domainRows(t.org)) expect(row.observation).toMatchObject({ attempts: 2 });
      await tick(w, t.org);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["attached", "attached"]);
      for (const id of p.ids) expect((await trail(id)).filter((a) => a === AUDIT_ACTIONS.DOMAIN_ATTACHED)).toHaveLength(1);
      expect(emails()).toHaveLength(0);
    });

    it("a name held by another hosting account (blocked) stays attach_pending as provider_rejected and alerts the operator ONCE per day", async () => {
      await withPlatformAdmin(async () => {
        const t = await tenant();
        const w = world();
        await pairAt(t, w, "attach_pending");
        w.hosting.failWith("add", "blocked_other_project");
        mockEnqueue.mockClear();
        await tick(w, t.org);
        for (const row of await domainRows(t.org)) {
          expect(row.state).toBe("attach_pending");
          expect(row.last_check_class).toBe("provider_rejected");
        }
        const first = alerts(/held by another hosting account/i);
        expect(first.length).toBeGreaterThan(0);
        expect(first.every((m) => m.to.length > 0)).toBe(true);
        expect(emails().filter((e) => /held by another/i.test(e.subject)).map((e) => e.templateKey)).toEqual(
          first.map(() => "domain_notification"),
        );

        mockEnqueue.mockClear();
        await tick(w, t.org, 2 * HOUR);
        expect(alerts(/held by another hosting account/i)).toHaveLength(0);

        await tick(w, t.org, 25 * HOUR);
        expect(alerts(/held by another hosting account/i).length).toBeGreaterThan(0);
      });
    });

    it.each([
      ["token_invalid", "config_error", /refused our credentials/i],
      ["payment_required", "config_error", /refused our credentials/i],
      ["rejected", "provider_rejected", /refused a request/i],
    ] as const)("%s -> class %s and an operator alert", async (failure, klass, re) => {
      await withPlatformAdmin(async () => {
        const t = await tenant();
        const w = world();
        await pairAt(t, w, "attach_pending");
        w.hosting.failWith("add", failure);
        mockEnqueue.mockClear();
        await tick(w, t.org);
        for (const row of await domainRows(t.org)) {
          expect(row.state).toBe("attach_pending");
          expect(row.last_check_class).toBe(klass);
        }
        expect(alerts(re).length).toBeGreaterThan(0);
        // The church is not emailed the provider's problem: no church-facing message carries it.
        expect(emails().every((e) => e.templateKey === "domain_notification")).toBe(true);
      });
    });

    it("an attach that has failed for more than 24 hours escalates to the operator", async () => {
      await withPlatformAdmin(async () => {
        const t = await tenant();
        const w = world();
        await pairAt(t, w, "attach_pending");
        w.hosting.failWith("add", "unavailable");
        mockEnqueue.mockClear();
        await tick(w, t.org);
        expect(alerts(/failing for a day/i)).toHaveLength(0);
        await tick(w, t.org, 25 * HOUR);
        expect(alerts(/connecting a domain has been failing for a day/i).length).toBeGreaterThan(0);
      });
    });

    it("provider text and the token never reach a row, an audit row or an email", async () => {
      await withPlatformAdmin(async () => {
        const t = await tenant();
        const w = world();
        const p = await pairAt(t, w, "attach_pending");
        w.hosting.failWith("add", "token_invalid");
        await tick(w, t.org);
        const visible = (await domainRows(t.org)).map((r) => ({
          observation: r.observation,
          notify_state: r.notify_state,
          last_check_class: r.last_check_class,
          provider_challenge: r.provider_challenge,
        }));
        const dump = JSON.stringify([visible, await auditFor(p.ids), emails()]);
        expect(dump).not.toContain(p.token);
        expect(dump).not.toMatch(/bearer|authorization|vercel_api_token/i);
      });
    });

    it("already_on_project is idempotent success: confirmed with a get, ONE attached audit row per host", async () => {
      const t = await tenant();
      const w = world();
      const p = await pairAt(t, w, "attach_pending");
      for (const h of p.hosts) w.hosting.attach(h); // a crash after the provider call, before the database write
      await tick(w, t.org);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["attached", "attached"]);
      for (const id of p.ids) expect((await trail(id)).filter((a) => a === AUDIT_ACTIONS.DOMAIN_ATTACHED)).toHaveLength(1);
      expect(w.hosting.callsOf("get").length).toBeGreaterThanOrEqual(2);
    });

    it("a name in another Vercel account attaches UNVERIFIED: the provider's challenge is kept as a record, verified when published, then cleared", async () => {
      const t = await tenant();
      const w = world();
      const p = await readyPair(t, w);
      const challenge = [{ type: "TXT", domain: `_vercel.${p.name}`, value: "vc-domain-verify=fixture", reason: "pending_domain_verification" }];
      for (const h of p.hosts) {
        w.hosting.requireChallenge(h, challenge);
        w.probe.set(h, "unknown");
      }
      await tick(w, t.org);
      await tick(w, t.org); // attached, unverified
      for (const row of await domainRows(t.org)) {
        expect(row.state).toBe("attached");
        expect(row.provider_challenge).toEqual(challenge);
      }
      const view = await svc.readDomainsView(t.personId, t.org, { platformSiteUrl: "platform.invalid/site/x" });
      if (view.kind !== "ok") throw new Error("view");
      expect(view.groups[0]!.records.filter((r) => r.kind === "provider")).toHaveLength(1);

      // Not published yet: verify is attempted and fails; the challenge stays.
      await tick(w, t.org);
      expect(w.hosting.callsOf("verify").length).toBeGreaterThan(0);
      for (const row of await domainRows(t.org)) expect(row.provider_challenge).toEqual(challenge);

      for (const h of p.hosts) {
        w.hosting.satisfyChallenge(h);
        w.probe.set(h, "ack");
      }
      await tick(w, t.org); // verify succeeds, challenge cleared, probe acks -> live
      for (const row of await domainRows(t.org)) {
        expect(row.provider_challenge).toBeNull();
        expect(row.state).toBe("live");
      }
    });
  });

  // ===================================================================
  describe("targets, routing and the live gate", () => {
    it("a project token refused on the config endpoint (denied) still goes live: generic targets are shown and used", async () => {
      const t = await tenant();
      const w = world();
      const p = await readyPair(t, w);
      w.hosting.setConfig("denied");
      w.dns.clearRecords("CNAME", `www.${p.name}`);
      w.dns.setRecord("CNAME", `www.${p.name}`, "cname.vercel-dns.com");
      w.dns.clearRecords("A", p.name);
      w.dns.setRecord("A", p.name, "76.76.21.21");
      await tick(w, t.org);
      await tick(w, t.org);
      await tick(w, t.org);
      const rows = await domainRows(t.org);
      expect(rows.map((r) => r.state)).toEqual(["live", "live"]);
      for (const row of rows) {
        expect(row.observation).toMatchObject({ targets: { source: "generic" } });
        expect((row.observation as { routing: { records: Array<{ status: string }> } }).routing.records[0]!.status).toBe("correct");
      }
    });

    it("the provider's recommendation wins once readable, and a later denial keeps the cached one rather than regressing to generic", async () => {
      const t = await tenant();
      const w = world();
      await readyPair(t, w);
      await tick(w, t.org);
      await tick(w, t.org);
      await tick(w, t.org);
      for (const row of await domainRows(t.org)) {
        expect(row.observation).toMatchObject({ targets: { source: "provider", cname: "cname.vercel-dns.invalid", ipv4: ["192.0.2.10"] } });
      }
      w.hosting.setConfig("denied");
      await tick(w, t.org, 2 * HOUR);
      for (const row of await domainRows(t.org)) {
        expect(row.observation).toMatchObject({ targets: { source: "provider", cname: "cname.vercel-dns.invalid" } });
      }
    });

    it("each row stores ITS OWN routing result; the apex records its SOA verdict", async () => {
      const t = await tenant();
      const w = world();
      const p = await readyPair(t, w);
      await tick(w, t.org);
      await tick(w, t.org);
      const apex = (await domainRows(t.org, sql`hostname = ${p.name}`))[0]!;
      const www = (await domainRows(t.org, sql`hostname = ${"www." + p.name}`))[0]!;
      const routingOf = (r: Row) => (r.observation as { routing: { records: Array<{ hostname: string; status: string; apex: boolean | null }> } }).routing.records;
      expect(routingOf(apex)).toEqual([expect.objectContaining({ hostname: p.name, status: "correct", apex: true })]);
      expect(routingOf(www)).toEqual([expect.objectContaining({ hostname: `www.${p.name}`, status: "correct", apex: false })]);
    });

    it("a Cloudflare-PROXIED record is not allowed to go live even when the probe acks (operator Q7); fixing it does", async () => {
      const t = await tenant();
      const w = world();
      const p = await readyPair(t, w);
      w.dns.clearRecords("A", p.name);
      w.dns.setRecord("A", p.name, "104.16.5.5");
      await tick(w, t.org);
      await tick(w, t.org);
      await tick(w, t.org);
      const apex = (await domainRows(t.org, sql`hostname = ${p.name}`))[0]!;
      const www = (await domainRows(t.org, sql`hostname = ${"www." + p.name}`))[0]!;
      expect(apex.state).toBe("attached");
      expect(apex.last_check_class).toBe("routing_wrong");
      expect((apex.observation as { routing: { records: Array<{ hint: string }> } }).routing.records[0]!.hint).toBe("proxied");
      expect(www.state).toBe("live"); // the www CNAME is fine; the gate is per host
      // A host whose records point somewhere else is never even probed, so it cannot be acknowledged.
      expect(w.probe.calls).not.toContain(p.name);

      w.dns.clearRecords("A", p.name);
      w.dns.setRecord("A", p.name, "192.0.2.10");
      await tick(w, t.org);
      expect((await domainRows(t.org, sql`hostname = ${p.name}`))[0]!.state).toBe("live");
    });

    it("a leftover AAAA is reported but does not block going live", async () => {
      const t = await tenant();
      const w = world();
      const p = await readyPair(t, w);
      w.dns.setRecord("AAAA", p.name, "2001:db8::1");
      await tick(w, t.org);
      await tick(w, t.org);
      await tick(w, t.org);
      const apex = (await domainRows(t.org, sql`hostname = ${p.name}`))[0]!;
      expect(apex.state).toBe("live");
      expect((apex.observation as { routing: { records: Array<{ hint: string; status: string }> } }).routing.records[0]).toMatchObject({
        status: "conflicting",
        hint: "leftover_aaaa",
      });
    });

    it("a CAA record that forbids the certificate authority is diagnosed while the host waits for its certificate", async () => {
      const t = await tenant();
      const w = world();
      const p = await readyPair(t, w);
      w.dns.setRecord("CAA", p.name, '0 issue "other-ca.invalid"');
      for (const h of p.hosts) w.probe.set(h, "negative"); // no certificate can issue, so nothing answers us
      await tick(w, t.org);
      await tick(w, t.org);
      await tick(w, t.org);
      for (const row of await domainRows(t.org)) {
        expect(row.state).toBe("attached");
        expect(row.last_check_class).toBe("routing_wrong");
        expect((row.observation as { routing: { records: Array<{ hint: string }> } }).routing.records[0]!.hint).toBe("caa");
      }
    });
  });

  // ===================================================================
  describe("the nameserver tripwire (notify-only)", () => {
    it("the fingerprint is recorded silently at first sight; a later change emails once and re-baselines", async () => {
      const t = await tenant();
      const w = world();
      const p = await readyPair(t, w);
      w.dns.setRecord("NS", p.name, "ns1.dns-host.invalid", "ns2.dns-host.invalid");
      mockEnqueue.mockClear();
      await tick(w, t.org); // verified
      await tick(w, t.org); // attach_start records the fingerprint
      for (const row of await domainRows(t.org)) expect(row.ns_fingerprint).toBe("ns1.dns-host.invalid,ns2.dns-host.invalid");
      expect(subjectsLike(/nameservers changed/i)).toHaveLength(0);

      await tick(w, t.org);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["live", "live"]);

      w.dns.clearRecords("NS", p.name);
      w.dns.setRecord("NS", p.name, "ns1.other-host.invalid", "ns2.other-host.invalid");
      await tick(w, t.org, 2 * HOUR);
      const mails = subjectsLike(/nameservers changed/i);
      expect(mails.length).toBeGreaterThan(0);
      for (const row of await domainRows(t.org)) {
        expect(row.state).toBe("live"); // notify-only: it NEVER enforces
        expect(row.ns_fingerprint).toBe("ns1.other-host.invalid,ns2.other-host.invalid");
      }
      mockEnqueue.mockClear();
      await tick(w, t.org, 2 * HOUR);
      expect(subjectsLike(/nameservers changed/i)).toHaveLength(0);
    });
  });

  // ===================================================================
  describe("a parked domain: the weekly 'records still point at us' nudge", () => {
    async function parkedPair(t: Tenant, w: World) {
      const p = await livePair(t, w);
      expect((await svc.removeClaim(t.actor, t.org, p.name)).kind).toBe("ok");
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["parked", "parked"]);
      mockEnqueue.mockClear();
      return p;
    }

    it("emails when DNS still points at our hosting, then not again for a week, then again", async () => {
      const t = await tenant();
      const w = world();
      await parkedPair(t, w);
      await tick(w, t.org, DAY);
      const first = subjectsLike(/still points at PresbyPortal/i);
      expect(first.length).toBeGreaterThan(0);
      expect(first.every((m) => m.templateKey === "domain_notification")).toBe(true);

      mockEnqueue.mockClear();
      await tick(w, t.org, DAY);
      await tick(w, t.org, 3 * DAY);
      expect(subjectsLike(/still points at/i)).toHaveLength(0);

      await tick(w, t.org, 5 * DAY); // 9 days after the first
      expect(subjectsLike(/still points at/i).length).toBeGreaterThan(0);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["parked", "parked"]);
    });

    it("does not email once the church has deleted the records", async () => {
      const t = await tenant();
      const w = world();
      const p = await parkedPair(t, w);
      w.dns.clearRecords("A", p.name);
      w.dns.clearRecords("CNAME", `www.${p.name}`);
      await tick(w, t.org, DAY);
      expect(subjectsLike(/still points at/i)).toHaveLength(0);
    });

    it("a resolver outage with nothing else to go on is unknown, not 'still pointing': no email", async () => {
      const t = await tenant();
      const w = world();
      const p = await parkedPair(t, w);
      w.dns.clearRecords("A", p.name);
      w.dns.clearRecords("CNAME", `www.${p.name}`);
      w.dns.google.failWith("timeout");
      await tick(w, t.org, DAY);
      expect(subjectsLike(/still points at/i)).toHaveLength(0);
    });
  });

  // ===================================================================
  describe("reconciliation (a crash leaves a retryable state, never a half-attached host)", () => {
    it("attach_pending after a crash between the intent commit and the provider call: the next sweep attaches it", async () => {
      const t = await tenant();
      const w = world();
      const p = await pairAt(t, w, "attach_pending");
      expect(w.hosting.calls).toHaveLength(0);
      await tick(w, t.org);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["attached", "attached"]);
      expect(w.hosting.callsOf("add").sort()).toEqual([...p.hosts].sort());
      for (const id of p.ids) expect((await trail(id)).filter((a) => a === AUDIT_ACTIONS.DOMAIN_ATTACHED)).toHaveLength(1);
    });

    it("release_pending where the provider already forgot the host (a crash after the detach): the retry is idempotent success", async () => {
      const t = await tenant();
      const w = world();
      const p = await pairAt(t, w, "release_pending");
      expect(w.hosting.isAttached(p.hosts[0]!)).toBe(false);
      await tick(w, t.org);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["released", "released"]);
      for (const id of p.ids) expect((await trail(id)).slice(-1)).toEqual([AUDIT_ACTIONS.DOMAIN_RELEASED]);
      expect(w.hosting.callsOf("remove").sort()).toEqual([...p.hosts].sort());
    });

    it("release_pending while the provider is down: stays, backs off 5 -> 15 minutes, alerts the operator after a day", async () => {
      await withPlatformAdmin(async () => {
        const t = await tenant();
        const w = world();
        await pairAt(t, w, "release_pending");
        w.hosting.failWith("remove", "unavailable");
        mockEnqueue.mockClear();
        await tick(w, t.org);
        for (const row of await domainRows(t.org)) {
          expect(row.state).toBe("release_pending");
          expect(row.last_check_class).toBe("provider_unavailable");
          expect(row.observation).toMatchObject({ attempts: 1 });
        }
        const ahead = async () =>
          Number((await q(sql`select extract(epoch from (min(next_check_at) - now()))::float as s from organization_domains where organization_id = ${t.org}`))[0]!.s);
        expect(await ahead()).toBeGreaterThan(4 * 60);
        expect(await ahead()).toBeLessThan(6 * 60);
        await tick(w, t.org);
        expect(await ahead()).toBeGreaterThan(14 * 60);
        expect(await ahead()).toBeLessThan(16 * 60);

        await tick(w, t.org, 25 * HOUR);
        expect(subjectsLike(/releasing a domain has been failing for a day/i).length).toBeGreaterThan(0);

        w.hosting.failWith("remove", null);
        await tick(w, t.org);
        expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["released", "released"]);
      });
    });

    it("an attached host the provider no longer knows is put back (add is idempotent) with no state change and no audit row", async () => {
      const t = await tenant();
      const w = world();
      const p = await pairAt(t, w, "attached");
      for (const h of p.hosts) w.probe.set(h, "unknown");
      expect(w.hosting.isAttached(p.hosts[0]!)).toBe(false);
      const before = (await auditFor(p.ids)).length;
      await tick(w, t.org);
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["attached", "attached"]);
      expect(w.hosting.callsOf("add").sort()).toEqual([...p.hosts].sort());
      expect(w.hosting.isAttached(p.hosts[0]!)).toBe(true);
      expect((await auditFor(p.ids)).length).toBe(before);
    });
  });

  // ===================================================================
  describe("the sweep itself: lease, skip locked, idempotence, scope", () => {
    it("leases ONE statement's worth of due rows and pushes their next_check_at out ~10 minutes", async () => {
      const t = await tenant();
      const w = world();
      const p = await readyPair(t, w);
      await makeDue(t.org);
      const leased = await svc.leaseDueDomains(50, [t.org]);
      expect(leased.map((r) => r.id).sort()).toEqual([...p.ids].sort());
      const [r] = await q(sql`select extract(epoch from (min(next_check_at) - now()))::float as s from organization_domains where organization_id = ${t.org}`);
      expect(Number(r!.s)).toBeGreaterThan(9 * 60);
      expect(Number(r!.s)).toBeLessThan(11 * 60);
      expect(await svc.leaseDueDomains(50, [t.org])).toEqual([]);
      expect(w.hosting.calls).toHaveLength(0);
    });

    it("a row another transaction holds locked is SKIPPED, not waited for, and is taken once released", { retry: 0 }, async () => {
      const t = await tenant();
      const w = world();
      const p = await readyPair(t, w);
      await makeDue(t.org);
      const lockedId = p.ids[0]!;
      let release!: () => void;
      const hold = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const gotLock = new Promise<void>((resolve) => (locked = resolve));
      const holder = fx.platform.transaction(async (tx) => {
        await tx.execute(sql`select id from organization_domains where id = ${lockedId} for update`);
        locked();
        await hold;
      });
      await gotLock;
      const leased = await svc.leaseDueDomains(50, [t.org]);
      expect(leased.map((r) => r.id)).toEqual([p.ids[1]]);
      release();
      await holder;
      await makeDue(t.org);
      const again = await svc.leaseDueDomains(50, [t.org]);
      expect(again.map((r) => r.id)).toContain(lockedId);
    });

    it("two CONCURRENT sweeps over the same due rows take each row exactly once (one provider call, one audit row per edge)", { retry: 0 }, async () => {
      const w = world();
      const tenants = await Promise.all([tenant(), tenant(), tenant()]);
      const pairs = [];
      for (const t of tenants) {
        const p = await pairAt(t, w, "attach_pending");
        pairs.push(p);
      }
      const orgs = tenants.map((t) => t.org);
      for (const org of orgs) await makeDue(org);

      const [a, b] = await Promise.all([
        svc.sweepDueDomains({ organizationIds: orgs, deps: w.deps, concurrency: 3 }),
        svc.sweepDueDomains({ organizationIds: orgs, deps: w.deps, concurrency: 3 }),
      ]);
      expect(a.picked + b.picked).toBe(6);
      expect(a.failed + b.failed).toBe(0);
      const allHosts = pairs.flatMap((p) => p.hosts).sort();
      expect(w.hosting.callsOf("add").sort()).toEqual(allHosts);
      for (const p of pairs) {
        for (const id of p.ids) {
          expect((await trail(id)).filter((x) => x === AUDIT_ACTIONS.DOMAIN_ATTACHED)).toHaveLength(1);
          expect(await stateOf(id)).toBe("attached");
        }
      }
    });

    it("idempotent: a second sweep right after finds nothing due; a forced-due re-check of a settled live host writes no audit row", async () => {
      const t = await tenant();
      const w = world();
      const p = await livePair(t, w);
      const empty = await sweep(w, [t.org]);
      expect(empty.picked).toBe(0);
      const before = (await auditFor(p.ids)).length;
      const again = await tick(w, t.org, 2 * HOUR);
      expect(again.picked).toBe(2);
      expect(again.advanced).toBe(0);
      expect((await auditFor(p.ids)).length).toBe(before);
    });

    it("respects the limit, never picks terminal rows, treats a null next_check_at as due, and is scoped by organization", async () => {
      const t = await tenant();
      const other = await tenant();
      const w = world();
      const a = await readyPair(t, w);
      const b = await readyPair(other, w);
      await makeDue(t.org);
      await makeDue(other.org);
      const limited = await svc.leaseDueDomains(1, [t.org, other.org]);
      expect(limited).toHaveLength(1);

      // Scope: sweeping only `t` leaves `other` untouched.
      await makeDue(t.org);
      await makeDue(other.org);
      const scoped = await svc.leaseDueDomains(50, [t.org]);
      expect(scoped.every((r) => r.organization_id === t.org)).toBe(true);
      expect((await domainRows(other.org)).every((r) => r.next_check_at !== null)).toBe(true);

      // Terminal rows are never picked, however old their next_check_at.
      await q(sql`update organization_domains set next_check_at = now() - interval '1 day' where id = ${a.ids[0]}`);
      await step(a.ids[0]!, "released", "removed");
      await q(sql`update organization_domains set next_check_at = null where id = ${a.ids[1]}`);
      const picked = await svc.leaseDueDomains(50, [t.org]);
      expect(picked.map((r) => r.id)).toEqual([a.ids[1]]); // the null-scheduled row is due; the released one is not
      expect(b.ids).toHaveLength(2);
    });

    it("only the LEASED rows of a claim are processed: a group-mate that is not due is left alone", async () => {
      const t = await tenant();
      const w = world();
      const p = await readyPair(t, w);
      const [apexId, wwwId] = [p.ids.find((_, i) => p.hosts[i] === p.name)!, p.ids.find((_, i) => p.hosts[i] === `www.${p.name}`)!];
      await q(sql`update organization_domains set next_check_at = now() - interval '1 minute' where id = ${apexId}`);
      await q(sql`update organization_domains set next_check_at = now() + interval '3 hours' where id = ${wwwId}`);
      const r = await sweep(w, [t.org]);
      expect(r.picked).toBe(1);
      expect(await stateOf(apexId)).toBe("verified");
      expect(await stateOf(wwwId)).toBe("pending");
    });

    it("a sweep past its deadline starts no new claim (the leased rows simply come due again)", async () => {
      const t = await tenant();
      const w = world();
      await readyPair(t, w);
      await makeDue(t.org);
      const r = await svc.sweepDueDomains({ organizationIds: [t.org], deps: w.deps, deadlineMs: Date.now() - 1 });
      expect(r.picked).toBe(2);
      expect(r.groups).toBe(1);
      expect(r.advanced).toBe(0);
      expect(r.outcomes).toEqual({});
      expect((await domainRows(t.org)).map((x) => x.state)).toEqual(["pending", "pending"]);
    });

    it("a failing group is counted and logged with ids only, and does not stop the others", async () => {
      const t = await tenant();
      const t2 = await tenant();
      const w = world();
      await readyPair(t, w);
      const p2 = await readyPair(t2, w, "other");
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const exploding = {
          lookup: async (name: string, ...rest: unknown[]) => {
            if (name.includes(p2.name)) throw new Error("boom with secret detail");
            return (w.dns.observer.lookup as (...a: unknown[]) => Promise<unknown>)(name, ...rest);
          },
        };
        await makeDue(t.org);
        await makeDue(t2.org);
        const r = await svc.sweepDueDomains({
          organizationIds: [t.org, t2.org],
          deps: { ...w.deps, dns: exploding as never },
          concurrency: 1,
        });
        expect(r.failed).toBe(1);
        expect(r.outcomes).toEqual({ verified: 1 });
        expect((await domainRows(t.org)).map((x) => x.state)).toEqual(["verified", "verified"]);
        expect((await domainRows(t2.org)).map((x) => x.state)).toEqual(["pending", "pending"]); // retried when the lease runs out
        const logged = err.mock.calls.flat().join(" ");
        expect(logged).not.toContain("secret detail");
        expect(logged).not.toContain(p2.name);
      } finally {
        err.mockRestore();
      }
    });
  });

  // ===================================================================
  describe("canonical promotion (1a-ii deviation 6, ruled in 1b)", () => {
    const canonicalHosts = async (org: string) =>
      (await domainRows(org, sql`web_role = 'canonical' and state not in ('expired','released')`)).map((r) => String(r.hostname));
    const promotions = async (org: string) =>
      (await q(sql`select metadata from audit_events
                    where resource_type = 'organization_domain' and action = ${AUDIT_ACTIONS.DOMAIN_CANONICAL_CHANGED}
                      and metadata->>'organizationId' = ${org} order by created_at`)).map((r) => r.metadata as Record<string, unknown>);

    /** Group A (a single www host, canonical) and group B (an apex/www pair, aliases). */
    async function twoGroups(t: Tenant, w: World) {
      const a = `www.${claim("first")}`;
      const ra = await claimOk(t, a);
      const b = await readyPair(t, w, "second");
      return { a, aIds: ra.created.map((c) => c.id), b };
    }

    it("when the canonical claim is removed and an alias later goes live, the org is not left with no canonical: the live alias (www preferred) is promoted, once, with one audit row", async () => {
      const t = await tenant();
      const w = world();
      const { a, aIds, b } = await twoGroups(t, w);
      expect(await canonicalHosts(t.org)).toEqual([a]);
      for (const id of aIds) await walkTo(id, "live");
      // B is not live yet, so removing A is allowed with no replacement named.
      expect((await svc.removeClaim(t.actor, t.org, a)).kind).toBe("ok");
      expect(await canonicalHosts(t.org)).toEqual([]);

      await tick(w, t.org);
      await tick(w, t.org);
      expect(await canonicalHosts(t.org)).toEqual([]); // attached is not live: nothing to promote yet
      await tick(w, t.org); // B goes live; the promotion happens in the same check
      expect((await domainRows(t.org, sql`claim_name = ${b.name}`)).map((r) => r.state)).toEqual(["live", "live"]);
      expect(await canonicalHosts(t.org)).toEqual([`www.${b.name}`]);
      expect((await domainRows(t.org, sql`hostname = ${b.name}`))[0]!.web_role).toBe("alias");

      const done = await promotions(t.org);
      expect(done).toHaveLength(1);
      expect(done[0]).toMatchObject({ reason: "no_canonical", fromHostname: null, toHostname: `www.${b.name}`, actorKind: "machine", trigger: "cron" });

      await tick(w, t.org, 2 * HOUR);
      expect(await promotions(t.org)).toHaveLength(1); // idempotent: nothing more to promote
    });

    it("a canonical that EXISTS but is not serving is never replaced (no surprise redirects): the aliases stay dark, fail-soft", async () => {
      const t = await tenant();
      const w = world();
      const { a, aIds, b } = await twoGroups(t, w);
      for (const id of aIds) await walkTo(id, "lapsed"); // canonical, lapsed
      await tick(w, t.org); // B: verified (A lapsed is only watched)
      await tick(w, t.org);
      await tick(w, t.org);
      expect((await domainRows(t.org, sql`claim_name = ${b.name}`)).map((r) => r.state)).toEqual(["live", "live"]);
      expect(await canonicalHosts(t.org)).toEqual([a]);
      expect(await promotions(t.org)).toHaveLength(0);
    });

    it("a held (paused) host is not promoted; clearing the hold lets the next check promote it", async () => {
      const t = await tenant();
      const w = world();
      const { a, aIds, b } = await twoGroups(t, w);
      for (const id of aIds) await walkTo(id, "live");
      expect((await svc.removeClaim(t.actor, t.org, a)).kind).toBe("ok");
      for (const id of b.ids) {
        const held = await svc.setDomainHold(platformActor(), id, "paused", "Paused while the dispute is reviewed.");
        expect(held.kind).toBe("ok");
      }
      await tick(w, t.org);
      await tick(w, t.org);
      await tick(w, t.org);
      expect((await domainRows(t.org, sql`claim_name = ${b.name}`)).map((r) => r.state)).toEqual(["live", "live"]);
      expect(await canonicalHosts(t.org)).toEqual([]);

      const www = String((await domainRows(t.org, sql`hostname = ${"www." + b.name}`))[0]!.id);
      await svc.setDomainHold(platformActor(), www, null, null);
      await tick(w, t.org, 2 * HOUR);
      // The apex is still held; the www host is the only candidate.
      expect(await canonicalHosts(t.org)).toEqual([`www.${b.name}`]);
    });
  });

  // ===================================================================
  describe("a closed organization's domains are removed by the sweep (org_closed)", () => {
    it("live -> parked and pending -> released with cause org_closed, then the parked rows still go through grace and detach", async () => {
      const t = await tenant();
      const w = world();
      const p = await livePair(t, w);
      const single = `www.${claim("solo")}`;
      const rs = await claimOk(t, single);
      const soloId = rs.created[0]!.id;

      await q(sql`update organizations set lifecycle_status = 'dissolved' where id = ${t.org}`);
      mockEnqueue.mockClear();
      const providerCallsBefore = w.hosting.calls.length;
      const summary = await tick(w, t.org);
      expect(summary.outcomes).toEqual({ removed: 2 });
      for (const id of p.ids) {
        expect(await stateOf(id)).toBe("parked");
        const parked = (await auditFor([id])).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_PARKED);
        expect(parked).toHaveLength(1);
        expect(parked[0]!.metadata).toMatchObject({ releaseCause: "org_closed", actorKind: "machine", trigger: "org_closed" });
      }
      expect(await stateOf(soloId)).toBe("released");
      expect((await domainRows(t.org, sql`id = ${soloId}`))[0]!.release_cause).toBe("org_closed");
      expect(w.hosting.calls.length).toBe(providerCallsBefore); // removal darkens; it makes no provider call
      expect(subjectsLike(/domain was removed/i).length).toBeGreaterThan(0);

      // Parked rows of a closed org keep going: grace, then the detach.
      for (const id of p.ids) await backdateDomainClock(fx.platform, id, { graceEndsAt: new Date(Date.now() - 60_000) });
      await tick(w, t.org);
      expect(await stateOf(p.ids[0]!)).toBe("release_pending");
      await tick(w, t.org);
      expect(await stateOf(p.ids[0]!)).toBe("released");
      expect(w.hosting.isAttached(p.hosts[0]!)).toBe(false);
      await expectGuardsEnabled();
    });
  });

  // ===================================================================
  describe("platform operations", () => {
    async function insertMail(org: string): Promise<string> {
      const host = claim("mail");
      const [r] = await q(sql`
        insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
        values (${org}, 'mail', ${host}, ${host}, null, ${"m".repeat(32)}, 'platform', ${fx.actingUserId})
        returning id`);
      return String(r!.id);
    }
    const holdAudit = async (id: string) =>
      (await auditFor([id])).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_HOLD_SET || a.action === AUDIT_ACTIONS.DOMAIN_HOLD_CLEARED);

    describe("setDomainHold (pause / dispute / resume)", () => {
      it("is platform-only and needs a real reason to set a hold", async () => {
        const t = await tenant();
        const w = world();
        const p = await readyPair(t, w);
        const id = p.ids[0]!;
        for (const actor of [t.actor, machine]) {
          expect(await svc.setDomainHold(actor, id, "paused", "A perfectly good reason here.")).toEqual({ kind: "forbidden" });
        }
        for (const bad of [null, "", "   ", "too short", "x".repeat(501)]) {
          expect(await svc.setDomainHold(platformActor(), id, "paused", bad), String(bad)).toEqual({ kind: "invalid_reason" });
        }
        expect(await svc.setDomainHold(platformActor(), "00000000-0000-4000-8000-000000000000", "paused", "A perfectly good reason here.")).toEqual({ kind: "not_found" });
        expect((await domainRows(t.org))[0]!.platform_hold).toBeNull();
        expect(await holdAudit(id)).toHaveLength(0);
      });

      it("pause -> dispute -> resume: columns, ONE audit row per change, the holders told, no change = no audit", async () => {
        await withPlatformAdmin(async () => {
          const t = await tenant();
          const w = world();
          const p = await livePair(t, w);
          const id = p.ids[0]!;
          mockEnqueue.mockClear();

          const paused = await svc.setDomainHold(platformActor(), id, "paused", "  Paused pending a support review.  ");
          expect(paused).toMatchObject({ kind: "ok", changed: true });
          const row = (await domainRows(t.org, sql`id = ${id}`))[0]!;
          expect(row).toMatchObject({ platform_hold: "paused", hold_reason: "Paused pending a support review.", state: "live" });
          let audit = await holdAudit(id);
          expect(audit).toHaveLength(1);
          expect(audit[0]).toMatchObject({ action: AUDIT_ACTIONS.DOMAIN_HOLD_SET, actor_user_id: fx.actingUserId });
          expect(audit[0]!.metadata).toMatchObject({ hold: "paused", previousHold: null, reason: "Paused pending a support review.", actorKind: "platform", state: "live" });
          expect(subjectsLike(/domain was paused/i).length).toBeGreaterThan(0);

          mockEnqueue.mockClear();
          expect(await svc.setDomainHold(platformActor(), id, "paused", "Same hold, different words entirely.")).toMatchObject({ kind: "ok", changed: false });
          expect(await holdAudit(id)).toHaveLength(1);
          expect(emails()).toHaveLength(0);

          expect(await svc.setDomainHold(platformActor(), id, "disputed", "Another organization disputes this name.")).toMatchObject({ changed: true });
          audit = await holdAudit(id);
          expect(audit).toHaveLength(2);
          expect(audit[1]!.metadata).toMatchObject({ hold: "disputed", previousHold: "paused" });

          mockEnqueue.mockClear();
          expect(await svc.setDomainHold(platformActor(), id, null, null)).toMatchObject({ kind: "ok", changed: true });
          expect((await domainRows(t.org, sql`id = ${id}`))[0]).toMatchObject({ platform_hold: null, hold_reason: null });
          audit = await holdAudit(id);
          expect(audit).toHaveLength(3);
          expect(audit[2]).toMatchObject({ action: AUDIT_ACTIONS.DOMAIN_HOLD_CLEARED });
          expect(audit[2]!.metadata).toMatchObject({ hold: null, previousHold: "disputed" });
          expect(subjectsLike(/domain was resumed/i).length).toBeGreaterThan(0);
        });
      });

      it("a hold darkens serving but not the watching: a paused live host is still checked and keeps its state", async () => {
        const t = await tenant();
        const w = world();
        const p = await livePair(t, w);
        await svc.setDomainHold(platformActor(), p.ids[0]!, "paused", "Paused pending a support review.");
        const before = (await domainRows(t.org, sql`id = ${p.ids[0]}`))[0]!;
        await tick(w, t.org, 2 * HOUR);
        const after = (await domainRows(t.org, sql`id = ${p.ids[0]}`))[0]!;
        expect(after.state).toBe("live");
        expect(Number(new Date(String(after.last_checked_at)))).toBeGreaterThan(Number(new Date(String(before.last_checked_at))));
      });

      it("a terminal row cannot be held", async () => {
        const t = await tenant();
        const w = world();
        const p = await readyPair(t, w);
        await step(p.ids[0]!, "released", "removed");
        expect(await svc.setDomainHold(platformActor(), p.ids[0]!, "paused", "A perfectly good reason here.")).toEqual({ kind: "terminal" });
      });
    });

    describe("forceReleaseDomain (skips the grace; also eviction and dispute resolution)", () => {
      it("is platform-only and needs a reason of 10-500 characters", async () => {
        const t = await tenant();
        const w = world();
        const p = await readyPair(t, w);
        const id = p.ids[0]!;
        for (const actor of [t.actor, machine]) {
          expect(await svc.forceReleaseDomain(actor, id, { reason: "A perfectly good reason here." })).toEqual({ kind: "forbidden" });
        }
        for (const bad of ["", "short", "x".repeat(501)]) {
          expect(await svc.forceReleaseDomain(platformActor(), id, { reason: bad })).toEqual({ kind: "invalid_reason" });
        }
        expect(await svc.forceReleaseDomain(platformActor(), "00000000-0000-4000-8000-000000000000", { reason: "A perfectly good reason here." })).toEqual({ kind: "not_found" });
        expect(await stateOf(id)).toBe("pending");
      });

      it("a pending host is released at once with the reason on record; the holders are told", async () => {
        await withPlatformAdmin(async () => {
          const t = await tenant();
          const w = world();
          const p = await readyPair(t, w);
          mockEnqueue.mockClear();
          const r = await svc.forceReleaseDomain(platformActor(), p.ids[0]!, { reason: "Released to resolve a support dispute." });
          expect(r).toMatchObject({ kind: "ok", domain: { state: "released" } });
          const row = (await domainRows(t.org, sql`id = ${p.ids[0]}`))[0]!;
          expect(row).toMatchObject({ state: "released", release_cause: "force_released", force_release_reason: "Released to resolve a support dispute." });
          const a = (await auditFor([p.ids[0]!])).filter((x) => x.action === AUDIT_ACTIONS.DOMAIN_RELEASED);
          expect(a).toHaveLength(1);
          expect(a[0]).toMatchObject({ actor_user_id: fx.actingUserId });
          expect(a[0]!.metadata).toMatchObject({ reason: "Released to resolve a support dispute.", releaseCause: "force_released", actorKind: "platform", event: "force_release" });
          expect(subjectsLike(/released by PresbyPortal support/i).length).toBeGreaterThan(0);
          expect(JSON.stringify(await auditFor(p.ids))).not.toContain(p.token);
        });
      });

      it("a live canonical host is handed to release_pending, loses the canonical role, and the next sweep detaches it", async () => {
        const t = await tenant();
        const w = world();
        const p = await livePair(t, w);
        const www = String((await domainRows(t.org, sql`hostname = ${"www." + p.name}`))[0]!.id);
        const r = await svc.forceReleaseDomain(platformActor(), www, { reason: "Evicted after the dispute was resolved.", cause: "evicted" });
        expect(r).toMatchObject({ kind: "ok", domain: { state: "release_pending", webRole: "alias" } });
        expect((await domainRows(t.org, sql`id = ${www}`))[0]).toMatchObject({ release_cause: "evicted", force_release_reason: "Evicted after the dispute was resolved." });
        expect(w.hosting.isAttached(`www.${p.name}`)).toBe(true); // intent first
        await tick(w, t.org);
        expect(await stateOf(www)).toBe("released");
        expect(w.hosting.isAttached(`www.${p.name}`)).toBe(false);
        expect((await trail(www)).slice(-2)).toEqual([AUDIT_ACTIONS.DOMAIN_RELEASE_REQUESTED, AUDIT_ACTIONS.DOMAIN_RELEASED]);
        // The apex (an alias that is still live) is untouched, and with no canonical left the sweep promotes it.
        expect(await stateOf(p.ids.find((id) => id !== www)!)).toBe("live");
      });

      it("final and already-releasing rows answer for themselves; a lapsed MAIL row is released directly", async () => {
        const t = await tenant();
        const w = world();
        const p = await readyPair(t, w);
        await step(p.ids[0]!, "released", "removed");
        expect(await svc.forceReleaseDomain(platformActor(), p.ids[0]!, { reason: "A perfectly good reason here." })).toEqual({ kind: "already_final" });
        await walkTo(p.ids[1]!, "release_pending");
        expect(await svc.forceReleaseDomain(platformActor(), p.ids[1]!, { reason: "A perfectly good reason here." })).toEqual({ kind: "already_releasing" });

        const mail = await insertMail(t.org);
        await step(mail, "verified");
        await step(mail, "lapsed");
        expect(await svc.forceReleaseDomain(platformActor(), mail, { reason: "Releasing a lapsed mail name." })).toMatchObject({ kind: "ok", domain: { state: "released" } });
        expect(w.hosting.calls).toHaveLength(0);
      });
    });

    describe("checkDomainPlatform", () => {
      it("is platform-only, finds the claim from the row, and runs the same routine as a forced check", async () => {
        const t = await tenant();
        const w = world();
        const p = await readyPair(t, w);
        for (const id of p.ids) await walkTo(id, "verified");
        expect(await svc.checkDomainPlatform(t.actor, p.ids[0]!, { deps: w.deps })).toEqual({ kind: "forbidden" });
        expect(await svc.checkDomainPlatform(platformActor(), "00000000-0000-4000-8000-000000000000", { deps: w.deps })).toEqual({ kind: "not_found" });
        expect(w.hosting.calls).toHaveLength(0);

        const r = await svc.checkDomainPlatform(platformActor(), p.ids[0]!, { deps: w.deps });
        expect(r).toMatchObject({ kind: "ok", outcome: "attached" });
        expect((await domainRows(t.org)).map((x) => x.state)).toEqual(["attached", "attached"]);
        const attached = (await auditFor(p.ids)).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_ATTACHED);
        expect(attached).toHaveLength(2);
        expect(attached[0]!.metadata).toMatchObject({ actorKind: "platform", trigger: "check_now" });
        expect(attached[0]!.actor_user_id).toBe(fx.actingUserId);
      });
    });
  });

  // ===================================================================
  describe("a church's own 'Check now' drives the same lifecycle", () => {
    it("verified -> attached in ONE click (the intent commit, then the provider call), audited as the tenant with trigger check_now", async () => {
      const t = await tenant();
      const w = world();
      const p = await readyPair(t, w);
      for (const id of p.ids) await walkTo(id, "verified");
      const res = await svc.checkClaim(t.actor, t.org, p.name, { forced: true, deps: w.deps });
      expect(res).toMatchObject({ kind: "ok", outcome: "attached", proof: "present" });
      expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["attached", "attached"]);
      const audit = (await auditFor(p.ids)).filter((a) => a.action === AUDIT_ACTIONS.DOMAIN_ATTACH_REQUESTED || a.action === AUDIT_ACTIONS.DOMAIN_ATTACHED);
      expect(audit).toHaveLength(4);
      for (const a of audit) {
        expect(a.metadata).toMatchObject({ actorKind: "tenant", trigger: "check_now" });
        expect(a.actor_user_id).toBe(fx.actingUserId);
      }
    });

    it("while the provider is unconfigured a click reports honestly and changes nothing but the visible class", async () => {
      vi.stubEnv("DOMAINS_PROVIDER", "");
      const t = await tenant();
      const w = world();
      const p = await readyPair(t, w);
      for (const id of p.ids) await walkTo(id, "verified");
      const res = await svc.checkClaim(t.actor, t.org, p.name, { forced: true, deps: { dns: w.dns.observer, probe: w.probe, now: w.deps.now } });
      expect(res).toMatchObject({ kind: "ok", outcome: "attach_waiting" });
      for (const row of await domainRows(t.org)) {
        expect(row.state).toBe("attach_pending");
        expect(row.last_check_class).toBe("provider_unavailable");
      }
    });

    it("is gated exactly as before: no permission, the toggle off, or another org's claim never reaches the network", async () => {
      const w = world();
      const noPerm = await tenant();
      await q(sql`delete from role_grants where organization_id = ${noPerm.org}`);
      const off = await tenant();
      await setToggle(off.org, false);
      const a = await tenant();
      const b = await tenant();
      const pa = await readyPair(a, w);
      const deps = w.deps;
      expect((await svc.checkClaim(noPerm.actor, noPerm.org, "x.invalid", { forced: false, deps })).kind).toBe("forbidden");
      expect((await svc.checkClaim(off.actor, off.org, "x.invalid", { forced: false, deps })).kind).toBe("feature_off");
      expect((await svc.checkClaim(b.actor, b.org, pa.name, { forced: false, deps })).kind).toBe("not_found");
      expect(w.dns.queryCount()).toBe(0);
      expect(w.hosting.calls).toHaveLength(0);
    });
  });

  // ===================================================================
  describe("secrets", () => {
    it("across a full walk, the proof token appears in no audit row, no notification and no log line", async () => {
      await withPlatformAdmin(async () => {
        const t = await tenant();
        const w = world();
        const logs = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
        try {
          const p = await livePair(t, w);
          w.dns.clearRecords("TXT", proofName(p.name));
          for (let i = 0; i < 6; i += 1) await tick(w, t.org, 2 * HOUR);
          for (const id of p.ids) await backdateDomainClock(fx.platform, id, { graceEndsAt: new Date(Date.now() - 60_000) });
          await tick(w, t.org);
          await tick(w, t.org);
          expect((await domainRows(t.org)).map((r) => r.state)).toEqual(["released", "released"]);

          const dump = JSON.stringify([
            await auditFor(p.ids),
            emails(),
            logs.map((l) => l.mock.calls),
          ]);
          expect(dump).not.toContain(p.token);
          // The token is not in the observation we show either (the checklist derives the record from the row, not from jsonb).
          expect(JSON.stringify((await domainRows(t.org)).map((r) => r.observation))).not.toContain(p.token);
        } finally {
          for (const l of logs) l.mockRestore();
        }
      });
    });
  });
});
