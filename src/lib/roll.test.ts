/**
 * Integration tests for src/lib/roll.ts — run against a REAL Postgres
 * connection, not mocked. Same harness as `people.test.ts`/`role-grants.
 * test.ts`. `npm test` in CI does not set DATABASE_URL, so this whole suite
 * is SKIPPED there, not failed. Run for real with:
 *   dotenv -e .env.local -- vitest run src/lib/roll.test.ts
 *
 * `recordAudit()` is mocked at the module boundary, same posture and same
 * reason as `org-features.test.ts` — `@/lib/audit` transitively imports
 * `@/auth` (next-auth), which this test environment cannot resolve.
 *
 * SCHEMA DEFECT (FIXED): `roll_actions_freeze`'s `BEFORE DELETE` path used
 * to return `new`, which is always NULL on a DELETE — Postgres treats that
 * as "silently skip deleting this row," so DELETE was a no-op regardless of
 * `approval_status`, including for `pending` rows. Fixed in
 * `drizzle/0028_presby_people_write_rls_fix.sql` (see the "roll_actions
 * DELETE" describe block below for the regression pin: a pending row can
 * now be deleted; an approved one is still — correctly, by design —
 * rejected, not silently no-op'd). Teardown here STILL disables the
 * trigger, but for a different, legitimate reason now: this suite's own
 * `approveRollAction` tests leave some rows `approved`, and invariant 4
 * correctly refuses to DELETE those forever, by design — teardown needs to
 * clear the fixture regardless of approval_status, which an ordinary
 * `presby_app`-shaped DELETE cannot do for an approved row (nor should it).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, and, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    ROLL_ACTION_APPROVED: "tenant.roll_action.approved",
    ROLL_ACTION_DENIED: "tenant.roll_action.denied",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)("roll.ts (Postgres-backed, real dev database)", () => {
  let approveRollAction: typeof import("./roll").approveRollAction;
  let denyRollAction: typeof import("./roll").denyRollAction;
  let listPendingRollActions: typeof import("./roll").listPendingRollActions;
  let AUDIT_ACTIONS: typeof import("@/lib/audit").AUDIT_ACTIONS;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let organizations: typeof import("@/lib/db/domain/org").organizations;
  let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
  let groups: typeof import("@/lib/db/domain/groups").groups;
  let people: typeof import("@/lib/db/domain/people").people;
  let memberships: typeof import("@/lib/db/domain/people").memberships;
  let rollActions: typeof import("@/lib/db/domain/roll").rollActions;
  let permissions: typeof import("@/lib/db/domain/authz").permissions;
  let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
  let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
  let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
  let users: typeof import("@/lib/db/schema").users;

  const stamp = Date.now();

  let orgA: string;

  let approverPerson: string; // holds roll.approve
  let approverUserId: string; // users.id linked to approverPerson (for proposedByIsViewer)
  let outsiderPerson: string; // no grant at all
  let rollSubject: string; // the person the pending roll_actions are about

  let approveTargetId: string; // pending
  let denyTargetId: string; // pending
  let raceTargetId: string; // pending, used for the already_decided race test
  let ownProposalTargetId: string; // pending, proposed_by = approverUserId

  beforeAll(async () => {
    ({ approveRollAction, denyRollAction, listPendingRollActions } =
      await import("./roll"));
    ({ AUDIT_ACTIONS } = await import("@/lib/audit"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ organizations } = await import("@/lib/db/domain/org"));
    ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
    ({ people, memberships } = await import("@/lib/db/domain/people"));
    ({ rollActions } = await import("@/lib/db/domain/roll"));
    ({ permissions, appRoles, appRolePermissions, roleGrants } = await import(
      "@/lib/db/domain/authz"
    ));
    ({ users } = await import("@/lib/db/schema"));

    const platform = getPlatformDb();

    const [org] = await platform
      .insert(organizations)
      .values({
        organizationType: "congregation",
        name: "Fixture Congregation for roll.test.ts",
        slug: `roll-test-a-${stamp}`,
        path: `roll_test_a_${stamp}`,
        platformStatus: "unmanaged",
      })
      .returning({ id: organizations.id });
    orgA = org!.id;

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
    await platform.insert(groups).values({
      organizationId: orgA,
      groupTypeId,
      name: "Active Membership",
      membershipSource: "derived",
      derivedFrom: "active_membership",
      isProtected: true,
    });

    await platform
      .insert(permissions)
      .values({
        key: "roll.approve",
        module: "roll",
        description: "Approve or deny a proposed roll action",
        sensitivityTier: 1,
      })
      .onConflictDoNothing();

    const [approveRole] = await platform
      .insert(appRoles)
      .values({
        organizationId: orgA,
        key: "roll_approver",
        name: "Roll Approver",
        roleKind: "custom",
      })
      .returning({ id: appRoles.id });
    await platform
      .insert(appRolePermissions)
      .values({ roleId: approveRole!.id, permissionKey: "roll.approve" });

    async function person(first: string, last: string) {
      const [p] = await platform
        .insert(people)
        .values({ firstName: first, lastName: last })
        .returning({ id: people.id });
      return p!.id;
    }
    approverPerson = await person("Cassian", `Wrenfield${stamp}`);
    outsiderPerson = await person("Delphine", `Ashgrove${stamp}`);
    rollSubject = await person("Fenwick", `Larimore${stamp}`);

    await platform.insert(memberships).values([
      { organizationId: orgA, personId: approverPerson, engagementStatus: "regular" },
      { organizationId: orgA, personId: outsiderPerson, engagementStatus: "regular" },
      {
        organizationId: orgA,
        personId: rollSubject,
        engagementStatus: "regular",
        currentRoll: "other_participant",
        currentRollSince: "2020-01-01",
      },
    ]);

    await platform.insert(roleGrants).values({
      organizationId: orgA,
      roleId: approveRole!.id,
      personId: approverPerson,
      startsOn: "2020-01-01",
    });

    const [u1] = await platform
      .insert(users)
      .values({ email: `roll-test-approver-${stamp}@example.invalid`, name: "Fixture Approver" })
      .returning({ id: users.id });
    approverUserId = u1!.id;
    await platform.update(people).set({ userId: approverUserId }).where(eq(people.id, approverPerson));

    const [u2] = await platform
      .insert(users)
      .values({ email: `roll-test-proposer-${stamp}@example.invalid`, name: "Fixture Proposer" })
      .returning({ id: users.id });
    const proposerUserId = u2!.id;

    async function pendingAction(proposedBy: string) {
      const [row] = await platform
        .insert(rollActions)
        .values({
          organizationId: orgA,
          personId: rollSubject,
          kind: "other_participant_enrolled",
          effectiveDate: "2026-01-01",
          approvalStatus: "pending",
          proposedBy,
        })
        .returning({ id: rollActions.id });
      return row!.id;
    }
    approveTargetId = await pendingAction(proposerUserId);
    denyTargetId = await pendingAction(proposerUserId);
    raceTargetId = await pendingAction(proposerUserId);
    ownProposalTargetId = await pendingAction(approverUserId);
  });

  afterEach(() => {
    mockRecordAudit.mockClear();
  });

  afterAll(async () => {
    const platform = getPlatformDb();
    // See this file's own header — some rows in this fixture are `approved`,
    // and invariant 4 correctly refuses to let ANY connection delete those,
    // forever, by design. Teardown disables the trigger for that reason now
    // (not because DELETE is broken — it isn't, see the regression test
    // below).
    await platform.execute(sql`alter table roll_actions disable trigger roll_actions_freeze`);
    try {
      await platform.delete(rollActions).where(eq(rollActions.organizationId, orgA));
    } finally {
      await platform.execute(sql`alter table roll_actions enable trigger roll_actions_freeze`);
    }
    await platform.delete(organizations).where(eq(organizations.id, orgA));
    await platform.delete(people).where(eq(people.id, approverPerson));
    await platform.delete(people).where(eq(people.id, outsiderPerson));
    await platform.delete(people).where(eq(people.id, rollSubject));
    await platform.delete(users).where(eq(users.id, approverUserId));
    // proposerUserId was never tracked in a `let` — sweep by email instead.
    await platform
      .delete(users)
      .where(eq(users.email, `roll-test-proposer-${stamp}@example.invalid`));
  });

  // ---------------------------------------------------------------------
  // approveRollAction
  // ---------------------------------------------------------------------

  describe("approveRollAction", () => {
    it("forbidden without roll.approve", async () => {
      const result = await approveRollAction(
        outsiderPerson,
        orgA,
        approverUserId,
        approveTargetId,
        {},
      );
      expect(result).toEqual({ kind: "forbidden" });
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it("not_found for a nonexistent id", async () => {
      const result = await approveRollAction(
        approverPerson,
        orgA,
        approverUserId,
        "00000000-0000-0000-0000-000000000000",
        {},
      );
      expect(result).toEqual({ kind: "not_found" });
    });

    it("approves a pending action, projects memberships.current_roll, and audits", async () => {
      const result = await approveRollAction(
        approverPerson,
        orgA,
        approverUserId,
        approveTargetId,
        { minuteReference: "Session 2026-01-01, item 5" },
      );
      expect(result).toEqual({ kind: "ok" });
      expect(mockRecordAudit).toHaveBeenCalledTimes(1);
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.ROLL_ACTION_APPROVED,
          resourceId: approveTargetId,
        }),
      );

      const platform = getPlatformDb();
      const [row] = await platform
        .select()
        .from(rollActions)
        .where(eq(rollActions.id, approveTargetId));
      expect(row?.approvalStatus).toBe("approved");
      expect(row?.approvedBy).toBe(approverUserId);
      expect(row?.minuteReference).toBe("Session 2026-01-01, item 5");

      const [membershipRow] = await platform
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.personId, rollSubject),
            eq(memberships.organizationId, orgA),
          ),
        );
      // The sync trigger projects current_roll from the newly-approved
      // action's own resulting_roll/kind — this pins that the trigger
      // fired at all (untouched code, inherited behavior).
      expect(membershipRow?.currentRoll).toBeDefined();
    });

    it("already_decided on a second approval of the same row (the race pre-check)", async () => {
      const first = await approveRollAction(
        approverPerson,
        orgA,
        approverUserId,
        raceTargetId,
        {},
      );
      expect(first).toEqual({ kind: "ok" });
      mockRecordAudit.mockClear();

      const second = await approveRollAction(
        approverPerson,
        orgA,
        approverUserId,
        raceTargetId,
        {},
      );
      expect(second).toEqual({ kind: "already_decided" });
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    /**
     * REGRESSION PIN ON INVARIANT 4 ITSELF, not this module's own pre-check
     * — a DIRECT `UPDATE` against an already-approved row, run as
     * `presby_app` (the tenant connection this whole app writes through),
     * must still be rejected by `presby_freeze_approved_roll_action`. This
     * proves the trigger is the enforcement floor and `decideRollAction()`'s
     * pending-status pre-check is a nicety layered on top, not a substitute.
     */
    it("presby_freeze_approved_roll_action still rejects a direct UPDATE against an approved row (presby_app)", async () => {
      const { withOrgContext } = await import("@/lib/authz");

      // NOT `.rejects.toThrow(regex)` — see people.test.ts's own "BLOCKED"
      // test comment: Drizzle's `DrizzleQueryError.message` is "Failed
      // query: update ...", and the actual Postgres exception ("approved
      // actions are immutable...") is one level down, on `.cause`.
      let caught: unknown;
      try {
        await withOrgContext(approverPerson, orgA, async (tx) => {
          await tx.execute(sql`
            update roll_actions set denial_reason = 'attempted-edit'
             where id = ${raceTargetId}::uuid
          `);
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const chain =
        caught instanceof Error
          ? [caught.message, (caught.cause as Error | undefined)?.message]
              .filter(Boolean)
              .join(" :: ")
          : String(caught);
      expect(chain).toMatch(/immutable/i);
    });

    /**
     * REGRESSION PIN — Finding 2 (docs/work-log/2026-08-25-member-
     * management.md, "Two schema-layer findings, verified live"), fixed by
     * drizzle/0028_presby_people_write_rls_fix.sql.
     * `presby_freeze_approved_roll_action`'s BEFORE DELETE path used to
     * unconditionally `return new` — always NULL on a DELETE — so DELETE
     * silently no-op'd regardless of `approval_status`, INCLUDING a
     * `pending` row. Both halves proven through the SAME RLS-enforced
     * `presby_app` connection this app writes through (`withOrgContext()`,
     * not `getPlatformDb()`, which would prove nothing about the live
     * policy — table owner/BYPASSRLS connections are still subject to
     * ordinary triggers, but a test using only that connection wouldn't
     * exercise the path the application actually writes through):
     *   - a PENDING row's DELETE now genuinely succeeds (roll.ts itself
     *     never deletes anything — this is a schema-floor guarantee, not
     *     a path this module exercises today).
     *   - an APPROVED row's DELETE is still rejected, not silently
     *     no-op'd — the exact defect this migration fixed.
     */
    it("Finding 2: a pending row's DELETE now succeeds; an approved row's DELETE is still rejected, not silently no-op'd (presby_app)", async () => {
      const { withOrgContext } = await import("@/lib/authz");
      const platform = getPlatformDb();

      const [pendingRow] = await platform
        .insert(rollActions)
        .values({
          organizationId: orgA,
          personId: rollSubject,
          kind: "other_participant_enrolled",
          effectiveDate: "2026-01-01",
          approvalStatus: "pending",
          proposedBy: approverUserId,
        })
        .returning({ id: rollActions.id });

      await withOrgContext(approverPerson, orgA, async (tx) => {
        await tx.execute(sql`delete from roll_actions where id = ${pendingRow!.id}::uuid`);
      });
      const [stillPending] = await platform
        .select({ id: rollActions.id })
        .from(rollActions)
        .where(eq(rollActions.id, pendingRow!.id));
      expect(stillPending).toBeUndefined();

      // A SEPARATE, self-created approved row — not a shared fixture id —
      // so this assertion never depends on another test's execution order.
      const [approvedRow] = await platform
        .insert(rollActions)
        .values({
          organizationId: orgA,
          personId: rollSubject,
          kind: "other_participant_enrolled",
          effectiveDate: "2026-01-01",
          approvalStatus: "approved",
          proposedBy: approverUserId,
          approvedBy: approverUserId,
          approvedOn: "2026-01-02",
        })
        .returning({ id: rollActions.id });

      let caught: unknown;
      try {
        await withOrgContext(approverPerson, orgA, async (tx) => {
          await tx.execute(sql`delete from roll_actions where id = ${approvedRow!.id}::uuid`);
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const chain =
        caught instanceof Error
          ? [caught.message, (caught.cause as Error | undefined)?.message]
              .filter(Boolean)
              .join(" :: ")
          : String(caught);
      expect(chain).toMatch(/immutable/i);

      const [stillApproved] = await platform
        .select({ id: rollActions.id, approvalStatus: rollActions.approvalStatus })
        .from(rollActions)
        .where(eq(rollActions.id, approvedRow!.id));
      expect(stillApproved?.approvalStatus).toBe("approved");
    });
  });

  // ---------------------------------------------------------------------
  // denyRollAction
  // ---------------------------------------------------------------------

  describe("denyRollAction", () => {
    it("forbidden without roll.approve", async () => {
      const result = await denyRollAction(outsiderPerson, orgA, denyTargetId, {
        reason: "Not enough information",
      });
      expect(result).toEqual({ kind: "forbidden" });
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it("denies a pending action and audits", async () => {
      const result = await denyRollAction(approverPerson, orgA, denyTargetId, {
        reason: "Duplicate entry",
      });
      expect(result).toEqual({ kind: "ok" });
      expect(mockRecordAudit).toHaveBeenCalledTimes(1);
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.ROLL_ACTION_DENIED,
          resourceId: denyTargetId,
        }),
      );

      const platform = getPlatformDb();
      const [row] = await platform
        .select()
        .from(rollActions)
        .where(eq(rollActions.id, denyTargetId));
      expect(row?.approvalStatus).toBe("denied");
      expect(row?.denialReason).toBe("Duplicate entry");
    });
  });

  // ---------------------------------------------------------------------
  // listPendingRollActions
  // ---------------------------------------------------------------------

  describe("listPendingRollActions", () => {
    it("forbidden without roll.approve", async () => {
      const result = await listPendingRollActions(outsiderPerson, orgA);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("lists pending actions and flags the viewer's own proposal", async () => {
      const result = await listPendingRollActions(approverPerson, orgA);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;

      const own = result.actions.find((a) => a.id === ownProposalTargetId);
      expect(own).toBeDefined();
      expect(own!.proposedByIsViewer).toBe(true);

      // approveTargetId/denyTargetId/raceTargetId were already decided by
      // the earlier describe blocks (this file runs its tests in
      // declaration order) — only ownProposalTargetId is still pending by
      // this point, and it must NOT be flagged as the viewer's own for any
      // OTHER row that happens to still be pending.
      const others = result.actions.filter((a) => a.id !== ownProposalTargetId);
      for (const entry of others) {
        expect(entry.proposedByIsViewer).toBe(false);
      }
    });
  });
});
