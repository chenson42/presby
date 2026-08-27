// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockExtendSeriesPatternAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  extendSeriesPatternAction: (...args: unknown[]) => mockExtendSeriesPatternAction(...args),
}));

const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { ExtendSeriesForm } from "./extend-series-form";

afterEach(() => {
  cleanup();
  mockExtendSeriesPatternAction.mockReset();
  mockRefresh.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("ExtendSeriesForm", () => {
  it("pre-selects the series' current simple pattern", () => {
    render(
      <ExtendSeriesForm slug="alder-creek" parentEventId="parent-1" currentPattern="biweekly" />,
    );
    expect(screen.getByDisplayValue(/every 2 weeks/i)).toBeTruthy();
  });

  it("submits additionalCount as a number, additive to the existing series (never a replacement)", async () => {
    mockExtendSeriesPatternAction.mockResolvedValueOnce({
      ok: true,
      data: { occurrenceIds: ["e1", "e2"] },
    });

    render(<ExtendSeriesForm slug="alder-creek" parentEventId="parent-1" currentPattern="weekly" />);
    fireEvent.change(screen.getByLabelText(/additional occurrences to add/i), {
      target: { value: "4" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /extend series/i }));
    });

    expect(mockExtendSeriesPatternAction).toHaveBeenCalledWith("alder-creek", {
      parentEventId: "parent-1",
      pattern: "weekly",
      additionalCount: 4,
    });
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("collapses a day-of-week choice into an ordinal+day pattern string", async () => {
    mockExtendSeriesPatternAction.mockResolvedValueOnce({
      ok: true,
      data: { occurrenceIds: ["e1"] },
    });

    render(
      <ExtendSeriesForm slug="alder-creek" parentEventId="parent-1" currentPattern="2nd Tuesday" />,
    );
    fireEvent.change(screen.getByLabelText(/additional occurrences to add/i), {
      target: { value: "2" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /extend series/i }));
    });

    expect(mockExtendSeriesPatternAction).toHaveBeenCalledWith(
      "alder-creek",
      expect.objectContaining({ pattern: "2nd Tuesday" }),
    );
  });

  it("surfaces the server's error copy (e.g. the 52-occurrence cap message) via toast.error", async () => {
    mockExtendSeriesPatternAction.mockResolvedValueOnce({
      ok: false,
      error: "A series can have at most 52 occurrences in total (this series already has 50).",
    });

    render(<ExtendSeriesForm slug="alder-creek" parentEventId="parent-1" currentPattern="weekly" />);
    fireEvent.change(screen.getByLabelText(/additional occurrences to add/i), {
      target: { value: "3" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /extend series/i }));
    });

    expect(toastError).toHaveBeenCalledWith(
      "A series can have at most 52 occurrences in total (this series already has 50).",
    );
  });
});
