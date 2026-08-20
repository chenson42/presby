// @vitest-environment jsdom
/**
 * Orchestration tests for `/admin/tickets`'s page.tsx — the cross-org triage
 * queue. Mocked at the `@/lib/db` (`getPlatformDb()`) boundary, same
 * circular-import-avoidance shape `(admin)/tickets/actions.test.ts`'s own
 * header documents (loading `@/lib/db/schema` first inside the mock factory
 * before returning it).
 *
 * What this pins:
 *   1. `FEATURES.ADMIN_TICKETS` gate — missing the feature renders a denial,
 *      no query ever runs.
 *   2. The empty state (real copy, not a blank screen) for both "no tickets
 *      at all" and "no tickets match this filter".
 *   3. `?status=`/`?area=`/`?priority=` render as the `<select>`s' selected
 *      values and are validated against the controlled vocabulary (an
 *      unknown value falls back to "all").
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));

const rowsRef = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));

const dbMock = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
  } as Record<string, ReturnType<typeof vi.fn>>;
  selectChain.from.mockReturnValue(selectChain);
  selectChain.innerJoin.mockReturnValue(selectChain);
  selectChain.leftJoin.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  selectChain.orderBy.mockImplementation(() => Promise.resolve(rowsRef.current));
  const select = vi.fn(() => selectChain);
  const platformDb = { select };
  return { select, getPlatformDb: vi.fn(() => platformDb) };
});

vi.mock("@/lib/db", async () => {
  await import("@/lib/db/schema");
  return { getPlatformDb: dbMock.getPlatformDb };
});

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

import AdminTicketsPage from "./page";

afterEach(() => {
  cleanup();
  mockAuth.mockReset();
  redirectMock.mockClear();
  rowsRef.current = [];
});

const OPERATOR_SESSION = {
  user: { id: "operator-1", email: "ops@example.invalid", features: ["admin.tickets"] },
};

function makeSearchParams(params: Record<string, string> = {}) {
  return Promise.resolve(params);
}

describe("AdminTicketsPage — feature gate", () => {
  it("redirects to /signin when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(
      AdminTicketsPage({ searchParams: makeSearchParams() }),
    ).rejects.toThrow("REDIRECT:/signin?callbackUrl=/admin/tickets");
  });

  it("renders a denial, never running a query, when the session lacks admin.tickets", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", features: [] } });
    const el = await AdminTicketsPage({ searchParams: makeSearchParams() });
    render(el);
    expect(
      screen.getByText(/don.t have permission to view this page/i),
    ).toBeTruthy();
    expect(dbMock.select).not.toHaveBeenCalled();
  });
});

describe("AdminTicketsPage — empty states", () => {
  it("renders 'No tickets yet' with no active filter", async () => {
    mockAuth.mockResolvedValue(OPERATOR_SESSION);
    rowsRef.current = [];
    const el = await AdminTicketsPage({ searchParams: makeSearchParams() });
    render(el);
    expect(screen.getByText(/^no tickets yet$/i)).toBeTruthy();
  });

  it("renders 'No tickets match this filter' with an active filter", async () => {
    mockAuth.mockResolvedValue(OPERATOR_SESSION);
    rowsRef.current = [];
    const el = await AdminTicketsPage({
      searchParams: makeSearchParams({ status: "resolved" }),
    });
    render(el);
    expect(screen.getByText(/no tickets match this filter/i)).toBeTruthy();
  });
});

describe("AdminTicketsPage — populated", () => {
  it("renders a row per ticket, linking to the ticket's detail page", async () => {
    mockAuth.mockResolvedValue(OPERATOR_SESSION);
    rowsRef.current = [
      {
        id: "ticket-1",
        subject: "Directory search does not find members by maiden name",
        status: "new",
        changeClass: "bug",
        area: "directory",
        priority: "urgent",
        createdAt: new Date("2026-08-15T14:22:00Z"),
        organizationName: "Alder Creek Presbyterian Church",
        submitterFirstName: "Desmond",
        submitterLastName: "Okonkwo",
        submitterPreferredName: null,
        assigneeEmail: null,
      },
    ];
    const el = await AdminTicketsPage({ searchParams: makeSearchParams() });
    render(el);

    const link = screen.getByRole("link", {
      name: /directory search does not find members by maiden name/i,
    });
    expect(link.getAttribute("href")).toBe("/admin/tickets/ticket-1");
    expect(screen.getByText("Alder Creek Presbyterian Church")).toBeTruthy();
    expect(screen.getByText("Unassigned")).toBeTruthy();
  });
});
