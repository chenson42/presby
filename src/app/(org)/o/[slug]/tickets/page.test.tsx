// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/tickets`'s page.tsx — mirrors
 * `admin/roles/page.test.tsx`'s exact assertion style. What this file exists
 * to pin:
 *
 *   1. `isFlagEnabled("org_portal.tickets")` is checked BEFORE `listTickets()`
 *      is ever called.
 *   2. `OrgAccessError` thrown by `listTickets()`/`listPendingFeedback()` is
 *      RE-THROWN, not swallowed into the load-error state.
 *   3. Any OTHER thrown error renders the load-error state.
 *   4. `{ kind: "forbidden" }` from `listTickets()` renders `TicketsForbidden`
 *      WITHOUT ever calling `listPendingFeedback()`.
 *   5. The ok path renders both sections.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({
  cachedAuth: () => cachedAuth(),
}));

const resolveOrgContext = vi.fn();
const assertOrgAccess = vi.fn();
vi.mock("@/lib/authz", () => {
  class MockOrgAccessError extends Error {
    constructor() {
      super("mock: no active membership");
      this.name = "OrgAccessError";
    }
  }
  return {
    OrgAccessError: MockOrgAccessError,
    resolveOrgContext: (...args: unknown[]) => resolveOrgContext(...args),
    assertOrgAccess: (...args: unknown[]) => assertOrgAccess(...args),
  };
});

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args),
}));

const listTickets = vi.fn();
const listPendingFeedback = vi.fn();
vi.mock("@/lib/tickets", () => ({
  listTickets: (...args: unknown[]) => listTickets(...args),
  listPendingFeedback: (...args: unknown[]) => listPendingFeedback(...args),
}));

// Public sites' ContactForm read side (DECISION-089) — the third section on
// this page. Mocked wholesale: the real @/lib/sites imports "server-only"
// and is not itself under test here (src/lib/sites.test.ts owns that).
const listSiteContactMessages = vi.fn();
vi.mock("@/lib/sites", () => ({
  listSiteContactMessages: (...args: unknown[]) =>
    listSiteContactMessages(...args),
}));

vi.mock("./actions", () => ({
  dismissFeedbackAction: vi.fn(),
  markSiteContactMessageReadAction: vi.fn(),
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
  useRouter: () => ({ refresh: vi.fn() }),
}));

import TicketsPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  listTickets.mockReset();
  listPendingFeedback.mockReset();
  listSiteContactMessages.mockReset().mockResolvedValue({ kind: "ok", messages: [] });
  redirectMock.mockClear();
  notFoundMock.mockClear();
});

const OK_RESOLVED = {
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

function makeParams(slug = "alder-creek") {
  return Promise.resolve({ slug });
}

describe("TicketsPage — the flag-before-permission ordering contract", () => {
  it("checks the flag and renders flag-off WITHOUT ever calling listTickets()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await TicketsPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.tickets");
    expect(listTickets).not.toHaveBeenCalled();
    expect(screen.getByText(/aren.t turned on for Alder Creek/i)).toBeTruthy();
  });
});

describe("TicketsPage — listTickets() error handling", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listTickets.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(TicketsPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listTickets.mockRejectedValue(new Error("connection reset"));

    const el = await TicketsPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/couldn.t load tickets right now/i)).toBeTruthy();
  });
});

describe("TicketsPage — result branches", () => {
  it("renders TicketsForbidden when listTickets() returns { kind: 'forbidden' }, WITHOUT calling listPendingFeedback()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listTickets.mockResolvedValue({ kind: "forbidden" });

    const el = await TicketsPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to file or manage support tickets/i),
    ).toBeTruthy();
    expect(listPendingFeedback).not.toHaveBeenCalled();
  });

  it("renders both sections — Open tickets and Incoming feedback — on the ok path", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listTickets.mockResolvedValue({
      kind: "ok",
      tickets: [
        {
          ticketId: "ticket-1",
          subject: "Directory search broken",
          changeClass: "bug",
          area: "directory",
          priority: "normal",
          status: "new",
          submitterDisplayName: "Desmond Okonkwo",
          createdAt: "2026-08-15T14:22:00Z",
          lastActivityAt: "2026-08-15T14:22:00Z",
          messageCount: 1,
        },
      ],
    });
    listPendingFeedback.mockResolvedValue({
      kind: "ok",
      feedback: [
        {
          feedbackId: "feedback-1",
          submitterDisplayName: "Priya Balakrishnan",
          body: "The events calendar should show Sunday school times.",
          createdAt: "2026-08-17T09:05:00Z",
        },
      ],
    });
    listSiteContactMessages.mockResolvedValue({
      kind: "ok",
      messages: [
        {
          messageId: "msg-1",
          name: "Nadia Okonkwo",
          email: "nadia@example.invalid",
          body: "Is there a Wednesday evening service?",
          status: "new",
          createdAt: "2026-08-18T09:05:00Z",
        },
      ],
    });

    const el = await TicketsPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /^tickets$/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /open tickets/i })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /incoming feedback/i }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: /site messages/i })).toBeTruthy();
    expect(screen.getByText(/directory search broken/i)).toBeTruthy();
    expect(screen.getByText(/priya balakrishnan/i)).toBeTruthy();
    expect(screen.getByText(/nadia okonkwo/i)).toBeTruthy();
  });

  it("renders all three empty states when there is no data", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listTickets.mockResolvedValue({ kind: "ok", tickets: [] });
    listPendingFeedback.mockResolvedValue({ kind: "ok", feedback: [] });
    listSiteContactMessages.mockResolvedValue({ kind: "ok", messages: [] });

    const el = await TicketsPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/no tickets yet/i)).toBeTruthy();
    expect(screen.getByText(/no incoming feedback right now/i)).toBeTruthy();
    expect(screen.getByText(/no site messages yet/i)).toBeTruthy();
  });
});

describe("TicketsPage — site messages (ContactForm read side, DECISION-089)", () => {
  it("re-throws OrgAccessError from listSiteContactMessages() rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listTickets.mockResolvedValue({ kind: "ok", tickets: [] });
    listPendingFeedback.mockResolvedValue({ kind: "ok", feedback: [] });
    listSiteContactMessages.mockRejectedValue(
      new OrgAccessError("person-1", "org-1"),
    );

    await expect(TicketsPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error from listSiteContactMessages()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listTickets.mockResolvedValue({ kind: "ok", tickets: [] });
    listPendingFeedback.mockResolvedValue({ kind: "ok", feedback: [] });
    listSiteContactMessages.mockRejectedValue(new Error("connection reset"));

    const el = await TicketsPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/couldn.t load tickets right now/i)).toBeTruthy();
  });
});

describe("TicketsPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to tickets when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(TicketsPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Ftickets",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(TicketsPage({ params: makeParams() })).rejects.toThrow(
      "NOT_FOUND",
    );
  });

  it("renders the shared access-denied copy for a forbidden org relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });

    const el = await TicketsPage({ params: makeParams("bramblewood") });
    render(el);

    expect(
      screen.getByText(/you don.t have access to Bramblewood/i),
    ).toBeTruthy();
    expect(listTickets).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-03-31",
    });

    const el = await TicketsPage({ params: makeParams("fernwood") });
    render(el);

    expect(
      screen.getByText(/your access to Fernwood.*has ended/i),
    ).toBeTruthy();
  });
});
