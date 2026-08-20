// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/tickets/new`'s page.tsx. What this file
 * exists to pin:
 *
 *   1. The belt-and-suspenders gate: `listTickets()` is called to check the
 *      permission BEFORE rendering the form, and a `forbidden` result
 *      renders `TicketsForbidden`, not a form that only fails on submit.
 *   2. With no `?fromFeedback=`, the plain file-ticket form renders.
 *   3. With `?fromFeedback=<id>`, `getFeedbackPreview()` is called, and its
 *      three outcomes (not_found / already_handled / ok) each render
 *      distinct copy.
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
const getFeedbackPreview = vi.fn();
vi.mock("@/lib/tickets", () => ({
  listTickets: (...args: unknown[]) => listTickets(...args),
  getFeedbackPreview: (...args: unknown[]) => getFeedbackPreview(...args),
}));

vi.mock("../actions", () => ({
  fileTicketAction: vi.fn(),
  promoteFeedbackAction: vi.fn(),
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
  useRouter: () => ({ push: vi.fn() }),
}));

import NewTicketPage from "./page";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  listTickets.mockReset();
  getFeedbackPreview.mockReset();
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
  return Promise.resolve({ slug: "alder-creek" });
}
function makeSearchParams(fromFeedback?: string) {
  return Promise.resolve({ fromFeedback });
}

describe("NewTicketPage — belt-and-suspenders permission gate", () => {
  it("renders TicketsForbidden, not the form, when listTickets() returns forbidden", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listTickets.mockResolvedValue({ kind: "forbidden" });

    const el = await NewTicketPage({ params: makeParams(), searchParams: makeSearchParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to file or manage support tickets/i),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/^subject$/i)).toBeNull();
  });

  it("checks the flag before calling listTickets() at all", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await NewTicketPage({ params: makeParams(), searchParams: makeSearchParams() });
    render(el);

    expect(listTickets).not.toHaveBeenCalled();
    expect(screen.getByText(/aren.t turned on for/i)).toBeTruthy();
  });
});

describe("NewTicketPage — direct filing (no fromFeedback)", () => {
  it("renders the plain file-ticket form", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listTickets.mockResolvedValue({ kind: "ok", tickets: [] });

    const el = await NewTicketPage({ params: makeParams(), searchParams: makeSearchParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /file a ticket/i })).toBeTruthy();
    expect(screen.getByLabelText(/^subject$/i)).toBeTruthy();
    expect(getFeedbackPreview).not.toHaveBeenCalled();
  });
});

describe("NewTicketPage — promotion (fromFeedback supplied)", () => {
  it("renders 'doesn't exist' copy for not_found, with a link back to tickets", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listTickets.mockResolvedValue({ kind: "ok", tickets: [] });
    getFeedbackPreview.mockResolvedValue({ kind: "not_found" });

    const el = await NewTicketPage({
      params: makeParams(),
      searchParams: makeSearchParams("feedback-1"),
    });
    render(el);

    expect(screen.getByText(/doesn.t exist anymore/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: /back to tickets/i });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/tickets");
  });

  it("renders 'already handled' copy naming the disposition for a promoted row", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listTickets.mockResolvedValue({ kind: "ok", tickets: [] });
    getFeedbackPreview.mockResolvedValue({
      kind: "ok",
      feedback: {
        feedbackId: "feedback-1",
        submitterDisplayName: "Priya Balakrishnan",
        body: "Some feedback",
        status: "promoted",
      },
    });

    const el = await NewTicketPage({
      params: makeParams(),
      searchParams: makeSearchParams("feedback-1"),
    });
    render(el);

    expect(screen.getByText(/already been promoted to a ticket/i)).toBeTruthy();
  });

  it("renders the pre-filled form for a still-new feedback row", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listTickets.mockResolvedValue({ kind: "ok", tickets: [] });
    getFeedbackPreview.mockResolvedValue({
      kind: "ok",
      feedback: {
        feedbackId: "feedback-1",
        submitterDisplayName: "Priya Balakrishnan",
        body: "The events calendar should show Sunday school times.",
        status: "new",
      },
    });

    const el = await NewTicketPage({
      params: makeParams(),
      searchParams: makeSearchParams("feedback-1"),
    });
    render(el);

    expect(
      screen.getByText(/promoting feedback from priya balakrishnan/i),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/^description$/i)).toBeNull();
  });
});
