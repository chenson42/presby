/**
 * Orchestration tests for startOfficerTermAction / endOfficerTermAction.
 *
 * Mocked at the `@/lib/officers` boundary — same principle as
 * `admin/roles/actions.test.ts`: the SQL correctness (the `officers.manage`
 * gate, the F21-shaped membership/org_unit scoping, the exclusion-constraint
 * mapping, the F22 no-upsert/no-delete write path) is already proven by
 * `officers.test.ts` against a real Postgres connection. What this file
 * exists to pin is the CONTRACT this actions.ts layer owns and nothing else
 * does:
 *
 *   1. `organizationId` comes from a FRESH `resolveOrgContext(session.user.id,
 *      slug)` call, never from client-supplied input.
 *   2. `startOfficerTerm`/`endOfficerTerm` receive `identity.personId` (a
 *      `people.id`) for authorization and `identity.userId` (a `users.id`,
 *      from `session.user.id`) for `recorded_by` — never the same value for
 *      both.
 *   3. Every `OfficersResult` kind maps to the correct `ActionResult` shape,
 *      including the `overlap`/`invalid_input` copy this file is responsible
 *      for composing (per Phase 3's API-contract table).
 *   4. `recordAudit()` fires ONLY on `{ kind: "ok" }` — with
 *      `AUDIT_ACTIONS.OFFICER_TERM_STARTED`/`OFFICER_TERM_ENDED` — never on a
 *      denial, and never before the mutation succeeds.
 *   5. `revalidatePath` fires only after a successful mutation.
 *
 * vi.mock() calls are hoisted before imports by Vitest's transform; every
 * mock factory referencing an outer `vi.fn()` uses `vi.hoisted()`.
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
    OFFICER_TERM_STARTED: "tenant.officer_term.started",
    OFFICER_TERM_ENDED: "tenant.officer_term.ended",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const mockStartOfficerTerm = vi.hoisted(() => vi.fn());
const mockEndOfficerTerm = vi.hoisted(() => vi.fn());
vi.mock("@/lib/officers", () => ({
  startOfficerTerm: (...args: unknown[]) => mockStartOfficerTerm(...args),
  endOfficerTerm: (...args: unknown[]) => mockEndOfficerTerm(...args),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endOfficerTermAction, startOfficerTermAction } from "./actions";

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
// Identity resolution — the contract this file owns
// ---------------------------------------------------------------------------

describe("identity resolution — organizationId never comes from client input", () => {
  it("startOfficerTermAction: not signed in returns an error without calling resolveOrgContext", async () => {
    mockAuth.mockResolvedValueOnce(null);

    const result = await startOfficerTermAction("alder-creek", {
      personId: "target-1",
      office: "trustee",
      startsOn: "2026-01-01",
    });

    expect(result).toEqual({
      ok: false,
      error: "You must be signed in to do that.",
    });
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
    expect(mockStartOfficerTerm).not.toHaveBeenCalled();
  });

  it("startOfficerTermAction: calls resolveOrgContext with session.user.id and the slug argument", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockStartOfficerTerm.mockResolvedValueOnce({
      kind: "ok",
      data: { termId: "term-1" },
    });

    await startOfficerTermAction("alder-creek", {
      personId: "target-1",
      office: "trustee",
      startsOn: "2026-01-01",
    });

    expect(mockResolveOrgContext).toHaveBeenCalledWith(
      "user-platform-id-1",
      "alder-creek",
    );
  });

  it("startOfficerTermAction: a non-'ok' resolution returns an error without calling startOfficerTerm", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });

    const result = await startOfficerTermAction("bramblewood", {
      personId: "target-1",
      office: "trustee",
      startsOn: "2026-01-01",
    });

    expect(result).toEqual({
      ok: false,
      error: "You don't have access to that organization.",
    });
    expect(mockStartOfficerTerm).not.toHaveBeenCalled();
  });

  it("startOfficerTermAction: passes resolved personId/organizationId AND session.user.id (users.id) as the separate recorder id", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockStartOfficerTerm.mockResolvedValueOnce({
      kind: "ok",
      data: { termId: "term-1" },
    });

    const input = {
      personId: "target-1",
      office: "trustee" as const,
      startsOn: "2026-01-01",
    };
    await startOfficerTermAction("alder-creek", input);

    // (personId, organizationId, actingUserId, input)
    expect(mockStartOfficerTerm).toHaveBeenCalledWith(
      "person-1", // resolved.org.personId — a people.id
      "org-1", // resolved.org.organizationId
      "user-platform-id-1", // session.user.id — a users.id, NEVER personId
      input,
    );
  });

  it("endOfficerTermAction: passes resolved personId/organizationId to endOfficerTerm", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockEndOfficerTerm.mockResolvedValueOnce({
      kind: "ok",
      data: { termId: "term-1" },
    });

    await endOfficerTermAction("alder-creek", endInput());

    expect(mockEndOfficerTerm).toHaveBeenCalledWith("person-1", "org-1", {
      termId: "term-1",
      endsOn: "2026-06-01",
      endReason: "resigned",
    });
  });
});

// ---------------------------------------------------------------------------
// startOfficerTermAction — result-kind mapping
// ---------------------------------------------------------------------------

describe("startOfficerTermAction — OfficersResult → ActionResult mapping", () => {
  beforeEachStart();

  it("forbidden → ok:false, no audit, no revalidate", async () => {
    mockStartOfficerTerm.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await startOfficerTermAction("alder-creek", startInput());
    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to manage officer terms here.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("invalid_target → names the person/district case, no audit", async () => {
    mockStartOfficerTerm.mockResolvedValueOnce({ kind: "invalid_target" });
    const result = await startOfficerTermAction("alder-creek", startInput());
    expect(result).toEqual({
      ok: false,
      error: "That person or district doesn't belong to this organization.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("invalid_input → surfaces officers.ts's own message verbatim", async () => {
    mockStartOfficerTerm.mockResolvedValueOnce({
      kind: "invalid_input",
      message: "A deacon term needs a district (org unit) selected.",
    });
    const result = await startOfficerTermAction("alder-creek", startInput());
    expect(result).toEqual({
      ok: false,
      error: "A deacon term needs a district (org unit) selected.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("overlap → composes the specific 'already has an open term' copy, no audit", async () => {
    mockStartOfficerTerm.mockResolvedValueOnce({
      kind: "overlap",
      personName: "Saoirse Kalantzis",
      officeLabel: "Treasurer",
    });
    const result = await startOfficerTermAction("alder-creek", startInput());
    expect(result).toEqual({
      ok: false,
      error:
        "Saoirse Kalantzis already has an open term as Treasurer — end it first.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("ok → returns ok:true with termId, records audit with full metadata, revalidates", async () => {
    mockStartOfficerTerm.mockResolvedValueOnce({
      kind: "ok",
      data: { termId: "term-99" },
    });

    const input = {
      personId: "target-1",
      office: "deacon" as const,
      startsOn: "2026-01-01",
      orgUnitId: "unit-1",
    };
    const result = await startOfficerTermAction("alder-creek", input);

    expect(result).toEqual({ ok: true, data: { termId: "term-99" } });
    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.officer_term.started",
      resourceType: "officer_term",
      resourceId: "term-99",
      metadata: {
        organizationId: "org-1",
        personId: "target-1",
        office: "deacon",
        startsOn: "2026-01-01",
        orgUnitId: "unit-1",
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/alder-creek/admin/officers",
    );
  });

  it("ok, no org_unit → metadata.orgUnitId is null, not undefined", async () => {
    mockStartOfficerTerm.mockResolvedValueOnce({
      kind: "ok",
      data: { termId: "term-100" },
    });

    await startOfficerTermAction("alder-creek", startInput());

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ orgUnitId: null }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// endOfficerTermAction — result-kind mapping
// ---------------------------------------------------------------------------

describe("endOfficerTermAction — OfficersResult → ActionResult mapping", () => {
  beforeEachEnd();

  it("forbidden → ok:false, no audit", async () => {
    mockEndOfficerTerm.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await endOfficerTermAction("alder-creek", endInput());
    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to manage officer terms here.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("invalid_target → 'no longer exists', no audit", async () => {
    mockEndOfficerTerm.mockResolvedValueOnce({ kind: "invalid_target" });
    const result = await endOfficerTermAction("alder-creek", endInput());
    expect(result).toEqual({
      ok: false,
      error: "That officer term no longer exists.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("invalid_input → surfaces officers.ts's own message verbatim", async () => {
    mockEndOfficerTerm.mockResolvedValueOnce({
      kind: "invalid_input",
      message: "The end date can't be before the start date.",
    });
    const result = await endOfficerTermAction("alder-creek", endInput());
    expect(result).toEqual({
      ok: false,
      error: "The end date can't be before the start date.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("ok → returns ok:true, records audit with caller-supplied metadata, revalidates", async () => {
    mockEndOfficerTerm.mockResolvedValueOnce({
      kind: "ok",
      data: { termId: "term-1" },
    });
    const input = endInput();

    const result = await endOfficerTermAction("alder-creek", input);

    expect(result).toEqual({ ok: true, data: { termId: "term-1" } });
    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.officer_term.ended",
      resourceType: "officer_term",
      resourceId: input.termId,
      metadata: {
        organizationId: "org-1",
        personId: input.personId,
        office: input.office,
        endsOn: input.endsOn,
        endReason: input.endReason,
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/alder-creek/admin/officers",
    );
  });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function beforeEachStart() {
  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  });
}

function beforeEachEnd() {
  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  });
}

function startInput() {
  return {
    personId: "target-1",
    office: "trustee" as const,
    startsOn: "2026-01-01",
  };
}

function endInput() {
  return {
    termId: "term-1",
    endsOn: "2026-06-01",
    endReason: "resigned",
    personId: "target-1",
    office: "trustee" as const,
  };
}
