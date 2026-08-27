/**
 * Integration tests for src/lib/role-definitions.ts — run against a REAL
 * Postgres connection, not mocked. Follows role-grants.test.ts's exact
 * harness: the `hasDb` skip-guard, dynamic imports inside `beforeAll` (this
 * file's own top-level import of `./role-definitions` would otherwise reach
 * `@/lib/db`'s module-scope pool construction before DATABASE_URL is
 * confirmed set), and a self-contained fixture created and torn down per
 * file rather than mutating `scripts/seed-dev.sql`'s fixture ids.
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is SKIPPED
 * there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run src/lib/role-definitions.test.ts
 *
 * THREE ORGANIZATIONS:
 *   orgA — the general-purpose fixture: an admin (holds roles.manage AND
 *          directory.view), a narrow member (directory.view only, no
 *          roles.manage — forbidden tests), a bare roles.manage holder
 *          (nothing else — the escalation fixture), a protected
 *          (constitutional) role, a custom role with one current holder
 *          (holderCount / deactivation fixtures), and a global template row
 *          this file seeds itself (self-sufficient, not the migration's
 *          fixed-id committee_chair row).
 *   orgB — exists only to prove the app_roles RLS split: a template row is
 *          visible from an org that never created it, and duplicate_key is
 *          scoped per-org (same key at orgB does not collide with orgA).
 *   orgLockout — two custom roles, each carrying roles.manage, held by two
 *          different people — the "remove one succeeds, the survivor is
 *          blocked" cascade for BOTH setRolePermissions and deactivateRole,
 *          mirroring role-grants.test.ts's own two-holder org shape.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "role-definitions.ts (Postgres-backed, real dev database)",
  () => {
    let listPermissionCatalog: typeof import("./role-definitions").listPermissionCatalog;
    let listRoleDefinitions: typeof import("./role-definitions").listRoleDefinitions;
    let getRoleDefinition: typeof import("./role-definitions").getRoleDefinition;
    let listTemplateRoles: typeof import("./role-definitions").listTemplateRoles;
    let createRole: typeof import("./role-definitions").createRole;
    let setRolePermissions: typeof import("./role-definitions").setRolePermissions;
    let deactivateRole: typeof import("./role-definitions").deactivateRole;
    let adoptTemplate: typeof import("./role-definitions").adoptTemplate;
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let organizations: typeof import("@/lib/db/domain/org").organizations;
    let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
    let groups: typeof import("@/lib/db/domain/groups").groups;
    let people: typeof import("@/lib/db/domain/people").people;
    let memberships: typeof import("@/lib/db/domain/people").memberships;
    let permissions: typeof import("@/lib/db/domain/authz").permissions;
    let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
    let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
    let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
    let users: typeof import("@/lib/db/schema").users;

    let orgA: string;
    let orgB: string;
    let orgLockout: string;

    let adminPerson: string; // orgA — roles.manage AND directory.view
    let narrowPerson: string; // orgA — directory.view only, no roles.manage
    let barePerson: string; // orgA — roles.manage ONLY, nothing else
    let holderPerson: string; // orgA — holds customRoleA
    let orgBPerson: string; // orgB — roles.manage, for cross-org not_found / per-org key scoping tests

    let roleAdminRoleA: string; // orgA — protected, carries roles.manage
    let customRoleA: string; // orgA — carries directory.view, held by holderPerson
    let customRoleAGrantId: string;
    let editableRoleA: string; // orgA — carries directory.view, held by nobody; setRolePermissions's own scratch role

    let templateRoleId: string; // organization_id IS NULL, this file's own

    let lockoutPersonX: string;
    let lockoutPersonY: string;
    let lockoutRoleX: string; // orgLockout — carries roles.manage
    let lockoutRoleY: string; // orgLockout — carries roles.manage

    let grantingUserId: string;

    beforeAll(async () => {
      ({
        listPermissionCatalog,
        listRoleDefinitions,
        getRoleDefinition,
        listTemplateRoles,
        createRole,
        setRolePermissions,
        deactivateRole,
        adoptTemplate,
      } = await import("./role-definitions"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations } = await import("@/lib/db/domain/org"));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
      ({ people, memberships } = await import("@/lib/db/domain/people"));
      ({ permissions, appRoles, appRolePermissions, roleGrants } = await import(
        "@/lib/db/domain/authz"
      ));
      ({ users } = await import("@/lib/db/schema"));

      const platform = getPlatformDb();
      const stamp = Date.now();

      async function makeOrg(label: string) {
        const [row] = await platform
          .insert(organizations)
          .values({
            organizationType: "congregation",
            name: `Fixture Congregation ${label} for role-definitions.test.ts`,
            slug: `role-definitions-test-${label.toLowerCase()}-${stamp}`,
            path: `role_definitions_test_${label.toLowerCase()}_${stamp}`,
            platformStatus: "unmanaged",
          })
          .returning({ id: organizations.id });
        return row!.id;
      }

      orgA = await makeOrg("A");
      orgB = await makeOrg("B");
      orgLockout = await makeOrg("Lockout");

      // drizzle/0017's sync trigger requires an active_membership derived
      // group to exist before any memberships insert at that org.
      const [gt] = await platform
        .insert(groupTypes)
        .values({ organizationId: null, key: "roster", name: "Roster" })
        .onConflictDoNothing()
        .returning({ id: groupTypes.id });
      let groupTypeId = gt?.id;
      if (!groupTypeId) {
        const [existing] = await platform
          .select({ id: groupTypes.id })
          .from(groupTypes)
          .where(eq(groupTypes.key, "roster"))
          .limit(1);
        groupTypeId = existing!.id;
      }

      async function activeMembershipGroup(organizationId: string) {
        const [row] = await platform
          .insert(groups)
          .values({
            organizationId,
            groupTypeId,
            name: "Active Membership",
            membershipSource: "derived",
            derivedFrom: "active_membership",
            isProtected: true,
          })
          .returning({ id: groups.id });
        return row!.id;
      }

      await activeMembershipGroup(orgA);
      await activeMembershipGroup(orgB);
      await activeMembershipGroup(orgLockout);

      // Permission catalog — already seeded by migrations in a real dev
      // database, but onConflictDoNothing keeps this file self-sufficient.
      await platform
        .insert(permissions)
        .values([
          {
            key: "directory.view",
            module: "directory",
            description: "Browse the congregation directory",
            sensitivityTier: 1,
          },
          {
            key: "roles.manage",
            module: "authz",
            description:
              "Create, edit the permission set of, and deactivate this organization's custom roles",
            sensitivityTier: 1,
          },
        ])
        .onConflictDoNothing();

      const [userRow] = await platform
        .insert(users)
        .values({
          email: `role-definitions-test-granter-${stamp}@example.invalid`,
          name: "Role Definitions Test Granter",
        })
        .returning({ id: users.id });
      grantingUserId = userRow!.id;

      // --- orgA -------------------------------------------------------

      const [roleAdminRow] = await platform
        .insert(appRoles)
        .values({
          organizationId: orgA,
          key: "role_admin_test",
          name: "Role Administrator (test)",
          roleKind: "constitutional",
          isProtected: true,
        })
        .returning({ id: appRoles.id });
      roleAdminRoleA = roleAdminRow!.id;
      await platform
        .insert(appRolePermissions)
        .values({ roleId: roleAdminRoleA, permissionKey: "roles.manage" });

      const [directoryRoleRow] = await platform
        .insert(appRoles)
        .values({
          organizationId: orgA,
          key: "directory_viewer_test",
          name: "Directory Viewer (test)",
          roleKind: "custom",
          isProtected: false,
        })
        .returning({ id: appRoles.id });
      const directoryRoleA = directoryRoleRow!.id;
      await platform
        .insert(appRolePermissions)
        .values({ roleId: directoryRoleA, permissionKey: "directory.view" });

      const [customRoleRow] = await platform
        .insert(appRoles)
        .values({
          organizationId: orgA,
          key: "committee_role_test",
          name: "Committee Role (test)",
          roleKind: "custom",
          isProtected: false,
        })
        .returning({ id: appRoles.id });
      customRoleA = customRoleRow!.id;
      await platform
        .insert(appRolePermissions)
        .values({ roleId: customRoleA, permissionKey: "directory.view" });

      // A SEPARATE custom role, held by nobody, reserved for
      // setRolePermissions's own escalation/delta/removal tests — so that
      // describe block's sequential mutations never interfere with
      // customRoleA (reserved for holderCount / getRoleDefinition /
      // deactivateRole, which must see a stable, single holder throughout).
      const [editableRoleRow] = await platform
        .insert(appRoles)
        .values({
          organizationId: orgA,
          key: "editable_role_test",
          name: "Editable Role (test)",
          roleKind: "custom",
          isProtected: false,
        })
        .returning({ id: appRoles.id });
      editableRoleA = editableRoleRow!.id;
      await platform
        .insert(appRolePermissions)
        .values({ roleId: editableRoleA, permissionKey: "directory.view" });

      async function person(first: string, last: string) {
        const [p] = await platform
          .insert(people)
          .values({ firstName: first, lastName: last })
          .returning({ id: people.id });
        return p!.id;
      }

      adminPerson = await person("Perpetua", "Nkemelu");
      narrowPerson = await person("Cormac", "Delacroix-Aoyama");
      barePerson = await person("Ottilie", "Vasquez");
      holderPerson = await person("Bartholomew", "Enescu");

      async function membership(organizationId: string, personId: string) {
        await platform.insert(memberships).values({
          organizationId,
          personId,
          engagementStatus: "regular",
          currentRoll: "active",
        });
      }

      await membership(orgA, adminPerson);
      await membership(orgA, narrowPerson);
      await membership(orgA, barePerson);
      await membership(orgA, holderPerson);

      await platform.insert(roleGrants).values({
        organizationId: orgA,
        roleId: roleAdminRoleA,
        personId: adminPerson,
        startsOn: "2020-01-01",
        grantedBy: grantingUserId,
      });
      await platform.insert(roleGrants).values({
        organizationId: orgA,
        roleId: directoryRoleA,
        personId: adminPerson,
        startsOn: "2020-01-01",
        grantedBy: grantingUserId,
      });
      await platform.insert(roleGrants).values({
        organizationId: orgA,
        roleId: directoryRoleA,
        personId: narrowPerson,
        startsOn: "2020-01-01",
        grantedBy: grantingUserId,
      });
      // barePerson holds roles.manage and NOTHING else — the escalation
      // fixture: passes every gate, but cannot create/adopt a role carrying
      // directory.view, which they don't personally hold.
      await platform.insert(roleGrants).values({
        organizationId: orgA,
        roleId: roleAdminRoleA,
        personId: barePerson,
        startsOn: "2020-01-01",
        grantedBy: grantingUserId,
      });
      const [customGrant] = await platform
        .insert(roleGrants)
        .values({
          organizationId: orgA,
          roleId: customRoleA,
          personId: holderPerson,
          startsOn: "2020-01-01",
          grantedBy: grantingUserId,
        })
        .returning({ id: roleGrants.id });
      customRoleAGrantId = customGrant!.id;

      // A global template row, self-seeded (not the migration's fixed-id
      // committee_chair row) so this file works whether or not
      // drizzle/0032_presby_role_definitions.sql has landed on whatever
      // database runs it.
      const [templateRow] = await platform
        .insert(appRoles)
        .values({
          organizationId: null,
          organizationTypeScope: null,
          key: `template_role_test_${stamp}`,
          name: "Template Role (test)",
          roleKind: "constitutional",
          isProtected: true,
        })
        .returning({ id: appRoles.id });
      templateRoleId = templateRow!.id;
      await platform
        .insert(appRolePermissions)
        .values({ roleId: templateRoleId, permissionKey: "directory.view" });

      // --- orgB: a real membership, for cross-org not_found / per-org key
      //     scoping tests (a person with NO relationship at orgB at all
      //     would trip withOrgContext's own OrgAccessError instead of
      //     reaching this module's not_found result). ---------------------

      const [orgBRoleRow] = await platform
        .insert(appRoles)
        .values({
          organizationId: orgB,
          key: "role_admin_test_b",
          name: "Role Administrator B (test)",
          roleKind: "constitutional",
          isProtected: true,
        })
        .returning({ id: appRoles.id });
      await platform
        .insert(appRolePermissions)
        .values({ roleId: orgBRoleRow!.id, permissionKey: "roles.manage" });

      orgBPerson = await person("Guillaume", "Achterberg-Ossai");
      await membership(orgB, orgBPerson);
      await platform.insert(roleGrants).values({
        organizationId: orgB,
        roleId: orgBRoleRow!.id,
        personId: orgBPerson,
        startsOn: "2020-01-01",
        grantedBy: grantingUserId,
      });

      // --- orgLockout: two roles.manage holders, via two DIFFERENT roles --

      const [roleXRow] = await platform
        .insert(appRoles)
        .values({
          organizationId: orgLockout,
          key: "manage_role_x_test",
          name: "Manage Role X (test)",
          roleKind: "custom",
          isProtected: false,
        })
        .returning({ id: appRoles.id });
      lockoutRoleX = roleXRow!.id;
      await platform
        .insert(appRolePermissions)
        .values({ roleId: lockoutRoleX, permissionKey: "roles.manage" });

      const [roleYRow] = await platform
        .insert(appRoles)
        .values({
          organizationId: orgLockout,
          key: "manage_role_y_test",
          name: "Manage Role Y (test)",
          roleKind: "custom",
          isProtected: false,
        })
        .returning({ id: appRoles.id });
      lockoutRoleY = roleYRow!.id;
      await platform
        .insert(appRolePermissions)
        .values({ roleId: lockoutRoleY, permissionKey: "roles.manage" });

      lockoutPersonX = await person("Ferdinand", "Okwuosa");
      lockoutPersonY = await person("Isolde", "Marchetti");
      await membership(orgLockout, lockoutPersonX);
      await membership(orgLockout, lockoutPersonY);

      await platform.insert(roleGrants).values({
        organizationId: orgLockout,
        roleId: lockoutRoleX,
        personId: lockoutPersonX,
        startsOn: "2020-01-01",
        grantedBy: grantingUserId,
      });
      await platform.insert(roleGrants).values({
        organizationId: orgLockout,
        roleId: lockoutRoleY,
        personId: lockoutPersonY,
        startsOn: "2020-01-01",
        grantedBy: grantingUserId,
      });
    });

    afterAll(async () => {
      const platform = getPlatformDb();
      await platform.delete(appRoles).where(eq(appRoles.id, templateRoleId));
      // drizzle/0033's group_memberships_reject_derived trigger now (DECISION-
      // 110) also rejects the DELETE that cascading `organizations` fires
      // against this fixture's own active_membership-derived group_memberships
      // rows — disable it around the cascade, same as roll.test.ts's own
      // teardown does for roll_actions_freeze.
      await platform.execute(
        sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
      );
      try {
        await platform.delete(organizations).where(eq(organizations.id, orgA));
        await platform.delete(organizations).where(eq(organizations.id, orgB));
        await platform
          .delete(organizations)
          .where(eq(organizations.id, orgLockout));
      } finally {
        await platform.execute(
          sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
        );
      }
      const allPeople = [
        adminPerson,
        narrowPerson,
        barePerson,
        holderPerson,
        orgBPerson,
        lockoutPersonX,
        lockoutPersonY,
      ].filter(Boolean);
      for (const id of allPeople) {
        await platform.delete(people).where(eq(people.id, id));
      }
      await platform.delete(users).where(eq(users.id, grantingUserId));
    });

    // -----------------------------------------------------------------
    // listPermissionCatalog
    // -----------------------------------------------------------------

    describe("listPermissionCatalog", () => {
      it("includes roles.manage, the permission this feature's own gate checks", async () => {
        const catalog = await listPermissionCatalog();
        expect(catalog.map((p) => p.key)).toContain("roles.manage");
      });

      it("takes no viewer/org argument — a plain global read", async () => {
        const catalog = await listPermissionCatalog();
        expect(Array.isArray(catalog)).toBe(true);
        expect(catalog.length).toBeGreaterThan(0);
      });
    });

    // -----------------------------------------------------------------
    // listRoleDefinitions
    // -----------------------------------------------------------------

    describe("listRoleDefinitions", () => {
      it("returns forbidden for a viewer with no roles.manage", async () => {
        const result = await listRoleDefinitions(narrowPerson, orgA);
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("returns this org's own roles, with permissionKeys and holderCount, never the template catalog", async () => {
        const result = await listRoleDefinitions(adminPerson, orgA);
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;

        const keys = result.roles.map((r) => r.key);
        expect(keys).toContain("committee_role_test");
        expect(keys).not.toContain(`template_role_test`);

        const committeeRole = result.roles.find(
          (r) => r.key === "committee_role_test",
        );
        expect(committeeRole?.permissionKeys).toEqual(["directory.view"]);
        expect(committeeRole?.holderCount).toBe(1);
        expect(committeeRole?.isProtected).toBe(false);
        expect(committeeRole?.deactivatedAt).toBeNull();

        const roleAdmin = result.roles.find((r) => r.key === "role_admin_test");
        expect(roleAdmin?.isProtected).toBe(true);
      });
    });

    // -----------------------------------------------------------------
    // getRoleDefinition
    // -----------------------------------------------------------------

    describe("getRoleDefinition", () => {
      it("returns forbidden for a viewer with no roles.manage", async () => {
        const result = await getRoleDefinition(narrowPerson, orgA, customRoleA);
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("returns not_found for a role id that doesn't exist", async () => {
        const result = await getRoleDefinition(adminPerson, orgA, randomUUID());
        expect(result).toEqual({ kind: "not_found" });
      });

      it("returns not_found for a role belonging to another org", async () => {
        // orgBPerson has a real membership (and roles.manage) at orgB, so
        // this exercises the not_found branch itself, not withOrgContext's
        // own OrgAccessError for a person with no relationship at all.
        const result = await getRoleDefinition(
          orgBPerson,
          orgB,
          customRoleA,
        );
        expect(result).toEqual({ kind: "not_found" });
      });

      it("returns the role with its current permissionKeys and holderCount", async () => {
        const result = await getRoleDefinition(adminPerson, orgA, customRoleA);
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.role.key).toBe("committee_role_test");
        expect(result.role.permissionKeys).toEqual(["directory.view"]);
        expect(result.role.holderCount).toBe(1);
      });
    });

    // -----------------------------------------------------------------
    // listTemplateRoles
    // -----------------------------------------------------------------

    describe("listTemplateRoles", () => {
      it("returns forbidden for a viewer with no roles.manage", async () => {
        const result = await listTemplateRoles(narrowPerson, orgA);
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("the app_roles RLS split: a template row is visible from an org that never created it", async () => {
        const resultA = await listTemplateRoles(adminPerson, orgA);
        expect(resultA.kind).toBe("ok");
        if (resultA.kind !== "ok") return;
        expect(resultA.templates.map((t) => t.id)).toContain(templateRoleId);

        const template = resultA.templates.find((t) => t.id === templateRoleId);
        expect(template?.permissionKeys).toEqual(["directory.view"]);
      });

      it("never returns this org's own custom roles, only organization_id IS NULL rows", async () => {
        const result = await listTemplateRoles(adminPerson, orgA);
        if (result.kind !== "ok") throw new Error("expected ok");
        expect(result.templates.map((t) => t.id)).not.toContain(customRoleA);
      });
    });

    // -----------------------------------------------------------------
    // listTemplateRoles — organization_type_scope filtering
    //
    // Phase 5 (QA, docs/work-log/2026-08-26-presbytery-functionality.md) FAIL
    // finding: drizzle/0037 shipped this codebase's first-ever non-null
    // `organization_type_scope` template row (`presbytery_stated_clerk`, real
    // key in the live dev DB), and NOTHING exercised the type-scope filter
    // both `listTemplateRoles` and `adoptTemplate` share
    // (role-definitions.ts:432-438 / :791-796) against a non-null scope —
    // the suite only ever proved the NULL-scope (`organizationTypeScope:
    // null`) path via `templateRoleId` above. This block seeds its OWN
    // presbytery-scoped template row (self-contained, not the live 0037 row
    // — matches this file's own stated convention of not depending on
    // migration-seeded fixed-id rows) and proves both directions.
    // -----------------------------------------------------------------

    describe("listTemplateRoles — organization_type_scope filtering", () => {
      let orgPresbytery: string;
      let presbyteryAdminPerson: string;
      let presbyteryTemplateRoleId: string;

      beforeAll(async () => {
        const platform = getPlatformDb();
        const stamp = Date.now();

        const [orgRow] = await platform
          .insert(organizations)
          .values({
            organizationType: "presbytery",
            name: `Fixture Presbytery for role-definitions.test.ts scope filtering`,
            slug: `role-definitions-test-presbytery-${stamp}`,
            path: `role_definitions_test_presbytery_${stamp}`,
            platformStatus: "unmanaged",
          })
          .returning({ id: organizations.id });
        orgPresbytery = orgRow!.id;

        // drizzle/0017's sync trigger requires an active_membership derived
        // group before any memberships insert at this org. The "roster"
        // groupType row already exists from the outer beforeAll above.
        const [gt] = await platform
          .select({ id: groupTypes.id })
          .from(groupTypes)
          .where(eq(groupTypes.key, "roster"))
          .limit(1);
        await platform.insert(groups).values({
          organizationId: orgPresbytery,
          groupTypeId: gt!.id,
          name: "Active Membership",
          membershipSource: "derived",
          derivedFrom: "active_membership",
          isProtected: true,
        });

        const [personRow] = await platform
          .insert(people)
          .values({ firstName: "Wilhelmina", lastName: "Adeyemi-Okoro" })
          .returning({ id: people.id });
        presbyteryAdminPerson = personRow!.id;
        await platform.insert(memberships).values({
          organizationId: orgPresbytery,
          personId: presbyteryAdminPerson,
          engagementStatus: "regular",
          currentRoll: "active",
        });

        const [roleRow] = await platform
          .insert(appRoles)
          .values({
            organizationId: orgPresbytery,
            key: "presbytery_role_admin_test",
            name: "Presbytery Role Administrator (test)",
            roleKind: "constitutional",
            isProtected: true,
          })
          .returning({ id: appRoles.id });
        await platform
          .insert(appRolePermissions)
          .values({ roleId: roleRow!.id, permissionKey: "roles.manage" });
        await platform.insert(roleGrants).values({
          organizationId: orgPresbytery,
          roleId: roleRow!.id,
          personId: presbyteryAdminPerson,
          startsOn: "2020-01-01",
          grantedBy: grantingUserId,
        });

        // The presbytery-scoped template — the fixture analog of drizzle/
        // 0037's real `presbytery_stated_clerk` row, self-seeded so this
        // file doesn't depend on that migration having landed.
        const [templateRow] = await platform
          .insert(appRoles)
          .values({
            organizationId: null,
            organizationTypeScope: "presbytery",
            key: `presbytery_template_test_${stamp}`,
            name: "Presbytery Template Role (test)",
            roleKind: "constitutional",
            isProtected: true,
          })
          .returning({ id: appRoles.id });
        presbyteryTemplateRoleId = templateRow!.id;
        await platform.insert(appRolePermissions).values({
          roleId: presbyteryTemplateRoleId,
          permissionKey: "directory.view",
        });
      });

      afterAll(async () => {
        const platform = getPlatformDb();
        // organizationId IS NULL — not cascaded by deleting orgPresbytery.
        await platform
          .delete(appRoles)
          .where(eq(appRoles.id, presbyteryTemplateRoleId));
        // Same trigger-disable dance as the outer afterAll: deleting
        // orgPresbytery cascades to this fixture's own active_membership
        // derived group's group_memberships rows.
        await platform.execute(
          sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
        );
        try {
          await platform
            .delete(organizations)
            .where(eq(organizations.id, orgPresbytery));
        } finally {
          await platform.execute(
            sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
          );
        }
        await platform
          .delete(people)
          .where(eq(people.id, presbyteryAdminPerson));
      });

      it("a congregation-context caller does NOT see the presbytery-scoped template, but DOES see the NULL-scope one", async () => {
        const result = await listTemplateRoles(adminPerson, orgA);
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        const ids = result.templates.map((t) => t.id);
        expect(ids).not.toContain(presbyteryTemplateRoleId);
        // templateRoleId (outer fixture, organizationTypeScope: null) is
        // this suite's own stand-in for the NULL-scope committee_chair row.
        expect(ids).toContain(templateRoleId);
      });

      it("a presbytery-context caller DOES see the presbytery-scoped template, alongside the NULL-scope one", async () => {
        const result = await listTemplateRoles(
          presbyteryAdminPerson,
          orgPresbytery,
        );
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        const ids = result.templates.map((t) => t.id);
        expect(ids).toContain(presbyteryTemplateRoleId);
        expect(ids).toContain(templateRoleId);
      });

      it("adoptTemplate rejects adopting the presbytery-scoped template from a congregation context, writing nothing", async () => {
        const result = await adoptTemplate(adminPerson, orgA, {
          templateRoleId: presbyteryTemplateRoleId,
          key: "should_not_adopt_presbytery_template",
        });
        expect(result).toEqual({ kind: "template_not_found" });

        const platform = getPlatformDb();
        const [row] = await platform
          .select({ id: appRoles.id })
          .from(appRoles)
          .where(
            and(
              eq(appRoles.organizationId, orgA),
              eq(appRoles.key, "should_not_adopt_presbytery_template"),
            ),
          )
          .limit(1);
        expect(row).toBeUndefined();
      });
    });

    // -----------------------------------------------------------------
    // createRole
    // -----------------------------------------------------------------

    describe("createRole", () => {
      it("returns forbidden for a person with no roles.manage at all", async () => {
        const result = await createRole(narrowPerson, orgA, {
          key: "should_not_exist",
          name: "Should Not Exist",
          permissionKeys: [],
        });
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("invalid_input: a key that doesn't match the format is rejected distinctly", async () => {
        const result = await createRole(adminPerson, orgA, {
          key: "Not-Valid-Key!",
          name: "Whatever",
          permissionKeys: [],
        });
        expect(result.kind).toBe("invalid_input");
      });

      it("invalid_input: an empty (post-trim) name is rejected distinctly", async () => {
        const result = await createRole(adminPerson, orgA, {
          key: "valid_key_1",
          name: "   ",
          permissionKeys: [],
        });
        expect(result.kind).toBe("invalid_input");
      });

      it("escalation_denied: a bare roles.manage holder cannot create a role carrying a permission they don't hold", async () => {
        const result = await createRole(barePerson, orgA, {
          key: "escalation_attempt",
          name: "Escalation Attempt",
          permissionKeys: ["directory.view"],
        });
        expect(result.kind).toBe("escalation_denied");
        if (result.kind !== "escalation_denied") return;
        expect(result.missingPermissions).toContain("directory.view");
      });

      it("a roles.manage holder CAN create a role carrying a subset of their own permissions", async () => {
        const result = await createRole(adminPerson, orgA, {
          key: "fresh_custom_role",
          name: "Fresh Custom Role",
          permissionKeys: ["directory.view"],
        });
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.roleKey).toBe("fresh_custom_role");

        const fetched = await getRoleDefinition(
          adminPerson,
          orgA,
          result.roleId,
        );
        if (fetched.kind !== "ok") throw new Error("expected ok");
        expect(fetched.role.permissionKeys).toEqual(["directory.view"]);
        expect(fetched.role.roleKind).toBe("custom");
        expect(fetched.role.isProtected).toBe(false);
      });

      it("duplicate_key: the same key at the same org is rejected, never thrown", async () => {
        const first = await createRole(adminPerson, orgA, {
          key: "duplicate_test_key",
          name: "First",
          permissionKeys: [],
        });
        expect(first.kind).toBe("ok");

        const second = await createRole(adminPerson, orgA, {
          key: "duplicate_test_key",
          name: "Second",
          permissionKeys: [],
        });
        expect(second).toEqual({ kind: "duplicate_key" });
      });

      it("the same key at a DIFFERENT org is not a duplicate", async () => {
        // orgBPerson (beforeAll fixture) holds roles.manage at orgB — the
        // (organization_id, key) unique constraint is scoped per-org, so
        // the same key already used at orgA is legal here.
        const result = await createRole(orgBPerson, orgB, {
          key: "duplicate_test_key",
          name: "Same Key, Different Org",
          permissionKeys: [],
        });
        expect(result.kind).toBe("ok");
      });
    });

    // -----------------------------------------------------------------
    // setRolePermissions
    // -----------------------------------------------------------------

    describe("setRolePermissions", () => {
      it("returns forbidden for a person with no roles.manage", async () => {
        const result = await setRolePermissions(narrowPerson, orgA, editableRoleA, [
          "directory.view",
        ]);
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("returns not_found for a role id that doesn't exist", async () => {
        const result = await setRolePermissions(adminPerson, orgA, randomUUID(), []);
        expect(result).toEqual({ kind: "not_found" });
      });

      it("returns protected_role for a constitutional role, gated on isProtected not role_kind", async () => {
        const result = await setRolePermissions(
          adminPerson,
          orgA,
          roleAdminRoleA,
          [],
        );
        expect(result).toEqual({ kind: "protected_role" });
      });

      it("returns not_found for a role belonging to another org", async () => {
        const result = await setRolePermissions(orgBPerson, orgB, editableRoleA, []);
        expect(result).toEqual({ kind: "not_found" });
      });

      // The three tests below run in sequence against the SAME role
      // (editableRoleA, held by nobody) — each one's mutation is the
      // precondition for the next, and the sequence itself is the point:
      // it demonstrates the check operates on the ADDED DELTA, never the
      // full resulting set.
      it("escalation_denied: the ADDED delta must be within the actor's own effective permissions", async () => {
        // editableRoleA's current set is [directory.view]. barePerson holds
        // ONLY roles.manage. Adding ledger.approve (a permission nobody in
        // this fixture holds) must be denied, naming exactly that key —
        // not directory.view, which is untouched (already present, not
        // part of the delta).
        const result = await setRolePermissions(barePerson, orgA, editableRoleA, [
          "directory.view",
          "ledger.approve",
        ]);
        expect(result.kind).toBe("escalation_denied");
        if (result.kind !== "escalation_denied") return;
        expect(result.missingPermissions).toEqual(["ledger.approve"]);
      });

      it("a delta-only check: an actor can add a permission they hold even though the role's FULL new set also contains one they don't", async () => {
        // barePerson does NOT hold directory.view — if this were checked
        // against the FULL new set (DECISION-106's rejected alternative),
        // this would be denied. It is not: directory.view is already on the
        // role (not part of the delta), and roles.manage — the only ADDED
        // key — is exactly what barePerson holds.
        const result = await setRolePermissions(barePerson, orgA, editableRoleA, [
          "directory.view",
          "roles.manage",
        ]);
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.addedKeys).toEqual(["roles.manage"]);
        expect(result.removedKeys).toEqual([]);
        expect(result.holderCount).toBe(0);
      });

      it("a pure permission REMOVAL trivially passes the escalation check even for an actor who holds nothing else", async () => {
        // editableRoleA is now [directory.view, roles.manage]. barePerson
        // does not hold directory.view — removing it has an EMPTY added
        // delta, so assertPermissionSubset() must pass trivially rather
        // than being (incorrectly) evaluated against the full remaining set.
        const result = await setRolePermissions(barePerson, orgA, editableRoleA, [
          "roles.manage",
        ]);
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.addedKeys).toEqual([]);
        expect(result.removedKeys).toEqual(["directory.view"]);
      });

      it("self-lockout cascade: removing roles.manage from one of two roles succeeds; the survivor's own removal is then blocked", async () => {
        const first = await setRolePermissions(
          lockoutPersonX,
          orgLockout,
          lockoutRoleX,
          [],
        );
        expect(first.kind).toBe("ok");

        const second = await setRolePermissions(
          lockoutPersonY,
          orgLockout,
          lockoutRoleY,
          [],
        );
        expect(second).toEqual({ kind: "self_lockout_blocked" });

        // Nothing was written on the blocked attempt.
        const stillHasIt = await getRoleDefinition(
          lockoutPersonY,
          orgLockout,
          lockoutRoleY,
        );
        if (stillHasIt.kind !== "ok") throw new Error("expected ok");
        expect(stillHasIt.role.permissionKeys).toContain("roles.manage");
      });
    });

    // -----------------------------------------------------------------
    // deactivateRole
    // -----------------------------------------------------------------

    describe("deactivateRole", () => {
      it("returns forbidden for a person with no roles.manage", async () => {
        const result = await deactivateRole(narrowPerson, orgA, customRoleA);
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("returns not_found for a role id that doesn't exist", async () => {
        const result = await deactivateRole(adminPerson, orgA, randomUUID());
        expect(result).toEqual({ kind: "not_found" });
      });

      it("returns protected_role for a constitutional role — role_admin itself is never deactivatable here", async () => {
        const result = await deactivateRole(adminPerson, orgA, roleAdminRoleA);
        expect(result).toEqual({ kind: "protected_role" });
      });

      it("ends every currently-effective role_grants row for the role in the SAME transaction as deactivating it", async () => {
        const result = await deactivateRole(adminPerson, orgA, customRoleA);
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.endedGrantCount).toBe(1);

        const platform = getPlatformDb();
        const [grantRow] = await platform
          .select({ endsOn: roleGrants.endsOn })
          .from(roleGrants)
          .where(eq(roleGrants.id, customRoleAGrantId))
          .limit(1);
        expect(grantRow?.endsOn).not.toBeNull();

        const [roleRow] = await platform
          .select({ deactivatedAt: appRoles.deactivatedAt })
          .from(appRoles)
          .where(eq(appRoles.id, customRoleA))
          .limit(1);
        expect(roleRow?.deactivatedAt).not.toBeNull();
      });

      it("returns already_deactivated on a second attempt, writing nothing further", async () => {
        const result = await deactivateRole(adminPerson, orgA, customRoleA);
        expect(result).toEqual({ kind: "already_deactivated" });
      });

      it("self-lockout: deactivating the sole remaining roles.manage-carrying role is blocked", async () => {
        // From the setRolePermissions describe block above, lockoutRoleX no
        // longer carries roles.manage and lockoutRoleY still does — it is
        // now the org's ONLY roles.manage-carrying role.
        const result = await deactivateRole(
          lockoutPersonY,
          orgLockout,
          lockoutRoleY,
        );
        expect(result).toEqual({ kind: "self_lockout_blocked" });

        const platform = getPlatformDb();
        const [roleRow] = await platform
          .select({ deactivatedAt: appRoles.deactivatedAt })
          .from(appRoles)
          .where(eq(appRoles.id, lockoutRoleY))
          .limit(1);
        expect(roleRow?.deactivatedAt).toBeNull();
      });
    });

    // -----------------------------------------------------------------
    // adoptTemplate
    // -----------------------------------------------------------------

    describe("adoptTemplate", () => {
      it("returns forbidden for a person with no roles.manage", async () => {
        const result = await adoptTemplate(narrowPerson, orgA, {
          templateRoleId,
        });
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("returns template_not_found for a role id that isn't a template at all", async () => {
        const result = await adoptTemplate(adminPerson, orgA, {
          templateRoleId: customRoleA, // a real role, but org-scoped, not a template
        });
        expect(result).toEqual({ kind: "template_not_found" });
      });

      it("escalation_denied: adopting a template whose permissions the actor doesn't hold is rejected", async () => {
        const result = await adoptTemplate(barePerson, orgA, {
          templateRoleId,
          key: "adopted_should_fail",
        });
        expect(result.kind).toBe("escalation_denied");
        if (result.kind !== "escalation_denied") return;
        expect(result.missingPermissions).toContain("directory.view");
      });

      it("clones the template's permission set into a new, fully-editable org-owned role", async () => {
        const result = await adoptTemplate(adminPerson, orgA, {
          templateRoleId,
          key: "adopted_role_test",
          name: "Adopted Role (test)",
        });
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.roleKey).toBe("adopted_role_test");
        expect(result.templateKey).toContain("template_role_test_");

        const fetched = await getRoleDefinition(
          adminPerson,
          orgA,
          result.roleId,
        );
        if (fetched.kind !== "ok") throw new Error("expected ok");
        expect(fetched.role.permissionKeys).toEqual(["directory.view"]);
        expect(fetched.role.roleKind).toBe("custom");
        expect(fetched.role.isProtected).toBe(false);
      });

      it("falls back to the template's own key/name when none are given", async () => {
        const result = await adoptTemplate(adminPerson, orgA, {
          templateRoleId,
        });
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.roleKey).toBe(result.templateKey);
      });

      it("duplicate_key: adopting into a key that already exists at this org is rejected, never thrown", async () => {
        const result = await adoptTemplate(adminPerson, orgA, {
          templateRoleId,
          key: "adopted_role_test", // already created above
        });
        expect(result).toEqual({ kind: "duplicate_key" });
      });

      it("invalid_input: an invalid override key is rejected distinctly", async () => {
        const result = await adoptTemplate(adminPerson, orgA, {
          templateRoleId,
          key: "Not Valid!",
        });
        expect(result.kind).toBe("invalid_input");
      });
    });

    // -----------------------------------------------------------------
    // Genuine failure propagation
    // -----------------------------------------------------------------

    describe("genuine failures propagate as thrown exceptions", () => {
      it("listRoleDefinitions: a person with no relationship at all throws OrgAccessError", async () => {
        await expect(
          listRoleDefinitions(randomUUID(), orgA),
        ).rejects.toMatchObject({ name: "OrgAccessError" });
      });
    });
  },
);
