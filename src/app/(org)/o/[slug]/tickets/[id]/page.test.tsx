// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/tickets/<id>`'s page.tsx. Mirrors
 * `admin/roles/page.test.tsx`'s style. What this pins:
 *
 *   1. The flag check runs before `getTicketThread()`.
 *   2. `OrgAccessError` re-thrown, any other error renders load-error.
 *   3. `{ kind: "forbidden" }` renders TicketsForbidden.
 *   4. `{ kind: "not_found" }` calls Next's notFound() (rendered by the
 *      segment's own not-found.tsx, not tested here — see that file).
 *   5. The ok path renders the thread: subject, badges, messages, reply form.
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

const getTicketThread = vi.fn();
vi.mock("@/lib/tickets", () => ({
  getTicketThread: (...args: unknown[]) => getTicketThread(...args),
}));

vi.mock("../actions", () => ({
  replyToTicketAction: vi.fn(),
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

import TicketDetailPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getTicketThread.mockReset();
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

function makeParams() {
  return Promise.resolve({ slug: "alder-creek", id: "ticket-1" });
}

describe("TicketDetailPage — flag-before-fetch", () => {
  it("checks the flag and renders flag-off WITHOUT ever calling getTicketThread()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await TicketDetailPage({ params: makeParams() });
    render(el);

    expect(getTicketThread).not.toHaveBeenCalled();
    expect(screen.getByText(/aren.t turned on for/i)).toBeTruthy();
  });
});

describe("TicketDetailPage — getTicketThread() result branches", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getTicketThread.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(TicketDetailPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getTicketThread.mockRejectedValue(new Error("connection reset"));

    const el = await TicketDetailPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/couldn.t load tickets right now/i)).toBeTruthy();
  });

  it("renders TicketsForbidden for { kind: 'forbidden' }", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getTicketThread.mockResolvedValue({ kind: "forbidden" });

    const el = await TicketDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to file or manage support tickets/i),
    ).toBeTruthy();
  });

  it("calls notFound() for { kind: 'not_found' } — enumeration discipline, never a distinguishable 403", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getTicketThread.mockResolvedValue({ kind: "not_found" });

    await expect(TicketDetailPage({ params: makeParams() })).rejects.toThrow(
      "NOT_FOUND",
    );
  });

  it("renders the thread — subject, badges, messages, and a reply form — on the ok path", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getTicketThread.mockResolvedValue({
      kind: "ok",
      thread: {
        ticketId: "ticket-1",
        subject: "Directory search does not find members by maiden name",
        changeClass: "bug",
        area: "directory",
        priority: "urgent",
        status: "new",
        submitterDisplayName: "Desmond Okonkwo",
        createdAt: "2026-08-15T14:22:00Z",
        messages: [
          {
            messageId: "message-1",
            authorKind: "submitter",
            authorDisplayName: "Desmond Okonkwo",
            body: "When I search under her maiden name, nothing comes up.",
            attachment: null,
            createdAt: "2026-08-15T14:22:00Z",
          },
        ],
      },
    });

    const el = await TicketDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByRole("heading", {
        name: /directory search does not find members by maiden name/i,
      }),
    ).toBeTruthy();
    expect(screen.getByText("Urgent")).toBeTruthy();
    expect(screen.getByText("New")).toBeTruthy();
    expect(
      screen.getByText(/when i search under her maiden name/i),
    ).toBeTruthy();
    expect(screen.getByLabelText(/^reply$/i)).toBeTruthy();
  });
});
