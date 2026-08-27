/**
 * Integration tests for src/lib/credentials.ts — run against a REAL Postgres
 * connection, not mocked. Follows `src/lib/officers.test.ts`'s exact harness:
 * the `hasDb` skip-guard, dynamic imports inside `beforeAll` (this file's own
 * top-level import of `./credentials` would otherwise reach `@/lib/db`'s
 * module-scope pool construction before DATABASE_URL is confirmed set), and
 * a self-contained fixture created and torn down per file.
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is SKIPPED
 * there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run src/lib/credentials.test.ts
 *
 * TWO PRESBYTERIES:
 *   presbyteryA — the general-purpose fixture: `credentials.manage` bound to
 *     a test role, a clerk holding it, a person holding nothing, a current
 *     member (ordination/appointment target), a lapsed member, TWO member
 *     congregations (`congregationA`, a plain congregation, and `nwcA`, a
 *     new_worshiping_community — both legal `servingOrgId` types), plus one
 *     dedicated "collision" fixture person.
 *   presbyteryB — exists to prove the PARENT-PATH adversarial case (Phase
 *     1's "second org id" finding): `congregationOutsideB` is a real
 *     member congregation, but of presbyteryB, not presbyteryA — recording
 *     an appointment against it FROM presbyteryA must be rejected the same
 *     as a nonexistent id. `outsidePerson` (membership only at presbyteryB)
 *     proves the F21 cross-org case for both write paths.
 *
 * DERIVED-GROUP FIXTURE BOILERPLATE (F16, same as `officers.test.ts`): ANY
 * `memberships` insert requires the org's own "Active Membership" derived
 * roster group to exist first, or a trigger blocks it — created for both
 * presbyteries below. Teardown disables `group_memberships_reject_derived`
 * around the cascade, same trigger-disable convention `officers.test.ts`/
 * `children.test.ts` document.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "credentials.ts (Postgres-backed, real dev database)",
  () => {
    let listOrdinations: typeof import("./credentials").listOrdinations;
    let recordOrdination: typeof import("./credentials").recordOrdination;
    let changeOrdinationStatus: typeof import("./credentials").changeOrdinationStatus;
    let listAppointments: typeof import("./credentials").listAppointments;
    let recordAppointment: typeof import("./credentials").recordAppointment;
    let endAppointment: typeof import("./credentials").endAppointment;
    let getCredentialsFormOptions: typeof import("./credentials").getCredentialsFormOptions;
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
    let ordinations: typeof import("@/lib/db/domain/officers").ordinations;
    let appointments: typeof import("@/lib/db/domain/officers").appointments;
    let users: typeof import("@/lib/db/schema").users;

    let presbyteryA: string;
    let presbyteryB: string;
    let congregationA: string;
    let nwcA: string;
    let congregationOutsideB: string;

    let clerkRoleA: string; // carries credentials.manage

    let clerkPerson: string; // presbyteryA — holds credentials.manage
    let narrowPerson: string; // presbyteryA — holds nothing
    let targetPerson: string; // presbyteryA — current membership, term target
    let lapsedPerson: string; // presbyteryA — membership ended
    let collisionPerson: string; // presbyteryA — dedicated to the open-appointment collision test

    let outsidePerson: string; // presbyteryB only — cross-org invalid_target
    let noMembershipPerson: string; // no membership ANYWHERE — cross-org throw

    let grantingUserId: string; // a users.id row for recorded_by

    beforeAll(async () => {
      ({
        listOrdinations,
        recordOrdination,
        changeOrdinationStatus,
        listAppointments,
        recordAppointment,
        endAppointment,
        getCredentialsFormOptions,
      } = await import("./credentials"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations } = await import("@/lib/db/domain/org"));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
      ({ people, memberships } = await import("@/lib/db/domain/people"));
      ({ permissions, appRoles, appRolePermissions, roleGrants } = await import(
        "@/lib/db/domain/authz"
      ));
      ({ ordinations, appointments } = await import(
        "@/lib/db/domain/officers"
      ));
      ({ users } = await import("@/lib/db/schema"));

      const platform = getPlatformDb();
      const stamp = Date.now();

      async function makePresbytery(label: string) {
        const [row] = await platform
          .insert(organizations)
          .values({
            organizationType: "presbytery",
            name: `Fixture Presbytery ${label} for credentials.test.ts`,
            slug: `credentials-test-presbytery-${label.toLowerCase()}-${stamp}`,
            path: `credentials_test_presbytery_${label.toLowerCase()}_${stamp}`,
            platformStatus: "unmanaged",
          })
          .returning({ id: organizations.id });
        return row!.id;
      }

      async function makeCongregation(
        label: string,
        parentId: string,
        organizationType: "congregation" | "new_worshiping_community" = "congregation",
      ) {
        const [row] = await platform
          .insert(organizations)
          .values({
            organizationType,
            parentId,
            name: `Fixture Congregation ${label} for credentials.test.ts`,
            slug: `credentials-test-cong-${label.toLowerCase()}-${stamp}`,
            path: `credentials_test_cong_${label.toLowerCase()}_${stamp}`,
            platformStatus: "unmanaged",
          })
          .returning({ id: organizations.id });
        return row!.id;
      }

      presbyteryA = await makePresbytery("A");
      presbyteryB = await makePresbytery("B");
      congregationA = await makeCongregation("A", presbyteryA, "congregation");
      nwcA = await makeCongregation("Nwc", presbyteryA, "new_worshiping_community");
      congregationOutsideB = await makeCongregation("Outside", presbyteryB);

      // F16: the "Active Membership" derived roster group must exist before
      // ANY memberships insert at an org.
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

      // Permission catalog — already seeded in a real dev DB by
      // drizzle/0037; onConflictDoNothing keeps this file self-sufficient.
      await platform
        .insert(permissions)
        .values({
          key: "credentials.manage",
          module: "officers",
          description: "Record ordination status changes and pastoral appointments",
          sensitivityTier: 1,
        })
        .onConflictDoNothing();

      const [userRow] = await platform
        .insert(users)
        .values({
          email: `credentials-test-granter-${stamp}@example.invalid`,
          name: "Credentials Test Granter",
        })
        .returning({ id: users.id });
      grantingUserId = userRow!.id;

      // --- presbyteryA: the general-purpose fixture -----------------------

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
      await platform
        .insert(appRolePermissions)
        .values({ roleId: clerkRoleA, permissionKey: "credentials.manage" });

      async function person(first: string, last: string) {
        const [p] = await platform
          .insert(people)
          .values({ firstName: first, lastName: last })
          .returning({ id: people.id });
        return p!.id;
      }

      clerkPerson = await person("Perpetua", "Ashworth-Nkemelu");
      narrowPerson = await person("Cassius", "Delacroix-Odum");
      targetPerson = await person("Wilhelmina", "Osei-Fairweather");
      lapsedPerson = await person("Barnaby", "Quintrell");
      collisionPerson = await person("Ottoline", "Vasquez-Iyer");

      async function membership(
        organizationId: string,
        personId: string,
        endedOn: string | null = null,
      ) {
        await platform.insert(memberships).values({
          organizationId,
          personId,
          engagementStatus: "regular",
          currentRoll: "active",
          endedOn,
        });
      }

      await membership(presbyteryA, clerkPerson);
      await membership(presbyteryA, narrowPerson);
      await membership(presbyteryA, targetPerson);
      await membership(presbyteryA, lapsedPerson);
      await membership(presbyteryA, collisionPerson);

      await platform.insert(roleGrants).values({
        organizationId: presbyteryA,
        roleId: clerkRoleA,
        personId: clerkPerson,
        startsOn: "2020-01-01",
        grantedBy: grantingUserId,
      });

      // Same narrowly-scoped, try/finally-guarded trigger disable
      // `officers.test.ts`/`role-grants.test.ts` use for their own
      // lapsed-member fixture.
      await platform.execute(
        sql`alter table memberships disable trigger memberships_guard_end`,
      );
      try {
        await platform
          .update(memberships)
          .set({ endedOn: "2021-06-15" })
          .where(eq(memberships.personId, lapsedPerson));
      } finally {
        await platform.execute(
          sql`alter table memberships enable trigger memberships_guard_end`,
        );
      }

      // --- presbyteryB: cross-org / parent-path isolation fixture --------

      outsidePerson = await person("Zosime", "Barraclough");
      await membership(presbyteryB, outsidePerson);

      noMembershipPerson = await person("Cosima", "Adeyemi");
      // Deliberately no membership row anywhere for noMembershipPerson.
    });

    afterAll(async () => {
      const platform = getPlatformDb();
      const allPeople = [
        clerkPerson,
        narrowPerson,
        targetPerson,
        lapsedPerson,
        collisionPerson,
        outsidePerson,
        noMembershipPerson,
      ].filter(Boolean);

      // Same trigger-disable teardown convention as officers.test.ts/
      // children.test.ts/roll.test.ts.
      await platform.execute(
        sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
      );
      try {
        // appointments.servingOrgId (no cascade) must be cleared before the
        // congregation orgs it points at can be deleted; organizations
        // .parentId (no cascade) must be cleared (children deleted) before
        // the presbytery orgs can be deleted. Order below satisfies both.
        await platform
          .delete(appointments)
          .where(inArray(appointments.organizationId, [presbyteryA, presbyteryB]));
        await platform.delete(organizations).where(eq(organizations.id, congregationA));
        await platform.delete(organizations).where(eq(organizations.id, nwcA));
        await platform
          .delete(organizations)
          .where(eq(organizations.id, congregationOutsideB));
        await platform.delete(organizations).where(eq(organizations.id, presbyteryA));
        await platform.delete(organizations).where(eq(organizations.id, presbyteryB));
      } finally {
        await platform.execute(
          sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
        );
      }
      for (const id of allPeople) {
        await platform.delete(people).where(eq(people.id, id));
      }
      await platform.delete(users).where(eq(users.id, grantingUserId));
    });

    // -----------------------------------------------------------------
    // Permission gate — every exported function, checked first
    // -----------------------------------------------------------------

    describe("permission gate — credentials.manage checked before any read or write", () => {
      it("listOrdinations: forbidden for a person holding no credentials.manage", async () => {
        const result = await listOrdinations(narrowPerson, presbyteryA);
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("recordOrdination: forbidden, AND NOTHING IS WRITTEN", async () => {
        const result = await recordOrdination(narrowPerson, presbyteryA, {
          personId: targetPerson,
          ministry: "ruling_elder",
          ordainedOn: "2026-01-01",
        });
        expect(result).toEqual({ kind: "forbidden" });

        const after = await listOrdinations(clerkPerson, presbyteryA);
        if (after.kind !== "ok") throw new Error("expected ok");
        expect(
          after.data.some((entry) => entry.personId === targetPerson),
        ).toBe(false);
      });

      it("changeOrdinationStatus: forbidden for a person holding no credentials.manage", async () => {
        const result = await changeOrdinationStatus(narrowPerson, presbyteryA, {
          ordinationId: randomUUID(),
          status: "on_leave",
        });
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("listAppointments: forbidden for a person holding no credentials.manage", async () => {
        const result = await listAppointments(narrowPerson, presbyteryA);
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("recordAppointment: forbidden, AND NOTHING IS WRITTEN", async () => {
        const result = await recordAppointment(
          narrowPerson,
          presbyteryA,
          grantingUserId,
          {
            personId: targetPerson,
            servingOrgId: congregationA,
            callType: "installed_pastor",
            startsOn: "2026-01-01",
          },
        );
        expect(result).toEqual({ kind: "forbidden" });

        const after = await listAppointments(clerkPerson, presbyteryA);
        if (after.kind !== "ok") throw new Error("expected ok");
        expect(
          after.data.some((entry) => entry.personId === targetPerson),
        ).toBe(false);
      });

      it("endAppointment: forbidden for a person holding no credentials.manage", async () => {
        const result = await endAppointment(narrowPerson, presbyteryA, {
          appointmentId: randomUUID(),
          endsOn: "2026-01-01",
          endReason: "accepted a call elsewhere",
        });
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("getCredentialsFormOptions: forbidden for a person holding no credentials.manage", async () => {
        const result = await getCredentialsFormOptions(narrowPerson, presbyteryA);
        expect(result).toEqual({ kind: "forbidden" });
      });
    });

    // -----------------------------------------------------------------
    // recordOrdination — F21 shape + validation
    // -----------------------------------------------------------------

    describe("recordOrdination", () => {
      it("a person with no CURRENT membership at this org is invalid_target (lapsed member)", async () => {
        const result = await recordOrdination(clerkPerson, presbyteryA, {
          personId: lapsedPerson,
          ministry: "ruling_elder",
          ordainedOn: "2026-01-01",
        });
        expect(result).toEqual({ kind: "invalid_target" });
      });

      it("a person with a membership only at a DIFFERENT presbytery is invalid_target", async () => {
        const result = await recordOrdination(clerkPerson, presbyteryA, {
          personId: outsidePerson,
          ministry: "ruling_elder",
          ordainedOn: "2026-01-01",
        });
        expect(result).toEqual({ kind: "invalid_target" });
      });

      it("succeeds for a current member, status defaults to active", async () => {
        const result = await recordOrdination(clerkPerson, presbyteryA, {
          personId: targetPerson,
          ministry: "minister_of_word_and_sacrament",
          ordainedOn: "2020-06-15",
          minuteReference: "Presbytery minutes, 15 June 2020",
        });
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;

        const list = await listOrdinations(clerkPerson, presbyteryA);
        if (list.kind !== "ok") throw new Error("expected ok");
        const entry = list.data.find((e) => e.ordinationId === result.data.ordinationId);
        expect(entry?.status).toBe("active");
        expect(entry?.ministry).toBe("minister_of_word_and_sacrament");
        expect(entry?.endedOn).toBeNull();
      });

      it("a minute reference over the length limit is invalid_input", async () => {
        const result = await recordOrdination(clerkPerson, presbyteryA, {
          personId: targetPerson,
          ministry: "ruling_elder",
          ordainedOn: "2026-01-01",
          minuteReference: "x".repeat(501),
        });
        expect(result.kind).toBe("invalid_input");
      });

      it("a malformed ordainedOn throws synchronously, not returned as a result", async () => {
        await expect(
          recordOrdination(clerkPerson, presbyteryA, {
            personId: targetPerson,
            ministry: "ruling_elder",
            ordainedOn: "not-a-date",
          }),
        ).rejects.toThrow(/ordainedOn/);
      });

      it("an unrecognized ministry throws", async () => {
        await expect(
          recordOrdination(clerkPerson, presbyteryA, {
            personId: targetPerson,
            // @ts-expect-error — deliberately invalid for this test
            ministry: "bishop",
            ordainedOn: "2026-01-01",
          }),
        ).rejects.toThrow(/ministry/);
      });
    });

    // -----------------------------------------------------------------
    // changeOrdinationStatus — status vs. removal, never touches endedOn
    // -----------------------------------------------------------------

    describe("changeOrdinationStatus", () => {
      it("invalid_target for an ordination id that doesn't exist", async () => {
        const result = await changeOrdinationStatus(clerkPerson, presbyteryA, {
          ordinationId: randomUUID(),
          status: "on_leave",
        });
        expect(result).toEqual({ kind: "invalid_target" });
      });

      it("updates status on the SAME row, never touching endedOn/endedReason", async () => {
        const recorded = await recordOrdination(clerkPerson, presbyteryA, {
          personId: targetPerson,
          ministry: "ruling_elder",
          ordainedOn: "2015-01-01",
        });
        if (recorded.kind !== "ok") throw new Error("expected ok");

        const changed = await changeOrdinationStatus(clerkPerson, presbyteryA, {
          ordinationId: recorded.data.ordinationId,
          status: "honorably_retired",
          minuteReference: "Presbytery minutes, 1 Jan 2026",
        });
        expect(changed).toEqual({
          kind: "ok",
          data: { ordinationId: recorded.data.ordinationId },
        });

        const list = await listOrdinations(clerkPerson, presbyteryA);
        if (list.kind !== "ok") throw new Error("expected ok");
        const entry = list.data.find(
          (e) => e.ordinationId === recorded.data.ordinationId,
        );
        expect(entry?.status).toBe("honorably_retired");
        expect(entry?.minuteReference).toBe("Presbytery minutes, 1 Jan 2026");
        // Never touched — this is the "status models everything short of
        // true removal" discipline DECISION-112 requires.
        expect(entry?.endedOn).toBeNull();
        expect(entry?.endedReason).toBeNull();
      });

      it("'removed' is a reachable status value (the End-ordination control's submission) and still never touches endedOn", async () => {
        const recorded = await recordOrdination(clerkPerson, presbyteryA, {
          personId: targetPerson,
          ministry: "deacon",
          ordainedOn: "2018-01-01",
        });
        if (recorded.kind !== "ok") throw new Error("expected ok");

        const changed = await changeOrdinationStatus(clerkPerson, presbyteryA, {
          ordinationId: recorded.data.ordinationId,
          status: "removed",
        });
        expect(changed.kind).toBe("ok");

        const list = await listOrdinations(clerkPerson, presbyteryA);
        if (list.kind !== "ok") throw new Error("expected ok");
        const entry = list.data.find(
          (e) => e.ordinationId === recorded.data.ordinationId,
        );
        expect(entry?.status).toBe("removed");
        expect(entry?.endedOn).toBeNull();
      });

      it("an unrecognized status throws", async () => {
        await expect(
          changeOrdinationStatus(clerkPerson, presbyteryA, {
            ordinationId: randomUUID(),
            // @ts-expect-error — deliberately invalid for this test
            status: "excommunicated",
          }),
        ).rejects.toThrow(/status/);
      });
    });

    // -----------------------------------------------------------------
    // recordAppointment — F21 + the parent-path adversarial check
    // -----------------------------------------------------------------

    describe("recordAppointment — parent-path validation (Phase 1's 'second org id' finding)", () => {
      it("a servingOrgId belonging to a DIFFERENT presbytery is invalid_target, not just a nonexistent-id case", async () => {
        const result = await recordAppointment(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          {
            personId: targetPerson,
            servingOrgId: congregationOutsideB,
            callType: "installed_pastor",
            startsOn: "2026-01-01",
          },
        );
        expect(result).toEqual({ kind: "invalid_target" });
      });

      it("a nonexistent servingOrgId is invalid_target", async () => {
        const result = await recordAppointment(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          {
            personId: targetPerson,
            servingOrgId: randomUUID(),
            callType: "installed_pastor",
            startsOn: "2026-01-01",
          },
        );
        expect(result).toEqual({ kind: "invalid_target" });
      });

      it("succeeds for a real member CONGREGATION of this presbytery", async () => {
        const result = await recordAppointment(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          {
            personId: targetPerson,
            servingOrgId: congregationA,
            callType: "stated_supply",
            startsOn: "2026-01-01",
          },
        );
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;

        await endAppointment(clerkPerson, presbyteryA, {
          appointmentId: result.data.appointmentId,
          endsOn: "2026-02-01",
          endReason: "test cleanup",
        });
      });

      it("succeeds for a real member NEW WORSHIPING COMMUNITY of this presbytery (both eligible types)", async () => {
        const result = await recordAppointment(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          {
            personId: targetPerson,
            servingOrgId: nwcA,
            callType: "temporary_supply",
            startsOn: "2026-01-01",
          },
        );
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;

        await endAppointment(clerkPerson, presbyteryA, {
          appointmentId: result.data.appointmentId,
          endsOn: "2026-02-01",
          endReason: "test cleanup",
        });
      });
    });

    describe("recordAppointment — F21 shape", () => {
      it("a person with no CURRENT membership at this org is invalid_target (lapsed member)", async () => {
        const result = await recordAppointment(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          {
            personId: lapsedPerson,
            servingOrgId: congregationA,
            callType: "installed_pastor",
            startsOn: "2026-01-01",
          },
        );
        expect(result).toEqual({ kind: "invalid_target" });
      });

      it("a person with a membership only at a DIFFERENT presbytery is invalid_target", async () => {
        const result = await recordAppointment(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          {
            personId: outsidePerson,
            servingOrgId: congregationA,
            callType: "installed_pastor",
            startsOn: "2026-01-01",
          },
        );
        expect(result).toEqual({ kind: "invalid_target" });
      });
    });

    describe("recordAppointment — open-appointment collision (app-level, no DB exclusion constraint)", () => {
      it("a second open appointment for the same person at the same servingOrgId is invalid_input, names the person and congregation, and inserts nothing", async () => {
        const first = await recordAppointment(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          {
            personId: collisionPerson,
            servingOrgId: congregationA,
            callType: "installed_pastor",
            startsOn: "2026-03-01",
          },
        );
        expect(first.kind).toBe("ok");
        if (first.kind !== "ok") return;

        const second = await recordAppointment(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          {
            personId: collisionPerson,
            servingOrgId: congregationA,
            callType: "interim_pastor",
            startsOn: "2026-04-01",
          },
        );
        expect(second.kind).toBe("invalid_input");
        if (second.kind !== "invalid_input") return;
        expect(second.message).toMatch(/already has an open appointment/i);
        expect(second.message).toMatch(/Ottoline|Vasquez-Iyer/);

        const list = await listAppointments(clerkPerson, presbyteryA);
        if (list.kind !== "ok") throw new Error("expected ok");
        const matching = list.data.filter(
          (entry) => entry.personId === collisionPerson,
        );
        expect(matching.length).toBe(1);
        expect(matching[0]!.appointmentId).toBe(first.data.appointmentId);

        // Clean up.
        await endAppointment(clerkPerson, presbyteryA, {
          appointmentId: first.data.appointmentId,
          endsOn: "2026-05-01",
          endReason: "test cleanup",
        });
      });

      it("a NEW open appointment for the same person/servingOrgId succeeds once the prior one is ended", async () => {
        const first = await recordAppointment(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          {
            personId: collisionPerson,
            servingOrgId: nwcA,
            callType: "designated_pastor",
            startsOn: "2026-06-01",
          },
        );
        if (first.kind !== "ok") throw new Error("expected ok");

        await endAppointment(clerkPerson, presbyteryA, {
          appointmentId: first.data.appointmentId,
          endsOn: "2026-07-01",
          endReason: "resigned",
        });

        const second = await recordAppointment(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          {
            personId: collisionPerson,
            servingOrgId: nwcA,
            callType: "designated_pastor",
            startsOn: "2026-08-01",
          },
        );
        expect(second.kind).toBe("ok");
        if (second.kind !== "ok") return;

        await endAppointment(clerkPerson, presbyteryA, {
          appointmentId: second.data.appointmentId,
          endsOn: "2026-09-01",
          endReason: "test cleanup",
        });
      });
    });

    // -----------------------------------------------------------------
    // endAppointment — validation and no-delete discipline
    // -----------------------------------------------------------------

    describe("endAppointment", () => {
      it("invalid_target for an appointment id that doesn't exist", async () => {
        const result = await endAppointment(clerkPerson, presbyteryA, {
          appointmentId: randomUUID(),
          endsOn: "2026-01-01",
          endReason: "resigned",
        });
        expect(result).toEqual({ kind: "invalid_target" });
      });

      it("invalid_input when endsOn is before startsOn", async () => {
        const started = await recordAppointment(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          {
            personId: targetPerson,
            servingOrgId: congregationA,
            callType: "parish_associate",
            startsOn: "2026-05-01",
          },
        );
        if (started.kind !== "ok") throw new Error("expected ok");

        const result = await endAppointment(clerkPerson, presbyteryA, {
          appointmentId: started.data.appointmentId,
          endsOn: "2026-04-01",
          endReason: "resigned",
        });
        expect(result).toEqual({
          kind: "invalid_input",
          message: "The end date can't be before the start date.",
        });

        await endAppointment(clerkPerson, presbyteryA, {
          appointmentId: started.data.appointmentId,
          endsOn: "2026-06-01",
          endReason: "resigned",
        });
      });

      it("ends via endsOn/endReason on the SAME row — never deletes", async () => {
        const started = await recordAppointment(
          clerkPerson,
          presbyteryA,
          grantingUserId,
          {
            personId: targetPerson,
            servingOrgId: congregationA,
            callType: "stated_supply",
            startsOn: "2026-07-01",
          },
        );
        if (started.kind !== "ok") throw new Error("expected ok");

        const ended = await endAppointment(clerkPerson, presbyteryA, {
          appointmentId: started.data.appointmentId,
          endsOn: "2026-08-01",
          endReason: "accepted a call elsewhere",
        });
        expect(ended).toEqual({
          kind: "ok",
          data: { appointmentId: started.data.appointmentId },
        });

        const platform = getPlatformDb();
        const [row] = await platform
          .select({ id: appointments.id, endsOn: appointments.endsOn })
          .from(appointments)
          .where(eq(appointments.id, started.data.appointmentId))
          .limit(1);
        expect(row).toBeDefined();
        expect(row?.endsOn).toBe("2026-08-01");
      });

      it("a malformed endsOn throws synchronously", async () => {
        await expect(
          endAppointment(clerkPerson, presbyteryA, {
            appointmentId: randomUUID(),
            endsOn: "not-a-date",
            endReason: "resigned",
          }),
        ).rejects.toThrow(/endsOn/);
      });
    });

    // -----------------------------------------------------------------
    // getCredentialsFormOptions — F21 shape + servingOrgs scoping
    // -----------------------------------------------------------------

    describe("getCredentialsFormOptions", () => {
      it("excludes a lapsed membership from the people list", async () => {
        const result = await getCredentialsFormOptions(clerkPerson, presbyteryA);
        if (result.kind !== "ok") throw new Error("expected ok");
        expect(
          result.data.people.some((p) => p.personId === lapsedPerson),
        ).toBe(false);
      });

      it("offers the presbytery's own member congregation AND new_worshiping_community, each with platformStatus", async () => {
        const result = await getCredentialsFormOptions(clerkPerson, presbyteryA);
        if (result.kind !== "ok") throw new Error("expected ok");
        const congEntry = result.data.servingOrgs.find(
          (o) => o.organizationId === congregationA,
        );
        const nwcEntry = result.data.servingOrgs.find(
          (o) => o.organizationId === nwcA,
        );
        expect(congEntry?.platformStatus).toBe("unmanaged");
        expect(nwcEntry?.platformStatus).toBe("unmanaged");
      });

      it("never includes a congregation belonging to a DIFFERENT presbytery", async () => {
        const result = await getCredentialsFormOptions(clerkPerson, presbyteryA);
        if (result.kind !== "ok") throw new Error("expected ok");
        expect(
          result.data.servingOrgs.some(
            (o) => o.organizationId === congregationOutsideB,
          ),
        ).toBe(false);
      });
    });

    // -----------------------------------------------------------------
    // Genuine failure propagation (not swallowed into a result variant)
    // -----------------------------------------------------------------

    describe("genuine failures propagate as thrown exceptions", () => {
      it("recordAppointment: a malformed startsOn throws synchronously", async () => {
        await expect(
          recordAppointment(clerkPerson, presbyteryA, grantingUserId, {
            personId: targetPerson,
            servingOrgId: congregationA,
            callType: "installed_pastor",
            startsOn: "not-a-date",
          }),
        ).rejects.toThrow(/startsOn/);
      });

      it("recordAppointment: an unrecognized callType throws", async () => {
        await expect(
          recordAppointment(clerkPerson, presbyteryA, grantingUserId, {
            personId: targetPerson,
            servingOrgId: congregationA,
            // @ts-expect-error — deliberately invalid for this test
            callType: "supply_pastor",
            startsOn: "2026-01-01",
          }),
        ).rejects.toThrow(/callType/);
      });

      it("listOrdinations: a person with no relationship at all throws OrgAccessError", async () => {
        await expect(
          listOrdinations(noMembershipPerson, presbyteryA),
        ).rejects.toMatchObject({ name: "OrgAccessError" });
      });

      it("listAppointments: a person with no relationship at all throws OrgAccessError", async () => {
        await expect(
          listAppointments(randomUUID(), presbyteryA),
        ).rejects.toMatchObject({ name: "OrgAccessError" });
      });
    });
  },
);
