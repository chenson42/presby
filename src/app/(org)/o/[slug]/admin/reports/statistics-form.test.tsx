// @vitest-environment jsdom
/**
 * Tests for <StatisticsForm> —
 * `docs/work-log/2026-09-28-statistics-error-mapping.md` (Phase 3 Design (b),
 * bug-fix variant). `./actions` is mocked: `setCongregationStatisticsAction`
 * is a "use server" export whose real implementation pulls
 * `@/lib/presbytery` (and, transitively, the Neon pool) into the module
 * graph — same reasoning `page.test.tsx`'s own header gives for mocking
 * `@/lib/presbytery` directly.
 *
 * What this file exists to pin:
 *
 *   - the Year `<input>` carries `min`/`max` sourced from the SELECTED
 *     congregation's affiliation window, and a pre-submit client-side guard
 *     blocks an out-of-window year WITHOUT calling the server action at all
 *     (Phase 3 Design (b) — UX only; the server mapping in (c) is the actual
 *     enforcement, covered by `presbytery.test.ts`'s DB-backed suite, not
 *     here);
 *   - a REJECTED action call still clears `submitting` — the `try/finally`
 *     fix for the stuck "Saving…" button (Phase 3 Design (b) / Root Cause)
 *     — regression for statistics form year guard and error mapping.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const mockSetCongregationStatisticsAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  setCongregationStatisticsAction: (...args: unknown[]) =>
    mockSetCongregationStatisticsAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const mockRouterRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh }),
}));

import { StatisticsForm } from "./statistics-form";

afterEach(() => {
  cleanup();
  mockSetCongregationStatisticsAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterRefresh.mockReset();
});

const CONGREGATION_WITH_WINDOW = {
  organizationId: "cong-1",
  name: "Fixture Congregation",
  affiliationMinYear: 2022,
  affiliationMaxYear: null,
};

describe("StatisticsForm — affiliation-window guard (Phase 3 Design (b))", () => {
  it("the Year input carries min sourced from the selected congregation's affiliation window", () => {
    render(
      <StatisticsForm slug="northern-reach" year={2024} congregations={[CONGREGATION_WITH_WINDOW]} />,
    );
    const yearInput = screen.getByLabelText(/^year/i) as HTMLInputElement;
    expect(yearInput.getAttribute("min")).toBe("2022");
    expect(yearInput.hasAttribute("max")).toBe(false);
  });

  it("entering a pre-affiliation year shows an inline guard error and does NOT call the server action — regression for statistics form year guard and error mapping", async () => {
    render(
      <StatisticsForm slug="northern-reach" year={2024} congregations={[CONGREGATION_WITH_WINDOW]} />,
    );

    fireEvent.change(screen.getByLabelText(/^year/i), { target: { value: "2015" } });
    fireEvent.click(screen.getByRole("button", { name: /save statistics/i }));

    await waitFor(() => {
      expect(screen.getByText(/wasn't affiliated with this presbytery until 2022/i)).toBeTruthy();
    });
    expect(mockSetCongregationStatisticsAction).not.toHaveBeenCalled();
  });

  it("a year inside the affiliation window is NOT blocked client-side (guard is a floor, not a ceiling, when only min is known)", async () => {
    mockSetCongregationStatisticsAction.mockResolvedValue({ ok: true, data: { id: "row-1" } });
    render(
      <StatisticsForm slug="northern-reach" year={2024} congregations={[CONGREGATION_WITH_WINDOW]} />,
    );

    fireEvent.change(screen.getByLabelText(/^year/i), { target: { value: "2023" } });
    fireEvent.click(screen.getByRole("button", { name: /save statistics/i }));

    await waitFor(() => {
      expect(mockSetCongregationStatisticsAction).toHaveBeenCalledTimes(1);
    });
  });
});

describe("StatisticsForm — the stuck-button bug (Root Cause / Phase 3 Design (b))", () => {
  it("a REJECTED action call still clears `submitting` and returns the button to its normal state — regression for statistics form year guard and error mapping", async () => {
    let rejectAction!: (err: unknown) => void;
    mockSetCongregationStatisticsAction.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectAction = reject;
      }),
    );

    render(
      <StatisticsForm slug="northern-reach" year={2024} congregations={[CONGREGATION_WITH_WINDOW]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /save statistics/i }));

    // Pending: the button flips to "Saving…" and disables — MUST FAIL today
    // if setSubmitting(true) never ran, but that half of the bug was never
    // broken; this assertion just establishes the pending state before the
    // rejection settles.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /saving/i })).toBeTruthy();
    });
    expect((screen.getByRole("button", { name: /saving/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    // A genuinely unexpected thrown/rejected failure (the same shape an
    // uncaught `congregation_statistics_about_org` refusal used to produce
    // before Phase 3 Design (c) mapped it to `{ ok: false }`) — before the
    // `try/finally` fix, `setSubmitting(false)` was the line AFTER the
    // `await` and never ran on this path, so the button stayed on "Saving…"
    // forever. MUST FAIL before the fix, PASS after. Caught (Phase 4
    // Implementer Notes divergence from the design doc's `finally`-only
    // text): a client-side RPC rejection cannot reach `error.tsx` (Phase 3
    // Design (e)), so leaving it truly unhandled meant total silence, not a
    // safety net — logged and surfaced via the same generic-toast voice
    // `reports-states.tsx` uses for a read-side load error.
    rejectAction(new Error("simulated unexpected failure"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^save statistics$/i })).toBeTruthy();
    });
    expect(
      (screen.getByRole("button", { name: /^save statistics$/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(toastError).toHaveBeenCalledWith(
      "We couldn't save this right now. Try again in a moment.",
    );
  });
});

describe("StatisticsForm — HydrationGate wiring (DECISION-159, F116)", () => {
  it("the server render is a disabled, busy fieldset around the form", () => {
    const html = renderToString(
      <StatisticsForm slug="northern-reach" year={2024} congregations={[CONGREGATION_WITH_WINDOW]} />,
    );
    expect(html).toContain('<fieldset disabled=""');
    expect(html).toContain('aria-busy="true"');
  });
});
