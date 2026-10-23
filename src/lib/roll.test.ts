/**
 * Integration tests for src/lib/roll.ts — run against a REAL Postgres
 * connection, not mocked. Same harness as `people.test.ts`/`role-grants.
 * test.ts`. `npm test` in CI does not set DATABASE_URL, so this whole suite
 * is SKIPPED there, not failed. Run for real with:
 *   dotenv -e .env.local -- vitest run src/lib/roll.test.ts
 *
 * `@/lib/audit` is mocked at the module boundary, same posture and same
 * reason as `org-features.test.ts` — it transitively imports `@/auth`
 * (next-auth), which this test environment cannot resolve. Only
 * `AUDIT_ACTIONS` is used for real: approve, deny, withdraw and the
 * on-record paths write their audit rows with the REAL `insertAuditRow()` in
 * the same transaction (Increment 2, R13), and `recordAudit` must never be
 * called by `roll.ts` at all (a test asserts it).
 *
 * RUNS AGAINST THE 0063 LOCKDOWN STATE (docs/work-log/2026-10-22-founding-
 * admin-directory.md, Increment 2 Batch B): `presby_app` holds no UPDATE or
 * DELETE on `roll_actions`, so every decision in this file goes through the
 * `presby_decide_roll_action` / `presby_withdraw_roll_action` definers and the
 * tests that used to prove a plain `presby_app` UPDATE or DELETE now prove it
 * is refused (SQLSTATE 42501).
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
  APPROVABLE_ROLL_ACTION_KINDS,
  BULK_APPROVE_MAX,
  EDIT_TIME_ROLL_ACTION_KINDS,
  ROLL_ACTION_KIND_TO_ROLL,
  ROLL_DECISION_REFUSALS,
  type RollActionKind,
} from "@/lib/roll-action-kinds";

vi.mock("server-only", () => ({}));
// Every test below makes many sequential round trips to a remote database.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 240_000 });

const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    ROLL_ACTION_APPROVED: "tenant.roll_action.approved",
    ROLL_ACTION_DENIED: "tenant.roll_action.denied",
    ROLL_ACTION_WITHDRAWN: "tenant.roll_action.withdrawn",
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
  let approveRollActions: typeof import("./roll").approveRollActions;
  let denyRollAction: typeof import("./roll").denyRollAction;
  let withdrawRollAction: typeof import("./roll").withdrawRollAction;
  let listPendingRollActions: typeof import("./roll").listPendingRollActions;
  let listRecentlyDecidedRollActions: typeof import("./roll").listRecentlyDecidedRollActions;
  let countPendingRollActions: typeof import("./roll").countPendingRollActions;
  let getSessionApprovalState: typeof import("./roll").getSessionApprovalState;
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

  // A SECOND organization with NO Session group (a presbytery): the
  // `no_session` refusal (R15), the `no_session` state, and the cross-org
  // `not_found` for a decision aimed at another organization's row.
  let orgB: string;
  let bProposer: string; // holds roll.propose at orgB
  let bProposerUserId: string;
  let bSubject: string; // membership at orgB, no roll rows
  let bPendingId: string; // a pending row at orgB (cross-org probe)

  // recordRollAction / getPendingRollActionsForPerson fixture
  let proposerPerson: string; // holds roll.propose ONLY (not roll.approve)
  let proposerUserId2: string; // a users.id for recordRollAction's actingUserId
  let otherProposerUserId: string; // a users.id that proposed fixture rows (nobody acts as it)
  let editSubjectWithBirthdate: string; // membership at orgA, dateOfBirth set
  let editSubjectNoBirthdate: string; // membership at orgA, dateOfBirth null
  let editSubjectAlreadyPending: string; // membership at orgA, one pre-existing pending row
  let personWithNoMembership: string; // exists, but no membership row at orgA
  let preexistingPendingId: string;
  // People, users and organizations created by the describes below; swept in
  // afterAll (organizations first, so their memberships cascade).
  const extraPeople: string[] = [];
  const extraUsers: string[] = [];
  const extraOrgs: string[] = [];

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


  /** A group_types row by key (the platform catalog), created if absent. */
  async function groupTypeIdFor(key: "roster" | "court"): Promise<string> {
    const platform = getPlatformDb();
    await platform
      .insert(groupTypes)
      .values({ key, name: key === "court" ? "Court" : "Roster" })
      .onConflictDoNothing();
    const [row] = await platform
      .select({ id: groupTypes.id })
      .from(groupTypes)
      .where(eq(groupTypes.key, key))
      .limit(1);
    return row!.id;
  }

  function courtGroupTypeId(): Promise<string> {
    return groupTypeIdFor("court");
  }

  let orgCounter = 0;

  /** An extra fixture organization with its Active Membership group and,
   * optionally, the derived Session group a congregation is seeded with. */
  async function mkOrg(
    label: string,
    opts: { type?: "congregation" | "presbytery"; session?: boolean } = {},
  ): Promise<string> {
    const platform = getPlatformDb();
    orgCounter += 1;
    const [org] = await platform
      .insert(organizations)
      .values({
        deletableUntil: fixtureDeletableUntil(),
        organizationType: opts.type ?? "congregation",
        name: `Fixture ${label} for roll.test.ts`,
        slug: `roll-test-${label}-${stamp}-${orgCounter}`,
        path: `roll_test_${label}_${stamp}_${orgCounter}`,
        platformStatus: "unmanaged",
      })
      .returning({ id: organizations.id });
    extraOrgs.push(org!.id);
    await platform.insert(groups).values({
      organizationId: org!.id,
      groupTypeId: await groupTypeIdFor("roster"),
      name: "Active Membership",
      membershipSource: "derived",
      derivedFrom: "active_membership",
      isProtected: true,
    });
    if (opts.session) {
      await platform.insert(groups).values({
        organizationId: org!.id,
        groupTypeId: await courtGroupTypeId(),
        name: "Session",
        membershipSource: "derived",
        derivedFrom: "session",
        isProtected: true,
      });
    }
    return org!.id;
  }

  /** A person with a live membership at `orgId`, and optionally a linked user. */
  async function mkMemberAt(
    orgId: string,
    first: string,
    last: string,
    opts: { dob?: string; engagement?: string; withUser?: boolean } = {},
  ): Promise<{ personId: string; userId: string | null }> {
    const platform = getPlatformDb();
    let userId: string | null = null;
    if (opts.withUser) {
      const [u] = await platform
        .insert(users)
        .values({
          email: `roll-test-${first.toLowerCase()}-${stamp}-${extraUsers.length}@example.invalid`,
          name: `${first} ${last}`,
        })
        .returning({ id: users.id });
      userId = u!.id;
      extraUsers.push(userId);
    }
    const [p] = await platform
      .insert(people)
      .values({
        firstName: first,
        lastName: `${last}${stamp}`,
        dateOfBirth: opts.dob ?? null,
        userId,
        deletableUntil: fixtureDeletableUntil(),
      })
      .returning({ id: people.id });
    extraPeople.push(p!.id);
    await platform.insert(memberships).values({
      organizationId: orgId,
      personId: p!.id,
      engagementStatus: opts.engagement ?? "regular",
    });
    return { personId: p!.id, userId };
  }

  /** An org-owned role holding `permissionKeys`, granted to a person or to a
   * group (the Session role is bound to the derived Session group). */
  async function mkRoleGrant(
    orgId: string,
    key: string,
    permissionKeys: string[],
    to: { personId: string } | { groupId: string },
  ): Promise<void> {
    const platform = getPlatformDb();
    const [role] = await platform
      .insert(appRoles)
      .values({ organizationId: orgId, key, name: key, roleKind: "custom" })
      .returning({ id: appRoles.id });
    await platform
      .insert(appRolePermissions)
      .values(permissionKeys.map((permissionKey) => ({ roleId: role!.id, permissionKey })));
    await platform.insert(roleGrants).values({
      organizationId: orgId,
      roleId: role!.id,
      startsOn: "2020-01-01",
      ...("personId" in to ? { personId: to.personId } : { groupId: to.groupId }),
    });
  }

  /** The derived Session group's id at an organization. */
  async function sessionGroupId(orgId: string): Promise<string> {
    const platform = getPlatformDb();
    const [g] = await platform
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.organizationId, orgId), eq(groups.derivedFrom, "session")))
      .limit(1);
    return g!.id;
  }

  /** A pending roll action inserted by the owner (fixtures only: presby_app
   * proposes through recordRollAction / createPerson). One pending row per
   * person (R7), so each call makes its own subject unless one is given. */
  async function mkPending(
    opts: {
      orgId?: string;
      personId?: string;
      kind?: RollActionKind;
      effectiveDate?: string;
      proposedBy?: string | null;
      minuteReference?: string | null;
      dob?: string;
    } = {},
  ): Promise<{ id: string; personId: string }> {
    const platform = getPlatformDb();
    const orgId = opts.orgId ?? orgA;
    const kind = opts.kind ?? "profession_of_faith";
    const personId =
      opts.personId ??
      (orgId === orgA
        ? await mkPerson("Pending", "Subject", { dob: opts.dob })
        : (await mkMemberAt(orgId, "Pending", "Subject", { dob: opts.dob })).personId);
    const [row] = await platform
      .insert(rollActions)
      .values({
        organizationId: orgId,
        personId,
        kind,
        effectiveDate: opts.effectiveDate ?? "2026-01-01",
        resultingRoll: ROLL_ACTION_KIND_TO_ROLL[kind],
        approvalStatus: "pending",
        proposedBy: opts.proposedBy === undefined ? otherProposerUserId : opts.proposedBy,
        minuteReference: opts.minuteReference ?? null,
      })
      .returning({ id: rollActions.id });
    return { id: row!.id, personId };
  }

  /** The roll row, the membership cache and the audit rows for one subject:
   * the "nothing was written" snapshot. */
  async function stateOf(rollActionId: string, personId: string) {
    const platform = getPlatformDb();
    const [row] = await platform.select().from(rollActions).where(eq(rollActions.id, rollActionId));
    const [m] = await platform
      .select({ currentRoll: memberships.currentRoll, endedOn: memberships.endedOn })
      .from(memberships)
      .where(and(eq(memberships.personId, personId), eq(memberships.organizationId, orgA)));
    const audits = await auditRowsFor(rollActionId);
    return {
      status: row?.approvalStatus,
      decidedBy: row?.decidedBy ?? null,
      currentRoll: m?.currentRoll ?? null,
      audits: audits.length,
    };
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
      approveRollActions,
      denyRollAction,
      withdrawRollAction,
      listPendingRollActions,
      listRecentlyDecidedRollActions,
      countPendingRollActions,
      getSessionApprovalState,
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
    // R15: a member proposal needs a Session to approve it, so the fixture
    // congregation carries the derived Session group a real one is seeded with.
    await platform.insert(groups).values({
      organizationId: orgA,
      groupTypeId: await courtGroupTypeId(),
      name: "Session",
      membershipSource: "derived",
      derivedFrom: "session",
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
    otherProposerUserId = u2!.id;

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

    // orgB: a presbytery with no Session group, one propose-only user, one
    // member with no roll rows, and one pending row (the cross-org probe).
    orgB = await mkOrg("b", { type: "presbytery", session: false });
    const bProposerMember = await mkMemberAt(orgB, "Bryony", "Proposer", { withUser: true });
    bProposer = bProposerMember.personId;
    bProposerUserId = bProposerMember.userId!;
    await mkRoleGrant(orgB, "roll_proposer", ["roll.propose"], { personId: bProposer });
    bSubject = (await mkMemberAt(orgB, "Bertram", "Subject")).personId;
    bPendingId = (await mkPending({ orgId: orgB })).id;
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
    // The extra organizations (their memberships, groups, terms, roles and
    // roll rows cascade). Same trigger handling as orgA above.
    await platform.execute(sql`alter table roll_actions disable trigger roll_actions_freeze`);
    await platform.execute(
      sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
    );
    try {
      for (const id of extraOrgs) {
        await platform.delete(rollActions).where(eq(rollActions.organizationId, id));
        await platform.delete(organizations).where(eq(organizations.id, id));
      }
    } finally {
      await platform.execute(
        sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
      );
      await platform.execute(sql`alter table roll_actions enable trigger roll_actions_freeze`);
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
    for (const id of extraOrgs) {
      await platform.execute(
        sql`delete from audit_events where metadata->>'organizationId' = ${id}`,
      );
    }
    for (const id of extraUsers) {
      await platform.delete(users).where(eq(users.id, id));
    }
    await platform.delete(users).where(eq(users.id, approverUserId));
    await platform.delete(users).where(eq(users.id, proposerUserId2));
    // proposerUserId was never tracked in a `let` — sweep by email instead.
    await platform
      .delete(users)
      .where(eq(users.email, `roll-test-proposer-${stamp}@example.invalid`));
  });

  // ---------------------------------------------------------------------
  // approveRollAction (through presby_decide_roll_action, DECISION-203)
  // ---------------------------------------------------------------------

  /** The exact UPDATE/DELETE refusal a `presby_app` caller gets after 0063. */
  async function plainSqlOutcome(statement: ReturnType<typeof sql>): Promise<string> {
    const { withOrgContext } = await import("@/lib/authz");
    try {
      await withOrgContext(approverPerson, orgA, async (tx) => {
        await tx.execute(statement);
      });
      return "NO ERROR";
    } catch (err) {
      const parts: string[] = [];
      for (let cur = err as { message?: string; code?: string; cause?: unknown } | undefined; cur; ) {
        parts.push(`${cur.code ?? ""} ${cur.message ?? ""}`);
        cur = cur.cause as typeof cur;
      }
      return parts.join(" :: ");
    }
  }

  describe("approveRollAction", () => {
    afterEach(() => {
      auditControl.fail = false;
    });

    it("forbidden without roll.approve; the row stays pending and nothing is audited", async () => {
      const target = await mkPending();
      const result = await approveRollAction(outsiderPerson, orgA, approverUserId, target.id, {});
      expect(result).toEqual({ kind: "forbidden" });
      expect(await stateOf(target.id, target.personId)).toEqual({
        status: "pending",
        decidedBy: null,
        currentRoll: null,
        audits: 0,
      });
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it("a roll.propose-only holder cannot approve, even for the row they proposed (propose and approve stay separate keys)", async () => {
      const target = await mkPending({ proposedBy: proposerUserId2 });
      const result = await approveRollAction(proposerPerson, orgA, proposerUserId2, target.id, {});
      expect(result).toEqual({ kind: "forbidden" });
      expect((await stateOf(target.id, target.personId)).status).toBe("pending");
    });

    it("FORGERY: a users.id that is not the acting person's is refused by the database, not trusted — typed forbidden, nothing written", async () => {
      // approverPerson holds roll.approve (the TypeScript pre-check passes),
      // but proposerUserId2 belongs to a person who does not: the function's
      // own actor check raises its one literal (SQLSTATE 42501).
      const target = await mkPending();
      const result = await approveRollAction(approverPerson, orgA, proposerUserId2, target.id, {});
      expect(result).toEqual({ kind: "forbidden" });
      expect(await stateOf(target.id, target.personId)).toEqual({
        status: "pending",
        decidedBy: null,
        currentRoll: null,
        audits: 0,
      });
    });

    it("not_found for a nonexistent id, a malformed id, and ANOTHER organization's roll action (indistinguishable)", async () => {
      for (const id of [
        "00000000-0000-0000-0000-000000000000",
        "not-a-uuid",
        "'; drop table roll_actions; --",
        bPendingId,
      ]) {
        expect(
          await approveRollAction(approverPerson, orgA, approverUserId, id, {}),
          id,
        ).toEqual({ kind: "refused", reason: "not_found" });
      }
      // The other organization's row was not touched.
      const platform = getPlatformDb();
      const [other] = await platform.select().from(rollActions).where(eq(rollActions.id, bPendingId));
      expect(other?.approvalStatus).toBe("pending");
    });

    it("approves a pending action: projects current_roll, stamps the decision, overwrites the minute reference, and audits in the same transaction with exactly the documented metadata", async () => {
      const target = await mkPending({ minuteReference: "Proposer's note" });
      const result = await approveRollAction(
        approverPerson,
        orgA,
        approverUserId,
        target.id,
        { minuteReference: "  Session 2026-01-01, item 5  " },
        { actingUserEmail: "approver@example.invalid" },
      );
      expect(result).toEqual({
        kind: "ok",
        rollActionId: target.id,
        personId: target.personId,
        rollKind: "profession_of_faith",
        effectiveDate: "2026-01-01",
        affectsFiledPeriod: false,
        shadowedBy: null,
        selfApproved: false,
        selfTarget: false,
      });

      const platform = getPlatformDb();
      const [row] = await platform.select().from(rollActions).where(eq(rollActions.id, target.id));
      expect(row).toMatchObject({
        approvalStatus: "approved",
        approvedBy: approverUserId,
        decidedBy: approverUserId,
        minuteReference: "Session 2026-01-01, item 5",
      });
      expect(row?.decidedAt).toBeInstanceOf(Date);
      const [m] = await platform
        .select({ currentRoll: memberships.currentRoll, since: memberships.currentRollSince })
        .from(memberships)
        .where(and(eq(memberships.personId, target.personId), eq(memberships.organizationId, orgA)));
      expect(m).toMatchObject({ currentRoll: "active", since: "2026-01-01" });

      const audits = await auditRowsFor(target.id);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: AUDIT_ACTIONS.ROLL_ACTION_APPROVED,
        actor_user_id: approverUserId,
        actor_email: "approver@example.invalid",
        resource_type: "roll_action",
        resource_id: target.id,
      });
      expect(audits[0]!.metadata).toEqual({
        organizationId: orgA,
        rollActionId: target.id,
        personId: target.personId,
        kind: "profession_of_faith",
        effectiveDate: "2026-01-01",
        minuteReference: "Session 2026-01-01, item 5",
        selfApproved: false,
        selfTarget: false,
        affectsFiledPeriod: false,
        shadowedBy: null,
      });
      // roll.ts never calls the swallow-on-failure after-commit recordAudit().
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it("an omitted minute reference leaves the proposer's value untouched, and the audit says null", async () => {
      const target = await mkPending({ minuteReference: "Proposer's note" });
      const result = await approveRollAction(approverPerson, orgA, approverUserId, target.id, {});
      expect(result.kind).toBe("ok");
      const platform = getPlatformDb();
      const [row] = await platform.select().from(rollActions).where(eq(rollActions.id, target.id));
      expect(row?.minuteReference).toBe("Proposer's note");
      const [audit] = await auditRowsFor(target.id);
      expect((audit!.metadata as Record<string, unknown>).minuteReference).toBeNull();
    });

    it("stamps selfApproved (the proposer approves their own row) and selfTarget (the approver is the subject) — permitted, never blocked", async () => {
      const own = await mkPending({ proposedBy: approverUserId });
      const ownResult = await approveRollAction(approverPerson, orgA, approverUserId, own.id, {});
      expect(ownResult).toMatchObject({ kind: "ok", selfApproved: true, selfTarget: false });
      const [ownAudit] = await auditRowsFor(own.id);
      expect(ownAudit!.metadata).toMatchObject({ selfApproved: true, selfTarget: false });

      // The approver is the SUBJECT of a proposal someone else made.
      const about = await mkPending({ personId: approverPerson, effectiveDate: "2025-06-01" });
      const aboutResult = await approveRollAction(approverPerson, orgA, approverUserId, about.id, {});
      expect(aboutResult).toMatchObject({ kind: "ok", selfApproved: false, selfTarget: true });
      const [aboutAudit] = await auditRowsFor(about.id);
      expect(aboutAudit!.metadata).toMatchObject({ selfApproved: false, selfTarget: true });
    });

    it("returns shadowedBy (a warning, never a refusal) when a later effective action exists, and puts it in the audit metadata", async () => {
      const subject = await mkPerson("Shadow", "Subject");
      const platform = getPlatformDb();
      await platform.insert(rollActions).values({
        organizationId: orgA,
        personId: subject,
        kind: "baptized_member_enrolled",
        effectiveDate: "2026-03-01",
        resultingRoll: "baptized",
        approvalStatus: "approved",
        approvedBy: proposerUserId2,
        proposedBy: proposerUserId2,
      });
      const target = await mkPending({ personId: subject, effectiveDate: "2026-01-15" });
      const result = await approveRollAction(approverPerson, orgA, approverUserId, target.id, {});
      expect(result).toMatchObject({
        kind: "ok",
        shadowedBy: { kind: "baptized_member_enrolled", effectiveDate: "2026-03-01" },
      });
      const [audit] = await auditRowsFor(target.id);
      expect((audit!.metadata as Record<string, unknown>).shadowedBy).toEqual({
        kind: "baptized_member_enrolled",
        effectiveDate: "2026-03-01",
      });
    });

    it("already_decided on a second approval of the same row; one audit row, not two", async () => {
      const target = await mkPending();
      const first = await approveRollAction(approverPerson, orgA, approverUserId, target.id, {});
      expect(first.kind).toBe("ok");
      const second = await approveRollAction(approverPerson, orgA, approverUserId, target.id, {});
      expect(second).toEqual({ kind: "refused", reason: "already_decided" });
      expect((await auditRowsFor(target.id)).length).toBe(1);
    });

    it("bounds the minute reference at 200 characters after trimming (the database enforces it too)", async () => {
      const target = await mkPending();
      expect(
        await approveRollAction(approverPerson, orgA, approverUserId, target.id, {
          minuteReference: "m".repeat(201),
        }),
      ).toEqual({ kind: "refused", reason: "minute_reference_too_long" });
      expect((await stateOf(target.id, target.personId)).status).toBe("pending");
      // Exactly 200 (padded with spaces that trim away) is fine.
      expect(
        (
          await approveRollAction(approverPerson, orgA, approverUserId, target.id, {
            minuteReference: `  ${"m".repeat(200)}  `,
          })
        ).kind,
      ).toBe("ok");
    });

    it.each([
      ["a kind that is not approvable (a legacy pending participant row)", "not_approvable_kind"],
      ["an ended membership", "membership_ended"],
      ["a person recorded as deceased", "person_deceased"],
      ["a gain the person already has", "already_on_roll"],
    ] as const)(
      "refuses %s with its own code, leaves the row pending and writes no audit row",
      async (label, expected) => {
        const platform = getPlatformDb();
        let target: { id: string; personId: string };
        if (expected === "not_approvable_kind") {
          target = await mkPending({ kind: "other_participant_enrolled" });
        } else if (expected === "membership_ended") {
          target = await mkPending();
          await platform
            .update(memberships)
            .set({ endedOn: "2026-02-01", endedReason: "moved" })
            .where(and(eq(memberships.personId, target.personId), eq(memberships.organizationId, orgA)));
        } else if (expected === "person_deceased") {
          target = await mkPending();
          await platform.update(people).set({ dateOfDeath: "2026-02-01" }).where(eq(people.id, target.personId));
        } else {
          const subject = await mkPerson("Already", "OnRoll");
          await platform.insert(rollActions).values({
            organizationId: orgA,
            personId: subject,
            kind: "profession_of_faith",
            effectiveDate: "2025-01-01",
            resultingRoll: "active",
            approvalStatus: "approved",
            approvedBy: proposerUserId2,
            proposedBy: proposerUserId2,
          });
          target = await mkPending({ personId: subject, kind: "reaffirmation", effectiveDate: "2026-01-01" });
        }
        const result = await approveRollAction(approverPerson, orgA, approverUserId, target.id, {});
        expect(result, label).toEqual({ kind: "refused", reason: expected });
        const state = await stateOf(target.id, target.personId);
        expect(state.status).toBe("pending");
        expect(state.audits).toBe(0);
        expect(state.decidedBy).toBeNull();
      },
    );

    it("every refusal code the database can return is one the library recognises (no outcome is dropped or invented)", () => {
      expect(ROLL_DECISION_REFUSALS).toContain("already_on_roll");
      expect(ROLL_DECISION_REFUSALS).toContain("holds_pastoral_office");
      expect(ROLL_DECISION_REFUSALS).toContain("active_elsewhere");
    });

    /**
     * R13 / F180. The audit row shares the decision's transaction, so a failed
     * audit insert fails the whole approval: the row stays pending, the cache
     * is untouched, and there is no audit row. The old after-commit
     * recordAudit() would have left an approved row with no audit trail.
     */
    it("a failed audit insert rolls the whole approval back: still pending, the cache untouched, no audit row", async () => {
      const target = await mkPending();
      auditControl.fail = true;
      await expect(
        approveRollAction(approverPerson, orgA, approverUserId, target.id, {}),
      ).rejects.toThrow(/audit insert failed/);
      expect(await stateOf(target.id, target.personId)).toEqual({
        status: "pending",
        decidedBy: null,
        currentRoll: null,
        audits: 0,
      });
      // And once the audit can be written, the same row approves cleanly.
      auditControl.fail = false;
      expect((await approveRollAction(approverPerson, orgA, approverUserId, target.id, {})).kind).toBe("ok");
    });

    /**
     * Two approvers racing for the same row: exactly one wins, the other gets
     * the typed already_decided, and exactly one audit row exists.
     */
    it("a race for the same row: one ok, one already_decided, one audit row", async () => {
      const target = await mkPending();
      const results = await Promise.all([
        approveRollAction(approverPerson, orgA, approverUserId, target.id, {}),
        approveRollAction(approverPerson, orgA, approverUserId, target.id, {}),
      ]);
      const kinds = results.map((r) => (r.kind === "ok" ? "ok" : r.kind === "refused" ? r.reason : r.kind));
      expect(kinds.sort()).toEqual(["already_decided", "ok"]);
      expect((await auditRowsFor(target.id)).length).toBe(1);
    });

    /**
     * 0063 (F180): presby_app holds neither UPDATE nor DELETE on roll_actions,
     * so no path other than the definers can move a row out of `pending`,
     * edit a decided one, or delete one. These replace the pre-0063 tests that
     * proved the freeze trigger and the pending-DELETE through presby_app.
     */
    it("0063: a plain UPDATE or DELETE of a roll action as presby_app is refused with SQLSTATE 42501 — pending, approved, denied and withdrawn alike", async () => {
      const pending = await mkPending();
      const approved = await mkPending();
      await approveRollAction(approverPerson, orgA, approverUserId, approved.id, {});
      const denied = await mkPending();
      await denyRollAction(approverPerson, orgA, approverUserId, denied.id, { reason: "Duplicate" });
      const withdrawn = await mkPending();
      await withdrawRollAction(proposerPerson, orgA, proposerUserId2, withdrawn.id, { reason: "Typo" });

      for (const [label, id] of [
        ["pending", pending.id],
        ["approved", approved.id],
        ["denied", denied.id],
        ["withdrawn", withdrawn.id],
      ] as const) {
        const update = await plainSqlOutcome(
          sql`update roll_actions set approval_status = 'approved' where id = ${id}::uuid`,
        );
        expect(update, `UPDATE of a ${label} row`).toMatch(/42501.*permission denied/);
        const del = await plainSqlOutcome(sql`delete from roll_actions where id = ${id}::uuid`);
        expect(del, `DELETE of a ${label} row`).toMatch(/42501.*permission denied/);
      }
      const platform = getPlatformDb();
      const rows = await platform
        .select({ id: rollActions.id, status: rollActions.approvalStatus })
        .from(rollActions)
        .where(eq(rollActions.organizationId, orgA));
      const byId = new Map(rows.map((r) => [r.id, r.status]));
      expect(byId.get(pending.id)).toBe("pending");
      expect(byId.get(approved.id)).toBe("approved");
      expect(byId.get(denied.id)).toBe("denied");
      expect(byId.get(withdrawn.id)).toBe("withdrawn");
    });

    it("the freeze trigger still binds the OWNER: an approved, a denied and a withdrawn row cannot be updated or deleted even by the connection no grant binds", async () => {
      const platform = getPlatformDb();
      const approved = await mkPending();
      await approveRollAction(approverPerson, orgA, approverUserId, approved.id, {});
      const denied = await mkPending();
      await denyRollAction(approverPerson, orgA, approverUserId, denied.id, { reason: "Duplicate" });
      const withdrawn = await mkPending();
      await withdrawRollAction(proposerPerson, orgA, proposerUserId2, withdrawn.id, { reason: "Typo" });
      const chainOf = (err: unknown): string => {
        const parts: string[] = [];
        for (let cur = err as { message?: string; cause?: unknown } | undefined; cur; ) {
          if (cur.message) parts.push(cur.message);
          cur = cur.cause as typeof cur;
        }
        return parts.join(" :: ");
      };
      for (const id of [approved.id, denied.id, withdrawn.id]) {
        const update = await platform
          .execute(sql`update roll_actions set minute_reference = 'edit' where id = ${id}::uuid`)
          .then(() => "NO ERROR", chainOf);
        expect(update).toMatch(/immutable/i);
        const del = await platform
          .execute(sql`delete from roll_actions where id = ${id}::uuid`)
          .then(() => "NO ERROR", chainOf);
        expect(del).toMatch(/immutable/i);
      }
    });
  });

  // ---------------------------------------------------------------------
  // denyRollAction
  // ---------------------------------------------------------------------

  describe("denyRollAction", () => {
    afterEach(() => {
      auditControl.fail = false;
    });

    it("forbidden without roll.approve, and for a roll.propose-only holder", async () => {
      const target = await mkPending();
      expect(
        await denyRollAction(outsiderPerson, orgA, approverUserId, target.id, { reason: "No" }),
      ).toEqual({ kind: "forbidden" });
      expect(
        await denyRollAction(proposerPerson, orgA, proposerUserId2, target.id, { reason: "No" }),
      ).toEqual({ kind: "forbidden" });
      expect((await stateOf(target.id, target.personId)).status).toBe("pending");
    });

    it("denies a pending action: stores the trimmed reason AND who decided and when (a denied row used to record no actor), audits in the same transaction", async () => {
      const target = await mkPending();
      const result = await denyRollAction(
        approverPerson,
        orgA,
        approverUserId,
        target.id,
        { reason: "  Duplicate entry  " },
        { actingUserEmail: "approver@example.invalid" },
      );
      expect(result).toEqual({ kind: "ok", rollActionId: target.id, personId: target.personId });

      const platform = getPlatformDb();
      const [row] = await platform.select().from(rollActions).where(eq(rollActions.id, target.id));
      expect(row).toMatchObject({
        approvalStatus: "denied",
        denialReason: "Duplicate entry",
        decidedBy: approverUserId,
        approvedBy: null,
      });
      expect(row?.decidedAt).toBeInstanceOf(Date);
      // A denied action never projects into the cache.
      expect((await stateOf(target.id, target.personId)).currentRoll).toBeNull();

      const audits = await auditRowsFor(target.id);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: AUDIT_ACTIONS.ROLL_ACTION_DENIED,
        actor_user_id: approverUserId,
        actor_email: "approver@example.invalid",
      });
      expect(audits[0]!.metadata).toEqual({
        organizationId: orgA,
        rollActionId: target.id,
        personId: target.personId,
        reason: "Duplicate entry",
      });
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it("requires a reason of 1 to 500 characters after trimming (F184); nothing is written on a refusal", async () => {
      const target = await mkPending();
      for (const reason of ["", "   ", undefined as unknown as string, 42 as unknown as string]) {
        expect(
          await denyRollAction(approverPerson, orgA, approverUserId, target.id, { reason }),
        ).toEqual({ kind: "refused", reason: "reason_required" });
      }
      expect(
        await denyRollAction(approverPerson, orgA, approverUserId, target.id, { reason: "r".repeat(501) }),
      ).toEqual({ kind: "refused", reason: "reason_too_long" });
      expect((await stateOf(target.id, target.personId)).status).toBe("pending");
      expect(
        (await denyRollAction(approverPerson, orgA, approverUserId, target.id, { reason: "r".repeat(500) })).kind,
      ).toBe("ok");
    });

    it("always denies, whatever the person's state: an ended membership, a deceased person and a non-approvable kind can be denied", async () => {
      const platform = getPlatformDb();
      const ended = await mkPending();
      await platform
        .update(memberships)
        .set({ endedOn: "2026-02-01", endedReason: "moved" })
        .where(and(eq(memberships.personId, ended.personId), eq(memberships.organizationId, orgA)));
      const dead = await mkPending();
      await platform.update(people).set({ dateOfDeath: "2026-02-01" }).where(eq(people.id, dead.personId));
      const legacy = await mkPending({ kind: "other_participant_enrolled" });
      for (const t of [ended, dead, legacy]) {
        expect(
          (await denyRollAction(approverPerson, orgA, approverUserId, t.id, { reason: "Cannot approve" })).kind,
        ).toBe("ok");
      }
    });

    it("not_found for a malformed id and another organization's row; already_decided on a second deny and on an approved row", async () => {
      expect(
        await denyRollAction(approverPerson, orgA, approverUserId, "nope", { reason: "x" }),
      ).toEqual({ kind: "refused", reason: "not_found" });
      expect(
        await denyRollAction(approverPerson, orgA, approverUserId, bPendingId, { reason: "x" }),
      ).toEqual({ kind: "refused", reason: "not_found" });
      const target = await mkPending();
      expect((await denyRollAction(approverPerson, orgA, approverUserId, target.id, { reason: "x" })).kind).toBe("ok");
      expect(
        await denyRollAction(approverPerson, orgA, approverUserId, target.id, { reason: "x" }),
      ).toEqual({ kind: "refused", reason: "already_decided" });
      const approved = await mkPending();
      await approveRollAction(approverPerson, orgA, approverUserId, approved.id, {});
      expect(
        await denyRollAction(approverPerson, orgA, approverUserId, approved.id, { reason: "x" }),
      ).toEqual({ kind: "refused", reason: "already_decided" });
    });

    it("a denied row is terminal: it can never be approved afterwards", async () => {
      const target = await mkPending();
      await denyRollAction(approverPerson, orgA, approverUserId, target.id, { reason: "Duplicate" });
      expect(await approveRollAction(approverPerson, orgA, approverUserId, target.id, {})).toEqual({
        kind: "refused",
        reason: "already_decided",
      });
      expect((await stateOf(target.id, target.personId)).status).toBe("denied");
    });

    it("a failed audit insert rolls the denial back: still pending, no audit row", async () => {
      const target = await mkPending();
      auditControl.fail = true;
      await expect(
        denyRollAction(approverPerson, orgA, approverUserId, target.id, { reason: "Duplicate" }),
      ).rejects.toThrow(/audit insert failed/);
      expect(await stateOf(target.id, target.personId)).toEqual({
        status: "pending",
        decidedBy: null,
        currentRoll: null,
        audits: 0,
      });
      const platform = getPlatformDb();
      const [row] = await platform.select().from(rollActions).where(eq(rollActions.id, target.id));
      expect(row?.denialReason).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // withdrawRollAction (through presby_withdraw_roll_action)
  // ---------------------------------------------------------------------

  describe("withdrawRollAction", () => {
    afterEach(() => {
      auditControl.fail = false;
    });

    it("forbidden without roll.propose: an approve-only holder, an outsider, and a users.id that is not the acting person's", async () => {
      const target = await mkPending();
      expect(
        await withdrawRollAction(approverPerson, orgA, approverUserId, target.id, { reason: "Typo" }),
      ).toEqual({ kind: "forbidden" });
      expect(
        await withdrawRollAction(outsiderPerson, orgA, approverUserId, target.id, { reason: "Typo" }),
      ).toEqual({ kind: "forbidden" });
      // proposerPerson holds roll.propose, but approverUserId is not their user.
      expect(
        await withdrawRollAction(proposerPerson, orgA, approverUserId, target.id, { reason: "Typo" }),
      ).toEqual({ kind: "forbidden" });
      expect(await stateOf(target.id, target.personId)).toEqual({
        status: "pending",
        decidedBy: null,
        currentRoll: null,
        audits: 0,
      });
    });

    it("withdraws a proposal anyone proposed (the clerk keeps the register): its own status, the reason, the actor, an audit row with selfProposed", async () => {
      const others = await mkPending({ proposedBy: otherProposerUserId });
      const result = await withdrawRollAction(
        proposerPerson,
        orgA,
        proposerUserId2,
        others.id,
        { reason: "  Entered against the wrong person.  " },
        { actingUserEmail: "recorder@example.invalid" },
      );
      expect(result).toEqual({
        kind: "ok",
        rollActionId: others.id,
        personId: others.personId,
        selfProposed: false,
      });
      const platform = getPlatformDb();
      const [row] = await platform.select().from(rollActions).where(eq(rollActions.id, others.id));
      expect(row).toMatchObject({
        approvalStatus: "withdrawn",
        withdrawalReason: "Entered against the wrong person.",
        denialReason: null,
        decidedBy: proposerUserId2,
      });
      expect(row?.decidedAt).toBeInstanceOf(Date);
      const [audit] = await auditRowsFor(others.id);
      expect(audit).toMatchObject({
        action: AUDIT_ACTIONS.ROLL_ACTION_WITHDRAWN,
        actor_user_id: proposerUserId2,
        actor_email: "recorder@example.invalid",
      });
      expect(audit!.metadata).toEqual({
        organizationId: orgA,
        rollActionId: others.id,
        personId: others.personId,
        reason: "Entered against the wrong person.",
        selfProposed: false,
      });
      expect(audit!.action).not.toBe(AUDIT_ACTIONS.ROLL_ACTION_DENIED);

      const mine = await mkPending({ proposedBy: proposerUserId2 });
      expect(
        await withdrawRollAction(proposerPerson, orgA, proposerUserId2, mine.id, { reason: "My typo" }),
      ).toMatchObject({ kind: "ok", selfProposed: true });
    });

    it("requires a reason of 1 to 500 characters after trimming; nothing is written on a refusal", async () => {
      const target = await mkPending();
      for (const reason of ["", "  ", undefined as unknown as string]) {
        expect(
          await withdrawRollAction(proposerPerson, orgA, proposerUserId2, target.id, { reason }),
        ).toEqual({ kind: "refused", reason: "reason_required" });
      }
      expect(
        await withdrawRollAction(proposerPerson, orgA, proposerUserId2, target.id, { reason: "r".repeat(501) }),
      ).toEqual({ kind: "refused", reason: "reason_too_long" });
      expect((await stateOf(target.id, target.personId)).status).toBe("pending");
    });

    it("not_found for a malformed id and another organization's row; already_decided once the Session has decided (approved or denied) or it was withdrawn", async () => {
      expect(
        await withdrawRollAction(proposerPerson, orgA, proposerUserId2, "nope", { reason: "x" }),
      ).toEqual({ kind: "refused", reason: "not_found" });
      expect(
        await withdrawRollAction(proposerPerson, orgA, proposerUserId2, bPendingId, { reason: "x" }),
      ).toEqual({ kind: "refused", reason: "not_found" });

      const approved = await mkPending();
      await approveRollAction(approverPerson, orgA, approverUserId, approved.id, {});
      const denied = await mkPending();
      await denyRollAction(approverPerson, orgA, approverUserId, denied.id, { reason: "No" });
      const withdrawn = await mkPending();
      await withdrawRollAction(proposerPerson, orgA, proposerUserId2, withdrawn.id, { reason: "Typo" });
      for (const t of [approved, denied, withdrawn]) {
        expect(
          await withdrawRollAction(proposerPerson, orgA, proposerUserId2, t.id, { reason: "Too late" }),
        ).toEqual({ kind: "refused", reason: "already_decided" });
      }
      expect((await stateOf(approved.id, approved.personId)).status).toBe("approved");
    });

    it("has no state checks: a proposal for an ended membership, a deceased person or a legacy non-approvable kind can be withdrawn", async () => {
      const platform = getPlatformDb();
      const ended = await mkPending();
      await platform
        .update(memberships)
        .set({ endedOn: "2026-02-01", endedReason: "moved" })
        .where(and(eq(memberships.personId, ended.personId), eq(memberships.organizationId, orgA)));
      const dead = await mkPending();
      await platform.update(people).set({ dateOfDeath: "2026-02-01" }).where(eq(people.id, dead.personId));
      const legacy = await mkPending({ kind: "other_participant_enrolled" });
      for (const t of [ended, dead, legacy]) {
        expect(
          (await withdrawRollAction(proposerPerson, orgA, proposerUserId2, t.id, { reason: "Cleaning up" })).kind,
        ).toBe("ok");
      }
    });

    it("releases the person: a withdrawn row never enters replay, and the clerk can propose again (R7 allows one PENDING row)", async () => {
      const subject = await mkPerson("Release", "Me", { dob: "1990-05-05" });
      const first = await recordRollAction(proposerPerson, orgA, proposerUserId2, {
        personId: subject,
        kind: "profession_of_faith",
        effectiveDate: "2026-03-03",
      });
      if (first.kind !== "ok") throw new Error("fixture proposal failed");
      // While it waits, a second proposal is refused (pending_exists).
      expect(
        await recordRollAction(proposerPerson, orgA, proposerUserId2, {
          personId: subject,
          kind: "reaffirmation",
          effectiveDate: "2026-03-04",
        }),
      ).toEqual({ kind: "proposal_refused", reason: "pending_exists" });
      expect(
        (await withdrawRollAction(proposerPerson, orgA, proposerUserId2, first.rollActionId, { reason: "Wrong kind" })).kind,
      ).toBe("ok");
      // Replay never saw it.
      const platform = getPlatformDb();
      const replay = await platform.execute(sql`
        select count(*)::int as n from presby_effective_roll_actions
         where person_id = ${subject}::uuid and organization_id = ${orgA}::uuid
      `);
      expect((replay as unknown as { rows: Array<{ n: number }> }).rows[0]!.n).toBe(0);
      // And the person can be proposed again.
      expect(
        await recordRollAction(proposerPerson, orgA, proposerUserId2, {
          personId: subject,
          kind: "reaffirmation",
          effectiveDate: "2026-03-04",
        }),
      ).toMatchObject({ kind: "ok", effect: "pending" });
    });

    it("a failed audit insert rolls the withdrawal back: still pending, no audit row", async () => {
      const target = await mkPending();
      auditControl.fail = true;
      await expect(
        withdrawRollAction(proposerPerson, orgA, proposerUserId2, target.id, { reason: "Typo" }),
      ).rejects.toThrow(/audit insert failed/);
      expect(await stateOf(target.id, target.personId)).toEqual({
        status: "pending",
        decidedBy: null,
        currentRoll: null,
        audits: 0,
      });
    });

    it("withdraw against approve: exactly one decision wins and the loser is already_decided", async () => {
      const target = await mkPending();
      const [approved, withdrawn] = await Promise.all([
        approveRollAction(approverPerson, orgA, approverUserId, target.id, {}),
        withdrawRollAction(proposerPerson, orgA, proposerUserId2, target.id, { reason: "Typo" }),
      ]);
      const outcomes = [approved.kind === "ok", withdrawn.kind === "ok"];
      expect(outcomes.filter(Boolean)).toHaveLength(1);
      const loser = approved.kind === "ok" ? withdrawn : approved;
      expect(loser).toEqual({ kind: "refused", reason: "already_decided" });
      expect((await auditRowsFor(target.id)).length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // approveRollActions (bulk, R18)
  // ---------------------------------------------------------------------

  describe("approveRollActions (bulk)", () => {
    afterEach(() => {
      auditControl.fail = false;
    });

    it("approves each row in its own transaction with one shared minute reference, and audits each row individually", async () => {
      const a = await mkPending();
      const b = await mkPending();
      const c = await mkPending();
      const result = await approveRollActions(
        approverPerson,
        orgA,
        approverUserId,
        { rollActionIds: [a.id, b.id, c.id], minuteReference: "Session 2026-01-01, items 6-8" },
        { actingUserEmail: "approver@example.invalid" },
      );
      expect(result).toMatchObject({ kind: "ok", approved: 3, needAttention: 0 });
      if (result.kind !== "ok") return;
      expect(result.results.map((r) => r.rollActionId)).toEqual([a.id, b.id, c.id]);
      for (const t of [a, b, c]) {
        const audits = await auditRowsFor(t.id);
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
          action: AUDIT_ACTIONS.ROLL_ACTION_APPROVED,
          actor_email: "approver@example.invalid",
        });
        expect((audits[0]!.metadata as Record<string, unknown>).minuteReference).toBe(
          "Session 2026-01-01, items 6-8",
        );
        expect((await stateOf(t.id, t.personId)).currentRoll).toBe("active");
      }
    });

    it("is per row, not atomic: a row decided in the meantime (a stale selection) or refused is reported, and the rest still approve", async () => {
      const ok1 = await mkPending();
      const stale = await mkPending();
      const dead = await mkPending();
      const ok2 = await mkPending();
      const platform = getPlatformDb();
      await platform.update(people).set({ dateOfDeath: "2026-02-01" }).where(eq(people.id, dead.personId));
      // Another approver decided `stale` between the page load and the submit.
      await denyRollAction(approverPerson, orgA, approverUserId, stale.id, { reason: "Decided first" });

      const result = await approveRollActions(approverPerson, orgA, approverUserId, {
        rollActionIds: [ok1.id, stale.id, dead.id, ok2.id],
      });
      expect(result).toMatchObject({ kind: "ok", approved: 2, needAttention: 2 });
      if (result.kind !== "ok") return;
      const byId = new Map(result.results.map((r) => [r.rollActionId, r.result]));
      expect(byId.get(ok1.id)!.kind).toBe("ok");
      expect(byId.get(stale.id)).toEqual({ kind: "refused", reason: "already_decided" });
      expect(byId.get(dead.id)).toEqual({ kind: "refused", reason: "person_deceased" });
      expect(byId.get(ok2.id)!.kind).toBe("ok");
      // The refused rows are exactly as they were.
      expect((await stateOf(stale.id, stale.personId)).status).toBe("denied");
      expect((await stateOf(dead.id, dead.personId)).status).toBe("pending");
    });

    it("deduplicates ids, treats a malformed id as that row's not_found, and caps the request at 50 unique ids", async () => {
      const a = await mkPending();
      const result = await approveRollActions(approverPerson, orgA, approverUserId, {
        rollActionIds: [a.id, a.id, "not-a-uuid"],
      });
      expect(result).toMatchObject({ kind: "ok", approved: 1, needAttention: 1 });
      if (result.kind !== "ok") return;
      expect(result.results).toHaveLength(2);
      expect(result.results[1]).toEqual({
        rollActionId: "not-a-uuid",
        result: { kind: "refused", reason: "not_found" },
      });
      expect((await auditRowsFor(a.id)).length).toBe(1);

      const fiftyOne = Array.from({ length: BULK_APPROVE_MAX + 1 }, (_, i) =>
        `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      );
      expect(
        await approveRollActions(approverPerson, orgA, approverUserId, { rollActionIds: fiftyOne }),
      ).toEqual({ kind: "too_many" });
      // 51 copies of one id are one unique id, not too many.
      expect(
        (await approveRollActions(approverPerson, orgA, approverUserId, {
          rollActionIds: Array.from({ length: 60 }, () => a.id),
        })).kind,
      ).toBe("ok");
    });

    it("empty, non-array and non-string input are the empty result; nothing is called", async () => {
      expect(await approveRollActions(approverPerson, orgA, approverUserId, { rollActionIds: [] })).toEqual({
        kind: "empty",
      });
      expect(
        await approveRollActions(approverPerson, orgA, approverUserId, {
          rollActionIds: "x" as unknown as string[],
        }),
      ).toEqual({ kind: "empty" });
      expect(
        await approveRollActions(approverPerson, orgA, approverUserId, {
          rollActionIds: [1, null, {}] as unknown as string[],
        }),
      ).toEqual({ kind: "empty" });
    });

    it("forbidden on the first row is the whole result and nothing is decided: an outsider, and a roll.propose-only holder", async () => {
      const a = await mkPending();
      const b = await mkPending();
      expect(
        await approveRollActions(outsiderPerson, orgA, approverUserId, { rollActionIds: [a.id, b.id] }),
      ).toEqual({ kind: "forbidden" });
      expect(
        await approveRollActions(proposerPerson, orgA, proposerUserId2, { rollActionIds: [a.id, b.id] }),
      ).toEqual({ kind: "forbidden" });
      expect((await stateOf(a.id, a.personId)).status).toBe("pending");
      expect((await stateOf(b.id, b.personId)).status).toBe("pending");
    });

    it("a failed audit insert on one row rolls back that row only: earlier rows stay approved, the error surfaces", async () => {
      const first = await mkPending();
      const second = await mkPending();
      // Approve `first` for real, then make the NEXT audit insert fail.
      expect((await approveRollActions(approverPerson, orgA, approverUserId, { rollActionIds: [first.id] })).kind).toBe("ok");
      auditControl.fail = true;
      await expect(
        approveRollActions(approverPerson, orgA, approverUserId, { rollActionIds: [second.id] }),
      ).rejects.toThrow(/audit insert failed/);
      expect((await stateOf(first.id, first.personId)).status).toBe("approved");
      expect((await stateOf(second.id, second.personId)).status).toBe("pending");
    });
  });

  // ---------------------------------------------------------------------
  // The queue reads (F179, R17, DECISION-204)
  // ---------------------------------------------------------------------

  describe("listPendingRollActions", () => {
    it("forbidden without roll.approve or roll.propose", async () => {
      expect(await listPendingRollActions(outsiderPerson, orgA)).toEqual({ kind: "forbidden" });
    });

    it("an approver gets decide mode with the viewer flags; the viewer's own proposal is flagged and nobody else's is", async () => {
      const own = await mkPending({ proposedBy: approverUserId, minuteReference: "Proposed minute" });
      const theirs = await mkPending({ proposedBy: otherProposerUserId });
      const result = await listPendingRollActions(approverPerson, orgA);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.mode).toBe("decide");
      expect(result.viewer).toEqual({ canApprove: true, canPropose: false, canManagePeople: false });
      const ownRow = result.actions.find((a) => a.id === own.id)!;
      expect(ownRow).toMatchObject({
        personId: own.personId,
        kind: "profession_of_faith",
        effectiveDate: "2026-01-01",
        minuteReference: "Proposed minute",
        proposedByIsViewer: true,
        membershipEnded: false,
        personDeceased: false,
      });
      expect(ownRow.proposedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.actions.find((a) => a.id === theirs.id)!.proposedByIsViewer).toBe(false);
      for (const entry of result.actions) {
        if (entry.id !== own.id) expect(entry.proposedByIsViewer).toBe(false);
      }
      expect(result.pagination.total).toBeGreaterThanOrEqual(2);
    });

    it("a roll.propose-only holder gets READ mode and the whole queue (the clerk keeps the register), with no approve flag", async () => {
      const target = await mkPending();
      const result = await listPendingRollActions(proposerPerson, orgA);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.mode).toBe("read");
      expect(result.viewer).toMatchObject({ canApprove: false, canPropose: true });
      expect(result.actions.some((a) => a.id === target.id)).toBe(true);
    });

    it("flags a person whose connection ended or who is recorded as deceased (approval would be refused)", async () => {
      const platform = getPlatformDb();
      const ended = await mkPending();
      await platform
        .update(memberships)
        .set({ endedOn: "2026-02-01", endedReason: "moved" })
        .where(and(eq(memberships.personId, ended.personId), eq(memberships.organizationId, orgA)));
      const dead = await mkPending();
      await platform.update(people).set({ dateOfDeath: "2026-02-01" }).where(eq(people.id, dead.personId));
      const result = await listPendingRollActions(approverPerson, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.actions.find((a) => a.id === ended.id)).toMatchObject({
        membershipEnded: true,
        personDeceased: false,
      });
      expect(result.actions.find((a) => a.id === dead.id)).toMatchObject({
        membershipEnded: false,
        personDeceased: true,
      });
    });

    it("never lists another organization's rows, nor decided or withdrawn rows", async () => {
      const decided = await mkPending();
      await denyRollAction(approverPerson, orgA, approverUserId, decided.id, { reason: "No" });
      const gone = await mkPending();
      await withdrawRollAction(proposerPerson, orgA, proposerUserId2, gone.id, { reason: "Typo" });
      const result = await listPendingRollActions(approverPerson, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      const ids = result.actions.map((a) => a.id);
      expect(ids).not.toContain(bPendingId);
      expect(ids).not.toContain(decided.id);
      expect(ids).not.toContain(gone.id);
    });

    it("paginates: the page size is clamped to the bulk cap and pages are clamped into range", async () => {
      await mkPending();
      await mkPending();
      await mkPending();
      const small = await listPendingRollActions(approverPerson, orgA, { pageSize: 2 });
      if (small.kind !== "ok") throw new Error("expected ok");
      expect(small.actions).toHaveLength(2);
      expect(small.pagination.pageSize).toBe(2);
      expect(small.pagination.total).toBeGreaterThanOrEqual(3);
      expect(small.pagination.totalPages).toBe(Math.ceil(small.pagination.total / 2));
      const last = await listPendingRollActions(approverPerson, orgA, { pageSize: 2, page: 999 });
      if (last.kind !== "ok") throw new Error("expected ok");
      expect(last.pagination.page).toBe(small.pagination.totalPages);
      expect(last.actions.length).toBeGreaterThan(0);
      const huge = await listPendingRollActions(approverPerson, orgA, { pageSize: 10_000, page: -4 });
      if (huge.kind !== "ok") throw new Error("expected ok");
      expect(huge.pagination.pageSize).toBe(BULK_APPROVE_MAX);
      expect(huge.pagination.page).toBe(1);
    });
  });

  describe("listRecentlyDecidedRollActions", () => {
    it("forbidden without either roll key", async () => {
      expect(await listRecentlyDecidedRollActions(outsiderPerson, orgA)).toEqual({ kind: "forbidden" });
    });

    it("shows approvals of the approvable kinds, denials and withdrawals with their reasons, newest first, to BOTH key holders", async () => {
      const approved = await mkPending();
      await approveRollAction(approverPerson, orgA, approverUserId, approved.id, { minuteReference: "Item 1" });
      const denied = await mkPending({ proposedBy: approverUserId });
      await denyRollAction(approverPerson, orgA, approverUserId, denied.id, { reason: "Duplicate entry" });
      const withdrawn = await mkPending();
      await withdrawRollAction(proposerPerson, orgA, proposerUserId2, withdrawn.id, { reason: "Typo in the date" });

      for (const viewer of [approverPerson, proposerPerson]) {
        const result = await listRecentlyDecidedRollActions(viewer, orgA, { limit: 100 });
        if (result.kind !== "ok") throw new Error("expected ok");
        const byId = new Map(result.actions.map((a) => [a.id, a]));
        expect(byId.get(approved.id)).toMatchObject({
          status: "approved",
          reason: null,
          minuteReference: "Item 1",
          kind: "profession_of_faith",
          personId: approved.personId,
          selfDecided: false,
        });
        expect(byId.get(denied.id)).toMatchObject({
          status: "denied",
          reason: "Duplicate entry",
          selfDecided: true, // the proposer decided their own row
        });
        expect(byId.get(withdrawn.id)).toMatchObject({
          status: "withdrawn",
          reason: "Typo in the date",
          selfDecided: false,
        });
        for (const entry of result.actions) {
          expect(entry.decidedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
    });

    it("never shows on-record participant rows, opening balances, voids or pending rows", async () => {
      const subject = await mkPerson("Hidden", "Entry");
      const enrol = await recordRollAction(proposerPerson, orgA, proposerUserId2, {
        personId: subject,
        kind: "other_participant_enrolled",
        effectiveDate: "2026-03-02",
      });
      if (enrol.kind !== "ok") throw new Error("fixture enrolment failed");
      const platform = getPlatformDb();
      const [opening] = await platform
        .insert(rollActions)
        .values({
          organizationId: orgA,
          personId: subject,
          kind: "opening_balance",
          effectiveDate: "2020-01-01",
          resultingRoll: "other_participant",
          approvalStatus: "approved",
        })
        .returning({ id: rollActions.id });
      const pending = await mkPending();
      const result = await listRecentlyDecidedRollActions(approverPerson, orgA, { limit: 100 });
      if (result.kind !== "ok") throw new Error("expected ok");
      const ids = result.actions.map((a) => a.id);
      expect(ids).not.toContain(enrol.rollActionId);
      expect(ids).not.toContain(opening!.id);
      expect(ids).not.toContain(pending.id);
      // Only approvable kinds are ever shown as approved.
      for (const entry of result.actions.filter((a) => a.status === "approved")) {
        expect(APPROVABLE_ROLL_ACTION_KINDS as readonly string[]).toContain(entry.kind);
      }
    });

    it("is scoped to the viewer's organization and honours the limit", async () => {
      const bDecided = await mkPending({ orgId: orgB });
      const platform = getPlatformDb();
      // Decide orgB's row through the owner path (fixture only).
      await platform.execute(sql`
        alter table roll_actions disable trigger roll_actions_freeze
      `);
      try {
        await platform.execute(sql`
          update roll_actions set approval_status = 'denied', denial_reason = 'fixture',
                 decided_by = ${bProposerUserId}::uuid, decided_at = now()
           where id = ${bDecided.id}::uuid
        `);
      } finally {
        await platform.execute(sql`alter table roll_actions enable trigger roll_actions_freeze`);
      }
      const result = await listRecentlyDecidedRollActions(approverPerson, orgA, { limit: 2 });
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.actions.length).toBeLessThanOrEqual(2);
      expect(result.actions.map((a) => a.id)).not.toContain(bDecided.id);
    });
  });

  describe("countPendingRollActions", () => {
    it("forbidden without either key; counts only pending rows of the viewer's organization", async () => {
      expect(await countPendingRollActions(outsiderPerson, orgA)).toEqual({ kind: "forbidden" });
      const before = await countPendingRollActions(approverPerson, orgA);
      if (before.kind !== "ok") throw new Error("expected ok");
      const a = await mkPending();
      await mkPending({ orgId: orgB });
      const afterOne = await countPendingRollActions(proposerPerson, orgA);
      expect(afterOne).toEqual({ kind: "ok", count: before.count + 1 });
      await denyRollAction(approverPerson, orgA, approverUserId, a.id, { reason: "x" });
      expect(await countPendingRollActions(approverPerson, orgA)).toEqual({ kind: "ok", count: before.count });
    });
  });

  // ---------------------------------------------------------------------
  // getSessionApprovalState (Flow 7, S4)
  // ---------------------------------------------------------------------

  describe("getSessionApprovalState", () => {
    async function seatElder(
      orgId: string,
      personId: string,
      office: string,
      startsOn: string,
    ): Promise<void> {
      const platform = getPlatformDb();
      await platform.execute(sql`
        insert into officer_terms (organization_id, person_id, office, starts_on)
        values (${orgId}::uuid, ${personId}::uuid, ${office}, ${startsOn}::date)
      `);
    }

    it("forbidden without either roll key", async () => {
      expect(await getSessionApprovalState(outsiderPerson, orgA)).toEqual({ kind: "forbidden" });
    });

    it("no_session: an organization with no derived Session group (a presbytery), told to a propose-only holder", async () => {
      const result = await getSessionApprovalState(bProposer, orgB);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.state).toMatchObject({
        kind: "no_session",
        recorded: 0,
        withAccount: 0,
        canApprove: 0,
        viewer: { canApprove: false, canManageOfficers: false },
      });
    });

    it("walks empty -> no_sign_in (seat starts later, then a seat with no account) -> no_permission -> ready, with counts only", async () => {
      const orgC = await mkOrg("c", { session: true });
      const viewer = await mkMemberAt(orgC, "Vera", "Viewer", { withUser: true });
      await mkRoleGrant(orgC, "roll_proposer", ["roll.propose", "officers.manage"], {
        personId: viewer.personId,
      });

      // empty: a Session group with nobody seated.
      let state = await getSessionApprovalState(viewer.personId, orgC);
      if (state.kind !== "ok") throw new Error("expected ok");
      expect(state.state).toMatchObject({
        kind: "empty",
        recorded: 0,
        startingLater: 0,
        nextStart: null,
        viewer: { canApprove: false, canManageOfficers: true },
      });

      // A seat that starts later is "no_sign_in" with the date, not empty.
      const later = await mkMemberAt(orgC, "Lena", "Later", { withUser: true });
      await seatElder(orgC, later.personId, "ruling_elder", "2999-01-01");
      state = await getSessionApprovalState(viewer.personId, orgC);
      if (state.kind !== "ok") throw new Error("expected ok");
      expect(state.state).toMatchObject({
        kind: "no_sign_in",
        recorded: 0,
        startingLater: 1,
        nextStart: "2999-01-01",
      });

      // A seat in effect held by someone with no account: still no_sign_in.
      const noAccount = await mkMemberAt(orgC, "Nora", "NoLogin");
      await seatElder(orgC, noAccount.personId, "ruling_elder", "2020-01-01");
      state = await getSessionApprovalState(viewer.personId, orgC);
      if (state.kind !== "ok") throw new Error("expected ok");
      expect(state.state).toMatchObject({
        kind: "no_sign_in",
        recorded: 1,
        withAccount: 0,
        canApprove: 0,
        startingLater: 1,
      });

      // An installed pastor with an account is a Session seat too (DECISION-206),
      // but nothing grants the Session group roll.approve yet: no_permission.
      const pastor = await mkMemberAt(orgC, "Percival", "Pastor", { withUser: true, engagement: "regular" });
      await seatElder(orgC, pastor.personId, "installed_pastor", "2020-01-01");
      state = await getSessionApprovalState(viewer.personId, orgC);
      if (state.kind !== "ok") throw new Error("expected ok");
      expect(state.state).toMatchObject({
        kind: "no_permission",
        recorded: 2,
        withAccount: 1,
        canApprove: 0,
      });

      // Bind a roll.approve role to the Session group: the pastor can approve.
      await mkRoleGrant(orgC, "session_member", ["roll.approve"], {
        groupId: await sessionGroupId(orgC),
      });
      state = await getSessionApprovalState(viewer.personId, orgC);
      if (state.kind !== "ok") throw new Error("expected ok");
      expect(state.state).toMatchObject({ kind: "ready", recorded: 2, withAccount: 1, canApprove: 1 });
      // Counts only: no names or ids anywhere in the result.
      expect(JSON.stringify(state.state)).not.toMatch(
        /Percival|Nora|NoLogin|Lena|Vera|[0-9a-f]{8}-[0-9a-f]{4}-/,
      );
    });

    it("an ended term is not a seat: a Session whose only term ended is empty", async () => {
      const orgD = await mkOrg("d", { session: true });
      const viewer = await mkMemberAt(orgD, "Dara", "Viewer", { withUser: true });
      await mkRoleGrant(orgD, "roll_proposer", ["roll.propose"], { personId: viewer.personId });
      const platform = getPlatformDb();
      const past = await mkMemberAt(orgD, "Pia", "Past", { withUser: true });
      await platform.execute(sql`
        insert into officer_terms (organization_id, person_id, office, starts_on, ends_on)
        values (${orgD}::uuid, ${past.personId}::uuid, 'ruling_elder', '2015-01-01', '2018-01-01')
      `);
      const result = await getSessionApprovalState(viewer.personId, orgD);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.state).toMatchObject({ kind: "empty", recorded: 0, startingLater: 0 });
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
      const platform = getPlatformDb();
      const kinds = EDIT_TIME_ROLL_ACTION_KINDS.filter(
        (kind) => kind !== "other_participant_enrolled",
      );
      expect(kinds.length).toBeGreaterThan(0);
      // One person per kind: R7 allows a single pending proposal per person.
      for (const kind of kinds) {
        const subject = await mkPerson("Ottilie", "Brackwater", { dob: "1990-01-20" });
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
        const [m] = await platform
          .select({ currentRoll: memberships.currentRoll })
          .from(memberships)
          .where(and(eq(memberships.personId, subject), eq(memberships.organizationId, orgA)));
        expect(m?.currentRoll, kind).toBeNull();
      }
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
      const platform = getPlatformDb();
      // An approved action dated 2026-02-01, inserted by the owner (fixture).
      // One subject per proposal: R7 allows a single pending proposal each.
      async function subjectWithBaptism(first: string): Promise<string> {
        const subject = await mkPerson(first, "Ellsworth");
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
        return subject;
      }
      const shadowed = await recordRollAction(proposerPerson, orgA, proposerUserId2, {
        personId: await subjectWithBaptism("Rowan"),
        kind: "profession_of_faith",
        effectiveDate: "2026-01-15",
      });
      expect(shadowed).toMatchObject({
        kind: "ok",
        effect: "pending",
        shadowedBy: { kind: "baptized_member_enrolled", effectiveDate: "2026-02-01" },
      });
      const same = await recordRollAction(proposerPerson, orgA, proposerUserId2, {
        personId: await subjectWithBaptism("Rhys"),
        kind: "profession_of_faith",
        effectiveDate: "2026-02-01",
      });
      expect(same).toMatchObject({ kind: "ok", shadowedBy: null });
      const later = await recordRollAction(proposerPerson, orgA, proposerUserId2, {
        personId: await subjectWithBaptism("Rosalind"),
        kind: "profession_of_faith",
        effectiveDate: "2026-04-01",
      });
      expect(later).toMatchObject({ kind: "ok", shadowedBy: null });
    });

    // R7 and R15 (docs/work-log/2026-10-22-founding-admin-directory.md,
    // Increment 2): one pending proposal per person, and a membership proposal
    // needs a Session to approve it.
    it("R7: a second proposal for a person who already has one waiting is proposal_refused pending_exists, and writes nothing", async () => {
      const subject = await mkPerson("Dupe", "Proposal", { dob: "1980-01-01" });
      const first = await recordRollAction(proposerPerson, orgA, proposerUserId2, {
        personId: subject,
        kind: "profession_of_faith",
        effectiveDate: "2026-03-03",
      });
      expect(first.kind).toBe("ok");
      for (const kind of ["profession_of_faith", "reaffirmation", "baptized_member_enrolled"] as const) {
        expect(
          await recordRollAction(proposerPerson, orgA, proposerUserId2, {
            personId: subject,
            kind,
            effectiveDate: "2026-03-04",
          }),
          kind,
        ).toEqual({ kind: "proposal_refused", reason: "pending_exists" });
      }
      const platform = getPlatformDb();
      const rows = await platform.select().from(rollActions).where(eq(rollActions.personId, subject));
      expect(rows).toHaveLength(1);
    });

    it("R7: two proposals racing for the same person give exactly one ok and one pending_exists (the unique index is the backstop)", async () => {
      const subject = await mkPerson("Racing", "Proposal");
      const results = await Promise.all([
        recordRollAction(proposerPerson, orgA, proposerUserId2, {
          personId: subject,
          kind: "profession_of_faith",
          effectiveDate: "2026-03-03",
        }),
        recordRollAction(proposerPerson, orgA, proposerUserId2, {
          personId: subject,
          kind: "reaffirmation",
          effectiveDate: "2026-03-03",
        }),
      ]);
      const kinds = results.map((r) =>
        r.kind === "ok" ? "ok" : r.kind === "proposal_refused" ? r.reason : r.kind,
      );
      expect(kinds.sort()).toEqual(["ok", "pending_exists"]);
      const platform = getPlatformDb();
      const rows = await platform.select().from(rollActions).where(eq(rollActions.personId, subject));
      expect(rows).toHaveLength(1);
    });

    it("R15: an organization with no Session refuses a membership proposal (no_session) and writes nothing — but a participant enrolment on record is unaffected", async () => {
      expect(
        await recordRollAction(bProposer, orgB, bProposerUserId, {
          personId: bSubject,
          kind: "profession_of_faith",
          effectiveDate: "2026-03-03",
        }),
      ).toEqual({ kind: "proposal_refused", reason: "no_session" });
      for (const kind of ["reaffirmation", "baptized_member_enrolled", "affiliate_received"] as const) {
        expect(
          await recordRollAction(bProposer, orgB, bProposerUserId, {
            personId: bSubject,
            kind,
            effectiveDate: "2026-03-03",
          }),
          kind,
        ).toEqual({ kind: "proposal_refused", reason: "no_session" });
      }
      const platform = getPlatformDb();
      const none = await platform.select().from(rollActions).where(eq(rollActions.personId, bSubject));
      expect(none).toHaveLength(0);

      const enrolled = await recordRollAction(bProposer, orgB, bProposerUserId, {
        personId: bSubject,
        kind: "other_participant_enrolled",
        effectiveDate: "2026-03-03",
      });
      expect(enrolled).toMatchObject({ kind: "ok", effect: "recorded" });
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
