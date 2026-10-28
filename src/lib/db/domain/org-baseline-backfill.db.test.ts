/**
 * drizzle/0082 on a REAL Postgres connection (docs/work-log/
 * 2026-10-28-org-baseline-backfill.md; bug-fix variant).
 *
 * THE BUG: an organization created before src/lib/org-provisioning.ts seeded
 * the derived Active Membership group and the baseline `member` role had
 * neither, so `provisioningComplete()` (src/lib/onboarding/issue.ts) refused
 * every founding-administrator invitation with `provisioning_incomplete`. Found
 * in production for one presbytery created before provisioning.
 *
 * THE SHAPE UNDER TEST: `fx.makeBareOrg()` is an organization with no derived
 * groups and no roles, the shape of a pre-provisioning org. The file is executed
 * as the owner, in one transaction (the `-1` apply), exactly as the migration
 * was applied to production.
 *
 * REGRESSION FOR the founding-administrator invitation refused at a
 * pre-provisioning organization. The "after 0082" case fails (the invitation is
 * still `provisioning_incomplete`) when the migration step is removed.
 *
 * SERIAL: the migration is global (it backfills EVERY organization missing the
 * baseline, and its stop-block counts every organization with live memberships
 * and no group), so this file must not run beside another DB suite.
 *
 * Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/org-baseline-backfill.db.test.ts
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql, type SQL } from "drizzle-orm";
import type { InvitationFixture, Row } from "@/lib/testing/invitation-fixture";

vi.mock("server-only", () => ({}));
// audit.ts imports @/auth (next-auth), which this test environment cannot load.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
const sendMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email/send", () => ({ sendEmail: sendMock }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const MIGRATION = path.join(process.cwd(), "drizzle", "0082_presby_backfill_org_baseline.sql");
const MIGRATION_TEXT = readFileSync(MIGRATION, "utf8");

describe.skipIf(!hasDb)("drizzle/0082 org baseline backfill (Postgres-backed)", { timeout: 60_000 }, () => {
  let fx: InvitationFixture;
  let issue: typeof import("@/lib/onboarding/issue");
  let inviter: string;
  const orgIds: string[] = [];

  async function q(query: SQL): Promise<Row[]> {
    return fx.q(query);
  }

  /** The migration, as the owner, in one transaction (the -1 apply). */
  async function applyMigration(): Promise<void> {
    await fx.platform.transaction(async (tx) => {
      await tx.execute(sql.raw(MIGRATION_TEXT));
    });
  }

  async function bareOrg(name: string): Promise<string> {
    const id = await fx.makeBareOrg(name, "presbytery");
    orgIds.push(id);
    return id;
  }

  /** Everything 0082 can write for one organization, as comparable counts. */
  async function baseline(orgId: string): Promise<Row> {
    const [row] = await q(sql`
      select
        (select count(*) from groups where organization_id = ${orgId}::uuid
            and derived_from = 'active_membership')::int as groups,
        (select count(*) from app_roles where organization_id = ${orgId}::uuid)::int as roles,
        (select count(*) from app_role_permissions p join app_roles r on r.id = p.role_id
            where r.organization_id = ${orgId}::uuid)::int as permissions,
        (select count(*) from role_grants where organization_id = ${orgId}::uuid)::int as grants`);
    return row!;
  }

  function invite(orgId: string, address: string) {
    return issue.createInvitation({
      organizationId: orgId,
      purpose: "founding_administrator",
      email: address,
      firstName: "Marisol",
      lastName: "Quenby",
      inviter: { userId: inviter, email: null },
    });
  }

  beforeAll(async () => {
    delete process.env.EMAIL_DEV_INTERCEPT;
    delete process.env.EMAIL_DEV_REDIRECT_TO;
    const mod = await import("@/lib/testing/invitation-fixture");
    fx = await mod.createInvitationFixture("org-baseline");
    inviter = await fx.makeUser(fx.email("inviter"));
    issue = await import("@/lib/onboarding/issue");
  });

  afterEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ id: "provider-ok" });
  });

  afterAll(async () => {
    if (!fx) return;
    try {
      for (const id of orgIds) {
        await q(sql`delete from audit_events where metadata->>'organizationId' = ${id}`);
      }
      await q(sql`delete from email_queue where to_email like 'org-baseline-%@example.invalid'`);
    } finally {
      await fx.cleanup();
    }
  });

  it("a pre-provisioning organization has no baseline and is refused; after 0082 it has the group, the member role and the grant, and is no longer refused", async () => {
    sendMock.mockResolvedValue({ id: "prov-1" });
    const orgId = await bareOrg("pre");
    const address = fx.email("fa");

    // BEFORE: the production symptom.
    expect(await baseline(orgId)).toEqual({ groups: 0, roles: 0, permissions: 0, grants: 0 });
    expect(await invite(orgId, address)).toEqual({ kind: "provisioning_incomplete" });
    expect(await q(sql`select 1 from account_invitations where organization_id = ${orgId}::uuid`)).toHaveLength(0);

    await applyMigration();

    // AFTER: exactly what org-provisioning.ts seeds at creation.
    const [group] = await q(sql`
      select g.name, g.membership_source, g.derived_from, g.is_protected, gt.key as type_key
        from groups g join group_types gt on gt.id = g.group_type_id
       where g.organization_id = ${orgId}::uuid and g.derived_from = 'active_membership'`);
    expect(group).toMatchObject({
      name: "Active Membership",
      membership_source: "derived",
      derived_from: "active_membership",
      is_protected: true,
      type_key: "roster",
    });

    const roles = await q(sql`
      select id, key, name, role_kind, is_protected from app_roles where organization_id = ${orgId}::uuid`);
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({ key: "member", name: "Member", role_kind: "constitutional", is_protected: true });

    const permissions = await q(sql`
      select permission_key from app_role_permissions where role_id = ${String(roles[0]!.id)}::uuid
       order by permission_key`);
    expect(permissions.map((r) => r.permission_key)).toEqual(["directory.view", "events.view"]);

    const grants = await q(sql`
      select g.derived_from from role_grants rg join groups g on g.id = rg.group_id
       where rg.organization_id = ${orgId}::uuid and rg.role_id = ${String(roles[0]!.id)}::uuid`);
    expect(grants).toEqual([{ derived_from: "active_membership" }]);

    // The invitation the operator could not send now goes out.
    const after = await invite(orgId, address);
    expect(after.kind).toBe("ok");
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [invitation] = await q(sql`
      select purpose from account_invitations where organization_id = ${orgId}::uuid`);
    expect(invitation).toMatchObject({ purpose: "founding_administrator" });
  });

  it("a second run inserts nothing, and leaves an already-provisioned organization alone", async () => {
    const orgId = await bareOrg("twice");
    const provisioned = await fx.makeOrg("already-provisioned");
    orgIds.push(provisioned);

    await applyMigration();
    const first = await baseline(orgId);
    expect(first).toEqual({ groups: 1, roles: 1, permissions: 2, grants: 1 });
    const provisionedBefore = await baseline(provisioned);

    await applyMigration();
    expect(await baseline(orgId)).toEqual(first);
    expect(await baseline(provisioned)).toEqual(provisionedBefore);
  });

  it("leaves a tenant-held `member` role alone: the group is added, the role and its grants are not touched", async () => {
    const orgId = await bareOrg("held");
    const [role] = await q(sql`
      insert into app_roles (organization_id, key, name, role_kind)
      values (${orgId}::uuid, 'member', 'Tenant member', 'custom') returning id`);
    await q(sql`insert into app_role_permissions (role_id, permission_key) values (${String(role!.id)}::uuid, 'events.view')`);

    await applyMigration();

    expect((await baseline(orgId)).groups).toBe(1);
    const roles = await q(sql`select id, name, role_kind from app_roles where organization_id = ${orgId}::uuid`);
    expect(roles).toEqual([{ id: role!.id, name: "Tenant member", role_kind: "custom" }]);
    const permissions = await q(sql`select permission_key from app_role_permissions where role_id = ${String(role!.id)}::uuid`);
    expect(permissions).toEqual([{ permission_key: "events.view" }]);
    expect((await baseline(orgId)).grants).toBe(0);
  });

  // Last on purpose: it leaves an organization with a live membership and no
  // group, which the migration's stop-block refuses for EVERY run until the
  // fixture is removed at teardown.
  it("the stop-block refuses an organization that has live memberships and no group, and writes nothing", async () => {
    const orgId = await bareOrg("members");
    const person = await fx.makePerson("Odalys", "Pennick");
    // Since 0017 the sync trigger refuses a membership in an organization with
    // no group, so the legacy shape (a membership that predates the group) is
    // built with that trigger off for the one insert, as the cleanup does for
    // its own guard.
    await q(sql`alter table memberships disable trigger memberships_sync_derived_group`);
    try {
      await fx.addMember(orgId, person);
    } finally {
      await q(sql`alter table memberships enable trigger memberships_sync_derived_group`);
    }

    const refused = await applyMigration().then(
      () => null,
      (error: unknown) => {
        const messages: string[] = [];
        for (let e: unknown = error; e && messages.length < 6; e = (e as { cause?: unknown }).cause) {
          messages.push(String((e as { message?: unknown }).message));
        }
        return messages.join(" | ");
      },
    );
    expect(refused, "the stop-block raised").toMatch(/lack the active_membership group but have live memberships/);

    expect(await baseline(orgId)).toEqual({ groups: 0, roles: 0, permissions: 0, grants: 0 });
  });
});
