/**
 * Integration tests for src/lib/presbytery.ts — run against a REAL Postgres
 * connection, not mocked. Follows `src/lib/credentials.test.ts`'s exact
 * harness: the `hasDb` skip-guard, dynamic imports inside `beforeAll` (this
 * file's own top-level import of `./presbytery` would otherwise reach
 * `@/lib/db`'s module-scope pool construction before DATABASE_URL is
 * confirmed set), and a self-contained fixture created and torn down per
 * file.
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is
 * SKIPPED there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run src/lib/presbytery.test.ts
 *
 * TWO PRESBYTERIES:
 *   presbyteryA — the general-purpose fixture: `congregation_oversight
 *     .manage`/`statistics.manage`/`per_capita.manage` bound to a test role,
 *     a clerk holding it, a person holding nothing, TWO member congregations
 *     (`congA`, `congB`), and a non-congregation child org (`nwcA`, an
 *     `organization_type` other than `congregation` nested under
 *     presbyteryA — exercises the org-type half of the parent-path check;
 *     see `src/lib/presbytery.ts`'s header for why the type check is
 *     `'congregation'` only, unlike `credentials.ts`'s broader
 *     `SERVING_ORG_TYPES`).
 *   presbyteryB — exists to prove the PARENT-PATH adversarial case (Phase
 *     1's "second org id" finding): `congOutsideB` is a real congregation,
 *     but of presbyteryB, not presbyteryA — every write against it FROM
 *     presbyteryA must be rejected the same as a nonexistent id.
 *
 * `congregation_statistics_freeze` TRIGGER DISCIPLINE: this file inserts
 * `published_by_congregation` fixture rows directly (via `getPlatformDb()`,
 * since no write path in `presbytery.ts` ever produces one — that is
 * Increment 4a's `presby_publish_sasr_snapshot()`) to exercise the
 * provenance-coalesce read. The freeze trigger rejects UPDATE **and**
 * DELETE on those rows, so teardown disables `congregation_statistics_
 * freeze` around its own cascade, same trigger-disable convention
 * `officers.test.ts`/`children.test.ts`/`credentials.test.ts` document for
 * `group_memberships_reject_derived`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "presbytery.ts (Postgres-backed, real dev database)",
  () => {
    let getCongregationOversightList: typeof import("./presbytery").getCongregationOversightList;
    let getCongregationOversightDetail: typeof import("./presbytery").getCongregationOversightDetail;
    let setCongregationOversight: typeof import("./presbytery").setCongregationOversight;
    let getCongregationStatisticsRollup: typeof import("./presbytery").getCongregationStatisticsRollup;
    let setCongregationStatistics: typeof import("./presbytery").setCongregationStatistics;
    let getPerCapitaOverview: typeof import("./presbytery").getPerCapitaOverview;
    let setPerCapitaRate: typeof import("./presbytery").setPerCapitaRate;
    let generatePerCapitaRecords: typeof import("./presbytery").generatePerCapitaRecords;
    let recordPerCapitaPayment: typeof import("./presbytery").recordPerCapitaPayment;

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
    let congregationOversight: typeof import("@/lib/db/domain/presbytery").congregationOversight;
    let congregationStatistics: typeof import("@/lib/db/domain/presbytery").congregationStatistics;
    let perCapitaRates: typeof import("@/lib/db/domain/presbytery").perCapitaRates;
    let perCapitaRecords: typeof import("@/lib/db/domain/presbytery").perCapitaRecords;
    let users: typeof import("@/lib/db/schema").users;

    let presbyteryA: string;
    let presbyteryB: string;
    let congA: string;
    let congB: string;
    let nwcA: string; // organization_type != 'congregation', child of presbyteryA
    let congOutsideB: string;

    let clerkRoleA: string; // carries all three presbytery permissions

    let clerkPerson: string; // presbyteryA — holds all three permissions
    let narrowPerson: string; // presbyteryA — holds nothing
    let noMembershipPerson: string; // no membership ANYWHERE

    let grantingUserId: string; // a users.id row for updated_by/entered_by

    beforeAll(async () => {
      ({
        getCongregationOversightList,
        getCongregationOversightDetail,
        setCongregationOversight,
        getCongregationStatisticsRollup,
        setCongregationStatistics,
        getPerCapitaOverview,
        setPerCapitaRate,
        generatePerCapitaRecords,
        recordPerCapitaPayment,
      } = await import("./presbytery"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations } = await import("@/lib/db/domain/org"));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
      ({ people, memberships } = await import("@/lib/db/domain/people"));
      ({ permissions, appRoles, appRolePermissions, roleGrants } = await import(
        "@/lib/db/domain/authz"
      ));
      ({ congregationOversight, congregationStatistics, perCapitaRates, perCapitaRecords } =
        await import("@/lib/db/domain/presbytery"));
      ({ users } = await import("@/lib/db/schema"));

      const platform = getPlatformDb();
      const stamp = Date.now();

      async function makeOrg(
        label: string,
        organizationType: string,
        parentId: string | null,
      ) {
        const [row] = await platform
          .insert(organizations)
          .values({
            organizationType: organizationType as "presbytery",
            parentId,
            name: `Fixture ${label} for presbytery.test.ts`,
            slug: `presbytery-test-${label.toLowerCase()}-${stamp}`,
            path: `presbytery_test_${label.toLowerCase()}_${stamp}`,
            platformStatus: "unmanaged",
          })
          .returning({ id: organizations.id });
        return row!.id;
      }

      presbyteryA = await makeOrg("PresbyteryA", "presbytery", null);
      presbyteryB = await makeOrg("PresbyteryB", "presbytery", null);
      congA = await makeOrg("CongA", "congregation", presbyteryA);
      congB = await makeOrg("CongB", "congregation", presbyteryA);
      nwcA = await makeOrg("NwcA", "new_worshiping_community", presbyteryA);
      congOutsideB = await makeOrg("CongOutsideB", "congregation", presbyteryB);

      // F16: the "Active Membership" derived roster group must exist before
      // ANY memberships insert at an org (presbyteryA/B only — congA/B/
      // nwcA/congOutsideB are never an org CONTEXT in this file, only a
      // plain-FK aboutOrgId target, so they need no roster group).
      async function findOrCreateGroupType(key: string) {
        const [gt] = await platform
          .insert(groupTypes)
          .values({ organizationId: null, key, name: key })
          .onConflictDoNothing()
          .returning({ id: groupTypes.id });
        if (gt?.id) return gt.id;
        const [existing] = await platform
          .select({ id: groupTypes.id })
          .from(groupTypes)
          .where(eq(groupTypes.key, key))
          .limit(1);
        return existing!.id;
      }
      const rosterTypeId = await findOrCreateGroupType("roster");
      async function derivedRosterGroup(organizationId: string) {
        await platform.insert(groups).values({
          organizationId,
          groupTypeId: rosterTypeId,
          name: "Active Membership",
          membershipSource: "derived",
          derivedFrom: "active_membership",
          isProtected: true,
        });
      }
      await derivedRosterGroup(presbyteryA);
      await derivedRosterGroup(presbyteryB);

      // Permission catalog — already seeded in a real dev DB by 0038;
      // onConflictDoNothing keeps this file self-sufficient.
      await platform
        .insert(permissions)
        .values([
          {
            key: "congregation_oversight.manage",
            module: "presbytery",
            description: "Manage congregation oversight records",
            sensitivityTier: 1,
          },
          {
            key: "statistics.manage",
            module: "presbytery",
            description: "Manage congregation statistics",
            sensitivityTier: 2,
          },
          {
            key: "per_capita.manage",
            module: "presbytery",
            description: "Manage per-capita rates and records",
            sensitivityTier: 2,
          },
        ])
        .onConflictDoNothing();

      const [userRow] = await platform
        .insert(users)
        .values({
          email: `presbytery-test-granter-${stamp}@example.invalid`,
          name: "Presbytery Test Granter",
        })
        .returning({ id: users.id });
      grantingUserId = userRow!.id;

      const [clerkRoleRow] = await platform
        .insert(appRoles)
        .values({
          organizationId: presbyteryA,
          key: "clerk",
          name: "Clerk (test)",
          roleKind: "constitutional",
          isProtected: true,
        })
        .returning({ id: appRoles.id });
      clerkRoleA = clerkRoleRow!.id;
      await platform.insert(appRolePermissions).values([
        { roleId: clerkRoleA, permissionKey: "congregation_oversight.manage" },
        { roleId: clerkRoleA, permissionKey: "statistics.manage" },
        { roleId: clerkRoleA, permissionKey: "per_capita.manage" },
      ]);

      async function person(first: string, last: string) {
        const [p] = await platform
          .insert(people)
          .values({ firstName: first, lastName: last })
          .returning({ id: people.id });
        return p!.id;
      }
      clerkPerson = await person("Perpetua", "Ashworth-Nkemelu");
      narrowPerson = await person("Cassius", "Delacroix-Odum");

      async function membership(organizationId: string, personId: string) {
        await platform.insert(memberships).values({
          organizationId,
          personId,
          engagementStatus: "regular",
          currentRoll: "active",
        });
      }
      await membership(presbyteryA, clerkPerson);
      await membership(presbyteryA, narrowPerson);

      await platform.insert(roleGrants).values({
        organizationId: presbyteryA,
        roleId: clerkRoleA,
        personId: clerkPerson,
        startsOn: "2020-01-01",
        grantedBy: grantingUserId,
      });

      noMembershipPerson = await person("Ondine", "Fairweather-Solheim");
      // Deliberately no membership row anywhere for noMembershipPerson.
    });

    afterAll(async () => {
      const platform = getPlatformDb();

      // The freeze trigger rejects UPDATE/DELETE on published_by_congregation
      // rows — disabled for teardown's own cascade, same convention
      // group_memberships_reject_derived documents elsewhere in this file
      // family.
      await platform.execute(
        sql`alter table congregation_statistics disable trigger congregation_statistics_freeze`,
      );
      try {
        await platform
          .delete(congregationStatistics)
          .where(inArray(congregationStatistics.organizationId, [presbyteryA, presbyteryB]));
      } finally {
        await platform.execute(
          sql`alter table congregation_statistics enable trigger congregation_statistics_freeze`,
        );
      }
      await platform
        .delete(perCapitaRecords)
        .where(inArray(perCapitaRecords.organizationId, [presbyteryA, presbyteryB]));
      await platform
        .delete(perCapitaRates)
        .where(inArray(perCapitaRates.organizationId, [presbyteryA, presbyteryB]));
      await platform
        .delete(congregationOversight)
        .where(inArray(congregationOversight.organizationId, [presbyteryA, presbyteryB]));

      // Same trigger-disable teardown convention as officers.test.ts/
      // children.test.ts/credentials.test.ts — deleting presbyteryA/B
      // cascades into their derived "Active Membership" group_memberships
      // rows, which reject direct delete.
      await platform.execute(
        sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
      );
      try {
        await platform.delete(organizations).where(eq(organizations.id, congA));
        await platform.delete(organizations).where(eq(organizations.id, congB));
        await platform.delete(organizations).where(eq(organizations.id, nwcA));
        await platform.delete(organizations).where(eq(organizations.id, congOutsideB));
        await platform.delete(organizations).where(eq(organizations.id, presbyteryA));
        await platform.delete(organizations).where(eq(organizations.id, presbyteryB));
      } finally {
        await platform.execute(
          sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
        );
      }

      for (const id of [clerkPerson, narrowPerson, noMembershipPerson]) {
        await platform.delete(people).where(eq(people.id, id));
      }
      await platform.delete(users).where(eq(users.id, grantingUserId));
    });

    // -----------------------------------------------------------------
    // Permission gate — every exported function, checked first
    // -----------------------------------------------------------------

    describe("permission gate — checked before any read or write", () => {
      it("getCongregationOversightList: forbidden for a person holding no congregation_oversight.manage", async () => {
        const result = await getCongregationOversightList(narrowPerson, presbyteryA);
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("setCongregationOversight: forbidden, AND NOTHING IS WRITTEN", async () => {
        const result = await setCongregationOversight(
          narrowPerson,
          presbyteryA,
          grantingUserId,
          congA,
          { viabilityScore: 2 },
        );
        expect(result).toEqual({ kind: "forbidden" });

        const after = await getCongregationOversightDetail(clerkPerson, presbyteryA, congA);
        if (after.kind !== "ok") throw new Error("expected ok");
        expect(after.data.hasData).toBe(false);
      });

      it("getCongregationStatisticsRollup: forbidden for a person holding no statistics.manage", async () => {
        const result = await getCongregationStatisticsRollup(narrowPerson, presbyteryA, 2025);
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("setCongregationStatistics: forbidden, AND NOTHING IS WRITTEN", async () => {
        const result = await setCongregationStatistics(
          narrowPerson,
          presbyteryA,
          grantingUserId,
          congA,
          2020,
          { endingActive: 100 },
        );
        expect(result).toEqual({ kind: "forbidden" });

        const after = await getCongregationStatisticsRollup(clerkPerson, presbyteryA, 2020);
        if (after.kind !== "ok") throw new Error("expected ok");
        expect(after.data.find((r) => r.organizationId === congA)?.hasData).toBe(false);
      });

      it("getPerCapitaOverview: forbidden for a person holding no per_capita.manage", async () => {
        const result = await getPerCapitaOverview(narrowPerson, presbyteryA, 2026);
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("setPerCapitaRate: forbidden, AND NOTHING IS WRITTEN", async () => {
        const result = await setPerCapitaRate(narrowPerson, presbyteryA, grantingUserId, 2021, {
          ratePerMember: "10.00",
        });
        expect(result).toEqual({ kind: "forbidden" });

        const after = await getPerCapitaOverview(clerkPerson, presbyteryA, 2021);
        if (after.kind !== "ok") throw new Error("expected ok");
        expect(after.data.rate).toBeNull();
      });

      it("generatePerCapitaRecords: forbidden for a person holding no per_capita.manage", async () => {
        const result = await generatePerCapitaRecords(narrowPerson, presbyteryA, grantingUserId, 2021);
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("recordPerCapitaPayment: forbidden for a person holding no per_capita.manage", async () => {
        const result = await recordPerCapitaPayment(
          narrowPerson,
          presbyteryA,
          grantingUserId,
          randomUUID(),
          { paidAmount: "10.00", paidAt: "2026-01-01" },
        );
        expect(result).toEqual({ kind: "forbidden" });
      });
    });

    // -----------------------------------------------------------------
    // Congregation oversight — parent-path + upsert + validation
    // -----------------------------------------------------------------

    describe("congregation oversight", () => {
      it("invalid_target for a congregation belonging to a DIFFERENT presbytery", async () => {
        const result = await setCongregationOversight(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          congOutsideB,
          { viabilityScore: 2 },
        );
        expect(result).toEqual({ kind: "invalid_target" });
      });

      it("invalid_target for a child org whose organization_type isn't 'congregation'", async () => {
        const result = await setCongregationOversight(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          nwcA,
          { viabilityScore: 2 },
        );
        expect(result).toEqual({ kind: "invalid_target" });
      });

      it("invalid_target for a nonexistent aboutOrgId", async () => {
        const result = await setCongregationOversight(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          randomUUID(),
          { viabilityScore: 2 },
        );
        expect(result).toEqual({ kind: "invalid_target" });
      });

      it("invalid_input for an out-of-range viability score", async () => {
        const result = await setCongregationOversight(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          congA,
          { viabilityScore: 5 },
        );
        expect(result.kind).toBe("invalid_input");
      });

      it("invalid_input for a malformed insuranceExpiresOn", async () => {
        const result = await setCongregationOversight(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          congA,
          { insuranceExpiresOn: "not-a-date" },
        );
        expect(result.kind).toBe("invalid_input");
      });

      it("creates, then UPSERTS on a second call — one row per congregation, not two", async () => {
        const first = await setCongregationOversight(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          congA,
          { viabilityScore: 3, buildingsNotes: "Roof replaced 2024" },
        );
        expect(first.kind).toBe("ok");

        const second = await setCongregationOversight(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          congA,
          { viabilityScore: 2, buildingsNotes: "Fellowship hall leak" },
        );
        expect(second.kind).toBe("ok");
        if (first.kind === "ok" && second.kind === "ok") {
          expect(second.data.id).toBe(first.data.id);
        }

        const detail = await getCongregationOversightDetail(clerkPerson, presbyteryA, congA);
        if (detail.kind !== "ok") throw new Error("expected ok");
        expect(detail.data.viabilityScore).toBe(2);
        expect(detail.data.buildingsNotes).toBe("Fellowship hall leak");
      });

      it("getCongregationOversightList includes a congregation with NO oversight row on file (hasData: false)", async () => {
        const result = await getCongregationOversightList(clerkPerson, presbyteryA);
        if (result.kind !== "ok") throw new Error("expected ok");
        const congBRow = result.data.find((r) => r.organizationId === congB);
        expect(congBRow?.hasData).toBe(false);
        expect(congBRow?.viabilityScore).toBeNull();
        // congA (set above) has data.
        const congARow = result.data.find((r) => r.organizationId === congA);
        expect(congARow?.hasData).toBe(true);
      });

      it("getCongregationOversightList never includes a congregation belonging to a DIFFERENT presbytery", async () => {
        const result = await getCongregationOversightList(clerkPerson, presbyteryA);
        if (result.kind !== "ok") throw new Error("expected ok");
        expect(result.data.some((r) => r.organizationId === congOutsideB)).toBe(false);
      });
    });

    // -----------------------------------------------------------------
    // Congregation statistics — parent-path + upsert + provenance coalesce
    // -----------------------------------------------------------------

    describe("congregation statistics", () => {
      it("invalid_target for a congregation belonging to a DIFFERENT presbytery", async () => {
        const result = await setCongregationStatistics(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          congOutsideB,
          2025,
          { endingActive: 100 },
        );
        expect(result).toEqual({ kind: "invalid_target" });
      });

      it("invalid_input for a negative count", async () => {
        const result = await setCongregationStatistics(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          congA,
          2025,
          { endingActive: -5 },
        );
        expect(result.kind).toBe("invalid_input");
      });

      it("invalid_input for an out-of-range year", async () => {
        const result = await getCongregationStatisticsRollup(clerkPerson, presbyteryA, 3000);
        expect(result.kind).toBe("invalid_input");
      });

      it("creates, then UPSERTS a presbytery_entered row for the same (congregation, year)", async () => {
        const first = await setCongregationStatistics(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          congA,
          2024,
          { endingActive: 100 },
        );
        expect(first.kind).toBe("ok");

        const second = await setCongregationStatistics(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          congA,
          2024,
          { endingActive: 150 },
        );
        expect(second.kind).toBe("ok");
        if (first.kind === "ok" && second.kind === "ok") {
          expect(second.data.id).toBe(first.data.id);
        }

        const rollup = await getCongregationStatisticsRollup(clerkPerson, presbyteryA, 2024);
        if (rollup.kind !== "ok") throw new Error("expected ok");
        const row = rollup.data.find((r) => r.organizationId === congA);
        expect(row?.provenance).toBe("presbytery_entered");
        expect(row?.endingActive).toBe(150);
      });

      it("a published_by_congregation row wins the coalesce over a presbytery_entered row for the same year", async () => {
        await setCongregationStatistics(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          congB,
          2023,
          { endingActive: 40 },
        );

        const platform = getPlatformDb();
        await platform.insert(congregationStatistics).values({
          organizationId: presbyteryA,
          aboutOrgId: congB,
          year: 2023,
          provenance: "published_by_congregation",
          publishedAt: new Date("2024-01-10T00:00:00Z"),
          endingActive: 212,
        });

        const rollup = await getCongregationStatisticsRollup(clerkPerson, presbyteryA, 2023);
        if (rollup.kind !== "ok") throw new Error("expected ok");
        const row = rollup.data.find((r) => r.organizationId === congB);
        expect(row?.provenance).toBe("published_by_congregation");
        expect(row?.endingActive).toBe(212);
      });

      it("a LATER published_by_congregation row (a republish) wins over an earlier one", async () => {
        const platform = getPlatformDb();
        await platform.insert(congregationStatistics).values({
          organizationId: presbyteryA,
          aboutOrgId: congB,
          year: 2022,
          provenance: "published_by_congregation",
          publishedAt: new Date("2023-01-01T00:00:00Z"),
          endingActive: 200,
        });
        await platform.insert(congregationStatistics).values({
          organizationId: presbyteryA,
          aboutOrgId: congB,
          year: 2022,
          provenance: "published_by_congregation",
          publishedAt: new Date("2023-06-01T00:00:00Z"),
          endingActive: 205,
        });

        const rollup = await getCongregationStatisticsRollup(clerkPerson, presbyteryA, 2022);
        if (rollup.kind !== "ok") throw new Error("expected ok");
        const row = rollup.data.find((r) => r.organizationId === congB);
        expect(row?.endingActive).toBe(205);
      });

      it("getCongregationStatisticsRollup includes a congregation with NO data on file for the year (hasData: false, provenance: null)", async () => {
        const rollup = await getCongregationStatisticsRollup(clerkPerson, presbyteryA, 1999);
        if (rollup.kind !== "ok") throw new Error("expected ok");
        const row = rollup.data.find((r) => r.organizationId === congA);
        expect(row?.hasData).toBe(false);
        expect(row?.provenance).toBeNull();
      });
    });

    // -----------------------------------------------------------------
    // Per-capita — rate defaulting, generation skip rules, payment status
    // -----------------------------------------------------------------

    describe("per-capita", () => {
      it("setPerCapitaRate defaults basisYear to billingYear - 2 when omitted", async () => {
        const result = await setPerCapitaRate(clerkPerson, presbyteryA, grantingUserId, 2030, {
          ratePerMember: "15.00",
        });
        expect(result.kind).toBe("ok");

        const overview = await getPerCapitaOverview(clerkPerson, presbyteryA, 2030);
        if (overview.kind !== "ok") throw new Error("expected ok");
        expect(overview.data.rate?.basisYear).toBe(2028);
      });

      it("setPerCapitaRate honors an explicit basisYear override", async () => {
        const result = await setPerCapitaRate(clerkPerson, presbyteryA, grantingUserId, 2031, {
          basisYear: 2029,
          ratePerMember: "16.00",
        });
        expect(result.kind).toBe("ok");

        const overview = await getPerCapitaOverview(clerkPerson, presbyteryA, 2031);
        if (overview.kind !== "ok") throw new Error("expected ok");
        expect(overview.data.rate?.basisYear).toBe(2029);
      });

      it("invalid_input for a negative rate", async () => {
        const result = await setPerCapitaRate(clerkPerson, presbyteryA, grantingUserId, 2032, {
          ratePerMember: "-5.00",
        });
        expect(result.kind).toBe("invalid_input");
      });

      it("generatePerCapitaRecords is invalid_input when no rate is set for the billing year", async () => {
        const result = await generatePerCapitaRecords(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          2099,
        );
        expect(result.kind).toBe("invalid_input");
      });

      it("skips a congregation with no statistics on file for the basis year, names it, and creates records for those that have data", async () => {
        // basisYear 2024 statistics: congA has a row (from the upsert test
        // above, endingActive 150 at year 2024); congB has none at 2024.
        await setPerCapitaRate(clerkPerson, presbyteryA, grantingUserId, 2040, {
          basisYear: 2024,
          ratePerMember: "10.00",
        });

        const result = await generatePerCapitaRecords(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          2040,
        );
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.data.created).toBe(1);
        expect(result.data.skipped.some((s) => s.includes("no statistics on file"))).toBe(true);

        const overview = await getPerCapitaOverview(clerkPerson, presbyteryA, 2040);
        if (overview.kind !== "ok") throw new Error("expected ok");
        const record = overview.data.records.find((r) => r.organizationId === congA);
        expect(record?.endingActiveBasis).toBe(150);
        expect(record?.amountOwed).toBe("1500.00");
      });

      it("regenerating never overwrites an existing record — it is skipped and named", async () => {
        const result = await generatePerCapitaRecords(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          2040,
        );
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.data.created).toBe(0);
        expect(result.data.skipped.some((s) => s.includes("already has a"))).toBe(true);
      });

      it("recordPerCapitaPayment: invalid_target for a nonexistent record", async () => {
        const result = await recordPerCapitaPayment(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          randomUUID(),
          { paidAmount: "10.00", paidAt: "2026-01-01" },
        );
        expect(result).toEqual({ kind: "invalid_target" });
      });

      it("derives paidStatus: paid, partial, unpaid, from paidAmount vs. the frozen amountOwed", async () => {
        const overview = await getPerCapitaOverview(clerkPerson, presbyteryA, 2040);
        if (overview.kind !== "ok") throw new Error("expected ok");
        const record = overview.data.records.find((r) => r.organizationId === congA);
        if (!record) throw new Error("expected a record for congA");

        const partial = await recordPerCapitaPayment(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          record.recordId,
          { paidAmount: "500.00", paidAt: "2040-03-01" },
        );
        expect(partial.kind).toBe("ok");

        let refreshed = await getPerCapitaOverview(clerkPerson, presbyteryA, 2040);
        if (refreshed.kind !== "ok") throw new Error("expected ok");
        expect(
          refreshed.data.records.find((r) => r.recordId === record.recordId)?.paidStatus,
        ).toBe("partial");

        const paid = await recordPerCapitaPayment(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          record.recordId,
          { paidAmount: "1500.00", paidAt: "2040-04-01" },
        );
        expect(paid.kind).toBe("ok");

        refreshed = await getPerCapitaOverview(clerkPerson, presbyteryA, 2040);
        if (refreshed.kind !== "ok") throw new Error("expected ok");
        expect(
          refreshed.data.records.find((r) => r.recordId === record.recordId)?.paidStatus,
        ).toBe("paid");
      });

      it("a malformed paidAt throws synchronously", async () => {
        await expect(
          recordPerCapitaPayment(clerkPerson, presbyteryA, grantingUserId, randomUUID(), {
            paidAmount: "10.00",
            paidAt: "not-a-date",
          }),
        ).rejects.toThrow(/paidAt/);
      });
    });

    // -----------------------------------------------------------------
    // Genuine failure propagation (not swallowed into a result variant)
    // -----------------------------------------------------------------

    describe("genuine failures propagate as thrown exceptions", () => {
      it("getCongregationOversightList: a person with no relationship at all throws OrgAccessError", async () => {
        await expect(
          getCongregationOversightList(noMembershipPerson, presbyteryA),
        ).rejects.toMatchObject({ name: "OrgAccessError" });
      });

      it("getCongregationStatisticsRollup: a person with no relationship at all throws OrgAccessError", async () => {
        await expect(
          getCongregationStatisticsRollup(randomUUID(), presbyteryA, 2025),
        ).rejects.toMatchObject({ name: "OrgAccessError" });
      });
    });
  },
);
