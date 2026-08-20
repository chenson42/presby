/**
 * Orchestration tests for the `/admin/tickets` triage Server Actions.
 *
 * Mocked at the `@/lib/db` (`getPlatformDb()`), `@/lib/tickets-notifications`,
 * and `@/lib/storage/blob-store` boundaries — this file pins the CONTRACT
 * this actions.ts layer owns:
 *
 *   1. Every action gates on `FEATURES.ADMIN_TICKETS` FIRST, via `auth()` —
 *      never signed in, never missing the feature, reaches a DB call.
 *   2. `getPlatformDb()` is the connection used throughout — NOT the plain
 *      `db` export (the file's own header explains why: `tickets` is FORCE
 *      RLS, `feedback` isn't). This file cannot assert "which connection"
 *      directly (both are just functions), but it CAN assert that the
 *      `getPlatformDb` mock — and nothing importing plain `db` — is what's
 *      exercised, by never mocking `@/lib/db`'s `db` export at all: if the
 *      action under test imported and called the plain `db` export instead,
 *      the query would run against a real, unmocked module import and this
 *      suite would throw on module resolution or hang on a live connection
 *      attempt, not silently pass.
 *   3. `updateTicketStatusAction`'s state machine matches
 *      `admin/feedback/actions.ts`'s shape, extended by one state
 *      (`in_progress`).
 *   4. Each triage mutation writes its own `ticket_actions` row with the
 *      correct `action`/`fromValue`/`toValue`/`actorUserId` — no
 *      `recordAudit()` call anywhere in this file (routine triage is
 *      audit-exempt by design; this file imports no `@/lib/audit` mock
 *      because the module under test imports no `@/lib/audit` at all).
 *   5. `notifySubmitterOfResolution` fires ONLY for `resolved`/`declined`,
 *      and only when a `submitterEmail` is present.
 */

// This file's actions.ts imports the REAL `@/lib/tickets` module (for its
// CHANGE_CLASSES/TICKET_AREAS/TICKET_PRIORITIES validation constants, not
// mocked) — that module (and `@/lib/authz`, which it imports) is marked
// `import "server-only"`, which throws outside a real server context.
// Same neutralization role-grants.test.ts's own header documents.
vi.mock("server-only", () => ({}));

const ticketRowRef = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

const dbMock = vi.hoisted(() => {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  const insertValues = vi.fn(() => {
    const p = Promise.resolve(undefined) as Promise<undefined> & {
      returning: (...args: unknown[]) => Promise<Array<{ id: string }>>;
    };
    p.returning = vi.fn(() => Promise.resolve([{ id: "msg-1" }]));
    return p;
  });
  const insert = vi.fn(() => ({ values: insertValues }));

  const selectChain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  } as Record<string, ReturnType<typeof vi.fn>>;
  selectChain.from.mockReturnValue(selectChain);
  selectChain.innerJoin.mockReturnValue(selectChain);
  selectChain.leftJoin.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  selectChain.limit.mockImplementation(() =>
    Promise.resolve(ticketRowRef.current ? [ticketRowRef.current] : []),
  );
  const select = vi.fn(() => selectChain);

  const transaction = vi.fn(async (fn: (tx: { update: typeof update; insert: typeof insert }) => unknown) =>
    fn({ update, insert }),
  );

  const platformDb = { select, transaction, insert, update };

  return {
    select,
    selectChain,
    update,
    updateSet,
    updateWhere,
    insert,
    insertValues,
    transaction,
    getPlatformDb: vi.fn(() => platformDb),
  };
});
// `@/lib/db/schema.ts` and `@/lib/db/domain/org.ts` import each other
// circularly (org.ts needs `users` from schema.ts; schema.ts re-exports every
// domain/*.ts, including org.ts, via `export * from "./domain"`). Loading
// `@/lib/db` for real always resolves this safely because its own
// `import * as schema from "./schema"` makes schema.ts the entry point. Fully
// REPLACING `@/lib/db` (rather than that natural entry) makes whichever
// domain/*.ts this file imports first (here, `@/lib/db/domain/org`, for the
// `organizations` join) the new entry instead — which hits the SAME
// circularity from the other direction and fails
// (`organizationType is not a function`, a `pgEnum` from org.ts that
// authz.ts needs but org.ts hasn't finished exporting yet at that point in
// the cycle). Forcing schema.ts to load first, before returning the mock,
// re-establishes the same safe order production always has.
vi.mock("@/lib/db", async () => {
  await import("@/lib/db/schema");
  return { getPlatformDb: dbMock.getPlatformDb };
});

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockGetTicketOperatorPool = vi.hoisted(() => vi.fn());
const mockResolveOperatorByUserId = vi.hoisted(() => vi.fn());
const mockNotifySubmitterOfOperatorReply = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockNotifySubmitterOfResolution = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/tickets-notifications", () => ({
  getTicketOperatorPool: (...args: unknown[]) => mockGetTicketOperatorPool(...args),
  resolveOperatorByUserId: (...args: unknown[]) => mockResolveOperatorByUserId(...args),
  notifySubmitterOfOperatorReply: (...args: unknown[]) =>
    mockNotifySubmitterOfOperatorReply(...args),
  notifySubmitterOfResolution: (...args: unknown[]) => mockNotifySubmitterOfResolution(...args),
}));

const mockResolveMeta = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storage/blob-store", () => ({
  getBlobStore: () => ({ resolveMeta: mockResolveMeta }),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  updateTicketStatusAction,
  assignTicketAction,
  reclassifyTicketAction,
  setTicketAreaAction,
  setTicketPriorityAction,
  replyToTicketAsOperatorAction,
} from "./actions";

const OPERATOR_SESSION = {
  user: {
    id: "operator-1",
    email: "ops@example.invalid",
    name: "Ops Person",
    features: ["admin.tickets"],
  },
};

const BASE_TICKET_ROW = {
  id: "ticket-1",
  organizationId: "org-1",
  slug: "alder-creek",
  subject: "The directory search is slow",
  status: "new",
  changeClass: "bug",
  area: "directory",
  priority: "normal",
  submitterEmail: "member@example.invalid",
  submitterFirstName: "Ines",
  submitterLastName: "Okwuosa",
  submitterPreferredName: null,
};

beforeEach(() => {
  mockAuth.mockResolvedValue(OPERATOR_SESSION);
  ticketRowRef.current = { ...BASE_TICKET_ROW };
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Gate: FEATURES.ADMIN_TICKETS
// ---------------------------------------------------------------------------

describe("permission gate — every action checks auth() + FEATURES.ADMIN_TICKETS first", () => {
  it("updateTicketStatusAction: not signed in never touches the database", async () => {
    mockAuth.mockResolvedValueOnce(null);

    const result = await updateTicketStatusAction("ticket-1", "triaged");

    expect(result).toEqual({ ok: false, error: "Not signed in." });
    expect(dbMock.getPlatformDb).not.toHaveBeenCalled();
  });

  it("updateTicketStatusAction: signed in but missing FEATURES.ADMIN_TICKETS is forbidden", async () => {
    mockAuth.mockResolvedValueOnce({
      user: { id: "user-1", email: "x@example.invalid", features: [] },
    });

    const result = await updateTicketStatusAction("ticket-1", "triaged");

    expect(result).toEqual({ ok: false, error: "Forbidden." });
    expect(dbMock.getPlatformDb).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateTicketStatusAction — the state machine
// ---------------------------------------------------------------------------

describe("updateTicketStatusAction", () => {
  it("ticket not found → error, no DB write", async () => {
    ticketRowRef.current = null;

    const result = await updateTicketStatusAction("nope", "triaged");

    expect(result).toEqual({ ok: false, error: "Ticket not found." });
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("an illegal transition is rejected, naming both statuses, with no DB write", async () => {
    ticketRowRef.current = { ...BASE_TICKET_ROW, status: "resolved" };

    const result = await updateTicketStatusAction("ticket-1", "triaged");

    expect(result).toEqual({
      ok: false,
      error: "Cannot change status from 'resolved' to 'triaged'.",
    });
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("new → triaged: writes status + a status_changed ticket_actions row, no resolution email", async () => {
    const result = await updateTicketStatusAction("ticket-1", "triaged");

    expect(result).toEqual({ ok: true });
    expect(dbMock.updateSet).toHaveBeenCalledWith({ status: "triaged" });
    expect(dbMock.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "status_changed",
        fromValue: "new",
        toValue: "triaged",
        actorUserId: "operator-1",
      }),
    );
    expect(mockNotifySubmitterOfResolution).not.toHaveBeenCalled();
    expect(dbMock.transaction).toHaveBeenCalled();
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/tickets/ticket-1");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/tickets");
  });

  it("in_progress → resolved: sends notifySubmitterOfResolution when submitterEmail is present", async () => {
    ticketRowRef.current = { ...BASE_TICKET_ROW, status: "in_progress" };

    const result = await updateTicketStatusAction("ticket-1", "resolved");

    expect(result).toEqual({ ok: true });
    expect(mockNotifySubmitterOfResolution).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "ticket-1",
        slug: "alder-creek",
        submitterEmail: "member@example.invalid",
        status: "resolved",
      }),
    );
  });

  it("in_progress → declined: also sends notifySubmitterOfResolution (both terminal states)", async () => {
    ticketRowRef.current = { ...BASE_TICKET_ROW, status: "in_progress" };

    await updateTicketStatusAction("ticket-1", "declined");

    expect(mockNotifySubmitterOfResolution).toHaveBeenCalledWith(
      expect.objectContaining({ status: "declined" }),
    );
  });

  it("no submitterEmail → resolution email is skipped without error", async () => {
    ticketRowRef.current = { ...BASE_TICKET_ROW, status: "in_progress", submitterEmail: null };

    const result = await updateTicketStatusAction("ticket-1", "resolved");

    expect(result).toEqual({ ok: true });
    expect(mockNotifySubmitterOfResolution).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// assignTicketAction
// ---------------------------------------------------------------------------

describe("assignTicketAction", () => {
  it("assigns to a valid operator: writes assigneeUserId and an 'assigned' action row with the operator's email as toValue", async () => {
    mockResolveOperatorByUserId.mockResolvedValueOnce({
      userId: "operator-2",
      email: "second-ops@example.invalid",
      name: "Second Ops",
    });

    const result = await assignTicketAction("ticket-1", "operator-2");

    expect(result).toEqual({ ok: true });
    expect(dbMock.updateSet).toHaveBeenCalledWith({ assigneeUserId: "operator-2" });
    expect(dbMock.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "assigned",
        toValue: "second-ops@example.invalid",
        actorUserId: "operator-1",
      }),
    );
  });

  it("rejects an assignee who doesn't hold FEATURES.ADMIN_TICKETS, with no DB write", async () => {
    mockResolveOperatorByUserId.mockResolvedValueOnce(null);

    const result = await assignTicketAction("ticket-1", "not-an-operator");

    expect(result).toEqual({
      ok: false,
      error: "That person doesn't hold access to tickets.",
    });
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("un-assigns (null) without calling resolveOperatorByUserId", async () => {
    const result = await assignTicketAction("ticket-1", null);

    expect(result).toEqual({ ok: true });
    expect(mockResolveOperatorByUserId).not.toHaveBeenCalled();
    expect(dbMock.updateSet).toHaveBeenCalledWith({ assigneeUserId: null });
    expect(dbMock.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ action: "assigned", toValue: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// reclassifyTicketAction / setTicketAreaAction / setTicketPriorityAction
// ---------------------------------------------------------------------------

describe("reclassifyTicketAction / setTicketAreaAction / setTicketPriorityAction", () => {
  it("reclassifyTicketAction: rejects an unrecognized category before touching the database", async () => {
    const result = await reclassifyTicketAction("ticket-1", "not-a-real-class" as never);

    expect(result).toEqual({ ok: false, error: "Choose a valid category." });
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("reclassifyTicketAction: writes change_class + a reclassified action row", async () => {
    const result = await reclassifyTicketAction("ticket-1", "feature");

    expect(result).toEqual({ ok: true });
    expect(dbMock.updateSet).toHaveBeenCalledWith({ changeClass: "feature" });
    expect(dbMock.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reclassified", fromValue: "bug", toValue: "feature" }),
    );
  });

  it("setTicketAreaAction: rejects an unrecognized area", async () => {
    const result = await setTicketAreaAction("ticket-1", "not-an-area" as never);
    expect(result).toEqual({ ok: false, error: "Choose a valid area." });
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("setTicketAreaAction: writes area + an area_changed action row", async () => {
    const result = await setTicketAreaAction("ticket-1", "giving");

    expect(result).toEqual({ ok: true });
    expect(dbMock.updateSet).toHaveBeenCalledWith({ area: "giving" });
    expect(dbMock.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ action: "area_changed", fromValue: "directory", toValue: "giving" }),
    );
  });

  it("setTicketPriorityAction: rejects an unrecognized priority", async () => {
    const result = await setTicketPriorityAction("ticket-1", "critical" as never);
    expect(result).toEqual({ ok: false, error: "Choose a valid priority." });
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("setTicketPriorityAction: writes priority + a priority_changed action row", async () => {
    const result = await setTicketPriorityAction("ticket-1", "urgent");

    expect(result).toEqual({ ok: true });
    expect(dbMock.updateSet).toHaveBeenCalledWith({ priority: "urgent" });
    expect(dbMock.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ action: "priority_changed", fromValue: "normal", toValue: "urgent" }),
    );
  });
});

// ---------------------------------------------------------------------------
// replyToTicketAsOperatorAction
// ---------------------------------------------------------------------------

describe("replyToTicketAsOperatorAction", () => {
  it("rejects an empty reply without touching the database", async () => {
    const result = await replyToTicketAsOperatorAction("ticket-1", "   ");
    expect(result).toEqual({ ok: false, error: "Reply can't be empty." });
    expect(dbMock.getPlatformDb).not.toHaveBeenCalled();
  });

  it("inserts an operator ticket_messages row (no ticket_actions row — a reply isn't a state transition) and notifies the submitter", async () => {
    const result = await replyToTicketAsOperatorAction("ticket-1", "Looking into this now.");

    expect(result).toEqual({ ok: true, data: { messageId: "msg-1" } });
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
    expect(dbMock.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        authorKind: "operator",
        authorUserId: "operator-1",
        body: "Looking into this now.",
      }),
    );
    expect(mockNotifySubmitterOfOperatorReply).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "ticket-1",
        submitterEmail: "member@example.invalid",
        operatorName: "Ops Person",
      }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/tickets/ticket-1");
  });

  it("validates a supplied attachmentKey via resolveMeta() before inserting", async () => {
    mockResolveMeta.mockResolvedValueOnce(null);

    const result = await replyToTicketAsOperatorAction("ticket-1", "See attached.", "bad-key");

    expect(result).toEqual({
      ok: false,
      error: "That attachment couldn't be attached — try uploading it again.",
    });
    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});
