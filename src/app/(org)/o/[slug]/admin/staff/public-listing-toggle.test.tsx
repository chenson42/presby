// @vitest-environment jsdom
/**
 * Tests for <PublicListingToggle> — public-staff-directory Phase 3/4
 * (docs/work-log/2026-08-27-public-staff-directory.md), ux-developer slice.
 *
 * `./actions` and `sonner` are mocked so this can mount without pulling
 * `@/lib/staff` into the module graph — same reasoning
 * `end-position-dialog.test.tsx`'s header gives for the sibling dialog.
 *
 * What this file exists to pin:
 *   - the Switch's visible `checked` state never flips on a bare click —
 *     only the AlertDialog opens, staging the requested direction;
 *   - the confirmation copy differs by direction: turning ON warns about
 *     internet-wide/search-engine visibility; turning OFF warns that it
 *     stops future serving but does NOT retract anything already cached;
 *   - Cancel calls the action zero times and leaves the switch unchanged;
 *   - Confirm calls the action with the exact positionId/publicListed pair,
 *     and only THEN does the switch/badge reflect the new state;
 *   - a denied result surfaces via toast.error and leaves the switch at its
 *     prior committed value, never the attempted one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockSetStaffPositionPublicListedAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  setStaffPositionPublicListedAction: (...args: unknown[]) =>
    mockSetStaffPositionPublicListedAction(...args),
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

import { PublicListingToggle } from "./public-listing-toggle";

afterEach(() => {
  cleanup();
  mockSetStaffPositionPublicListedAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterRefresh.mockReset();
});

function renderToggle(publicListed = false) {
  return render(
    <PublicListingToggle
      slug="alder-creek"
      positionId="position-1"
      position="Church Secretary"
      personName="Marisol Windham"
      publicListed={publicListed}
    />,
  );
}

describe("PublicListingToggle — initial render", () => {
  it("renders no Public badge and an unchecked switch when not publicly listed", () => {
    renderToggle(false);
    expect(screen.queryByText("Public")).toBeNull();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("renders a Public badge and a checked switch when already publicly listed", () => {
    renderToggle(true);
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "true",
    );
  });
});

describe("PublicListingToggle — clicking the switch stages, never flips, immediately", () => {
  it("opens the confirmation dialog without changing the switch's own visible state", () => {
    renderToggle(false);
    fireEvent.click(screen.getByRole("switch"));

    expect(
      screen.getByText("List Marisol Windham publicly as Church Secretary?"),
    ).toBeTruthy();
    // Radix's modal AlertDialog marks the rest of the page `aria-hidden`
    // while open — `{ hidden: true }` opts back into querying it, since
    // the assertion here is about the switch's DOM state, not whether a
    // screen reader can currently reach it.
    expect(
      screen.getByRole("switch", { hidden: true }).getAttribute("aria-checked"),
    ).toBe("false");
    expect(mockSetStaffPositionPublicListedAction).not.toHaveBeenCalled();
  });

  it("names internet-wide/search-engine visibility when turning the listing ON", () => {
    renderToggle(false);
    fireEvent.click(screen.getByRole("switch"));
    expect(
      screen.getByText(/visible to anyone visiting the public website/i),
    ).toBeTruthy();
    expect(screen.getByText(/search engines/i)).toBeTruthy();
  });

  it("names the no-retraction caveat when turning an existing listing OFF", () => {
    renderToggle(true);
    fireEvent.click(screen.getByRole("switch"));
    expect(
      screen.getByText("Stop listing Marisol Windham publicly?"),
    ).toBeTruthy();
    expect(
      screen.getByText(/does not retract anything already cached/i),
    ).toBeTruthy();
  });
});

describe("PublicListingToggle — cancel", () => {
  it("calls the action zero times and leaves the switch unchanged", () => {
    renderToggle(false);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(mockSetStaffPositionPublicListedAction).not.toHaveBeenCalled();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(screen.queryByText("Public")).toBeNull();
  });
});

describe("PublicListingToggle — confirm ON", () => {
  it("calls the action with publicListed: true, then flips the switch and shows the Public badge", async () => {
    mockSetStaffPositionPublicListedAction.mockResolvedValueOnce({
      ok: true,
      data: { positionId: "position-1", publicListed: true },
    });
    renderToggle(false);
    fireEvent.click(screen.getByRole("switch"));

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /yes, list publicly/i }),
      );
    });

    expect(mockSetStaffPositionPublicListedAction).toHaveBeenCalledWith(
      "alder-creek",
      { positionId: "position-1", publicListed: true },
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      "Marisol Windham is now listed publicly.",
    );
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByText("Public")).toBeTruthy();
    expect(mockRouterRefresh).toHaveBeenCalled();
  });
});

describe("PublicListingToggle — confirm OFF", () => {
  it("calls the action with publicListed: false, then unchecks the switch and hides the badge", async () => {
    mockSetStaffPositionPublicListedAction.mockResolvedValueOnce({
      ok: true,
      data: { positionId: "position-1", publicListed: false },
    });
    renderToggle(true);
    fireEvent.click(screen.getByRole("switch"));

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /yes, stop listing/i }),
      );
    });

    expect(mockSetStaffPositionPublicListedAction).toHaveBeenCalledWith(
      "alder-creek",
      { positionId: "position-1", publicListed: false },
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      "Marisol Windham is no longer listed publicly.",
    );
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(screen.queryByText("Public")).toBeNull();
  });
});

describe("PublicListingToggle — denied result", () => {
  it("surfaces the server's own error via toast.error and leaves the switch at its prior committed value", async () => {
    mockSetStaffPositionPublicListedAction.mockResolvedValueOnce({
      ok: false,
      error: "You don't have permission to manage staff here.",
    });
    renderToggle(false);
    fireEvent.click(screen.getByRole("switch"));

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /yes, list publicly/i }),
      );
    });

    expect(toastError).toHaveBeenCalledWith(
      "You don't have permission to manage staff here.",
    );
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(screen.queryByText("Public")).toBeNull();
  });
});
