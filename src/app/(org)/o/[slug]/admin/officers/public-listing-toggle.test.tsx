// @vitest-environment jsdom
/**
 * Tests for <PublicListingToggle> (`admin/officers`) — public-staff-
 * directory Phase 3/4 (docs/work-log/2026-08-27-public-staff-directory.md),
 * ux-developer slice. The `officer_terms` twin of `admin/staff/public-
 * listing-toggle.test.tsx` — see that file's header for the fuller
 * rationale; this pins the identical behavior against
 * `setOfficerTermPublicListedAction`'s own `{ termId, publicListed }` shape.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockSetOfficerTermPublicListedAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  setOfficerTermPublicListedAction: (...args: unknown[]) =>
    mockSetOfficerTermPublicListedAction(...args),
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
  mockSetOfficerTermPublicListedAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterRefresh.mockReset();
});

function renderToggle(publicListed = false) {
  return render(
    <PublicListingToggle
      slug="alder-creek"
      termId="term-1"
      officeLabel="Ruling Elder"
      personName="Tobias Renwick"
      publicListed={publicListed}
    />,
  );
}

describe("PublicListingToggle (officers) — initial render", () => {
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

describe("PublicListingToggle (officers) — clicking the switch stages, never flips, immediately", () => {
  it("opens the confirmation dialog without changing the switch's own visible state", () => {
    renderToggle(false);
    fireEvent.click(screen.getByRole("switch"));

    expect(
      screen.getByText("List Tobias Renwick publicly as Ruling Elder?"),
    ).toBeTruthy();
    // Radix's modal AlertDialog marks the rest of the page `aria-hidden`
    // while open — `{ hidden: true }` opts back into querying it.
    expect(
      screen.getByRole("switch", { hidden: true }).getAttribute("aria-checked"),
    ).toBe("false");
    expect(mockSetOfficerTermPublicListedAction).not.toHaveBeenCalled();
  });

  it("names the no-retraction caveat when turning an existing listing OFF", () => {
    renderToggle(true);
    fireEvent.click(screen.getByRole("switch"));
    expect(
      screen.getByText("Stop listing Tobias Renwick publicly?"),
    ).toBeTruthy();
    expect(
      screen.getByText(/does not retract anything already cached/i),
    ).toBeTruthy();
  });
});

describe("PublicListingToggle (officers) — cancel", () => {
  it("calls the action zero times and leaves the switch unchanged", () => {
    renderToggle(false);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(mockSetOfficerTermPublicListedAction).not.toHaveBeenCalled();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    );
  });
});

describe("PublicListingToggle (officers) — confirm ON", () => {
  it("calls the action with termId/publicListed: true, then flips the switch and shows the Public badge", async () => {
    mockSetOfficerTermPublicListedAction.mockResolvedValueOnce({
      ok: true,
      data: { termId: "term-1", publicListed: true },
    });
    renderToggle(false);
    fireEvent.click(screen.getByRole("switch"));

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /yes, list publicly/i }),
      );
    });

    expect(mockSetOfficerTermPublicListedAction).toHaveBeenCalledWith(
      "alder-creek",
      { termId: "term-1", publicListed: true },
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      "Tobias Renwick is now listed publicly.",
    );
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByText("Public")).toBeTruthy();
    expect(mockRouterRefresh).toHaveBeenCalled();
  });
});

describe("PublicListingToggle (officers) — denied result", () => {
  it("surfaces the server's own error via toast.error and leaves the switch at its prior committed value", async () => {
    mockSetOfficerTermPublicListedAction.mockResolvedValueOnce({
      ok: false,
      error: "You don't have permission to manage officer terms here.",
    });
    renderToggle(false);
    fireEvent.click(screen.getByRole("switch"));

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /yes, list publicly/i }),
      );
    });

    expect(toastError).toHaveBeenCalledWith(
      "You don't have permission to manage officer terms here.",
    );
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    );
  });
});
