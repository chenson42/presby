// @vitest-environment jsdom
/**
 * Orchestration tests for `/admin/tickets/<id>`'s page.tsx. Mocked at the
 * `@/lib/db` (`getPlatformDb()`), `@/lib/tickets-notifications`, and
 * `@/lib/storage/blob-store` boundaries — same shape
 * `(admin)/tickets/actions.test.ts`'s own header documents.
 *
 * Three sequential `.select()` calls happen in this page (ticket row via
 * `.limit(1)`, message rows via `.orderBy()`, action-timeline rows via a
 * second `.orderBy()`) — the mock below distinguishes them by call order,
 * not by inspecting the query builder's arguments.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));

const ticketRowRef = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const messageRowsRef = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));
const actionRowsRef = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));
const orderByCallCount = vi.hoisted(() => ({ current: 0 }));

const dbMock = vi.hoisted(() => {
  function makeChain() {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      leftJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
      orderBy: vi.fn(),
    };
    chain.from.mockReturnValue(chain);
    chain.innerJoin.mockReturnValue(chain);
    chain.leftJoin.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.limit.mockImplementation(() =>
      Promise.resolve(ticketRowRef.current ? [ticketRowRef.current] : []),
    );
    chain.orderBy.mockImplementation(() => {
      orderByCallCount.current += 1;
      return Promise.resolve(
        orderByCallCount.current === 1 ? messageRowsRef.current : actionRowsRef.current,
      );
    });
    return chain;
  }
  const select = vi.fn(() => makeChain());
  const platformDb = { select };
  return { select, getPlatformDb: vi.fn(() => platformDb) };
});

vi.mock("@/lib/db", async () => {
  await import("@/lib/db/schema");
  return { getPlatformDb: dbMock.getPlatformDb };
});

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockGetTicketOperatorPool = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock("@/lib/tickets-notifications", () => ({
  getTicketOperatorPool: (...args: unknown[]) => mockGetTicketOperatorPool(...args),
}));

const mockResolveMeta = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock("@/lib/storage/blob-store", () => ({
  getBlobStore: () => ({ resolveMeta: mockResolveMeta }),
}));

vi.mock("./actions", () => ({
  updateTicketStatusAction: vi.fn(),
  assignTicketAction: vi.fn(),
  reclassifyTicketAction: vi.fn(),
  setTicketAreaAction: vi.fn(),
  setTicketPriorityAction: vi.fn(),
  replyToTicketAsOperatorAction: vi.fn(),
}));
vi.mock("./upload-attachment-action", () => ({
  uploadTicketAttachmentAction: vi.fn(),
}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => notFoundMock(),
  // <AdminReplyForm> (rendered for real, not mocked) calls useRouter().
  useRouter: () => ({ refresh: vi.fn() }),
}));

import AdminTicketDetailPage from "./page";

afterEach(() => {
  cleanup();
  mockAuth.mockReset();
  redirectMock.mockClear();
  notFoundMock.mockClear();
  mockGetTicketOperatorPool.mockClear();
  ticketRowRef.current = null;
  messageRowsRef.current = [];
  actionRowsRef.current = [];
  orderByCallCount.current = 0;
});

const OPERATOR_SESSION = {
  user: { id: "operator-1", features: ["admin.tickets"] },
};

const TICKET_ROW = {
  id: "ticket-1",
  organizationId: "org-1",
  organizationName: "Alder Creek Presbyterian Church",
  subject: "Directory search does not find members by maiden name",
  changeClass: "bug",
  area: "directory",
  priority: "urgent",
  status: "new",
  assigneeUserId: null,
  submitterFirstName: "Desmond",
  submitterLastName: "Okonkwo",
  submitterPreferredName: null,
  createdAt: new Date("2026-08-15T14:22:00Z"),
};

function makeParams() {
  return Promise.resolve({ id: "ticket-1" });
}

describe("AdminTicketDetailPage — feature gate", () => {
  it("redirects to /signin when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(AdminTicketDetailPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=/admin/tickets",
    );
  });

  it("renders a denial, never running a query, when the session lacks admin.tickets", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", features: [] } });
    const el = await AdminTicketDetailPage({ params: makeParams() });
    render(el);
    expect(
      screen.getByText(/don.t have permission to view this page/i),
    ).toBeTruthy();
    expect(dbMock.select).not.toHaveBeenCalled();
  });
});

describe("AdminTicketDetailPage — not found", () => {
  it("calls notFound() when the ticket row doesn't resolve", async () => {
    mockAuth.mockResolvedValue(OPERATOR_SESSION);
    ticketRowRef.current = null;
    await expect(AdminTicketDetailPage({ params: makeParams() })).rejects.toThrow(
      "NOT_FOUND",
    );
  });
});

describe("AdminTicketDetailPage — ok path", () => {
  it("renders subject, submitter, controls, conversation, and timeline", async () => {
    mockAuth.mockResolvedValue(OPERATOR_SESSION);
    ticketRowRef.current = TICKET_ROW;
    messageRowsRef.current = [
      {
        id: "message-1",
        authorKind: "submitter",
        body: "When I search under her maiden name, nothing comes up.",
        attachmentAssetKey: null,
        createdAt: new Date("2026-08-15T14:22:00Z"),
        authorFirstName: "Desmond",
        authorLastName: "Okonkwo",
        authorPreferredName: null,
        authorUserName: null,
        authorUserEmail: null,
      },
    ];
    actionRowsRef.current = [];

    const el = await AdminTicketDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByRole("heading", {
        name: /directory search does not find members by maiden name/i,
      }),
    ).toBeTruthy();
    expect(screen.getByText(/alder creek presbyterian church/i)).toBeTruthy();
    expect(screen.getByLabelText(/update ticket status/i)).toBeTruthy();
    expect(screen.getByLabelText(/update ticket assignee/i)).toBeTruthy();
    expect(screen.getByLabelText(/update ticket category/i)).toBeTruthy();
    expect(screen.getByLabelText(/update ticket area/i)).toBeTruthy();
    expect(screen.getByLabelText(/update ticket priority/i)).toBeTruthy();
    expect(
      screen.getByText(/when i search under her maiden name/i),
    ).toBeTruthy();
    expect(screen.getByText(/no triage activity yet/i)).toBeTruthy();
  });

  it("renders a timeline row per ticket_actions entry", async () => {
    mockAuth.mockResolvedValue(OPERATOR_SESSION);
    ticketRowRef.current = TICKET_ROW;
    messageRowsRef.current = [];
    actionRowsRef.current = [
      {
        id: "action-1",
        action: "status_changed",
        fromValue: "new",
        toValue: "triaged",
        actorEmail: "ops@example.invalid",
        appliedAt: new Date("2026-08-16T10:00:00Z"),
      },
    ];

    const el = await AdminTicketDetailPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/status changed/i)).toBeTruthy();
    expect(screen.getByText(/ops@example\.invalid/i)).toBeTruthy();
  });
});
