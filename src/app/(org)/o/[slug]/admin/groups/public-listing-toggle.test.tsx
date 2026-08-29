// @vitest-environment jsdom
/**
 * Tests for <PublicListingToggle> (groups) — public-directory-primitives
 * Phase 3/4 (docs/work-log/2026-08-28-public-directory-primitives.md),
 * ux-developer slice. Mirrors `admin/staff/public-listing-toggle.test.tsx`'s
 * own coverage exactly, adapted to this file's `groupId`/`groupMembershipId`/
 * `groupName` shape instead of `positionId`/`position`.
 *
 * `./actions` and `sonner` are mocked so this can mount without pulling
 * `@/lib/groups` into the module graph.
 *
 * What this file exists to pin:
 *   - the Switch's visible `checked` state never flips on a bare click —
 *     only the AlertDialog opens, staging the requested direction;
 *   - the confirmation copy names BOTH the person and the group, and differs
 *     by direction (ON warns about internet-wide/search-engine visibility;
 *     OFF warns it stops future serving but does not retract anything
 *     already cached);
 *   - Cancel calls the action zero times and leaves the switch unchanged;
 *   - Confirm calls the action with the exact groupMembershipId/publicListed/
 *     groupId trio, and only THEN does the switch/badge reflect the new
 *     state;
 *   - a denied result (including the derived-group `invalid_target` collapse
 *     the underlying mutation returns) surfaces via toast.error and leaves
 *     the switch at its prior committed value, never the attempted one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockSetGroupMembershipPublicListedAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  setGroupMembershipPublicListedAction: (...args: unknown[]) =>
    mockSetGroupMembershipPublicListedAction(...args),
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
  mockSetGroupMembershipPublicListedAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterRefresh.mockReset();
});

function renderToggle(publicListed = false) {
  return render(
    <PublicListingToggle
      slug="alder-creek"
      groupId="group-1"
      groupMembershipId="membership-1"
      groupName="Missions Committee"
      personName="Marisol Windham"
      publicListed={publicListed}
    />,
  );
}

describe("PublicListingToggle (groups) — initial render", () => {
  it("renders no Public badge and an unchecked switch when not publicly listed", () => {
    renderToggle(false);
    expect(screen.queryByText("Public")).toBeNull();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("renders a Public badge and a checked switch when already publicly listed", () => {
    renderToggle(true);
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });
});

describe("PublicListingToggle (groups) — clicking the switch stages, never flips, immediately", () => {
  it("opens the confirmation dialog, naming both person and group, without changing the switch's own visible state", () => {
    renderToggle(false);
    fireEvent.click(screen.getByRole("switch"));

    expect(
      screen.getByText("List Marisol Windham publicly on Missions Committee's roster?"),
    ).toBeTruthy();
    expect(
      screen.getByRole("switch", { hidden: true }).getAttribute("aria-checked"),
    ).toBe("false");
    expect(mockSetGroupMembershipPublicListedAction).not.toHaveBeenCalled();
  });

  it("names internet-wide/search-engine visibility when turning the listing ON", () => {
    renderToggle(false);
    fireEvent.click(screen.getByRole("switch"));
    expect(
      screen.getByText(/visible to anyone visiting the public website/i),
    ).toBeTruthy();
    expect(screen.getByText(/search engines/i)).toBeTruthy();
  });

  it("names both person and group, and the no-retraction caveat, when turning an existing listing OFF", () => {
    renderToggle(true);
    fireEvent.click(screen.getByRole("switch"));
    expect(
      screen.getByText("Stop listing Marisol Windham publicly on Missions Committee's roster?"),
    ).toBeTruthy();
    expect(
      screen.getByText(/does not retract anything already cached/i),
    ).toBeTruthy();
  });
});

describe("PublicListingToggle (groups) — cancel", () => {
  it("calls the action zero times and leaves the switch unchanged", () => {
    renderToggle(false);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(mockSetGroupMembershipPublicListedAction).not.toHaveBeenCalled();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText("Public")).toBeNull();
  });
});

describe("PublicListingToggle (groups) — confirm ON", () => {
  it("calls the action with groupMembershipId/publicListed:true/groupId, then flips the switch and shows the Public badge", async () => {
    mockSetGroupMembershipPublicListedAction.mockResolvedValueOnce({
      ok: true,
      data: { groupMembershipId: "membership-1", publicListed: true },
    });
    renderToggle(false);
    fireEvent.click(screen.getByRole("switch"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /yes, list publicly/i }));
    });

    expect(mockSetGroupMembershipPublicListedAction).toHaveBeenCalledWith(
      "alder-creek",
      { groupMembershipId: "membership-1", publicListed: true, groupId: "group-1" },
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      "Marisol Windham is now listed publicly on Missions Committee's roster.",
    );
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Public")).toBeTruthy();
    expect(mockRouterRefresh).toHaveBeenCalled();
  });
});

describe("PublicListingToggle (groups) — confirm OFF", () => {
  it("calls the action with publicListed: false, then unchecks the switch and hides the badge", async () => {
    mockSetGroupMembershipPublicListedAction.mockResolvedValueOnce({
      ok: true,
      data: { groupMembershipId: "membership-1", publicListed: false },
    });
    renderToggle(true);
    fireEvent.click(screen.getByRole("switch"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /yes, stop listing/i }));
    });

    expect(mockSetGroupMembershipPublicListedAction).toHaveBeenCalledWith(
      "alder-creek",
      { groupMembershipId: "membership-1", publicListed: false, groupId: "group-1" },
    );
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText("Public")).toBeNull();
  });
});

describe("PublicListingToggle (groups) — denied result", () => {
  it("surfaces the server's own error via toast.error and leaves the switch at its prior committed value — covers the derived-group invalid_target collapse too", async () => {
    mockSetGroupMembershipPublicListedAction.mockResolvedValueOnce({
      ok: false,
      error: "That group membership no longer exists.",
    });
    renderToggle(false);
    fireEvent.click(screen.getByRole("switch"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /yes, list publicly/i }));
    });

    expect(toastError).toHaveBeenCalledWith("That group membership no longer exists.");
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText("Public")).toBeNull();
  });
});
