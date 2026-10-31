/**
 * `acceptInvitation` and `acceptInvitationInPlace` with the database mocked
 * (Community Increment 2b, Batch B2, T-9; R45, edge cases E-16, E-17, E-18,
 * E-29, F196's TypeScript half). What this file pins is what the TypeScript
 * decides; the SQL it calls is proven in `accept-in-place.db.test.ts` and
 * `designation-parity-in-place.db.test.ts`, and the audit rows against a real
 * database in `accept-in-place.lib.db.test.ts`.
 *
 *   - the in-place path asks the definer for exactly the user, the invitation
 *     and the factor flag it was handed, and a malformed id never reaches the
 *     database;
 *   - both presentations write through the SAME audit writer: an in-place row
 *     carries `via: "in_place"` and `secondFactor`, and the token path's rows
 *     are UNCHANGED byte for byte (no `via`, no `secondFactor`);
 *   - purpose routing is explicit: a sign_in acceptance writes
 *     `invitation.accepted` and NO `org.*.designated` row; an unknown purpose
 *     throws (which rolls the acceptance back) and surfaces as db_error;
 *   - `needs_second_factor` changes nothing and writes nothing;
 *   - a blocked acceptance carries its purpose and the congregation's name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const h = vi.hoisted(() => ({
  execute: vi.fn(),
  dbExecute: vi.fn(),
  insertAuditRow: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    transaction: (fn: (tx: unknown) => Promise<unknown>) => h.transaction(fn),
    execute: (q: unknown) => h.dbExecute(q),
  },
}));
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return { ...actual, insertAuditRow: h.insertAuditRow };
});
vi.mock("bcryptjs", () => ({ hash: vi.fn(async () => "hashed") }));

const { acceptInvitation, acceptInvitationInPlace, ACCEPT_OUTCOMES } = await import("./accept");

const INVITATION = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const PERSON = "44444444-4444-4444-8444-444444444444";
const INVITER = "55555555-5555-4555-8555-555555555555";
const TOKEN = "t".repeat(43);
const tx = { execute: h.execute };

function acceptedRow(over: Record<string, unknown> = {}) {
  return {
    outcome: "accepted",
    blocked_reason: null,
    invitation_id: INVITATION,
    organization_id: ORG,
    organization_slug: "quillhaven-fellowship",
    purpose: "sign_in",
    mode: "existing_account",
    user_id: USER,
    person_id: PERSON,
    person_mode: "existing_person",
    created_by_user_id: INVITER,
    inviter_is_invitee: false,
    administration_role_key: null,
    office_role_key: null,
    permission_keys: null,
    treasurer_role_id: null,
    ...over,
  };
}

function definerReturns(row: Record<string, unknown> | undefined) {
  h.execute.mockImplementation(async () => ({ rows: row ? [row] : [] }));
}

const queryOf = (call: number) => new PgDialect().sqlToQuery(h.execute.mock.calls[call]![0]);
const auditActions = () => h.insertAuditRow.mock.calls.map((c) => (c[1] as { action: string }).action);
const auditRow = (action: string) =>
  (h.insertAuditRow.mock.calls.find((c) => (c[1] as { action: string }).action === action)![1] as {
    metadata: Record<string, unknown>;
    actor: { userId: string; email: string | null } | null;
  });

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  h.execute.mockReset();
  h.dbExecute.mockReset();
  h.insertAuditRow.mockReset();
  h.transaction.mockReset();
  h.transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
  h.dbExecute.mockResolvedValue({ rows: [{ name: "Quillhaven Fellowship" }] });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe("acceptInvitationInPlace: the call", () => {
  it("asks presby_accept_in_place for exactly the invitation, the user and the factor it was handed", async () => {
    definerReturns({ outcome: "dead" });
    await acceptInvitationInPlace({ invitationId: INVITATION, userId: USER, email: null, secondFactorVerified: true });
    const q = queryOf(0);
    expect(q.sql).toMatch(/presby_accept_in_place/);
    expect(q.params).toEqual([INVITATION, USER, true]);
  });

  it("the factor flag is the boolean true or false, never a truthy string", async () => {
    definerReturns({ outcome: "dead" });
    await acceptInvitationInPlace({ invitationId: INVITATION, userId: USER, email: null, secondFactorVerified: "true" as unknown as boolean });
    expect(queryOf(0).params).toEqual([INVITATION, USER, false]);
  });

  it("a malformed invitation id or user id is the dead bucket with no round trip", async () => {
    for (const bad of [{ invitationId: "nope", userId: USER }, { invitationId: INVITATION, userId: "" }, { invitationId: "", userId: "" }]) {
      expect(await acceptInvitationInPlace({ ...bad, email: null, secondFactorVerified: false })).toEqual({ kind: "dead" });
    }
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("dead, account_exists-style token outcomes and needs_second_factor map to their results and write no audit row", async () => {
    for (const [outcome, expected] of [
      ["dead", { kind: "dead" }],
      ["needs_second_factor", { kind: "needs_second_factor" }],
      ["account_inactive", { kind: "account_inactive" }],
      ["email_mismatch", { kind: "email_mismatch" }],
    ] as const) {
      h.execute.mockReset();
      definerReturns({ outcome });
      expect(await acceptInvitationInPlace({ invitationId: INVITATION, userId: USER, email: null, secondFactorVerified: false })).toEqual(expected);
    }
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it("an outcome this code does not know fails closed: the transaction throws and the caller gets db_error", async () => {
    definerReturns({ outcome: "teleported" });
    expect(await acceptInvitationInPlace({ invitationId: INVITATION, userId: USER, email: null, secondFactorVerified: true })).toEqual({ kind: "db_error" });
    expect(errorSpy).toHaveBeenCalledWith("[invitations] accept in place failed:", expect.any(String));
  });

  it("the token wrapper can never return needs_second_factor: if it did, the acceptance would roll back", async () => {
    definerReturns({ outcome: "needs_second_factor" });
    const result = await acceptInvitation({ token: TOKEN, mode: { kind: "existing_account", userId: USER, email: null } });
    expect(result).toEqual({ kind: "db_error" });
  });

  it("the outcome vocabulary is the one the code handles (pinned to the migration's literals in the SQL tests)", () => {
    expect([...ACCEPT_OUTCOMES].sort()).toEqual(
      ["accepted", "account_exists", "account_inactive", "blocked", "dead", "email_mismatch", "needs_second_factor"].sort(),
    );
  });
});

describe("one audit writer for both presentations (E-18, E-29)", () => {
  it("an in-place sign_in acceptance writes ONE row, invitation.accepted, with via and secondFactor, and no designation row", async () => {
    definerReturns(acceptedRow());
    const result = await acceptInvitationInPlace({ invitationId: INVITATION, userId: USER, email: "w@example.invalid", secondFactorVerified: false });
    expect(result).toEqual({ kind: "accepted", mode: "existing_account", organizationSlug: "quillhaven-fellowship" });
    expect(auditActions()).toEqual(["invitation.accepted"]);
    const row = auditRow("invitation.accepted");
    expect(row.actor).toEqual({ userId: USER, email: "w@example.invalid" });
    expect(row.metadata).toEqual({
      invitationId: INVITATION,
      organizationId: ORG,
      purpose: "sign_in",
      personId: PERSON,
      mode: "existing_account",
      invitedByUserId: INVITER,
      inviterIsInvitee: false,
      via: "in_place",
      secondFactor: false,
    });
  });

  it("the token path's sign_in row is the same row WITHOUT via or secondFactor (unchanged byte for byte)", async () => {
    definerReturns(acceptedRow());
    await acceptInvitation({ token: TOKEN, mode: { kind: "existing_account", userId: USER, email: "w@example.invalid" } });
    expect(auditRow("invitation.accepted").metadata).toEqual({
      invitationId: INVITATION,
      organizationId: ORG,
      purpose: "sign_in",
      personId: PERSON,
      mode: "existing_account",
      invitedByUserId: INVITER,
      inviterIsInvitee: false,
    });
    expect(Object.keys(auditRow("invitation.accepted").metadata)).not.toContain("via");
  });

  it("an in-place founding administrator writes invitation.accepted AND org.founding_administrator.designated, both carrying via and secondFactor true", async () => {
    definerReturns(
      acceptedRow({
        purpose: "founding_administrator",
        person_mode: "existing_person",
        administration_role_key: "church_administrator",
        office_role_key: null,
        permission_keys: ["people.manage"],
      }),
    );
    await acceptInvitationInPlace({ invitationId: INVITATION, userId: USER, email: null, secondFactorVerified: true });
    expect(auditActions()).toEqual(["invitation.accepted", "org.founding_administrator.designated"]);
    expect(auditRow("invitation.accepted").metadata).toMatchObject({ via: "in_place", secondFactor: true });
    expect(auditRow("org.founding_administrator.designated").metadata).toMatchObject({
      organizationId: ORG,
      personId: PERSON,
      userId: USER,
      administrationRoleKey: "church_administrator",
      permissionKeys: ["people.manage"],
      priorHolderCount: 0,
      viaInvitationId: INVITATION,
      via: "in_place",
      secondFactor: true,
    });
  });

  it("an in-place treasurer writes invitation.accepted AND org.treasurer.designated with via and secondFactor", async () => {
    definerReturns(acceptedRow({ purpose: "treasurer", treasurer_role_id: "66666666-6666-4666-8666-666666666666", permission_keys: ["giving.manage"] }));
    await acceptInvitationInPlace({ invitationId: INVITATION, userId: USER, email: null, secondFactorVerified: true });
    expect(auditActions()).toEqual(["invitation.accepted", "org.treasurer.designated"]);
    expect(auditRow("org.treasurer.designated").metadata).toMatchObject({
      roleId: "66666666-6666-4666-8666-666666666666",
      permissionKeys: ["giving.manage"],
      viaInvitationId: INVITATION,
      via: "in_place",
      secondFactor: true,
    });
  });

  it("the token path's designation rows have no via and no secondFactor (the parity golden's TypeScript half)", async () => {
    definerReturns(acceptedRow({ purpose: "treasurer", treasurer_role_id: "66666666-6666-4666-8666-666666666666", permission_keys: [] }));
    await acceptInvitation({ token: TOKEN, mode: { kind: "existing_account", userId: USER, email: null } });
    const keys = Object.keys(auditRow("org.treasurer.designated").metadata).sort();
    expect(keys).toEqual(["inviterIsInvitee", "invitedByUserId", "organizationId", "permissionKeys", "personId", "roleId", "viaInvitationId"].sort());
  });

  it("a new account (token path only) also writes user.created_via_invitation; a sign_in acceptance writes no designation row", async () => {
    definerReturns(acceptedRow({ mode: "new_account", purpose: "sign_in" }));
    const result = await acceptInvitation({
      token: TOKEN,
      mode: { kind: "new_account", firstName: "Wendeline", lastName: "Ashgrove", password: "a long enough password" },
    });
    expect(result).toMatchObject({ kind: "accepted", mode: "new_account" });
    expect(auditActions()).toEqual(["invitation.accepted", "user.created_via_invitation"]);
    expect(auditActions().some((a) => a.startsWith("org."))).toBe(false);
  });

  it("an unknown purpose throws, so the acceptance rolls back and the caller gets db_error (F196's TypeScript half)", async () => {
    definerReturns(acceptedRow({ purpose: "mystery" }));
    expect(await acceptInvitationInPlace({ invitationId: INVITATION, userId: USER, email: null, secondFactorVerified: true })).toEqual({ kind: "db_error" });
  });

  it("a FAILED audit insert fails the acceptance (the audit shares the transaction)", async () => {
    definerReturns(acceptedRow());
    h.insertAuditRow.mockRejectedValue(new Error("audit insert failed (test-injected)"));
    expect(await acceptInvitationInPlace({ invitationId: INVITATION, userId: USER, email: null, secondFactorVerified: true })).toEqual({ kind: "db_error" });
  });

  it("no audit row contains an address, a name or a token", async () => {
    definerReturns(acceptedRow({ purpose: "founding_administrator", administration_role_key: "church_administrator", permission_keys: [] }));
    await acceptInvitationInPlace({ invitationId: INVITATION, userId: USER, email: "w@example.invalid", secondFactorVerified: true });
    for (const call of h.insertAuditRow.mock.calls) {
      expect(JSON.stringify((call[1] as { metadata: unknown }).metadata)).not.toMatch(/@/);
    }
  });
});

describe("a blocked acceptance", () => {
  const blockedRow = (purpose: string) => ({
    outcome: "blocked",
    blocked_reason: "membership_ended",
    invitation_id: INVITATION,
    organization_id: ORG,
    organization_slug: "quillhaven-fellowship",
    purpose,
    user_id: USER,
  });

  it("carries its purpose and the congregation's public name, read AFTER the transaction on its own statement", async () => {
    definerReturns(blockedRow("sign_in"));
    const result = await acceptInvitationInPlace({ invitationId: INVITATION, userId: USER, email: null, secondFactorVerified: false });
    expect(result).toEqual({
      kind: "blocked",
      reason: "membership_ended",
      purpose: "sign_in",
      organizationName: "Quillhaven Fellowship",
    });
    // The name was read outside the transaction (a failure inside one would abort it).
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.dbExecute).toHaveBeenCalledTimes(1);
    expect(auditActions()).toEqual(["invitation.accept_blocked"]);
    expect(auditRow("invitation.accept_blocked").metadata).toEqual({
      invitationId: INVITATION,
      organizationId: ORG,
      purpose: "sign_in",
      reason: "membership_ended",
    });
  });

  it("a failure reading the name never loses the blocked outcome", async () => {
    definerReturns(blockedRow("treasurer"));
    h.dbExecute.mockRejectedValue(new Error("boom"));
    const result = await acceptInvitationInPlace({ invitationId: INVITATION, userId: USER, email: null, secondFactorVerified: true });
    expect(result).toEqual({ kind: "blocked", reason: "membership_ended", purpose: "treasurer", organizationName: null });
  });
});
