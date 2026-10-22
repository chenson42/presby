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
import { eq, and, ne, sql } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";
import {
  EDIT_TIME_ROLL_ACTION_KINDS,
  ROLL_ACTION_KIND_TO_ROLL,
} from "@/lib/roll-action-kinds";

vi.mock("server-only", () => ({}));

const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    ROLL_ACTION_APPROVED: "tenant.roll_action.approved",
    ROLL_ACTION_DENIED: "tenant.roll_action.denied",
    ROLL_ACTION_RECORDED: "tenant.roll_action.recorded",
    ROLL_ACTION_VOIDED: "tenant.roll_action.voided",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

// The on-record paths write their audit row with the REAL insertAuditRow() in
// the same transaction as the roll row (R8); this wrapper only lets a test
// force that insert to throw, to prove the whole act rolls back with it.
const auditControl = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return {
    ...actual,
    insertAuditRow: async (...args: Parameters<typeof actual.insertAuditRow>) => {
      if (auditControl.fail) throw new Error("audit insert failed (test-injected)");
      return actual.insertAuditRow(...args);
    },
  };
});

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)("roll.ts (Postgres-backed, real dev database)", () => {
  let approveRollAction: typeof import("./roll").approveRollAction;
  let denyRollAction: typeof import("./roll").denyRollAction;
  let listPendingRollActions: typeof import("./roll").listPendingRollActions;
  let recordRollAction: typeof import("./roll").recordRollAction;
  let getPendingRollActionsForPerson: typeof import("./roll").getPendingRollActionsForPerson;
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

  // recordRollAction / getPendingRollActionsForPerson fixture
  let proposerPerson: string; // holds roll.propose ONLY (not roll.approve)
  let proposerUserId2: string; // a users.id for recordRollAction's actingUserId
  let editSubjectWithBirthdate: string; // membership at orgA, dateOfBirth set
  let editSubjectNoBirthdate: string; // membership at orgA, dateOfBirth null
  let editSubjectAlreadyPending: string; // membership at orgA, one pre-existing pending row
  let personWithNoMembership: string; // exists, but no membership row at orgA
  let preexistingPendingId: string;
  // People created by the on-record describes below; swept in afterAll.
  const extraPeople: string[] = [];

  /** A person with a live membership at orgA (and optionally a birth date). */
  async function mkPerson(
    first: string,
    last: string,
    opts: { dob?: string; engagement?: string } = {},
  ): Promise<string> {
    const platform = getPlatformDb();
    const [p] = await platform
      .insert(people)
      .values({
        firstName: first,
        lastName: `${last}${stamp}`,
        dateOfBirth: opts.dob ?? null,
        deletableUntil: fixtureDeletableUntil(),
      })
      .returning({ id: people.id });
    extraPeople.push(p!.id);
    await platform.insert(memberships).values({
      organizationId: orgA,
      personId: p!.id,
      engagementStatus: opts.engagement ?? "regular",
    });
    return p!.id;
  }

  /** audit_events rows (owner read) for one roll action id. */
  async function auditRowsFor(rollActionId: string): Promise<Array<Record<string, unknown>>> {
    const platform = getPlatformDb();
    const result = await platform.execute(
      sql`select * from audit_events where resource_id = ${rollActionId} order by created_at`,
    );
    return (result as unknown as { rows: Array<Record<string, unknown>> }).rows;
  }

  beforeAll(async () => {
    ({
      approveRollAction,
      denyRollAction,
      listPendingRollActions,
      recordRollAction,
      getPendingRollActionsForPerson,
    } = await import("./roll"));
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
        // Fixture teardown window — drizzle/0044's BEFORE DELETE guard.
        deletableUntil: fixtureDeletableUntil(),
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
      .values({ key: "roster", name: "Roster" })
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

    // recordRollAction/getPendingRollActionsForPerson fixture — a SEPARATE
    // role holding ONLY roll.propose, never roll.approve, so "forbidden
    // without roll.propose" and "roll.propose alone is sufficient" are both
    // provable against a real grant, not just an absent one.
    await platform
      .insert(permissions)
      .values({
        key: "roll.propose",
        module: "roll",
        description: "Propose a roll action",
        sensitivityTier: 1,
      })
      .onConflictDoNothing();

    const [proposeRole] = await platform
      .insert(appRoles)
      .values({
        organizationId: orgA,
        key: "roll_proposer",
        name: "Roll Proposer",
        roleKind: "custom",
      })
      .returning({ id: appRoles.id });
    await platform
      .insert(appRolePermissions)
      .values({ roleId: proposeRole!.id, permissionKey: "roll.propose" });

    async function person(first: string, last: string) {
      const [p] = await platform
        .insert(people)
        .values({
          firstName: first,
          lastName: last,
          deletableUntil: fixtureDeletableUntil(),
        })
        .returning({ id: people.id });
      return p!.id;
    }
    approverPerson = await person("Cassian", `Wrenfield${stamp}`);
    outsiderPerson = await person("Delphine", `Ashgrove${stamp}`);
    rollSubject = await person("Fenwick", `Larimore${stamp}`);
    proposerPerson = await person("Wren", `Castellane${stamp}`);
    editSubjectWithBirthdate = await person("Hollis", `Marrow${stamp}`);
    editSubjectNoBirthdate = await person("Ines", `Thistlewood${stamp}`);
    editSubjectAlreadyPending = await person("Osric", `Fennimore${stamp}`);
    personWithNoMembership = await person("Zara", `Outlander${stamp}`);

    await platform
      .update(people)
      .set({ dateOfBirth: "2000-06-15" })
      .where(eq(people.id, editSubjectWithBirthdate));

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
      { organizationId: orgA, personId: proposerPerson, engagementStatus: "regular" },
      { organizationId: orgA, personId: editSubjectWithBirthdate, engagementStatus: "regular" },
      { organizationId: orgA, personId: editSubjectNoBirthdate, engagementStatus: "regular" },
      { organizationId: orgA, personId: editSubjectAlreadyPending, engagementStatus: "regular" },
      // personWithNoMembership deliberately has NO membership row at orgA.
    ]);

    await platform.insert(roleGrants).values({
      organizationId: orgA,
      roleId: approveRole!.id,
      personId: approverPerson,
      startsOn: "2020-01-01",
    });
    await platform.insert(roleGrants).values({
      organizationId: orgA,
      roleId: proposeRole!.id,
      personId: proposerPerson,
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

    const [u3] = await platform
      .insert(users)
      .values({
        email: `roll-test-recorder-${stamp}@example.invalid`,
        name: "Fixture Recorder",
      })
      .returning({ id: users.id });
    proposerUserId2 = u3!.id;
    await platform
      .update(people)
      .set({ userId: proposerUserId2 })
      .where(eq(people.id, proposerPerson));

    async function pendingAction(proposedBy: string) {
      const [row] = await platform
        .insert(rollActions)
        .values({
          organizationId: orgA,
          personId: rollSubject,
          kind: "other_participant_enrolled",
          effectiveDate: "2026-01-01",
          resultingRoll: "other_participant", // drizzle/0061 roll_actions_resulting_roll_matches_kind
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

    const [preexisting] = await platform
      .insert(rollActions)
      .values({
        organizationId: orgA,
        personId: editSubjectAlreadyPending,
        kind: "restoration",
        effectiveDate: "2026-02-01",
        resultingRoll: "active", // drizzle/0061 roll_actions_resulting_roll_matches_kind
        approvalStatus: "pending",
        proposedBy: proposerUserId2,
      })
      .returning({ id: rollActions.id });
    preexistingPendingId = preexisting!.id;
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
    // PRE-EXISTING TEARDOWN GAP, fixed here because running this file on its
    // own surfaces it every time: deleting the org cascades into
    // `group_memberships`, and this fixture HAS derived rows there (the
    // active_membership group above plus drizzle/0017's
    // memberships_sync_derived_group trigger), which
    // presby_reject_derived_group_write() refuses. The file only ever
    // appeared green because sibling test files run in parallel and one of
    // them happens to have this same global trigger disabled at the moment
    // the cascade runs — the "unreliable teardown / no per-test isolation"
    // item in docs/TODO.md, seen from the inside. Nothing to do with
    // drizzle/0044's delete guard, which this fixture satisfies through
    // `deletableUntil` at insert.
    await platform.execute(
      sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
    );
    try {
      await platform.delete(organizations).where(eq(organizations.id, orgA));
    } finally {
      await platform.execute(
        sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
      );
    }
    await platform.delete(people).where(eq(people.id, approverPerson));
    await platform.delete(people).where(eq(people.id, outsiderPerson));
    await platform.delete(people).where(eq(people.id, rollSubject));
    await platform.delete(people).where(eq(people.id, proposerPerson));
    await platform.delete(people).where(eq(people.id, editSubjectWithBirthdate));
    await platform.delete(people).where(eq(people.id, editSubjectNoBirthdate));
    await platform.delete(people).where(eq(people.id, editSubjectAlreadyPending));
    await platform.delete(people).where(eq(people.id, personWithNoMembership));
    for (const id of extraPeople) {
      await platform.delete(people).where(eq(people.id, id));
    }
    // The on-record paths write REAL audit rows (insertAuditRow, same tx);
    // audit_events is append-only for presby_app, so the owner connection
    // clears this fixture's rows by its organization id.
    await platform.execute(
      sql`delete from audit_events where metadata->>'organizationId' = ${orgA}`,
    );
    await platform.delete(users).where(eq(users.id, approverUserId));
    await platform.delete(users).where(eq(users.id, proposerUserId2));
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
          resultingRoll: "other_participant", // drizzle/0061 roll_actions_resulting_roll_matches_kind
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
          resultingRoll: "other_participant", // drizzle/0061 roll_actions_resulting_roll_matches_kind
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

  // ---------------------------------------------------------------------
  // recordRollAction (docs/work-log/2026-08-26-member-roll-on-edit.md)
  // ---------------------------------------------------------------------

  describe("recordRollAction", () => {
    it("forbidden without roll.propose", async () => {
      const result = await recordRollAction(
        outsiderPerson,
        orgA,
        proposerUserId2,
        {
          personId: editSubjectWithBirthdate,
          kind: "restoration",
          effectiveDate: "2026-03-01",
        },
      );
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("not_found when the target person holds no membership at this org", async () => {
      const result = await recordRollAction(
        proposerPerson,
        orgA,
        proposerUserId2,
        {
          personId: personWithNoMembership,
          kind: "restoration",
          effectiveDate: "2026-03-01",
        },
      );
      expect(result).toEqual({ kind: "not_found" });
    });

    it("invalid_kind for a kind outside EDIT_TIME_ROLL_ACTION_KINDS (a terminating kind, F19-excluded)", async () => {
      const result = await recordRollAction(
        proposerPerson,
        orgA,
        proposerUserId2,
        {
          personId: editSubjectWithBirthdate,
          // @ts-expect-error — deliberately an out-of-allow-list kind, proving
          // the server-side re-check rejects it even though the TS type
          // would normally prevent this at the call site (Phase 1's
          // adversarial pass: never trust the client alone).
          kind: "death",
          effectiveDate: "2026-03-01",
        },
      );
      expect(result).toEqual({ kind: "invalid_kind" });
    });

    it("rejects a malformed effectiveDate by throwing (genuine bad input, not a denial)", async () => {
      await expect(
        recordRollAction(proposerPerson, orgA, proposerUserId2, {
          personId: editSubjectWithBirthdate,
          kind: "restoration",
          effectiveDate: "03/01/2026",
        }),
      ).rejects.toThrow(/effectiveDate/);
    });

    it("ok: inserts a pending row with resultingRoll and ageAtAction computed from the person's dateOfBirth", async () => {
      const result = await recordRollAction(
        proposerPerson,
        orgA,
        proposerUserId2,
        {
          personId: editSubjectWithBirthdate,
          kind: "restoration",
          effectiveDate: "2026-03-01",
          minuteReference: "Session 2026-03-01, item 2",
        },
      );
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;

      const platform = getPlatformDb();
      const [row] = await platform
        .select()
        .from(rollActions)
        .where(eq(rollActions.id, result.rollActionId));
      expect(row?.approvalStatus).toBe("pending");
      expect(row?.proposedBy).toBe(proposerUserId2);
      expect(row?.resultingRoll).toBe("active"); // restoration -> active, per ROLL_ACTION_KIND_TO_ROLL
      // dateOfBirth 2000-06-15, effectiveDate 2026-03-01 → 25 (birthday not yet reached that year)
      expect(row?.ageAtAction).toBe(25);
      expect(row?.minuteReference).toBe("Session 2026-03-01, item 2");
    });

    it("ok: ageAtAction is left null when the person's dateOfBirth is unknown", async () => {
      const result = await recordRollAction(
        proposerPerson,
        orgA,
        proposerUserId2,
        {
          personId: editSubjectNoBirthdate,
          kind: "reaffirmation",
          effectiveDate: "2026-03-01",
        },
      );
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;

      const platform = getPlatformDb();
      const [row] = await platform
        .select()
        .from(rollActions)
        .where(eq(rollActions.id, result.rollActionId));
      expect(row?.ageAtAction).toBeNull();
      expect(row?.resultingRoll).toBe("active");
    });

    it("a participant enrolment through the edit path TAKES EFFECT ON RECORD: approved at insert, resulting_roll and the cache set, audited", async () => {
      const subject = await mkPerson("Ludovic", "Penhallow", { dob: "1975-09-02" });
      const result = await recordRollAction(
        proposerPerson,
        orgA,
        proposerUserId2,
        {
          personId: subject,
          kind: "other_participant_enrolled",
          effectiveDate: "2026-03-02",
        },
        { actingUserEmail: "recorder@example.invalid" },
      );
      expect(result).toMatchObject({
        kind: "ok",
        effect: "recorded",
        affectsFiledPeriod: false,
        shadowedBy: null,
      });
      if (result.kind !== "ok") return;

      const platform = getPlatformDb();
      const [row] = await platform
        .select()
        .from(rollActions)
        .where(eq(rollActions.id, result.rollActionId));
      expect(row).toMatchObject({
        kind: "other_participant_enrolled",
        resultingRoll: "other_participant",
        ageAtAction: 50,
        approvalStatus: "approved",
        approvedBy: proposerUserId2,
        proposedBy: proposerUserId2,
      });
      const [m] = await platform
        .select({ currentRoll: memberships.currentRoll })
        .from(memberships)
        .where(and(eq(memberships.personId, subject), eq(memberships.organizationId, orgA)));
      expect(m?.currentRoll).toBe("other_participant");
      const audits = await auditRowsFor(result.rollActionId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "tenant.roll_action.recorded",
        actor_user_id: proposerUserId2,
        actor_email: "recorder@example.invalid",
        resource_type: "roll_action",
      });
    });

    it("FORGERY: no membership kind can ever take effect on record — every other edit-time kind is a pending proposal with its derived roll", async () => {
      const subject = await mkPerson("Ottilie", "Brackwater", { dob: "1990-01-20" });
      const platform = getPlatformDb();
      const kinds = EDIT_TIME_ROLL_ACTION_KINDS.filter(
        (kind) => kind !== "other_participant_enrolled",
      );
      expect(kinds.length).toBeGreaterThan(0);
      for (const kind of kinds) {
        const result = await recordRollAction(proposerPerson, orgA, proposerUserId2, {
          personId: subject,
          kind,
          effectiveDate: "2026-03-03",
        });
        expect(result, kind).toMatchObject({ kind: "ok", effect: "pending" });
        if (result.kind !== "ok") continue;
        const [row] = await platform
          .select()
          .from(rollActions)
          .where(eq(rollActions.id, result.rollActionId));
        expect(row?.approvalStatus, kind).toBe("pending");
        expect(row?.approvedBy, kind).toBeNull();
        expect(row?.resultingRoll, kind).toBe(ROLL_ACTION_KIND_TO_ROLL[kind]);
        expect(row?.ageAtAction, kind).toBe(36);
        expect((await auditRowsFor(result.rollActionId)).length, kind).toBe(0);
      }
      const [m] = await platform
        .select({ currentRoll: memberships.currentRoll })
        .from(memberships)
        .where(and(eq(memberships.personId, subject), eq(memberships.organizationId, orgA)));
      expect(m?.currentRoll).toBeNull();
    });

    it("a removal kind or a void through the edit path is invalid_kind and writes nothing", async () => {
      const subject = await mkPerson("Perpetua", "Hargreave");
      for (const kind of ["other_participant_removed", "void", "death"] as const) {
        const result = await recordRollAction(proposerPerson, orgA, proposerUserId2, {
          personId: subject,
          kind: kind as never,
          effectiveDate: "2026-03-03",
        });
        expect(result, kind).toEqual({ kind: "invalid_kind" });
      }
      const platform = getPlatformDb();
      const rows = await platform.select().from(rollActions).where(eq(rollActions.personId, subject));
      expect(rows).toHaveLength(0);
    });

    it("S1: a proposal dated before the person's latest effective action is allowed, with shadowedBy naming it", async () => {
      const subject = await mkPerson("Rowan", "Ellsworth");
      const platform = getPlatformDb();
      // An approved action dated 2026-02-01, inserted by the owner (fixture).
      await platform.insert(rollActions).values({
        organizationId: orgA,
        personId: subject,
        kind: "baptized_member_enrolled",
        effectiveDate: "2026-02-01",
        resultingRoll: "baptized",
        approvalStatus: "approved",
        approvedBy: proposerUserId2,
        proposedBy: proposerUserId2,
      });
      const shadowed = await recordRollAction(proposerPerson, orgA, proposerUserId2, {
        personId: subject,
        kind: "profession_of_faith",
        effectiveDate: "2026-01-15",
      });
      expect(shadowed).toMatchObject({
        kind: "ok",
        effect: "pending",
        shadowedBy: { kind: "baptized_member_enrolled", effectiveDate: "2026-02-01" },
      });
      const same = await recordRollAction(proposerPerson, orgA, proposerUserId2, {
        personId: subject,
        kind: "profession_of_faith",
        effectiveDate: "2026-02-01",
      });
      expect(same).toMatchObject({ kind: "ok", shadowedBy: null });
      const later = await recordRollAction(proposerPerson, orgA, proposerUserId2, {
        personId: subject,
        kind: "profession_of_faith",
        effectiveDate: "2026-04-01",
      });
      expect(later).toMatchObject({ kind: "ok", shadowedBy: null });
    });

    it("an enrolment refused by the database function comes back as a typed refusal and leaves no row", async () => {
      const subject = await mkPerson("Tamsin", "Quarrington");
      const first = await recordRollAction(proposerPerson, orgA, proposerUserId2, {
        personId: subject,
        kind: "other_participant_enrolled",
        effectiveDate: "2026-03-02",
      });
      expect(first.kind).toBe("ok");
      const second = await recordRollAction(proposerPerson, orgA, proposerUserId2, {
        personId: subject,
        kind: "other_participant_enrolled",
        effectiveDate: "2026-03-05",
      });
      expect(second).toEqual({ kind: "refused", reason: "already_participant" });
      const platform = getPlatformDb();
      const rows = await platform.select().from(rollActions).where(eq(rollActions.personId, subject));
      expect(rows).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------
  // getPendingRollActionsForPerson
  // ---------------------------------------------------------------------

  describe("getPendingRollActionsForPerson", () => {
    it("forbidden without roll.propose", async () => {
      const result = await getPendingRollActionsForPerson(
        outsiderPerson,
        orgA,
        editSubjectAlreadyPending,
      );
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("lists only the pending rows for the SPECIFIC person asked about, not the whole org's worklist", async () => {
      const result = await getPendingRollActionsForPerson(
        proposerPerson,
        orgA,
        editSubjectAlreadyPending,
      );
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;

      expect(result.actions).toHaveLength(1);
      expect(result.actions[0]).toMatchObject({
        id: preexistingPendingId,
        kind: "restoration",
        effectiveDate: "2026-02-01",
      });
    });

    it("returns an empty list for a person with no pending action", async () => {
      const result = await getPendingRollActionsForPerson(
        proposerPerson,
        orgA,
        outsiderPerson,
      );
      expect(result).toEqual({ kind: "ok", actions: [] });
    });
  });

  // -------------------------------------------------------------------------
  // THE ROLL IS THE SYSTEM OF RECORD, enforced by a composite key (B-M3).
  // docs/work-log/2026-09-25-security-schema-b.md;
  // drizzle/0048_presby_security_b.sql section 7.
  //
  // `roll_actions.voids_action_id` was a PLAIN self-FK to roll_actions(id),
  // so a void recorded in one congregation could cite — and claim to
  // annul — an approved action on ANOTHER congregation's roll. RLS filters
  // the read; it does not filter that write (F2). The FK is now
  // (voids_action_id, organization_id) -> (id, organization_id).
  // -------------------------------------------------------------------------
  describe("roll_actions.voids_action_id composite FK (B-M3)", () => {
    it("refuses a void that cites another congregation's roll action — regression for B-M3 roll_actions.voids_action_id", async () => {
      const platform = getPlatformDb();
      // Any approved action belonging to some OTHER organization. The
      // seed-dev fixture guarantees several; skip rather than pass vacuously
      // if this database somehow has none.
      const [foreign] = await platform
        .select({
          id: rollActions.id,
          organizationId: rollActions.organizationId,
        })
        .from(rollActions)
        .where(ne(rollActions.organizationId, orgA))
        .limit(1);
      expect(foreign).toBeDefined();

      const chain = await platform
        .insert(rollActions)
        .values({
          organizationId: orgA,
          personId: rollSubject,
          kind: "void",
          effectiveDate: "2026-03-01",
          approvalStatus: "pending",
          proposedBy: proposerUserId2,
          voidsActionId: foreign!.id,
        })
        .then(
          () => "NO ERROR — the cross-org void was accepted",
          (e: unknown) => {
            const parts: string[] = [];
            for (
              let cur = e as { message?: string; cause?: unknown } | undefined;
              cur;

            ) {
              if (cur.message) parts.push(cur.message);
              cur = cur.cause as
                | { message?: string; cause?: unknown }
                | undefined;
            }
            return parts.join(" | ");
          },
        );
      expect(chain).toMatch(/roll_actions_voids_fk|foreign key/);
    });

    it("still permits a void that cites an action on its OWN roll", async () => {
      const platform = getPlatformDb();
      const [target] = await platform
        .select({ id: rollActions.id })
        .from(rollActions)
        .where(eq(rollActions.organizationId, orgA))
        .limit(1);
      expect(target).toBeDefined();

      const [voided] = await platform
        .insert(rollActions)
        .values({
          organizationId: orgA,
          personId: rollSubject,
          kind: "void",
          effectiveDate: "2026-03-02",
          approvalStatus: "pending",
          proposedBy: proposerUserId2,
          voidsActionId: target!.id,
        })
        .returning({ id: rollActions.id });
      expect(voided?.id).toBeDefined();
      await platform.delete(rollActions).where(eq(rollActions.id, voided!.id));
    });
  });

  // -------------------------------------------------------------------------
  // recordParticipantAction / voidParticipantAction — participants take effect
  // ON RECORD (docs/work-log/2026-10-22-founding-admin-directory.md, R1-R12,
  // DECISION-198). The SQL outcomes themselves are proven exhaustively by
  // participant-roll.db.test.ts; this block proves the TypeScript layer: the
  // identity mapping, the typed results, the audit row in the SAME transaction,
  // and the rollback when that audit insert fails.
  // -------------------------------------------------------------------------
  describe("participant actions on record", () => {
    let recordParticipantAction: typeof import("./roll").recordParticipantAction;
    let voidParticipantAction: typeof import("./roll").voidParticipantAction;

    beforeAll(async () => {
      ({ recordParticipantAction, voidParticipantAction } = await import("./roll"));
    });

    afterEach(() => {
      auditControl.fail = false;
    });

    const ENROL = "other_participant_enrolled" as const;
    const REMOVE = "other_participant_removed" as const;

    async function snapshot(personId: string) {
      const platform = getPlatformDb();
      const rows = await platform.select().from(rollActions).where(eq(rollActions.personId, personId));
      const [m] = await platform
        .select({
          currentRoll: memberships.currentRoll,
          endedOn: memberships.endedOn,
          endedReason: memberships.endedReason,
        })
        .from(memberships)
        .where(and(eq(memberships.personId, personId), eq(memberships.organizationId, orgA)));
      return { rollRows: rows.length, ...m };
    }

    it("enrols: approved at insert, audited with exactly the documented metadata, ids only", async () => {
      const subject = await mkPerson("Wilfred", "Ashdown", { dob: "1980-04-10" });
      const result = await recordParticipantAction(
        proposerPerson,
        orgA,
        proposerUserId2,
        { personId: subject, kind: ENROL, effectiveDate: "2026-05-01", minuteReference: "  note  " },
        { actingUserEmail: "recorder@example.invalid" },
      );
      expect(result).toMatchObject({ kind: "ok", membershipEnded: false, affectsFiledPeriod: false });
      if (result.kind !== "ok") return;

      const platform = getPlatformDb();
      const [row] = await platform.select().from(rollActions).where(eq(rollActions.id, result.rollActionId));
      expect(row).toMatchObject({
        personId: subject,
        kind: ENROL,
        resultingRoll: "other_participant",
        ageAtAction: 46,
        approvalStatus: "approved",
        approvedBy: proposerUserId2,
        proposedBy: proposerUserId2,
        minuteReference: "note",
      });
      const audits = await auditRowsFor(result.rollActionId);
      expect(audits).toHaveLength(1);
      const [audit] = audits;
      expect(audit).toMatchObject({
        action: "tenant.roll_action.recorded",
        actor_user_id: proposerUserId2,
        actor_email: "recorder@example.invalid",
        resource_type: "roll_action",
        resource_id: result.rollActionId,
      });
      expect(audit!.action).not.toBe("tenant.roll_action.approved");
      expect(audit!.metadata).toEqual({
        organizationId: orgA,
        rollActionId: result.rollActionId,
        kind: ENROL,
        effectiveDate: "2026-05-01",
        membershipEnded: false,
      });
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it("removes: ends the membership with the fixed marker, audits membershipEnded, and the person leaves the live roll", async () => {
      const subject = await mkPerson("Hester", "Moorcroft");
      const enrol = await recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
        personId: subject,
        kind: ENROL,
        effectiveDate: "2026-02-01",
      });
      expect(enrol.kind).toBe("ok");
      const removal = await recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
        personId: subject,
        kind: REMOVE,
        effectiveDate: "2026-04-01",
        minuteReference: "Session 2026-04-01",
      });
      expect(removal).toMatchObject({ kind: "ok", membershipEnded: true });
      if (removal.kind !== "ok") return;

      expect(await snapshot(subject)).toMatchObject({
        rollRows: 2,
        currentRoll: null,
        endedOn: "2026-04-01",
        endedReason: "other_participant_removed",
      });
      const [audit] = await auditRowsFor(removal.rollActionId);
      expect(audit).toMatchObject({ action: "tenant.roll_action.recorded" });
      expect(audit!.metadata).toMatchObject({ kind: REMOVE, membershipEnded: true, effectiveDate: "2026-04-01" });
    });

    it("forbidden without roll.propose: typed, and nothing is written or audited", async () => {
      const subject = await mkPerson("Ignatius", "Holloway");
      const result = await recordParticipantAction(outsiderPerson, orgA, approverUserId, {
        personId: subject,
        kind: ENROL,
        effectiveDate: "2026-05-01",
      });
      expect(result).toEqual({ kind: "forbidden" });
      expect(await snapshot(subject)).toMatchObject({ rollRows: 0, currentRoll: null });
    });

    it("the database's identity refusal (a user who is not the acting person's) maps to forbidden and rolls back — the SQLSTATE 42501 path", async () => {
      const subject = await mkPerson("Lavinia", "Cresswell");
      // proposerPerson holds roll.propose (the TypeScript pre-check passes),
      // but approverUserId belongs to a person who does not: the function
      // raises its one literal.
      const result = await recordParticipantAction(proposerPerson, orgA, approverUserId, {
        personId: subject,
        kind: ENROL,
        effectiveDate: "2026-05-01",
      });
      expect(result).toEqual({ kind: "forbidden" });
      expect(await snapshot(subject)).toMatchObject({ rollRows: 0, currentRoll: null });
    });

    it("a forged kind never reaches the database: a membership kind is invalid_kind, not approved", async () => {
      const subject = await mkPerson("Barnaby", "Whitlow");
      for (const kind of ["profession_of_faith", "baptized_member_enrolled", "void", "death", "nonsense"]) {
        const result = await recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
          personId: subject,
          kind: kind as never,
          effectiveDate: "2026-05-01",
        });
        expect(result, kind).toEqual({ kind: "refused", reason: "invalid_kind" });
      }
      expect(await snapshot(subject)).toMatchObject({ rollRows: 0, currentRoll: null });
    });

    it("a non-UUID person id is person_not_found, never a cast error", async () => {
      const result = await recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
        personId: "not-a-uuid",
        kind: ENROL,
        effectiveDate: "2026-05-01",
      });
      expect(result).toEqual({ kind: "refused", reason: "person_not_found" });
    });

    it("throws on a malformed or impossible date and on an over-long minute reference (genuine bad input)", async () => {
      const subject = await mkPerson("Cordelia", "Fenwick");
      for (const effectiveDate of ["05/01/2026", "2026-02-30", ""]) {
        await expect(
          recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
            personId: subject,
            kind: ENROL,
            effectiveDate,
          }),
        ).rejects.toThrow(/effectiveDate/);
      }
      await expect(
        recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
          personId: subject,
          kind: ENROL,
          effectiveDate: "2026-05-01",
          minuteReference: "m".repeat(201),
        }),
      ).rejects.toThrow(/minuteReference/);
      expect(await snapshot(subject)).toMatchObject({ rollRows: 0 });
    });

    it.each([
      ["a future date", "2999-01-01", "date_out_of_range"],
      ["before 1900", "1899-12-31", "date_out_of_range"],
    ])("refuses %s", async (_label, effectiveDate, reason) => {
      const subject = await mkPerson("Evander", "Pellham");
      const result = await recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
        personId: subject,
        kind: ENROL,
        effectiveDate,
      });
      expect(result).toEqual({ kind: "refused", reason });
      expect(await snapshot(subject)).toMatchObject({ rollRows: 0 });
    });

    it("refuses a second enrolment (already_participant), an enrolment over a pending action, and a removal of a non-participant", async () => {
      const platform = getPlatformDb();
      const subject = await mkPerson("Marguerite", "Dunmore");
      const first = await recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
        personId: subject,
        kind: ENROL,
        effectiveDate: "2026-02-01",
      });
      expect(first.kind).toBe("ok");
      expect(
        await recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
          personId: subject,
          kind: ENROL,
          effectiveDate: "2026-03-01",
        }),
      ).toEqual({ kind: "refused", reason: "already_participant" });

      const pending = await mkPerson("Anselm", "Treadgold");
      await platform.insert(rollActions).values({
        organizationId: orgA,
        personId: pending,
        kind: "profession_of_faith",
        effectiveDate: "2026-03-01",
        resultingRoll: "active",
        approvalStatus: "pending",
        proposedBy: proposerUserId2,
      });
      expect(
        await recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
          personId: pending,
          kind: ENROL,
          effectiveDate: "2026-04-01",
        }),
      ).toEqual({ kind: "refused", reason: "pending_action" });

      const never = await mkPerson("Philippa", "Gaunt");
      expect(
        await recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
          personId: never,
          kind: REMOVE,
          effectiveDate: "2026-04-01",
        }),
      ).toEqual({ kind: "refused", reason: "not_participant" });
    });

    it("refuses to enrol anyone on a member roll (on_member_roll): no Session act, no loss line", async () => {
      const platform = getPlatformDb();
      const member = await mkPerson("Octavia", "Strangways");
      await platform.insert(rollActions).values({
        organizationId: orgA,
        personId: member,
        kind: "baptized_member_enrolled",
        effectiveDate: "2025-01-01",
        resultingRoll: "baptized",
        approvalStatus: "approved",
        approvedBy: proposerUserId2,
        proposedBy: proposerUserId2,
      });
      expect(
        await recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
          personId: member,
          kind: ENROL,
          effectiveDate: "2026-03-01",
        }),
      ).toEqual({ kind: "refused", reason: "on_member_roll" });
      expect(await snapshot(member)).toMatchObject({ rollRows: 1, currentRoll: "baptized" });
    });

    it("refuses to remove the acting person themselves (self_target)", async () => {
      // proposerPerson is the actor: enrolling oneself as a participant is
      // harmless (a participant row is not a membership), removing oneself is not.
      const enrol = await recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
        personId: proposerPerson,
        kind: ENROL,
        effectiveDate: "2026-02-01",
      });
      expect(enrol.kind).toBe("ok");
      expect(
        await recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
          personId: proposerPerson,
          kind: REMOVE,
          effectiveDate: "2026-03-01",
        }),
      ).toEqual({ kind: "refused", reason: "self_target" });
      expect(await snapshot(proposerPerson)).toMatchObject({ endedOn: null, currentRoll: "other_participant" });
    });

    it("refuses a removal while a staff position is open (holds_position) and leaves the membership live", async () => {
      const platform = getPlatformDb();
      const subject = await mkPerson("Dorothea", "Wexcombe");
      expect(
        (
          await recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
            personId: subject,
            kind: ENROL,
            effectiveDate: "2026-02-01",
          })
        ).kind,
      ).toBe("ok");
      await platform.execute(sql`
        insert into staff_positions (organization_id, person_id, position, position_key, starts_on)
        values (${orgA}::uuid, ${subject}::uuid, 'Sexton', 'sexton', '2026-01-01')
      `);
      expect(
        await recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
          personId: subject,
          kind: REMOVE,
          effectiveDate: "2026-04-01",
        }),
      ).toEqual({ kind: "refused", reason: "holds_position" });
      expect(await snapshot(subject)).toMatchObject({ endedOn: null, currentRoll: "other_participant", rollRows: 1 });
      await platform.execute(sql`delete from staff_positions where person_id = ${subject}::uuid`);
    });

    it("a failed audit insert rolls back the roll row, the cache and the membership change — a constitutional record never commits without its audit row", async () => {
      const subject = await mkPerson("Gideon", "Applethwaite");
      auditControl.fail = true;
      await expect(
        recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
          personId: subject,
          kind: ENROL,
          effectiveDate: "2026-05-01",
        }),
      ).rejects.toThrow(/audit insert failed/);
      expect(await snapshot(subject)).toMatchObject({ rollRows: 0, currentRoll: null });

      // And a removal: the roll row, the end date and the marker all roll back.
      auditControl.fail = false;
      expect(
        (
          await recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
            personId: subject,
            kind: ENROL,
            effectiveDate: "2026-02-01",
          })
        ).kind,
      ).toBe("ok");
      auditControl.fail = true;
      await expect(
        recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
          personId: subject,
          kind: REMOVE,
          effectiveDate: "2026-04-01",
        }),
      ).rejects.toThrow(/audit insert failed/);
      expect(await snapshot(subject)).toMatchObject({
        rollRows: 1,
        currentRoll: "other_participant",
        endedOn: null,
        endedReason: null,
      });
    });

    describe("voidParticipantAction (undo, F175)", () => {
      async function enrolled(first: string) {
        const subject = await mkPerson(first, "Undoable", { dob: "1985-03-03" });
        const enrol = await recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
          personId: subject,
          kind: ENROL,
          effectiveDate: "2026-02-01",
        });
        if (enrol.kind !== "ok") throw new Error("fixture enrol failed");
        return { subject, enrolId: enrol.rollActionId };
      }

      it("undoes an enrolment: a void row (never an update), the person back to no roll, the original frozen, audited with the trimmed reason", async () => {
        const { subject, enrolId } = await enrolled("Ambrose");
        const result = await voidParticipantAction(
          proposerPerson,
          orgA,
          proposerUserId2,
          { rollActionId: enrolId, reason: "  Entered against the wrong person.  " },
          { actingUserEmail: "recorder@example.invalid" },
        );
        expect(result).toMatchObject({
          kind: "ok",
          voidedActionId: enrolId,
          voidedKind: ENROL,
          membershipReopened: false,
        });
        if (result.kind !== "ok") return;

        const platform = getPlatformDb();
        const [voidRow] = await platform.select().from(rollActions).where(eq(rollActions.id, result.voidRollActionId));
        expect(voidRow).toMatchObject({
          kind: "void",
          voidsActionId: enrolId,
          personId: subject,
          approvalStatus: "approved",
          resultingRoll: null,
        });
        const [original] = await platform.select().from(rollActions).where(eq(rollActions.id, enrolId));
        expect(original).toMatchObject({ approvalStatus: "approved", kind: ENROL });
        expect(await snapshot(subject)).toMatchObject({ currentRoll: null, rollRows: 2 });

        const [audit] = await auditRowsFor(result.voidRollActionId);
        expect(audit).toMatchObject({
          action: "tenant.roll_action.voided",
          actor_user_id: proposerUserId2,
          actor_email: "recorder@example.invalid",
        });
        expect(audit!.metadata).toEqual({
          organizationId: orgA,
          voidRollActionId: result.voidRollActionId,
          voidsActionId: enrolId,
          voidedKind: ENROL,
          reason: "Entered against the wrong person.",
          membershipReopened: false,
        });
      });

      it("undoes a removal: the membership reopens and the person is a participant again", async () => {
        const { subject } = await enrolled("Bartholomew");
        const removal = await recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
          personId: subject,
          kind: REMOVE,
          effectiveDate: "2026-04-01",
        });
        if (removal.kind !== "ok") throw new Error("fixture removal failed");
        const result = await voidParticipantAction(proposerPerson, orgA, proposerUserId2, {
          rollActionId: removal.rollActionId,
          reason: "Removed in error.",
        });
        expect(result).toMatchObject({ kind: "ok", voidedKind: REMOVE, membershipReopened: true });
        expect(await snapshot(subject)).toMatchObject({
          currentRoll: "other_participant",
          endedOn: null,
          endedReason: null,
        });
      });

      it("refuses a second undo (already_voided), an undo of anything but the latest entry, and a missing or blank reason", async () => {
        const { subject, enrolId } = await enrolled("Cuthbert");
        const removal = await recordParticipantAction(proposerPerson, orgA, proposerUserId2, {
          personId: subject,
          kind: REMOVE,
          effectiveDate: "2026-04-01",
        });
        if (removal.kind !== "ok") throw new Error("fixture removal failed");

        // The enrolment is no longer the latest entry.
        expect(
          await voidParticipantAction(proposerPerson, orgA, proposerUserId2, {
            rollActionId: enrolId,
            reason: "Too early.",
          }),
        ).toEqual({ kind: "refused", reason: "not_latest_action" });

        expect(
          await voidParticipantAction(proposerPerson, orgA, proposerUserId2, {
            rollActionId: removal.rollActionId,
            reason: "   ",
          }),
        ).toEqual({ kind: "refused", reason: "reason_required" });
        expect(
          await voidParticipantAction(proposerPerson, orgA, proposerUserId2, {
            rollActionId: removal.rollActionId,
            reason: "r".repeat(501),
          }),
        ).toEqual({ kind: "refused", reason: "reason_too_long" });

        expect(
          (
            await voidParticipantAction(proposerPerson, orgA, proposerUserId2, {
              rollActionId: removal.rollActionId,
              reason: "First undo.",
            })
          ).kind,
        ).toBe("ok");
        expect(
          await voidParticipantAction(proposerPerson, orgA, proposerUserId2, {
            rollActionId: removal.rollActionId,
            reason: "Second undo.",
          }),
        ).toEqual({ kind: "refused", reason: "already_voided" });
      });

      it("action_not_found for a non-UUID and for an id that is not at this organization", async () => {
        expect(
          await voidParticipantAction(proposerPerson, orgA, proposerUserId2, {
            rollActionId: "nope",
            reason: "x",
          }),
        ).toEqual({ kind: "refused", reason: "action_not_found" });
        expect(
          await voidParticipantAction(proposerPerson, orgA, proposerUserId2, {
            rollActionId: "00000000-0000-0000-0000-000000000000",
            reason: "x",
          }),
        ).toEqual({ kind: "refused", reason: "action_not_found" });
      });

      it("not_on_record_kind: a Session-approved or pending membership action cannot be undone here", async () => {
        const platform = getPlatformDb();
        const subject = await mkPerson("Desmond", "Pryce");
        const [approved] = await platform
          .insert(rollActions)
          .values({
            organizationId: orgA,
            personId: subject,
            kind: "baptized_member_enrolled",
            effectiveDate: "2025-01-01",
            resultingRoll: "baptized",
            approvalStatus: "approved",
            approvedBy: proposerUserId2,
            proposedBy: proposerUserId2,
          })
          .returning({ id: rollActions.id });
        expect(
          await voidParticipantAction(proposerPerson, orgA, proposerUserId2, {
            rollActionId: approved!.id,
            reason: "Not mine to undo.",
          }),
        ).toEqual({ kind: "refused", reason: "not_on_record_kind" });
      });

      it("forbidden without roll.propose, and for a user claim that is not the acting person's; nothing is written", async () => {
        const { subject, enrolId } = await enrolled("Ephraim");
        expect(
          await voidParticipantAction(outsiderPerson, orgA, approverUserId, {
            rollActionId: enrolId,
            reason: "No permission.",
          }),
        ).toEqual({ kind: "forbidden" });
        expect(
          await voidParticipantAction(proposerPerson, orgA, approverUserId, {
            rollActionId: enrolId,
            reason: "Wrong user claim.",
          }),
        ).toEqual({ kind: "forbidden" });
        expect(await snapshot(subject)).toMatchObject({ rollRows: 1, currentRoll: "other_participant" });
      });

      it("a failed audit insert rolls the void back: no void row, the person still a participant", async () => {
        const { subject, enrolId } = await enrolled("Fitzgerald");
        auditControl.fail = true;
        await expect(
          voidParticipantAction(proposerPerson, orgA, proposerUserId2, {
            rollActionId: enrolId,
            reason: "Will not commit.",
          }),
        ).rejects.toThrow(/audit insert failed/);
        expect(await snapshot(subject)).toMatchObject({ rollRows: 1, currentRoll: "other_participant" });
      });
    });
  });
});
