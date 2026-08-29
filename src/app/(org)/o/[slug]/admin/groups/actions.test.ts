/**
 * Orchestration tests for createGroupAction / updateGroupAction /
 * addGroupMemberAction / endGroupMembershipAction.
 *
 * Mocked at the `@/lib/groups` boundary — same principle as
 * `admin/officers/actions.test.ts`: the SQL correctness (the
 * `groups.manage` gate, the F21-shaped membership scoping, the
 * manageable-group-type re-validation, the app-level overlap check, the
 * derived-group guards) is already proven by `groups.test.ts` against a real
 * Postgres connection. What this file pins is the CONTRACT this actions.ts
 * layer owns and nothing else does:
 *
 *   1. `organizationId` comes from a FRESH `resolveOrgContext(session.user.id,
 *      slug)` call, never from client-supplied input.
 *   2. Every `GroupsResult` kind maps to the correct `ActionResult` shape,
 *      including the `overlap`/`invalid_input`/`invalid_target` copy this
 *      file composes (per Phase 3's API-contract table).
 *   3. `recordAudit()` fires ONLY on `{ kind: "ok" }`, with the correct
 *      `AUDIT_ACTIONS` key and metadata shape — never on a denial.
 *   4. `revalidatePath` fires only after a successful mutation.
 */

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    GROUP_CREATED: "tenant.group.created",
    GROUP_UPDATED: "tenant.group.updated",
    GROUP_MEMBER_ADDED: "tenant.group_membership.added",
    GROUP_MEMBER_ENDED: "tenant.group_membership.ended",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const mockCreateGroup = vi.hoisted(() => vi.fn());
const mockUpdateGroup = vi.hoisted(() => vi.fn());
const mockAddGroupMember = vi.hoisted(() => vi.fn());
const mockEndGroupMembership = vi.hoisted(() => vi.fn());
const mockSetGroupMembershipPublicListed = vi.hoisted(() => vi.fn());
const mockSetGroupMembershipPublicDisplayOrder = vi.hoisted(() => vi.fn());
vi.mock("@/lib/groups", () => ({
  createGroup: (...args: unknown[]) => mockCreateGroup(...args),
  updateGroup: (...args: unknown[]) => mockUpdateGroup(...args),
  addGroupMember: (...args: unknown[]) => mockAddGroupMember(...args),
  endGroupMembership: (...args: unknown[]) => mockEndGroupMembership(...args),
  setGroupMembershipPublicListed: (...args: unknown[]) =>
    mockSetGroupMembershipPublicListed(...args),
  setGroupMembershipPublicDisplayOrder: (...args: unknown[]) =>
    mockSetGroupMembershipPublicDisplayOrder(...args),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addGroupMemberAction,
  createGroupAction,
  endGroupMembershipAction,
  setGroupMembershipPublicDisplayOrderAction,
  setGroupMembershipPublicListedAction,
  updateGroupAction,
} from "./actions";

const SESSION = {
  user: { id: "user-platform-id-1", email: "clerk@example.invalid" },
};

const RESOLVED_OK = {
  kind: "ok" as const,
  org: {
    organizationId: "org-1",
    personId: "person-1",
    name: "Alder Creek Presbyterian Church",
    organizationType: "congregation" as const,
    slug: "alder-creek",
    platformStatus: "managed" as const,
  },
};

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Identity resolution
// ---------------------------------------------------------------------------

describe("identity resolution — organizationId never comes from client input", () => {
  it("createGroupAction: not signed in returns an error without calling resolveOrgContext", async () => {
    mockAuth.mockResolvedValueOnce(null);

    const result = await createGroupAction("alder-creek", {
      groupTypeId: "type-1",
      name: "Property Committee",
    });

    expect(result).toEqual({
      ok: false,
      error: "You must be signed in to do that.",
    });
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
    expect(mockCreateGroup).not.toHaveBeenCalled();
  });

  it("createGroupAction: calls resolveOrgContext with session.user.id and the slug argument", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockCreateGroup.mockResolvedValueOnce({ kind: "ok", data: { groupId: "g-1" } });

    await createGroupAction("alder-creek", {
      groupTypeId: "type-1",
      name: "Property Committee",
    });

    expect(mockResolveOrgContext).toHaveBeenCalledWith(
      "user-platform-id-1",
      "alder-creek",
    );
  });

  it("createGroupAction: a non-'ok' resolution returns an error without calling createGroup", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });

    const result = await createGroupAction("bramblewood", {
      groupTypeId: "type-1",
      name: "Property Committee",
    });

    expect(result).toEqual({
      ok: false,
      error: "You don't have access to that organization.",
    });
    expect(mockCreateGroup).not.toHaveBeenCalled();
  });

  it("createGroupAction: passes resolved personId/organizationId to createGroup", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockCreateGroup.mockResolvedValueOnce({ kind: "ok", data: { groupId: "g-1" } });

    const input = { groupTypeId: "type-1", name: "Property Committee" };
    await createGroupAction("alder-creek", input);

    expect(mockCreateGroup).toHaveBeenCalledWith("person-1", "org-1", input);
  });
});

// ---------------------------------------------------------------------------
// createGroupAction — result-kind mapping
// ---------------------------------------------------------------------------

describe("createGroupAction — GroupsResult → ActionResult mapping", () => {
  beforeEachAuth();

  it("forbidden → ok:false, no audit, no revalidate", async () => {
    mockCreateGroup.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await createGroupAction("alder-creek", createInput());
    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to manage groups here.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("invalid_input → surfaces groups.ts's own message verbatim", async () => {
    mockCreateGroup.mockResolvedValueOnce({
      kind: "invalid_input",
      message: "Choose a valid group type — committee, small group, choir, or team.",
    });
    const result = await createGroupAction("alder-creek", createInput());
    expect(result).toEqual({
      ok: false,
      error: "Choose a valid group type — committee, small group, choir, or team.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("ok → returns ok:true with groupId, records audit, revalidates", async () => {
    mockCreateGroup.mockResolvedValueOnce({
      kind: "ok",
      data: { groupId: "g-99" },
    });

    const input = { groupTypeId: "type-1", name: "Property Committee" };
    const result = await createGroupAction("alder-creek", input);

    expect(result).toEqual({ ok: true, data: { groupId: "g-99" } });
    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.group.created",
      resourceType: "group",
      resourceId: "g-99",
      metadata: {
        organizationId: "org-1",
        groupTypeId: "type-1",
        name: "Property Committee",
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/admin/groups");
  });
});

// ---------------------------------------------------------------------------
// updateGroupAction — result-kind mapping
// ---------------------------------------------------------------------------

describe("updateGroupAction — GroupsResult → ActionResult mapping", () => {
  beforeEachAuth();

  it("forbidden → ok:false, no audit", async () => {
    mockUpdateGroup.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await updateGroupAction("alder-creek", updateInput());
    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to manage groups here.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("invalid_target → the derived-group/nonexistent copy, no audit — the load-bearing Flow 2 guard", async () => {
    mockUpdateGroup.mockResolvedValueOnce({ kind: "invalid_target" });
    const result = await updateGroupAction("alder-creek", updateInput());
    expect(result).toEqual({
      ok: false,
      error: "That group doesn't exist, or can't be edited directly.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("invalid_input → surfaces groups.ts's own message verbatim", async () => {
    mockUpdateGroup.mockResolvedValueOnce({
      kind: "invalid_input",
      message: "Name is required.",
    });
    const result = await updateGroupAction("alder-creek", updateInput());
    expect(result).toEqual({ ok: false, error: "Name is required." });
  });

  it("ok → returns ok:true, records audit, revalidates both list and detail paths", async () => {
    mockUpdateGroup.mockResolvedValueOnce({
      kind: "ok",
      data: { groupId: "g-1" },
    });

    const input = updateInput();
    const result = await updateGroupAction("alder-creek", input);

    expect(result).toEqual({ ok: true, data: { groupId: "g-1" } });
    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.group.updated",
      resourceType: "group",
      resourceId: "g-1",
      metadata: { organizationId: "org-1", groupId: "g-1", name: input.name },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/admin/groups");
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/alder-creek/admin/groups/g-1",
    );
  });
});

// ---------------------------------------------------------------------------
// addGroupMemberAction — result-kind mapping
// ---------------------------------------------------------------------------

describe("addGroupMemberAction — GroupsResult → ActionResult mapping", () => {
  beforeEachAuth();

  it("forbidden → ok:false, no audit", async () => {
    mockAddGroupMember.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await addGroupMemberAction("alder-creek", memberInput());
    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to manage groups here.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("invalid_target → names the group/person case", async () => {
    mockAddGroupMember.mockResolvedValueOnce({ kind: "invalid_target" });
    const result = await addGroupMemberAction("alder-creek", memberInput());
    expect(result).toEqual({
      ok: false,
      error: "That group or person doesn't belong to this organization.",
    });
  });

  it("overlap → composes the 'already an active member' copy, naming both, no audit", async () => {
    mockAddGroupMember.mockResolvedValueOnce({
      kind: "overlap",
      personName: "Marisol Dvorak-Achebe",
      groupName: "Property Committee",
    });
    const result = await addGroupMemberAction("alder-creek", memberInput());
    expect(result).toEqual({
      ok: false,
      error: "Marisol Dvorak-Achebe is already an active member of Property Committee.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("ok → returns ok:true, records audit with full metadata, revalidates the detail path", async () => {
    mockAddGroupMember.mockResolvedValueOnce({
      kind: "ok",
      data: { groupMembershipId: "gm-1" },
    });

    const input = memberInput();
    const result = await addGroupMemberAction("alder-creek", input);

    expect(result).toEqual({ ok: true, data: { groupMembershipId: "gm-1" } });
    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.group_membership.added",
      resourceType: "group_membership",
      resourceId: "gm-1",
      metadata: {
        organizationId: "org-1",
        groupId: input.groupId,
        personId: input.personId,
        groupRole: input.groupRole,
        startsOn: input.startsOn,
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/o/alder-creek/admin/groups/${input.groupId}`,
    );
  });
});

// ---------------------------------------------------------------------------
// endGroupMembershipAction — result-kind mapping
// ---------------------------------------------------------------------------

describe("endGroupMembershipAction — GroupsResult → ActionResult mapping", () => {
  beforeEachAuth();

  it("forbidden → ok:false, no audit", async () => {
    mockEndGroupMembership.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await endGroupMembershipAction("alder-creek", endInput());
    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to manage groups here.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("invalid_target → 'no longer exists' — the load-bearing Flow 4 guard covers both missing and derived rows", async () => {
    mockEndGroupMembership.mockResolvedValueOnce({ kind: "invalid_target" });
    const result = await endGroupMembershipAction("alder-creek", endInput());
    expect(result).toEqual({
      ok: false,
      error: "That group membership no longer exists.",
    });
  });

  it("ok → returns ok:true, records audit with caller-supplied metadata, revalidates the detail path", async () => {
    mockEndGroupMembership.mockResolvedValueOnce({
      kind: "ok",
      data: { groupMembershipId: "gm-1" },
    });
    const input = endInput();

    const result = await endGroupMembershipAction("alder-creek", input);

    expect(result).toEqual({ ok: true, data: { groupMembershipId: "gm-1" } });
    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.group_membership.ended",
      resourceType: "group_membership",
      resourceId: "gm-1",
      metadata: {
        organizationId: "org-1",
        groupId: input.groupId,
        personId: input.personId,
        groupName: input.groupName,
        endsOn: input.endsOn,
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/o/alder-creek/admin/groups/${input.groupId}`,
    );
  });
});

// ---------------------------------------------------------------------------
// setGroupMembershipPublicListedAction — GroupsResult → ActionResult mapping
// (docs/work-log/2026-08-28-public-directory-primitives.md, Phase 3)
// ---------------------------------------------------------------------------

describe("setGroupMembershipPublicListedAction — GroupsResult → ActionResult mapping", () => {
  beforeEachAuth();

  function publicListedInput() {
    return { groupMembershipId: "gm-1", publicListed: true, groupId: "g-1" };
  }

  it("passes resolved personId/organizationId AND session.user.id as actingUserId", async () => {
    mockSetGroupMembershipPublicListed.mockResolvedValueOnce({
      kind: "ok",
      data: { groupMembershipId: "gm-1", publicListed: true },
    });

    await setGroupMembershipPublicListedAction("alder-creek", publicListedInput());

    expect(mockSetGroupMembershipPublicListed).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "user-platform-id-1",
      { groupMembershipId: "gm-1", publicListed: true },
    );
  });

  it("forbidden → ok:false, no audit, no revalidate", async () => {
    mockSetGroupMembershipPublicListed.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await setGroupMembershipPublicListedAction(
      "alder-creek",
      publicListedInput(),
    );
    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to manage groups here.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("invalid_target → 'no longer exists' — covers both missing and derived-group rows", async () => {
    mockSetGroupMembershipPublicListed.mockResolvedValueOnce({
      kind: "invalid_target",
    });
    const result = await setGroupMembershipPublicListedAction(
      "alder-creek",
      publicListedInput(),
    );
    expect(result).toEqual({
      ok: false,
      error: "That group membership no longer exists.",
    });
  });

  it("ok → returns ok:true, revalidates the detail path, and calls recordAudit ZERO times from this action", async () => {
    mockSetGroupMembershipPublicListed.mockResolvedValueOnce({
      kind: "ok",
      data: { groupMembershipId: "gm-1", publicListed: true },
    });

    const input = publicListedInput();
    const result = await setGroupMembershipPublicListedAction("alder-creek", input);

    expect(result).toEqual({
      ok: true,
      data: { groupMembershipId: "gm-1", publicListed: true },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/o/alder-creek/admin/groups/${input.groupId}`,
    );
    // Not "no audit fired at all" — setGroupMembershipPublicListed() itself
    // fires it, per its own doc comment. This asserts the DIVERGENCE from
    // createGroupAction/updateGroupAction/addGroupMemberAction/
    // endGroupMembershipAction's own recordAudit() call sites above: THIS
    // action calls no recordAudit() of its own.
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setGroupMembershipPublicDisplayOrderAction — GroupsResult → ActionResult
// mapping (docs/work-log/2026-08-28-public-directory-primitives.md, Phase 3)
// ---------------------------------------------------------------------------

describe("setGroupMembershipPublicDisplayOrderAction — GroupsResult → ActionResult mapping", () => {
  beforeEachAuth();

  function displayOrderInput() {
    return { groupMembershipId: "gm-1", publicDisplayOrder: 2, groupId: "g-1" };
  }

  it("passes resolved personId/organizationId (no actingUserId — this mutation takes none)", async () => {
    mockSetGroupMembershipPublicDisplayOrder.mockResolvedValueOnce({
      kind: "ok",
      data: { groupMembershipId: "gm-1", publicDisplayOrder: 2 },
    });

    await setGroupMembershipPublicDisplayOrderAction(
      "alder-creek",
      displayOrderInput(),
    );

    expect(mockSetGroupMembershipPublicDisplayOrder).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      { groupMembershipId: "gm-1", publicDisplayOrder: 2 },
    );
  });

  it("forbidden → ok:false, no audit, no revalidate", async () => {
    mockSetGroupMembershipPublicDisplayOrder.mockResolvedValueOnce({
      kind: "forbidden",
    });
    const result = await setGroupMembershipPublicDisplayOrderAction(
      "alder-creek",
      displayOrderInput(),
    );
    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to manage groups here.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("invalid_target → 'no longer exists'", async () => {
    mockSetGroupMembershipPublicDisplayOrder.mockResolvedValueOnce({
      kind: "invalid_target",
    });
    const result = await setGroupMembershipPublicDisplayOrderAction(
      "alder-creek",
      displayOrderInput(),
    );
    expect(result).toEqual({
      ok: false,
      error: "That group membership no longer exists.",
    });
  });

  it("invalid_input → surfaces groups.ts's own message verbatim", async () => {
    mockSetGroupMembershipPublicDisplayOrder.mockResolvedValueOnce({
      kind: "invalid_input",
      message: "Display order must be a whole number from 0 to 2147483647, or left blank.",
    });
    const result = await setGroupMembershipPublicDisplayOrderAction(
      "alder-creek",
      displayOrderInput(),
    );
    expect(result).toEqual({
      ok: false,
      error: "Display order must be a whole number from 0 to 2147483647, or left blank.",
    });
  });

  it("ok → returns ok:true, revalidates the detail path, and never calls recordAudit", async () => {
    mockSetGroupMembershipPublicDisplayOrder.mockResolvedValueOnce({
      kind: "ok",
      data: { groupMembershipId: "gm-1", publicDisplayOrder: 2 },
    });

    const input = displayOrderInput();
    const result = await setGroupMembershipPublicDisplayOrderAction(
      "alder-creek",
      input,
    );

    expect(result).toEqual({
      ok: true,
      data: { groupMembershipId: "gm-1", publicDisplayOrder: 2 },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/o/alder-creek/admin/groups/${input.groupId}`,
    );
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function beforeEachAuth() {
  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  });
}

function createInput() {
  return { groupTypeId: "type-1", name: "Property Committee" };
}

function updateInput() {
  return { groupId: "g-1", name: "Renamed Committee" };
}

function memberInput() {
  return {
    groupId: "g-1",
    personId: "target-1",
    groupRole: "member" as const,
    startsOn: "2026-01-01",
  };
}

function endInput() {
  return {
    groupMembershipId: "gm-1",
    endsOn: "2026-06-01",
    personId: "target-1",
    groupId: "g-1",
    groupName: "Property Committee",
  };
}
