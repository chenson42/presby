/**
 * Orchestration tests for the credentials `actions.ts` server actions.
 *
 * Mocked at the `@/lib/credentials` boundary — same principle as
 * `../officers/actions.test.ts`: the SQL correctness (the `credentials
 * .manage` gate, the F21-shaped membership scoping, the parent-path check,
 * the open-appointment collision guard) is already proven by
 * `src/lib/credentials.test.ts` against a real Postgres connection. What
 * this file exists to pin is the CONTRACT this actions.ts layer owns and
 * nothing else does:
 *
 *   1. `organizationId` comes from a FRESH `resolveOrgContext(session.user
 *      .id, slug)` call, never from client-supplied input.
 *   2. Every `CredentialsResult` kind maps to the correct `ActionResult`
 *      shape.
 *   3. `recordAudit()` fires ONLY on `{ kind: "ok" }` — with the correct
 *      `AUDIT_ACTIONS` key for each action — never on a denial.
 *   4. `changeOrdinationStatusAction` fires `ORDINATION_STATUS_CHANGED` for
 *      BOTH a routine status change AND a `status: "removed"` submission
 *      (the "End ordination" UI control) — proving both UI entry points
 *      really do share this one action/audit key, per
 *      `src/lib/credentials.ts`'s header.
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
    ORDINATION_RECORDED: "tenant.ordination.recorded",
    ORDINATION_STATUS_CHANGED: "tenant.ordination.status_changed",
    APPOINTMENT_RECORDED: "tenant.appointment.recorded",
    APPOINTMENT_ENDED: "tenant.appointment.ended",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const mockRecordOrdination = vi.hoisted(() => vi.fn());
const mockChangeOrdinationStatus = vi.hoisted(() => vi.fn());
const mockRecordAppointment = vi.hoisted(() => vi.fn());
const mockEndAppointment = vi.hoisted(() => vi.fn());
vi.mock("@/lib/credentials", () => ({
  recordOrdination: (...args: unknown[]) => mockRecordOrdination(...args),
  changeOrdinationStatus: (...args: unknown[]) =>
    mockChangeOrdinationStatus(...args),
  recordAppointment: (...args: unknown[]) => mockRecordAppointment(...args),
  endAppointment: (...args: unknown[]) => mockEndAppointment(...args),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  changeOrdinationStatusAction,
  endAppointmentAction,
  recordAppointmentAction,
  recordOrdinationAction,
} from "./actions";

const SESSION = {
  user: { id: "user-platform-id-1", email: "clerk@example.invalid" },
};

const RESOLVED_OK = {
  kind: "ok" as const,
  org: {
    organizationId: "org-1",
    personId: "person-1",
    name: "Presbytery of the Northern Reach",
    organizationType: "presbytery" as const,
    slug: "northern-reach",
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
  it("recordOrdinationAction: not signed in returns an error without calling resolveOrgContext", async () => {
    mockAuth.mockResolvedValueOnce(null);

    const result = await recordOrdinationAction("northern-reach", {
      personId: "target-1",
      ministry: "ruling_elder",
      ordainedOn: "2026-01-01",
    });

    expect(result).toEqual({
      ok: false,
      error: "You must be signed in to do that.",
    });
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
    expect(mockRecordOrdination).not.toHaveBeenCalled();
  });

  it("recordOrdinationAction: calls resolveOrgContext with session.user.id and the slug argument", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockRecordOrdination.mockResolvedValueOnce({
      kind: "ok",
      data: { ordinationId: "ord-1" },
    });

    await recordOrdinationAction("northern-reach", {
      personId: "target-1",
      ministry: "ruling_elder",
      ordainedOn: "2026-01-01",
    });

    expect(mockResolveOrgContext).toHaveBeenCalledWith(
      "user-platform-id-1",
      "northern-reach",
    );
  });

  it("recordOrdinationAction: a non-'ok' resolution returns an error without calling recordOrdination", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce({
      kind: "forbidden",
      name: "Some Other Presbytery",
      organizationType: "presbytery",
    });

    const result = await recordOrdinationAction("other-presbytery", {
      personId: "target-1",
      ministry: "ruling_elder",
      ordainedOn: "2026-01-01",
    });

    expect(result).toEqual({
      ok: false,
      error: "You don't have access to that organization.",
    });
    expect(mockRecordOrdination).not.toHaveBeenCalled();
  });

  it("recordAppointmentAction: passes resolved personId/organizationId AND session.user.id (users.id) as actingUserId", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockRecordAppointment.mockResolvedValueOnce({
      kind: "ok",
      data: { appointmentId: "appt-1" },
    });

    const input = {
      personId: "target-1",
      servingOrgId: "cong-1",
      callType: "installed_pastor" as const,
      startsOn: "2026-01-01",
    };
    await recordAppointmentAction("northern-reach", input);

    expect(mockRecordAppointment).toHaveBeenCalledWith(
      "person-1", // resolved.org.personId — a people.id
      "org-1", // resolved.org.organizationId
      "user-platform-id-1", // session.user.id — a users.id
      input,
    );
  });
});

// ---------------------------------------------------------------------------
// recordOrdinationAction — result-kind mapping
// ---------------------------------------------------------------------------

describe("recordOrdinationAction — CredentialsResult -> ActionResult mapping", () => {
  beforeEachAuthOk();

  it("forbidden -> ok:false, no audit, no revalidate", async () => {
    mockRecordOrdination.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await recordOrdinationAction("northern-reach", ordinationInput());
    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to manage ministry credentials here.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("invalid_target -> names the membership requirement, no audit", async () => {
    mockRecordOrdination.mockResolvedValueOnce({ kind: "invalid_target" });
    const result = await recordOrdinationAction("northern-reach", ordinationInput());
    expect(result).toEqual({
      ok: false,
      error:
        "That person doesn't hold a current membership at this organization.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("invalid_input -> surfaces credentials.ts's own message verbatim", async () => {
    mockRecordOrdination.mockResolvedValueOnce({
      kind: "invalid_input",
      message: "Minute reference must be 500 characters or fewer.",
    });
    const result = await recordOrdinationAction("northern-reach", ordinationInput());
    expect(result).toEqual({
      ok: false,
      error: "Minute reference must be 500 characters or fewer.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("ok -> returns ok:true, records ORDINATION_RECORDED with full metadata, revalidates", async () => {
    mockRecordOrdination.mockResolvedValueOnce({
      kind: "ok",
      data: { ordinationId: "ord-99" },
    });

    const input = ordinationInput();
    const result = await recordOrdinationAction("northern-reach", input);

    expect(result).toEqual({ ok: true, data: { ordinationId: "ord-99" } });
    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.ordination.recorded",
      resourceType: "ordination",
      resourceId: "ord-99",
      metadata: {
        organizationId: "org-1",
        personId: input.personId,
        ministry: input.ministry,
        ordainedOn: input.ordainedOn,
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/northern-reach/admin/credentials",
    );
  });
});

// ---------------------------------------------------------------------------
// changeOrdinationStatusAction — shared by "Change status" AND
// "End ordination" (status: "removed")
// ---------------------------------------------------------------------------

describe("changeOrdinationStatusAction — CredentialsResult -> ActionResult mapping", () => {
  beforeEachAuthOk();

  it("forbidden -> ok:false, no audit", async () => {
    mockChangeOrdinationStatus.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await changeOrdinationStatusAction(
      "northern-reach",
      statusInput("honorably_retired"),
    );
    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to manage ministry credentials here.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("invalid_target -> 'no longer exists', no audit", async () => {
    mockChangeOrdinationStatus.mockResolvedValueOnce({ kind: "invalid_target" });
    const result = await changeOrdinationStatusAction(
      "northern-reach",
      statusInput("on_leave"),
    );
    expect(result).toEqual({
      ok: false,
      error: "That ordination record no longer exists.",
    });
  });

  it("a routine status change fires ORDINATION_STATUS_CHANGED with that status in metadata", async () => {
    mockChangeOrdinationStatus.mockResolvedValueOnce({
      kind: "ok",
      data: { ordinationId: "ord-1" },
    });

    const result = await changeOrdinationStatusAction(
      "northern-reach",
      statusInput("honorably_retired"),
    );

    expect(result).toEqual({ ok: true, data: { ordinationId: "ord-1" } });
    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.ordination.status_changed",
      resourceType: "ordination",
      resourceId: "ord-1",
      metadata: {
        organizationId: "org-1",
        personId: "target-1",
        ordinationId: "ord-1",
        status: "honorably_retired",
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/northern-reach/admin/credentials",
    );
  });

  it("the End-ordination submission (status: 'removed') fires the SAME ORDINATION_STATUS_CHANGED key, metadata.status = 'removed'", async () => {
    mockChangeOrdinationStatus.mockResolvedValueOnce({
      kind: "ok",
      data: { ordinationId: "ord-1" },
    });

    await changeOrdinationStatusAction("northern-reach", statusInput("removed"));

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tenant.ordination.status_changed",
        metadata: expect.objectContaining({ status: "removed" }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// recordAppointmentAction — result-kind mapping
// ---------------------------------------------------------------------------

describe("recordAppointmentAction — CredentialsResult -> ActionResult mapping", () => {
  beforeEachAuthOk();

  it("forbidden -> ok:false, no audit", async () => {
    mockRecordAppointment.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await recordAppointmentAction(
      "northern-reach",
      appointmentInput(),
    );
    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to manage ministry credentials here.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("invalid_target -> names the parent-path failure generically, no audit", async () => {
    mockRecordAppointment.mockResolvedValueOnce({ kind: "invalid_target" });
    const result = await recordAppointmentAction(
      "northern-reach",
      appointmentInput(),
    );
    expect(result).toEqual({
      ok: false,
      error: "That person or congregation doesn't belong to this presbytery.",
    });
  });

  it("invalid_input -> surfaces credentials.ts's own collision message verbatim", async () => {
    mockRecordAppointment.mockResolvedValueOnce({
      kind: "invalid_input",
      message: "Wilhelmina Osei-Fairweather already has an open appointment at Alder Creek — end it first.",
    });
    const result = await recordAppointmentAction(
      "northern-reach",
      appointmentInput(),
    );
    expect(result).toEqual({
      ok: false,
      error:
        "Wilhelmina Osei-Fairweather already has an open appointment at Alder Creek — end it first.",
    });
  });

  it("ok -> returns ok:true, records APPOINTMENT_RECORDED with full metadata, revalidates", async () => {
    mockRecordAppointment.mockResolvedValueOnce({
      kind: "ok",
      data: { appointmentId: "appt-99" },
    });

    const input = appointmentInput();
    const result = await recordAppointmentAction("northern-reach", input);

    expect(result).toEqual({ ok: true, data: { appointmentId: "appt-99" } });
    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.appointment.recorded",
      resourceType: "appointment",
      resourceId: "appt-99",
      metadata: {
        organizationId: "org-1",
        personId: input.personId,
        servingOrgId: input.servingOrgId,
        callType: input.callType,
        startsOn: input.startsOn,
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/northern-reach/admin/credentials",
    );
  });
});

// ---------------------------------------------------------------------------
// endAppointmentAction — result-kind mapping
// ---------------------------------------------------------------------------

describe("endAppointmentAction — CredentialsResult -> ActionResult mapping", () => {
  beforeEachAuthOk();

  it("forbidden -> ok:false, no audit", async () => {
    mockEndAppointment.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await endAppointmentAction("northern-reach", endInput());
    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to manage ministry credentials here.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("invalid_target -> 'no longer exists', no audit", async () => {
    mockEndAppointment.mockResolvedValueOnce({ kind: "invalid_target" });
    const result = await endAppointmentAction("northern-reach", endInput());
    expect(result).toEqual({
      ok: false,
      error: "That appointment record no longer exists.",
    });
  });

  it("ok -> returns ok:true, records APPOINTMENT_ENDED with caller-supplied metadata, revalidates", async () => {
    mockEndAppointment.mockResolvedValueOnce({
      kind: "ok",
      data: { appointmentId: "appt-1" },
    });
    const input = endInput();

    const result = await endAppointmentAction("northern-reach", input);

    expect(result).toEqual({ ok: true, data: { appointmentId: "appt-1" } });
    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.appointment.ended",
      resourceType: "appointment",
      resourceId: input.appointmentId,
      metadata: {
        organizationId: "org-1",
        appointmentId: input.appointmentId,
        personId: input.personId,
        servingOrgId: input.servingOrgId,
        endsOn: input.endsOn,
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/northern-reach/admin/credentials",
    );
  });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function beforeEachAuthOk() {
  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  });
}

function ordinationInput() {
  return {
    personId: "target-1",
    ministry: "ruling_elder" as const,
    ordainedOn: "2026-01-01",
  };
}

function statusInput(status: "honorably_retired" | "on_leave" | "removed") {
  return {
    ordinationId: "ord-1",
    personId: "target-1",
    status,
  };
}

function appointmentInput() {
  return {
    personId: "target-1",
    servingOrgId: "cong-1",
    callType: "installed_pastor" as const,
    startsOn: "2026-01-01",
  };
}

function endInput() {
  return {
    appointmentId: "appt-1",
    endsOn: "2026-06-01",
    endReason: "resigned",
    personId: "target-1",
    servingOrgId: "cong-1",
  };
}
