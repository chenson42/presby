/**
 * Orchestration tests for fileTicketAction / replyToTicketAction /
 * promoteFeedbackAction / dismissFeedbackAction.
 *
 * Mocked at the `@/lib/tickets` / `@/lib/tickets-notifications` /
 * `@/lib/storage/blob-store` boundary — same principle as
 * `admin/roles/actions.test.ts`: the SQL correctness is already proven by
 * `tickets.test.ts` against a real Postgres connection. What this file
 * exists to pin is the CONTRACT this actions.ts layer owns and nothing else
 * does:
 *
 *   1. `organizationId`/`personId` come from a FRESH
 *      `resolveOrgContext(session.user.id, slug)` call, never from
 *      client-supplied input.
 *   2. Every result kind maps to the correct `ActionResult` shape.
 *   3. `recordAudit()` fires ONLY on `fileTicketAction`/`promoteFeedbackAction`
 *      success — never on a denial, never for reply/dismiss (audit-exempt by
 *      design).
 *   4. The attachment is store()'d BEFORE the query-layer call
 *      (E-c1/E-c2 ordering), and a sniff/store failure never reaches
 *      `fileTicket()`/`replyToTicket()` at all.
 *   5. Notification calls fire on the right result, with the right shape —
 *      `notifyOperatorsOfNewTicket` from BOTH filing and promotion;
 *      `notifySubmitterOfPromotion` skipped (with a warning, not a throw)
 *      when `submitterEmail` is null.
 *   6. `revalidatePath` fires only after a successful mutation.
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
    TICKET_CREATED: "tenant.ticket.created",
    TICKET_FEEDBACK_PROMOTED: "tenant.ticket.feedback_promoted",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const mockFileTicket = vi.hoisted(() => vi.fn());
const mockReplyToTicket = vi.hoisted(() => vi.fn());
const mockPromoteFeedbackToTicket = vi.hoisted(() => vi.fn());
const mockDismissFeedback = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tickets", () => ({
  fileTicket: (...args: unknown[]) => mockFileTicket(...args),
  replyToTicket: (...args: unknown[]) => mockReplyToTicket(...args),
  promoteFeedbackToTicket: (...args: unknown[]) => mockPromoteFeedbackToTicket(...args),
  dismissFeedback: (...args: unknown[]) => mockDismissFeedback(...args),
}));

const mockNotifyOperatorsOfNewTicket = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockNotifyOperatorsOfSubmitterReply = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockNotifySubmitterOfPromotion = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockResolveOperatorByUserId = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tickets-notifications", () => ({
  notifyOperatorsOfNewTicket: (...args: unknown[]) => mockNotifyOperatorsOfNewTicket(...args),
  notifyOperatorsOfSubmitterReply: (...args: unknown[]) =>
    mockNotifyOperatorsOfSubmitterReply(...args),
  notifySubmitterOfPromotion: (...args: unknown[]) => mockNotifySubmitterOfPromotion(...args),
  resolveOperatorByUserId: (...args: unknown[]) => mockResolveOperatorByUserId(...args),
}));

const mockStore = vi.hoisted(() => vi.fn());
const MockBlobValidationError = vi.hoisted(() => class MockBlobValidationError extends Error {});
vi.mock("@/lib/storage/blob-store", () => ({
  getBlobStore: () => ({ store: mockStore }),
  BlobValidationError: MockBlobValidationError,
}));

const mockSniff = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storage/sniff", () => ({
  sniffTicketAttachmentContentType: (...args: unknown[]) => mockSniff(...args),
}));

const mockEnqueueEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/email", () => ({
  enqueueEmail: (...args: unknown[]) => mockEnqueueEmail(...args),
}));
vi.mock("@/lib/email/escape-html", () => ({
  escapeHtml: (s: string) => s,
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

// @/lib/sites — mocked wholesale, same principle as @/lib/tickets below:
// markSiteContactMessageRead's SQL correctness is proven by sites.test.ts
// against a real Postgres connection. Mocking here (rather than letting the
// real module load) also avoids the real module's `import "server-only"`
// (this file has no top-level `vi.mock("server-only", ...)`, unlike
// admin/organizations/[id]/actions.test.ts) and its transitive
// `next/font/google` import path in a plain Node vitest environment.
const mockMarkSiteContactMessageRead = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sites", () => ({
  markSiteContactMessageRead: (...args: unknown[]) =>
    mockMarkSiteContactMessageRead(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fileTicketAction,
  replyToTicketAction,
  promoteFeedbackAction,
  dismissFeedbackAction,
  markSiteContactMessageReadAction,
} from "./actions";

const SESSION = {
  user: {
    id: "user-platform-id-1",
    email: "filer@example.invalid",
    name: "Rosalind Achterberg",
  },
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

function ticketFormData(fields: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("subject", fields.subject ?? "The directory is slow");
  fd.set("changeClass", fields.changeClass ?? "bug");
  fd.set("area", fields.area ?? "directory");
  fd.set("priority", fields.priority ?? "normal");
  fd.set("body", fields.body ?? "It takes ten seconds to search.");
  return fd;
}

beforeEach(() => {
  mockAuth.mockResolvedValue(SESSION);
  mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Identity resolution
// ---------------------------------------------------------------------------

describe("identity resolution — organizationId never comes from client input", () => {
  it("fileTicketAction: not signed in returns an error without calling resolveOrgContext", async () => {
    mockAuth.mockResolvedValueOnce(null);

    const result = await fileTicketAction("alder-creek", ticketFormData());

    expect(result).toEqual({ ok: false, error: "You must be signed in to do that." });
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
    expect(mockFileTicket).not.toHaveBeenCalled();
  });

  it("fileTicketAction: calls resolveOrgContext with session.user.id and the slug argument", async () => {
    mockFileTicket.mockResolvedValueOnce({ kind: "ok", ticketId: "ticket-1" });

    await fileTicketAction("alder-creek", ticketFormData());

    expect(mockResolveOrgContext).toHaveBeenCalledWith("user-platform-id-1", "alder-creek");
  });

  it("fileTicketAction: a non-'ok' resolution returns an error without calling fileTicket", async () => {
    mockResolveOrgContext.mockResolvedValueOnce({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });

    const result = await fileTicketAction("bramblewood", ticketFormData());

    expect(result).toEqual({
      ok: false,
      error: "You don't have access to that organization.",
    });
    expect(mockFileTicket).not.toHaveBeenCalled();
  });

  it("fileTicketAction: passes resolved.org.personId/organizationId to fileTicket, never client-supplied", async () => {
    mockFileTicket.mockResolvedValueOnce({ kind: "ok", ticketId: "ticket-1" });

    await fileTicketAction("alder-creek", ticketFormData());

    expect(mockFileTicket).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      expect.objectContaining({ subject: "The directory is slow" }),
    );
  });
});

// ---------------------------------------------------------------------------
// fileTicketAction
// ---------------------------------------------------------------------------

describe("fileTicketAction", () => {
  it("forbidden → ok:false, no email, no notification, no audit, no revalidate", async () => {
    mockFileTicket.mockResolvedValueOnce({ kind: "forbidden" });

    const result = await fileTicketAction("alder-creek", ticketFormData());

    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to file tickets here.",
    });
    expect(mockEnqueueEmail).not.toHaveBeenCalled();
    expect(mockNotifyOperatorsOfNewTicket).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("invalid_input → joins every error string", async () => {
    mockFileTicket.mockResolvedValueOnce({
      kind: "invalid_input",
      errors: ["Subject is required.", "Choose a valid area."],
    });

    const result = await fileTicketAction("alder-creek", ticketFormData());

    expect(result).toEqual({
      ok: false,
      error: "Subject is required. Choose a valid area.",
    });
  });

  it("no attachment present → never calls store()/sniff", async () => {
    mockFileTicket.mockResolvedValueOnce({ kind: "ok", ticketId: "ticket-1" });

    await fileTicketAction("alder-creek", ticketFormData());

    expect(mockSniff).not.toHaveBeenCalled();
    expect(mockStore).not.toHaveBeenCalled();
  });

  it("an unrecognized attachment type is rejected BEFORE fileTicket() is ever called", async () => {
    mockSniff.mockReturnValueOnce(null);
    const fd = ticketFormData();
    fd.set("attachment", new File([new Uint8Array([1, 2, 3])], "x.exe"));

    const result = await fileTicketAction("alder-creek", fd);

    expect(result).toEqual({
      ok: false,
      error: "That file isn't a PNG, JPEG, WEBP, or PDF we can accept.",
    });
    expect(mockStore).not.toHaveBeenCalled();
    expect(mockFileTicket).not.toHaveBeenCalled();
  });

  it("a valid attachment is store()'d BEFORE fileTicket() runs, and the key is passed through", async () => {
    mockSniff.mockReturnValueOnce("image/png");
    mockStore.mockResolvedValueOnce({ key: "blob-1", contentType: "image/png", byteSize: 10 });
    mockFileTicket.mockResolvedValueOnce({ kind: "ok", ticketId: "ticket-1" });

    const fd = ticketFormData();
    fd.set("attachment", new File([new Uint8Array([137, 80, 78, 71])], "x.png"));

    await fileTicketAction("alder-creek", fd);

    expect(mockStore).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", contentType: "image/png" }),
    );
    expect(mockFileTicket).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      expect.objectContaining({ attachmentKey: "blob-1" }),
    );
  });

  it("ok → sends confirmation email, notifies operators, records audit, revalidates", async () => {
    mockFileTicket.mockResolvedValueOnce({ kind: "ok", ticketId: "ticket-1" });

    const result = await fileTicketAction("alder-creek", ticketFormData());

    expect(result).toEqual({ ok: true, data: { ticketId: "ticket-1" } });

    expect(mockEnqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "filer@example.invalid", templateKey: "ticket_filed_confirmation" }),
    );
    expect(mockNotifyOperatorsOfNewTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "ticket-1",
        slug: "alder-creek",
        organizationName: "Alder Creek Presbyterian Church",
        submitterName: "Rosalind Achterberg",
      }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.ticket.created",
      resourceType: "ticket",
      resourceId: "ticket-1",
      metadata: {
        organizationId: "org-1",
        changeClass: "bug",
        area: "directory",
        priority: "normal",
        subject: "The directory is slow",
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/tickets");
  });
});

// ---------------------------------------------------------------------------
// replyToTicketAction
// ---------------------------------------------------------------------------

describe("replyToTicketAction", () => {
  function replyFormData(body = "Following up."): FormData {
    const fd = new FormData();
    fd.set("body", body);
    return fd;
  }

  it("forbidden → ok:false, no notification", async () => {
    mockReplyToTicket.mockResolvedValueOnce({ kind: "forbidden" });

    const result = await replyToTicketAction("alder-creek", "ticket-1", replyFormData());

    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to reply to tickets here.",
    });
    expect(mockNotifyOperatorsOfSubmitterReply).not.toHaveBeenCalled();
  });

  it("not_found → ok:false", async () => {
    mockReplyToTicket.mockResolvedValueOnce({ kind: "not_found" });

    const result = await replyToTicketAction("alder-creek", "ticket-1", replyFormData());

    expect(result).toEqual({ ok: false, error: "That ticket no longer exists." });
  });

  it("ok, no assignee → notifies the pool (assignee: null), never audits, revalidates the thread", async () => {
    mockReplyToTicket.mockResolvedValueOnce({
      kind: "ok",
      messageId: "msg-1",
      ticketSubject: "The directory is slow",
      assigneeUserId: null,
    });

    const result = await replyToTicketAction("alder-creek", "ticket-1", replyFormData());

    expect(result).toEqual({ ok: true, data: { messageId: "msg-1" } });
    expect(mockResolveOperatorByUserId).not.toHaveBeenCalled();
    expect(mockNotifyOperatorsOfSubmitterReply).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: "ticket-1", assignee: null }),
    );
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/tickets/ticket-1");
  });

  it("ok, WITH an assignee → resolves the operator and passes them through", async () => {
    mockReplyToTicket.mockResolvedValueOnce({
      kind: "ok",
      messageId: "msg-2",
      ticketSubject: "The directory is slow",
      assigneeUserId: "operator-1",
    });
    mockResolveOperatorByUserId.mockResolvedValueOnce({
      userId: "operator-1",
      email: "ops@example.invalid",
      name: "Ops Person",
    });

    await replyToTicketAction("alder-creek", "ticket-1", replyFormData());

    expect(mockResolveOperatorByUserId).toHaveBeenCalledWith("operator-1");
    expect(mockNotifyOperatorsOfSubmitterReply).toHaveBeenCalledWith(
      expect.objectContaining({
        assignee: { userId: "operator-1", email: "ops@example.invalid", name: "Ops Person" },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// promoteFeedbackAction
// ---------------------------------------------------------------------------

describe("promoteFeedbackAction", () => {
  const PROMOTE_INPUT = {
    subject: "Giving page 404s",
    changeClass: "bug" as const,
    area: "giving" as const,
    priority: "high" as const,
  };

  it("forbidden → ok:false, no notify, no audit", async () => {
    mockPromoteFeedbackToTicket.mockResolvedValueOnce({ kind: "forbidden" });

    const result = await promoteFeedbackAction("alder-creek", "feedback-1", PROMOTE_INPUT);

    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to promote feedback here.",
    });
    expect(mockNotifySubmitterOfPromotion).not.toHaveBeenCalled();
    expect(mockNotifyOperatorsOfNewTicket).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("already_handled → ok:false", async () => {
    mockPromoteFeedbackToTicket.mockResolvedValueOnce({ kind: "already_handled" });

    const result = await promoteFeedbackAction("alder-creek", "feedback-1", PROMOTE_INPUT);

    expect(result).toEqual({ ok: false, error: "That feedback has already been handled." });
  });

  it("ok with a submitterEmail → notifies the original submitter AND the operator pool, records audit", async () => {
    mockPromoteFeedbackToTicket.mockResolvedValueOnce({
      kind: "ok",
      ticketId: "ticket-9",
      submitterEmail: "member@example.invalid",
      submitterName: "Ines Okwuosa",
    });

    const result = await promoteFeedbackAction("alder-creek", "feedback-1", PROMOTE_INPUT);

    expect(result).toEqual({ ok: true, data: { ticketId: "ticket-9" } });
    expect(mockNotifySubmitterOfPromotion).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "ticket-9",
        submitterEmail: "member@example.invalid",
        submitterName: "Ines Okwuosa",
      }),
    );
    expect(mockNotifyOperatorsOfNewTicket).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: "ticket-9", submitterName: "Ines Okwuosa" }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.ticket.feedback_promoted",
      resourceType: "ticket",
      resourceId: "ticket-9",
      metadata: {
        organizationId: "org-1",
        feedbackId: "feedback-1",
        changeClass: "bug",
        area: "giving",
        priority: "high",
        subject: "Giving page 404s",
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/tickets");
  });

  it("ok with a NULL submitterEmail → skips the submitter notification but still notifies operators and records audit", async () => {
    mockPromoteFeedbackToTicket.mockResolvedValueOnce({
      kind: "ok",
      ticketId: "ticket-10",
      submitterEmail: null,
      submitterName: "A member with no linked login",
    });

    const result = await promoteFeedbackAction("alder-creek", "feedback-2", PROMOTE_INPUT);

    expect(result.ok).toBe(true);
    expect(mockNotifySubmitterOfPromotion).not.toHaveBeenCalled();
    expect(mockNotifyOperatorsOfNewTicket).toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// dismissFeedbackAction
// ---------------------------------------------------------------------------

describe("dismissFeedbackAction", () => {
  it("forbidden → ok:false, no audit", async () => {
    mockDismissFeedback.mockResolvedValueOnce({ kind: "forbidden" });

    const result = await dismissFeedbackAction("alder-creek", "feedback-1");

    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to dismiss feedback here.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("ok → revalidates, never audits (routine triage disposition)", async () => {
    mockDismissFeedback.mockResolvedValueOnce({ kind: "ok" });

    const result = await dismissFeedbackAction("alder-creek", "feedback-1");

    expect(result).toEqual({ ok: true });
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/tickets");
  });
});

// ---------------------------------------------------------------------------
// markSiteContactMessageReadAction (DECISION-089,
// docs/work-log/2026-08-20-public-sites.md Phase 3)
// ---------------------------------------------------------------------------

describe("markSiteContactMessageReadAction", () => {
  it("not signed in returns an error without calling markSiteContactMessageRead", async () => {
    mockAuth.mockResolvedValueOnce(null);

    const result = await markSiteContactMessageReadAction("alder-creek", "message-1");

    expect(result).toEqual({ ok: false, error: "You must be signed in to do that." });
    expect(mockMarkSiteContactMessageRead).not.toHaveBeenCalled();
  });

  it("passes the resolved personId/organizationId and the messageId argument through", async () => {
    mockMarkSiteContactMessageRead.mockResolvedValueOnce({ kind: "ok" });

    await markSiteContactMessageReadAction("alder-creek", "message-1");

    expect(mockMarkSiteContactMessageRead).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "message-1",
    );
  });

  it("forbidden → ok:false, no audit", async () => {
    mockMarkSiteContactMessageRead.mockResolvedValueOnce({ kind: "forbidden" });

    const result = await markSiteContactMessageReadAction("alder-creek", "message-1");

    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to manage site messages here.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("not_found → ok:false, no audit", async () => {
    mockMarkSiteContactMessageRead.mockResolvedValueOnce({ kind: "not_found" });

    const result = await markSiteContactMessageReadAction("alder-creek", "message-1");

    expect(result).toEqual({ ok: false, error: "That message no longer exists." });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("ok → revalidates, never audits (routine triage disposition, DECISION-089)", async () => {
    mockMarkSiteContactMessageRead.mockResolvedValueOnce({ kind: "ok" });

    const result = await markSiteContactMessageReadAction("alder-creek", "message-1");

    expect(result).toEqual({ ok: true });
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/tickets");
  });
});
