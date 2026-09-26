// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/filings`'s page.tsx — DECISION-152,
 * `docs/work-log/2026-09-26-withdraw-publication.md` Phase 3 Component Plan.
 * Mirrors `../reports/page.test.tsx`/`../oversight/[aboutOrgId]/page.test.tsx`'s
 * assertion style for a single-permission `(org)` page:
 *
 *   1. Unauthenticated -> redirect to /signin with a callbackUrl.
 *   2. `isFlagEnabled("org_portal.filings")` is checked BEFORE
 *      `listOwnFilings()` is ever called.
 *   3. Flag on, wrong org type -> PlaceholderNotAvailable, no data read.
 *   4. `OrgAccessError` is RE-THROWN, not swallowed into the load-error state.
 *   5. Any other thrown error renders the load-error state.
 *   6. `{ kind: "forbidden" }` renders `FilingsSectionForbidden`.
 *   7. Empty list -> the empty state names the missing publish form plainly
 *      (Phase 1's required copy), not a bare "no data" sentence.
 *   8. Non-empty list -> current/withdrawn/superseded rows render honestly,
 *      and ONLY the current, non-superseded, non-withdrawn row carries a
 *      Withdraw button.
 *   9. The withdraw dialog requires a minute reference and disables submit
 *      until one is present (Phase 2 Note 5's test list).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

const listOwnFilings = vi.fn();
vi.mock("@/lib/filings", () => ({
  listOwnFilings: (...args: unknown[]) => listOwnFilings(...args),
  MINUTE_REFERENCE_MAX: 500,
}));

const withdrawFilingAction = vi.fn();
vi.mock("./actions", () => ({
  withdrawFilingAction: (...args: unknown[]) => withdrawFilingAction(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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

import FilingsPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  listOwnFilings.mockReset();
  withdrawFilingAction.mockReset();
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

const CURRENT_FILING = {
  publicationId: "pub-current",
  reportYear: 2026,
  publishedAt: "2026-02-01T00:00:00.000Z",
  minuteReference: "Session, 2026-01-30, item 3",
  supersedesId: null,
  withdrawnAt: null,
  withdrawnBy: null,
  withdrawnMinuteReference: null,
};

const WITHDRAWN_FILING = {
  publicationId: "pub-withdrawn",
  reportYear: 2025,
  publishedAt: "2025-02-01T00:00:00.000Z",
  minuteReference: "Session, 2025-01-30, item 2",
  supersedesId: null,
  withdrawnAt: "2025-03-01T00:00:00.000Z",
  withdrawnBy: "user-1",
  withdrawnMinuteReference: "Session, 2025-02-28, item 5",
};

const SUPERSEDED_FILING = {
  publicationId: "pub-superseded",
  reportYear: 2024,
  publishedAt: "2024-02-01T00:00:00.000Z",
  minuteReference: "Session, 2024-01-30, item 1",
  supersedesId: null,
  withdrawnAt: null,
  withdrawnBy: null,
  withdrawnMinuteReference: null,
};
// The row that supersedes SUPERSEDED_FILING — its own supersedesId points
// BACK at pub-superseded, which is what marks that earlier row superseded.
const SUPERSEDING_FILING = {
  ...SUPERSEDED_FILING,
  publicationId: "pub-superseding",
  reportYear: 2024,
  supersedesId: "pub-superseded",
};

describe("FilingsPage — the ordering/error-handling contract", () => {
  it("redirects to /signin with a callbackUrl back to this route when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(FilingsPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Ffilings",
    );
  });

  it("checks the flag BEFORE calling listOwnFilings()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await FilingsPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.filings");
    expect(listOwnFilings).not.toHaveBeenCalled();
    expect(
      screen.getByText(/isn.t turned on for Alder Creek Presbyterian Church/i),
    ).toBeTruthy();
  });

  it("renders PlaceholderNotAvailable for a non-congregation org type, without reading data", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ok",
      org: { ...OK_RESOLVED.org, organizationType: "presbytery" },
    });
    isFlagEnabled.mockResolvedValue(true);

    const el = await FilingsPage({ params: makeParams() });
    render(el);

    expect(listOwnFilings).not.toHaveBeenCalled();
    expect(
      screen.getByText(/isn.t available for Alder Creek Presbyterian Church/i),
    ).toBeTruthy();
  });

  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listOwnFilings.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(FilingsPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listOwnFilings.mockRejectedValue(new Error("connection reset"));

    const el = await FilingsPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load your filing history right now/i),
    ).toBeTruthy();
  });

  it("renders FilingsSectionForbidden for a forbidden result", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listOwnFilings.mockResolvedValue({ kind: "forbidden" });

    const el = await FilingsPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to manage statistical filings/i),
    ).toBeTruthy();
  });

  it("renders the plain no-publish-form empty state for zero filings", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listOwnFilings.mockResolvedValue({ kind: "ok", data: [] });

    const el = await FilingsPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/no filings on record yet/i)).toBeTruthy();
    expect(screen.getByText(/isn.t built on this page yet/i)).toBeTruthy();
  });

  it("renders current/withdrawn/superseded rows honestly, Withdraw only on the current row", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listOwnFilings.mockResolvedValue({
      kind: "ok",
      data: [CURRENT_FILING, WITHDRAWN_FILING, SUPERSEDING_FILING, SUPERSEDED_FILING],
    });

    const el = await FilingsPage({ params: makeParams() });
    render(el);

    // Exactly one Withdraw trigger — the current, non-superseded,
    // non-withdrawn row (CURRENT_FILING). SUPERSEDING_FILING is itself
    // current (nothing supersedes IT), so it also gets one — two total.
    expect(screen.getAllByRole("button", { name: "Withdraw" })).toHaveLength(2);

    expect(screen.getByText("Withdrawn")).toBeTruthy();
    expect(screen.getByText("Session, 2025-02-28, item 5")).toBeTruthy();
    expect(screen.getByText("Superseded")).toBeTruthy();
    expect(screen.getAllByText("Current")).toHaveLength(2);
  });

  it("the withdraw dialog requires a minute reference and disables submit until one is present", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listOwnFilings.mockResolvedValue({ kind: "ok", data: [CURRENT_FILING] });
    withdrawFilingAction.mockResolvedValue({ ok: true, data: { id: "pub-current" } });

    const el = await FilingsPage({ params: makeParams() });
    render(el);

    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));

    const confirmButton = (await screen.findByRole("button", {
      name: /yes, withdraw this filing/i,
    })) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);

    const input = screen.getByLabelText(/minute reference/i);
    fireEvent.change(input, { target: { value: "Session, 2026-03-01, item 7" } });

    await waitFor(() => expect(confirmButton.disabled).toBe(false));

    await act(async () => {
      fireEvent.click(confirmButton);
    });
    expect(withdrawFilingAction).toHaveBeenCalledWith("alder-creek", {
      publicationId: "pub-current",
      minuteReference: "Session, 2026-03-01, item 7",
    });
  });
});
