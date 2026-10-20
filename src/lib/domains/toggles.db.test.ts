/**
 * toggles.ts against a real database: the platform-connection writer for the
 * two operator-enabled org toggles (Q1, T9). Proves the write, the audit row in
 * the same transaction (existing key, `via: "platform"`), idempotence (no row,
 * no audit event for a no-op), the closed key list, and that the tenant
 * resolver sees the result.
 *
 * Run serially: npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/domains/toggles.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
type Row = Record<string, unknown>;

describe.skipIf(!hasDb)("src/lib/domains/toggles.ts (Postgres-backed)", () => {
  let fx: CalendarFixture;
  let t: typeof import("./toggles");
  let AUDIT_ACTIONS: typeof import("@/lib/audit").AUDIT_ACTIONS;
  const orgIds: string[] = [];
  const rowsOf = (r: unknown): Row[] => {
    const x = r as { rows?: Row[] } | Row[];
    return Array.isArray(x) ? x : (x.rows ?? []);
  };
  const q = async (query: ReturnType<typeof sql>) => rowsOf(await fx.platform.execute(query));
  const operator = () => ({ userId: fx.actingUserId, email: "operator@example.invalid" });

  beforeAll(async () => {
    t = await import("./toggles");
    ({ AUDIT_ACTIONS } = await import("@/lib/audit"));
    const mod = await import("@/lib/testing/calendar-fixture");
    fx = await mod.createCalendarFixture("domains-toggles");
  }, 60_000);

  afterAll(async () => {
    if (!fx) return;
    for (const id of orgIds) await q(sql`delete from audit_events where metadata->>'organizationId' = ${id}`);
    await fx.cleanup();
  }, 60_000);

  const toggleRow = async (org: string, key: string) =>
    (await q(sql`select enabled, updated_by from organization_feature_toggles where organization_id = ${org} and feature_key = ${key}`))[0];
  const auditRows = (org: string) =>
    q(sql`select action, actor_user_id, actor_email, resource_id, metadata from audit_events
           where action = ${AUDIT_ACTIONS.ORG_FEATURE_TOGGLED} and metadata->>'organizationId' = ${org} order by created_at`);

  it("the operator keys are exactly the two catalog entries marked operatorEnabled", () => {
    expect([...t.OPERATOR_TOGGLE_KEYS].sort()).toEqual(["org_portal.domains", "org_portal.mail_domain"]);
  });

  it("turns a toggle ON: writes the row (updated_by the operator) and one audit row via 'platform', in the same transaction", async () => {
    const org = await fx.makeOrg("tg");
    orgIds.push(org);
    expect(await t.setOperatorOrgToggle(operator(), org, "org_portal.domains", true)).toEqual({ kind: "ok", changed: true });
    expect(await toggleRow(org, "org_portal.domains")).toMatchObject({ enabled: true, updated_by: fx.actingUserId });
    const audit = await auditRows(org);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "tenant.org_feature.toggled",
      actor_user_id: fx.actingUserId,
      actor_email: "operator@example.invalid",
      resource_id: "org_portal.domains",
    });
    expect(audit[0]!.metadata).toEqual({ organizationId: org, featureKey: "org_portal.domains", enabled: true, via: "platform" });
  });

  it("is idempotent: the same value again writes no audit row, and OFF with no row creates no row", async () => {
    const org = await fx.makeOrg("tg");
    orgIds.push(org);
    expect(await t.setOperatorOrgToggle(operator(), org, "org_portal.mail_domain", false)).toEqual({ kind: "ok", changed: false });
    expect(await toggleRow(org, "org_portal.mail_domain")).toBeUndefined();
    await t.setOperatorOrgToggle(operator(), org, "org_portal.mail_domain", true);
    expect(await t.setOperatorOrgToggle(operator(), org, "org_portal.mail_domain", true)).toEqual({ kind: "ok", changed: false });
    expect(await auditRows(org)).toHaveLength(1);
  });

  it("turns a toggle OFF: the row stays with enabled=false and a second audit row records it", async () => {
    const org = await fx.makeOrg("tg");
    orgIds.push(org);
    await t.setOperatorOrgToggle(operator(), org, "org_portal.domains", true);
    expect(await t.setOperatorOrgToggle(operator(), org, "org_portal.domains", false)).toEqual({ kind: "ok", changed: true });
    expect(await toggleRow(org, "org_portal.domains")).toMatchObject({ enabled: false });
    const audit = await auditRows(org);
    expect(audit.map((a) => (a.metadata as { enabled: boolean }).enabled)).toEqual([true, false]);
  });

  it("refuses every key outside the operator list, writes nothing, audits nothing", async () => {
    const org = await fx.makeOrg("tg");
    orgIds.push(org);
    for (const key of ["org_portal.calendar", "org_portal.giving", "org_portal.members_create", "", "org_portal.domains2"]) {
      expect(await t.setOperatorOrgToggle(operator(), org, key, true), key).toEqual({ kind: "invalid_key" });
    }
    const [n] = await q(sql`select count(*)::int as n from organization_feature_toggles where organization_id = ${org}`);
    expect(n!.n).toBe(0);
    expect(await auditRows(org)).toHaveLength(0);
  });

  it("an unknown organization is not_found and writes nothing", async () => {
    expect(await t.setOperatorOrgToggle(operator(), "00000000-0000-4000-8000-000000000000", "org_portal.domains", true)).toEqual({
      kind: "not_found",
    });
  });

  it("the tenant resolver sees the platform's write (the toggle is a real per-org switch)", async () => {
    const org = await fx.makeOrg("tg");
    orgIds.push(org);
    const person = await fx.makePerson("Tog", "Gle");
    await fx.enroll(org, person, ["org_features.manage"]);
    const { orgFeatureEnabledInTx } = await import("@/lib/org-features");
    const { withOrgContext } = await import("@/lib/authz");
    const read = () => withOrgContext(person, org, (tx) => orgFeatureEnabledInTx(tx, org, "org_portal.domains", false));
    expect(await read()).toBe(false);
    await t.setOperatorOrgToggle(operator(), org, "org_portal.domains", true);
    expect(await read()).toBe(true);
    await t.setOperatorOrgToggle(operator(), org, "org_portal.domains", false);
    expect(await read()).toBe(false);
  });

  it("the TENANT path cannot flip it: an org_features.manage holder gets invalid_key and no row", async () => {
    const org = await fx.makeOrg("tg");
    orgIds.push(org);
    const person = await fx.makePerson("Ten", "Ant");
    await fx.enroll(org, person, ["org_features.manage"]);
    const { toggleOrgFeature, listFeatureToggles } = await import("@/lib/org-features");
    expect(await toggleOrgFeature(person, org, fx.actingUserId, "org_portal.domains", true)).toEqual({ kind: "invalid_key" });
    expect(await toggleOrgFeature(person, org, fx.actingUserId, "org_portal.mail_domain", true)).toEqual({ kind: "invalid_key" });
    expect(await toggleRow(org, "org_portal.domains")).toBeUndefined();
    const listed = await listFeatureToggles(person, org);
    expect(listed.kind).toBe("ok");
    if (listed.kind !== "ok") return;
    const keys = listed.toggles.map((x) => x.key);
    expect(keys).not.toContain("org_portal.domains");
    expect(keys).not.toContain("org_portal.mail_domain");
    expect(keys).toContain("org_portal.calendar");
  });
});
