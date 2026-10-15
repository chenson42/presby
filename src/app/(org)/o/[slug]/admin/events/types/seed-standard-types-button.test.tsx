// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockSeed = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  seedStandardEventTypesAction: (...args: unknown[]) => mockSeed(...args),
}));
const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { SeedStandardTypesButton } from "./seed-standard-types-button";

afterEach(() => {
  cleanup();
  mockSeed.mockReset();
  mockRefresh.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("SeedStandardTypesButton", () => {
  it("adds the standard set, reports how many were created, and refreshes", async () => {
    mockSeed.mockResolvedValueOnce({ ok: true, data: { created: 9 } });
    render(<SeedStandardTypesButton slug="alder-creek" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add the standard event types" }));
    });
    expect(mockSeed).toHaveBeenCalledWith("alder-creek");
    expect(toastSuccess).toHaveBeenCalledWith("Added 9 event types.");
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("says so when nothing was missing", async () => {
    mockSeed.mockResolvedValueOnce({ ok: true, data: { created: 0 } });
    render(<SeedStandardTypesButton slug="alder-creek" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(toastSuccess).toHaveBeenCalledWith("The standard event types were already there.");
  });

  it("shows the server's error on failure", async () => {
    mockSeed.mockResolvedValueOnce({ ok: false, error: "You don't have permission to manage event types here." });
    render(<SeedStandardTypesButton slug="alder-creek" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(toastError).toHaveBeenCalledWith("You don't have permission to manage event types here.");
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
