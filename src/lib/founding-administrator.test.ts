/**
 * Tests for src/lib/founding-administrator.ts — docs/work-log/
 * 2026-09-28-founding-administrator.md, DECISION-155.
 *
 * Two independent suites in this file:
 *
 *   1. The "four files unchanged" mechanical test (Phase 2's Two Hierarchies
 *      ruling) — no DB, always run, shells out to `git diff`.
 *   2. The Postgres-backed integration suite, `describe.skipIf(!hasDb)`,
 *      following `role-grants.test.ts`'s/`org-provisioning.test.ts`'s exact
 *      harness: dynamic imports inside `beforeAll` (this file's own
 *      top-level import of `./founding-administrator` would otherwise reach
 *      `@/lib/db`'s module-scope pool construction before DATABASE_URL/
 *      PLATFORM_DATABASE_URL are confirmed set — measured, not assumed: this
 *      file originally imported `foundingAdministratorPlan`/
 *      `deriveNameFromUser` at the top level and every test failed with
 *      "DATABASE_URL is not set" before a single assertion ran), and
 *      self-contained fixtures created and torn down per file — never
 *      `scripts/seed-dev.sql`'s `founding.fixture@example.invalid` row,
 *      which is reserved for the manual browser rehearsal (Batch A's
 *      "consuming it" note) and for Batch C's e2e pass. `org-provisioning.
 *      test.ts`'s own header names this same constraint: even PURE-function
 *      tests (`foundingAdministratorPlan()`, `deriveNameFromUser()` here)
 *      must sit inside the DB-gated `describe.skipIf` and be imported
 *      dynamically, because they live in the same module as the DB-touching
 *      exports.
 *
 * `npm test` in CI does not set DATABASE_URL, so suite 2 (including its own
 * pure-function sub-suites) is SKIPPED there, not failed. Run it for real
 * with:
 *   dotenv -e .env.local -- vitest run src/lib/founding-administrator.test.ts --no-file-parallelism
 *
 * F110/F112 — `people_user_id_unique_idx` DOES NOT EXIST on this branch
 * (Batch A's headline finding: the index collides with a committed
 * `scripts/seed-dev.sql` fixture and was withheld). The pre-check-plus-
 * trigger defence this suite exercises (`person_elsewhere`) IS the
 * regression test Batch A asked for in place of "two inserts with the same
 * user_id collide" — see that describe block's own comment.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";

vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// 1. Two Hierarchies — the "eight paths unchanged" mechanical test (Phase 2
// Ruling 2 + the F118 addendum) was a PIPELINE-BRANCH discipline check: it
// diffed the working tree against `main` to prove the founding-administrator
// pipeline never touched the resolver (`src/lib/authz.ts`,
// `role-definitions.ts`, `role-grants.ts`, `drizzle/0010`) or the
// person-creation/staff-hire surfaces. It was satisfied and recorded when the
// pipeline merged (PR #23, d48e1ef, v0.29.0 — docs/work-log/
// 2026-09-28-founding-administrator.md Phase 5, "0 files" against the
// merge-base and against main). Retired at the very next cross-pipeline merge
// (F131, 2026-10-05): a "byte-identical to main" assertion is only meaningful
// inside the pipeline it guards — kept in the suite it fails any later branch
// that legitimately edits those paths (the hydration-gate pipeline wrapped the
// member and staff forms). The durable form of the invariant is behavioural:
// scripts/test-rls.sql §44 asserts what the designee can and cannot resolve.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 2. Postgres-backed integration suite (plus, nested inside it for the
// module-scope reason explained in this file's header, the pure-function
// tests for foundingAdministratorPlan()/deriveNameFromUser()).
// ---------------------------------------------------------------------------

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "founding-administrator.ts (Postgres-backed, real dev database)",
  () => {
    let designateFoundingAdministrator: typeof import("./founding-administrator").designateFoundingAdministrator;
    let countFoundingAdministratorHolders: typeof import("./founding-administrator").countFoundingAdministratorHolders;
    let foundingAdministratorPlan: typeof import("./founding-administrator").foundingAdministratorPlan;
    let deriveNameFromUser: typeof import("./founding-administrator").deriveNameFromUser;
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let organizations: typeof import("@/lib/db/domain/org").organizations;
    let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
    let groups: typeof import("@/lib/db/domain/groups").groups;
    let people: typeof import("@/lib/db/domain/people").people;
    let memberships: typeof import("@/lib/db/domain/people").memberships;
    let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
    let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
    let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
    let users: typeof import("@/lib/db/schema").users;

    let platform: ReturnType<typeof getPlatformDb>;
    let stamp: number;
    let groupTypeId: string;
    let operatorUserId: string;

    const createdOrgIds: string[] = [];
    const createdPeopleIds: string[] = [];
    const createdUserIds: string[] = [];

    beforeAll(async () => {
      ({
        designateFoundingAdministrator,
        countFoundingAdministratorHolders,
        foundingAdministratorPlan,
        deriveNameFromUser,
      } = await import("./founding-administrator"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations } = await import("@/lib/db/domain/org"));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
      ({ people, memberships } = await import("@/lib/db/domain/people"));
      ({ appRoles, appRolePermissions, roleGrants } = await import(
        "@/lib/db/domain/authz"
      ));
      ({ users } = await import("@/lib/db/schema"));

      platform = getPlatformDb();
      stamp = Date.now();

      // The real, migration-seeded global templates this module reads by
      // literal key — NOT self-seeded (unlike role-definitions.test.ts's
      // arbitrary-templateRoleId fixtures): designateFoundingAdministrator()
      // is hardcoded to "presbytery_stated_clerk"/"congregation_stated_clerk",
      // so this suite depends on drizzle/0037's/0052's real rows existing,
      // and fails loudly (not silently) if they don't.
      const [presbyteryTemplate] = await platform
        .select({ id: appRoles.id })
        .from(appRoles)
        .where(eq(appRoles.key, "presbytery_stated_clerk"))
        .limit(1);
      const [congregationTemplate] = await platform
        .select({ id: appRoles.id })
        .from(appRoles)
        .where(eq(appRoles.key, "congregation_stated_clerk"))
        .limit(1);
      if (!presbyteryTemplate || !congregationTemplate) {
        throw new Error(
          "[founding-administrator.test] presbytery_stated_clerk/congregation_stated_clerk template rows are missing — run npm run db:migrate (drizzle/0037, drizzle/0052) against this database first.",
        );
      }

      const [gt] = await platform
        .insert(groupTypes)
        .values({ key: "roster", name: "Roster" })
        .onConflictDoNothing()
        .returning({ id: groupTypes.id });
      groupTypeId = gt?.id ?? "";
      if (!groupTypeId) {
        const [existing] = await platform
          .select({ id: groupTypes.id })
          .from(groupTypes)
          .where(eq(groupTypes.key, "roster"))
          .limit(1);
        groupTypeId = existing!.id;
      }

      const [operatorRow] = await platform
        .insert(users)
        .values({
          email: `founding-admin-test-operator-${stamp}@example.invalid`,
          name: "Founding Admin Test Operator",
        })
        .returning({ id: users.id });
      operatorUserId = operatorRow!.id;
      createdUserIds.push(operatorUserId);
    });

    afterAll(async () => {
      // Same disable/enable-trigger bracket role-grants.test.ts's own
      // teardown uses: group_memberships_reject_derived would otherwise
      // reject the cascading DELETE against this fixture's own
      // active_membership-derived group_memberships rows.
      await platform.execute(
        sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
      );
      try {
        for (const id of createdOrgIds) {
          await platform.delete(organizations).where(eq(organizations.id, id));
        }
      } finally {
        await platform.execute(
          sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
        );
      }

      // people_guard_delete (SECURITY DEFINER) fires for neondb_owner too
      // (Phase 2 Ruling 1 / work-log Ruling 10) — every person this suite
      // either fixtured directly (already stamped at insert) or that
      // designateFoundingAdministrator() itself created (NOT stamped, since
      // production code must never carry a fixture-only parameter) needs
      // deletable_until set at TEARDOWN before it can be deleted.
      for (const id of createdPeopleIds) {
        await platform
          .update(people)
          .set({ deletableUntil: fixtureDeletableUntil() })
          .where(eq(people.id, id));
        await platform.delete(people).where(eq(people.id, id));
      }

      for (const id of createdUserIds) {
        await platform.delete(users).where(eq(users.id, id));
      }
    });

    // -----------------------------------------------------------------
    // Pure-function tests — no DB touched by the assertions themselves;
    // nested here only because the exports share a module with DB-touching
    // code (see this file's header).
    // -----------------------------------------------------------------

    describe("foundingAdministratorPlan()", () => {
      const BASE = [
        "people.manage",
        "roles.manage",
        "role_grants.manage",
        "groups.manage",
        "officers.manage",
        "org_features.manage",
        "tickets.file",
        "staff.manage",
      ];

      it("congregation: the base eight keys (F118 — staff.manage joins the bundle), congregation_stated_clerk office, no congregation_oversight.manage", () => {
        const plan = foundingAdministratorPlan("congregation");
        expect(plan.administration.key).toBe("founding_administrator");
        expect(plan.administration.permissionKeys.sort()).toEqual(
          [...BASE].sort(),
        );
        expect(plan.administration.permissionKeys).not.toContain(
          "congregation_oversight.manage",
        );
        expect(plan.officeTemplateKey).toBe("congregation_stated_clerk");
      });

      it("presbytery: base eight PLUS congregation_oversight.manage (9 total), presbytery_stated_clerk office", () => {
        const plan = foundingAdministratorPlan("presbytery");
        expect(plan.administration.permissionKeys.sort()).toEqual(
          [...BASE, "congregation_oversight.manage"].sort(),
        );
        expect(plan.officeTemplateKey).toBe("presbytery_stated_clerk");
      });

      it.each(["synod", "general_assembly", "new_worshiping_community"] as const)(
        "%s: administration half only, no office template",
        (organizationType) => {
          const plan = foundingAdministratorPlan(organizationType);
          expect(plan.administration.permissionKeys.sort()).toEqual(
            [...BASE].sort(),
          );
          expect(plan.officeTemplateKey).toBeNull();
        },
      );

      it("never carries a tier-3 or excluded tier-2 key (F111's enumerated-not-wildcard ceiling; staff.manage is CARRIED as of F118, so it is deliberately absent from this list)", () => {
        const excluded = [
          "roll.propose",
          "roll.approve",
          "branding.manage",
          "events.manage",
          "directory.view_hidden",
          "directory.view",
          "credentials.manage",
          "children.roster",
          "ledger.approve",
          "per_capita.manage",
          "statistics.manage",
          "demographics.manage",
          "medical.manage",
          "disabilities.manage",
          "pastoral_notes.manage",
        ];
        for (const organizationType of [
          "congregation",
          "presbytery",
          "synod",
          "general_assembly",
          "new_worshiping_community",
        ] as const) {
          const plan = foundingAdministratorPlan(organizationType);
          for (const key of excluded) {
            expect(plan.administration.permissionKeys).not.toContain(key);
          }
        }
      });
    });

    describe("deriveNameFromUser()", () => {
      it("pins the pipeline's own worked example: 'Fixture Founding Admin' -> firstName 'Fixture', lastName 'Founding Admin' (first-space split)", () => {
        expect(
          deriveNameFromUser("Fixture Founding Admin", "x@example.invalid"),
        ).toEqual({ firstName: "Fixture", lastName: "Founding Admin" });
      });

      it("a two-token name splits cleanly at the one space", () => {
        expect(deriveNameFromUser("Ada Lovelace", "x@example.invalid")).toEqual({
          firstName: "Ada",
          lastName: "Lovelace",
        });
      });

      it("a middle name lands in lastName, not dropped (first-space split, not last)", () => {
        expect(
          deriveNameFromUser("Mary Jane Smith", "x@example.invalid"),
        ).toEqual({
          firstName: "Mary",
          lastName: "Jane Smith",
        });
      });

      it("a single-word name maps both fields to that word rather than an empty surname", () => {
        expect(deriveNameFromUser("Cher", "x@example.invalid")).toEqual({
          firstName: "Cher",
          lastName: "Cher",
        });
      });

      it("null name falls back to the email local-part for both fields", () => {
        expect(deriveNameFromUser(null, "jdoe@example.invalid")).toEqual({
          firstName: "jdoe",
          lastName: "jdoe",
        });
      });

      it("blank/whitespace-only name falls back to the email local-part", () => {
        expect(deriveNameFromUser("   ", "jdoe@example.invalid")).toEqual({
          firstName: "jdoe",
          lastName: "jdoe",
        });
      });
    });

    // -----------------------------------------------------------------
    // Fixture helpers
    // -----------------------------------------------------------------

    async function makeOrg(
      label: string,
      organizationType: "congregation" | "presbytery" | "synod",
      { withActiveMembershipGroup = true }: { withActiveMembershipGroup?: boolean } = {},
    ): Promise<string> {
      const [row] = await platform
        .insert(organizations)
        .values({
          deletableUntil: fixtureDeletableUntil(),
          organizationType,
          name: `Fixture ${label} for founding-administrator.test.ts`,
          slug: `founding-admin-test-${label.toLowerCase()}-${stamp}`,
          path: `founding_admin_test_${label.toLowerCase()}_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      const organizationId = row!.id;
      createdOrgIds.push(organizationId);
      if (withActiveMembershipGroup) {
        await platform.insert(groups).values({
          organizationId,
          groupTypeId,
          name: "Active Membership",
          membershipSource: "derived",
          derivedFrom: "active_membership",
          isProtected: true,
        });
      }
      return organizationId;
    }

    async function makeUser(
      label: string,
      overrides: { isActive?: boolean; name?: string | null } = {},
    ): Promise<{ id: string; email: string }> {
      const email = `founding-admin-test-${label.toLowerCase()}-${stamp}@example.invalid`;
      const [row] = await platform
        .insert(users)
        .values({
          email,
          name: overrides.name === undefined ? `Fixture ${label}` : overrides.name,
          isActive: overrides.isActive ?? true,
        })
        .returning({ id: users.id });
      createdUserIds.push(row!.id);
      return { id: row!.id, email };
    }

    /** A people+memberships pair, self-inserted (not through
     * designateFoundingAdministrator()), for the existing_person /
     * membership_ended / person_elsewhere fixtures. */
    async function makePersonAt(
      userId: string,
      organizationId: string,
      opts: { endedOn?: string | null } = {},
    ): Promise<string> {
      const [personRow] = await platform
        .insert(people)
        .values({
          firstName: "Existing",
          lastName: "Fixture",
          userId,
          deletableUntil: fixtureDeletableUntil(),
        })
        .returning({ id: people.id });
      const personId = personRow!.id;
      createdPeopleIds.push(personId);
      await platform.insert(memberships).values({
        organizationId,
        personId,
        engagementStatus: "regular",
        endedOn: opts.endedOn ?? null,
      });
      return personId;
    }

    async function countMembershipsFor(personId: string): Promise<number> {
      const rows = await platform
        .select({ id: memberships.id })
        .from(memberships)
        .where(eq(memberships.personId, personId));
      return rows.length;
    }

    async function countLivePeopleForUser(userId: string): Promise<number> {
      const rows = await platform
        .select({ id: people.id })
        .from(people)
        .where(eq(people.userId, userId));
      // merged_into_id is null for every row this suite creates directly
      // (no merge fixture here), so a plain count is the live-row count.
      return rows.length;
    }

    // -----------------------------------------------------------------
    // ok — created_person, three org-type shapes
    // -----------------------------------------------------------------

    describe("ok — created_person", () => {
      it("congregation: administration bundle + congregation_stated_clerk office", async () => {
        const orgId = await makeOrg("CreatedCongregation", "congregation");
        const { id: userId, email } = await makeUser("CreatedCongregation");

        expect(await countFoundingAdministratorHolders(platform, orgId)).toBe(0);

        const result = await designateFoundingAdministrator(
          orgId,
          email,
          operatorUserId,
        );
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        createdPeopleIds.push(result.personId);

        expect(result.mode).toBe("created_person");
        expect(result.userId).toBe(userId);
        expect(result.administrationRoleKey).toBe("founding_administrator");
        expect(result.officeRoleKey).toBe("congregation_stated_clerk");
        expect(result.priorHolderCount).toBe(0);
        expect(result.permissionKeys.sort()).toEqual(
          [
            "people.manage",
            "roles.manage",
            "role_grants.manage",
            "groups.manage",
            "officers.manage",
            "org_features.manage",
            "tickets.file",
            "staff.manage",
            "statistics.publish",
          ].sort(),
        );

        // firstName/lastName from the fixture user's name ("Fixture
        // CreatedCongregation") via the first-space split.
        const [personRow] = await platform
          .select({ firstName: people.firstName, lastName: people.lastName })
          .from(people)
          .where(eq(people.id, result.personId));
        expect(personRow).toEqual({
          firstName: "Fixture",
          lastName: "CreatedCongregation",
        });

        // Staff-style membership, no roll (DECISION-128/129).
        const [membershipRow] = await platform
          .select({
            engagementStatus: memberships.engagementStatus,
            currentRoll: memberships.currentRoll,
          })
          .from(memberships)
          .where(eq(memberships.personId, result.personId));
        expect(membershipRow).toEqual({
          engagementStatus: "staff",
          currentRoll: null,
        });

        expect(await countFoundingAdministratorHolders(platform, orgId)).toBe(1);
      });

      it("presbytery: administration bundle (+ congregation_oversight.manage) + presbytery_stated_clerk office", async () => {
        const orgId = await makeOrg("CreatedPresbytery", "presbytery");
        const { email } = await makeUser("CreatedPresbytery");

        const result = await designateFoundingAdministrator(
          orgId,
          email,
          operatorUserId,
        );
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        createdPeopleIds.push(result.personId);

        expect(result.officeRoleKey).toBe("presbytery_stated_clerk");
        expect(result.permissionKeys).toEqual(
          expect.arrayContaining([
            "congregation_oversight.manage",
            "credentials.manage",
            "per_capita.manage",
            "statistics.manage",
          ]),
        );
      });

      it("synod (template-less): administration half only, officeRoleId/officeRoleKey null, no congregation_oversight.manage", async () => {
        const orgId = await makeOrg("CreatedSynod", "synod");
        const { email } = await makeUser("CreatedSynod");

        const result = await designateFoundingAdministrator(
          orgId,
          email,
          operatorUserId,
        );
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        createdPeopleIds.push(result.personId);

        expect(result.officeRoleId).toBeNull();
        expect(result.officeRoleKey).toBeNull();
        expect(result.permissionKeys).not.toContain("congregation_oversight.manage");
        expect(result.permissionKeys.sort()).toEqual(
          [
            "people.manage",
            "roles.manage",
            "role_grants.manage",
            "groups.manage",
            "officers.manage",
            "org_features.manage",
            "tickets.file",
            "staff.manage",
          ].sort(),
        );
      });
    });

    // -----------------------------------------------------------------
    // ok — existing_person
    // -----------------------------------------------------------------

    describe("ok — existing_person", () => {
      it("a person who already has a live membership at this org is reused, not duplicated", async () => {
        const orgId = await makeOrg("ExistingCongregation", "congregation");
        const { id: userId, email } = await makeUser("ExistingCongregation");
        const personId = await makePersonAt(userId, orgId);

        const result = await designateFoundingAdministrator(
          orgId,
          email,
          operatorUserId,
        );
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;

        expect(result.mode).toBe("existing_person");
        expect(result.personId).toBe(personId);
        // No second membership row was inserted for this person at this org.
        expect(await countMembershipsFor(personId)).toBe(1);
      });
    });

    // -----------------------------------------------------------------
    // no_such_user / user_inactive — share one holder-count-zero org, since
    // neither writes anything.
    // -----------------------------------------------------------------

    describe("no_such_user / user_inactive", () => {
      it("no_such_user: no users row for that email", async () => {
        const orgId = await makeOrg("SimpleRefusals", "congregation");
        const result = await designateFoundingAdministrator(
          orgId,
          `nobody-${stamp}@example.invalid`,
          operatorUserId,
        );
        expect(result).toEqual({ kind: "no_such_user" });
      });

      it("user_inactive: a deactivated account", async () => {
        const orgId = await makeOrg("SimpleRefusals2", "congregation");
        const { email } = await makeUser("Inactive", { isActive: false });
        const result = await designateFoundingAdministrator(
          orgId,
          email,
          operatorUserId,
        );
        expect(result).toEqual({ kind: "user_inactive" });
      });
    });

    // -----------------------------------------------------------------
    // person_elsewhere (F108) — failing-first, then passing. This is also
    // Batch A's replacement for the deferred "two inserts with the same
    // user_id collide" index test (F110/F112): the assertion below proves
    // designateFoundingAdministrator() refuses rather than creating a
    // second live people row for one user_id, since no unique index exists
    // to do it for us.
    // -----------------------------------------------------------------

    describe("person_elsewhere (F108)", () => {
      it("refuses, and creates no second live people row for that user_id", async () => {
        const orgHome = await makeOrg("ElsewhereHome", "congregation");
        const orgTarget = await makeOrg("ElsewhereTarget", "congregation");
        const { id: userId, email } = await makeUser("Elsewhere");
        await makePersonAt(userId, orgHome);

        expect(await countLivePeopleForUser(userId)).toBe(1);

        const result = await designateFoundingAdministrator(
          orgTarget,
          email,
          operatorUserId,
        );
        expect(result).toEqual({ kind: "person_elsewhere" });

        // THE regression this test stands in for the deferred index: still
        // exactly one live people row for this user_id, never two.
        expect(await countLivePeopleForUser(userId)).toBe(1);

        // Nothing was written at the target org.
        expect(await countFoundingAdministratorHolders(platform, orgTarget)).toBe(0);
        const [role] = await platform
          .select({ id: appRoles.id })
          .from(appRoles)
          .where(eq(appRoles.organizationId, orgTarget));
        expect(role).toBeUndefined();
      });
    });

    // -----------------------------------------------------------------
    // membership_ended — failing-first, then passing.
    // -----------------------------------------------------------------

    describe("membership_ended", () => {
      it("refuses, naming the end date, and writes nothing", async () => {
        const orgId = await makeOrg("Ended", "congregation");
        const { id: userId, email } = await makeUser("Ended");
        const personId = await makePersonAt(userId, orgId, {
          endedOn: "2020-06-15",
        });

        const result = await designateFoundingAdministrator(
          orgId,
          email,
          operatorUserId,
        );
        expect(result).toEqual({ kind: "membership_ended", endedOn: "2020-06-15" });

        const grants = await platform
          .select({ id: roleGrants.id })
          .from(roleGrants)
          .where(eq(roleGrants.personId, personId));
        expect(grants).toHaveLength(0);
        expect(await countFoundingAdministratorHolders(platform, orgId)).toBe(0);
      });
    });

    // -----------------------------------------------------------------
    // has_holders — failing-first, then passing.
    // -----------------------------------------------------------------

    describe("has_holders", () => {
      it("refuses once anyone holds roles.manage or role_grants.manage, and writes nothing", async () => {
        const orgId = await makeOrg("HasHolders", "congregation");

        // A pre-existing holder, minted directly (the seed-dev.sql
        // mechanism, not through any application code path).
        const { id: holderUserId } = await makeUser("HasHoldersHolder");
        const holderPersonId = await makePersonAt(holderUserId, orgId);
        const [holderRole] = await platform
          .insert(appRoles)
          .values({
            organizationId: orgId,
            key: "pre_existing_holder_role",
            name: "Pre-existing Holder Role (test)",
            roleKind: "custom",
            isProtected: false,
          })
          .returning({ id: appRoles.id });
        await platform.insert(appRolePermissions).values({
          roleId: holderRole!.id,
          permissionKey: "role_grants.manage",
        });
        await platform.insert(roleGrants).values({
          organizationId: orgId,
          roleId: holderRole!.id,
          personId: holderPersonId,
          grantedBy: operatorUserId,
        });

        expect(await countFoundingAdministratorHolders(platform, orgId)).toBe(1);

        const { email } = await makeUser("HasHoldersDesignee");
        const result = await designateFoundingAdministrator(
          orgId,
          email,
          operatorUserId,
        );
        expect(result).toEqual({ kind: "has_holders", holderCount: 1 });

        // No founding_administrator role was minted for this org — only the
        // pre-existing holder role exists.
        const roleRows = await platform
          .select({ id: appRoles.id })
          .from(appRoles)
          .where(eq(appRoles.organizationId, orgId));
        expect(roleRows.some((r) => r.id === holderRole!.id)).toBe(true);
        expect(roleRows).toHaveLength(1);
      });
    });

    // -----------------------------------------------------------------
    // provisioning_incomplete — an org predating the F16 group seed.
    // -----------------------------------------------------------------

    describe("provisioning_incomplete", () => {
      it("refuses when the org has no active_membership derived group, and rolls back the people insert (G11 atomicity)", async () => {
        const orgId = await makeOrg("NoGroup", "congregation", {
          withActiveMembershipGroup: false,
        });
        const { id: userId, email } = await makeUser("NoGroup");

        const result = await designateFoundingAdministrator(
          orgId,
          email,
          operatorUserId,
        );
        expect(result).toEqual({ kind: "provisioning_incomplete" });

        // The whole transaction rolled back — no orphan people row for a
        // membership insert that never succeeded.
        expect(await countLivePeopleForUser(userId)).toBe(0);
      });
    });

    // -----------------------------------------------------------------
    // db_error — a genuinely unexpected failure the action layer should
    // already have caught (a malformed organizationId reaching the DB
    // directly), proving the catch-all doesn't accidentally match a named
    // case.
    // -----------------------------------------------------------------

    describe("db_error", () => {
      it("a malformed organizationId raises a real Postgres error, mapped to db_error (not thrown)", async () => {
        const { email } = await makeUser("DbError");
        const result = await designateFoundingAdministrator(
          "not-a-uuid",
          email,
          operatorUserId,
        );
        expect(result).toEqual({ kind: "db_error" });
      });
    });

    // -----------------------------------------------------------------
    // race — two concurrent designations for the same org.
    // -----------------------------------------------------------------

    describe("race", () => {
      it("exactly one of two concurrent designations succeeds; the org ends with exactly one founding_administrator role row", async () => {
        const orgId = await makeOrg("Race", "congregation");
        const { email: emailA } = await makeUser("RaceA");
        const { email: emailB } = await makeUser("RaceB");

        const [resultA, resultB] = await Promise.all([
          designateFoundingAdministrator(orgId, emailA, operatorUserId),
          designateFoundingAdministrator(orgId, emailB, operatorUserId),
        ]);

        const kinds = [resultA.kind, resultB.kind].sort();
        // Exactly one ok; the other is refused as has_holders (MEASURED: the
        // org-row `for update` lock fully serializes two calls to this
        // function for the same org, so the second always sees the first's
        // already-committed holder count in practice) or, in principle,
        // race (the app_roles_org_key unique-violation backstop — see the
        // dedicated test below, which forces that specific branch directly
        // rather than relying on this timing-dependent pair to land on it).
        // Never both ok, never neither.
        expect(kinds.filter((k) => k === "ok")).toHaveLength(1);
        expect(
          kinds.some((k) => k === "has_holders" || k === "race"),
        ).toBe(true);

        for (const r of [resultA, resultB]) {
          if (r.kind === "ok") createdPeopleIds.push(r.personId);
        }

        // The assertion that matters: no DUPLICATE founding_administrator
        // key at this org, regardless of which side won.
        const rolesWithKeys = await platform
          .select({ id: appRoles.id, key: appRoles.key })
          .from(appRoles)
          .where(eq(appRoles.organizationId, orgId));
        const founding = rolesWithKeys.filter(
          (r) => r.key === "founding_administrator",
        );
        expect(founding).toHaveLength(1);
      });

      it("GENUINE DISCOVERY: the organizations FOR UPDATE lock serializes against ANY concurrent writer touching this org's app_roles, not only against a second designateFoundingAdministrator() call — which is also why the isUniqueViolation()/race catch cannot be forced via a normal, FK-respecting writer", async () => {
        // Attempted, per Batch A's suggestion, to force the app_roles_org_key
        // 23505 directly: hold a raw, uncommitted transaction's INSERT into
        // app_roles open (for the SAME org, a DIFFERENT key, so no
        // conflict), and watch designateFoundingAdministrator() run
        // concurrently. Measured, not assumed: designateFoundingAdministrator()
        // did not block on ITS OWN app_roles insert waiting for the raw
        // transaction to resolve — it blocked much earlier, at step 1's
        // `select ... for update` on the organizations row itself, for the
        // ENTIRE duration the raw transaction stayed open, and only
        // proceeded (fast) once that transaction committed.
        //
        // The reason: app_roles.organization_id is a real foreign key to
        // organizations.id, and Postgres takes an implicit FOR KEY SHARE
        // lock on the REFERENCED row for the duration of any transaction
        // that inserts a referencing row — FOR KEY SHARE conflicts with FOR
        // UPDATE. So ANY writer inserting into app_roles/role_grants for an
        // org — not just this module's own reuse-and-reactivate step —
        // blocks behind this function's own organizations-row lock until it
        // commits or rolls back. Consequently, the isUniqueViolation()/race
        // catch cannot be forced through any ordinary, FK-respecting write
        // path: by the time a competing writer's insert could even be
        // attempted, this function's own transaction has already resolved
        // one way or the other. The catch stays in the code as the same
        // named, harmless backstop createOrganization()'s slug_taken catch
        // is for its own TOCTOU window — cheap insurance against a future
        // schema change (e.g. dropping the FK) that would reopen the
        // window, not a path any current writer can exercise.
        const orgId = await makeOrg("LockGeneralizes", "congregation");
        const { email } = await makeUser("LockGeneralizes");

        const { Pool: NeonPool, neonConfig } = await import(
          "@neondatabase/serverless"
        );
        const { default: ws } = await import("ws");
        // Belt-and-suspenders: @/lib/db's own module-scope side effect
        // already sets this once per process, but this file's dynamic
        // import of @neondatabase/serverless is a second, independent entry
        // point into that package, and a raw Pool with no WebSocket
        // constructor configured cannot hold a real multi-statement
        // transaction open across awaits (see this file's header on why
        // the WS driver, not neon-http, is required for that).
        neonConfig.webSocketConstructor = ws;

        const rawPool = new NeonPool({
          connectionString: process.env.PLATFORM_DATABASE_URL,
        });
        const rawClient = await rawPool.connect();
        try {
          await rawClient.query("BEGIN");
          // A DIFFERENT key from 'founding_administrator' — this test is
          // about the LOCK, not about forcing a specific key conflict.
          await rawClient.query(
            `insert into app_roles (organization_id, key, name, role_kind, is_protected)
             values ($1, 'unrelated_concurrent_role', 'Lock Generalizes (test)', 'custom', false)`,
            [orgId],
          );

          const HOLD_MS = 1500;
          const startedAt = Date.now();
          const designatePromise = designateFoundingAdministrator(
            orgId,
            email,
            operatorUserId,
          );

          await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
          await rawClient.query("COMMIT");

          const result = await designatePromise;
          const elapsedMs = Date.now() - startedAt;

          expect(result.kind).toBe("ok");
          // Proves it BLOCKED for (approximately) the raw transaction's
          // full lifetime, rather than completing independently of it.
          expect(elapsedMs).toBeGreaterThanOrEqual(HOLD_MS - 200);

          if (result.kind === "ok") createdPeopleIds.push(result.personId);
        } finally {
          rawClient.release();
          await rawPool.end();
        }
      });
    });

    // -----------------------------------------------------------------
    // Recovery (F109) — reuse-and-reactivate, additive-only reconcile.
    // -----------------------------------------------------------------

    describe("recovery (F109)", () => {
      it("designate -> lapse the grants and deactivate the role -> designate again: same app_roles.id, deactivated_at cleared, every plan key still present", async () => {
        const orgId = await makeOrg("Recovery", "congregation");
        const { email } = await makeUser("Recovery");

        const first = await designateFoundingAdministrator(
          orgId,
          email,
          operatorUserId,
        );
        expect(first.kind).toBe("ok");
        if (first.kind !== "ok") return;
        createdPeopleIds.push(first.personId);

        // Lapse: end the grants directly (bypassing revokeRole()'s own
        // self-lockout guard, which is not what this test is about) and
        // deactivate the administration role directly, so the second
        // designation must both reactivate AND reuse rather than insert.
        await platform
          .update(roleGrants)
          .set({ endsOn: "2020-01-01" })
          .where(eq(roleGrants.personId, first.personId));
        await platform
          .update(appRoles)
          .set({ deactivatedAt: new Date() })
          .where(eq(appRoles.id, first.administrationRoleId));

        expect(await countFoundingAdministratorHolders(platform, orgId)).toBe(0);

        const second = await designateFoundingAdministrator(
          orgId,
          email,
          operatorUserId,
        );
        expect(second.kind).toBe("ok");
        if (second.kind !== "ok") return;

        expect(second.mode).toBe("existing_person");
        expect(second.personId).toBe(first.personId);
        expect(second.administrationRoleId).toBe(first.administrationRoleId);

        const [roleRow] = await platform
          .select({ deactivatedAt: appRoles.deactivatedAt })
          .from(appRoles)
          .where(eq(appRoles.id, first.administrationRoleId));
        expect(roleRow?.deactivatedAt).toBeNull();

        const permissionRows = await platform
          .select({ permissionKey: appRolePermissions.permissionKey })
          .from(appRolePermissions)
          .where(eq(appRolePermissions.roleId, first.administrationRoleId));
        const permissionKeys = permissionRows.map((r) => r.permissionKey).sort();
        expect(permissionKeys).toEqual(
          [...foundingAdministratorPlan("congregation").administration.permissionKeys].sort(),
        );

        // Exactly one app_roles row for this key at this org (F109: reused,
        // never a second insert).
        const keyed = await platform
          .select({ id: appRoles.id, key: appRoles.key })
          .from(appRoles)
          .where(eq(appRoles.organizationId, orgId));
        expect(
          keyed.filter((r) => r.key === "founding_administrator"),
        ).toHaveLength(1);
      });
    });
  },
);
