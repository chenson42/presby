// @vitest-environment jsdom
/**
 * `FeaturesList` — the toggle admin's client component. Mocked at the
 * `./actions` boundary (`toggleFeatureAction`'s own contract is proven by
 * `actions.test.ts`); this file pins the CLIENT-side behavior: optimistic
 * toggle, rollback on a denied result, and the empty state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockToggleFeatureAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  toggleFeatureAction: (...args: unknown[]) => mockToggleFeatureAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { FeaturesList } from "./features-list";
import type { FeatureToggleEntry } from "@/lib/org-features";

const TOGGLE: FeatureToggleEntry = {
  key: "org_portal.members_create",
  name: "Add & approve members",
  description: "Lets this congregation's admins create people.",
  enabled: false,
  updatedAt: null,
  updatedByEmail: null,
};

afterEach(() => {
  cleanup();
  mockRefresh.mockClear();
  mockToggleFeatureAction.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe("FeaturesList — empty state", () => {
  it("shows a designed empty state, not a blank screen", () => {
    render(<FeaturesList slug="alder-creek" toggles={[]} />);
    expect(screen.getByText(/no optional features yet/i)).toBeTruthy();
  });
});

describe("FeaturesList — toggling", () => {
  it("flips the switch immediately (optimistic) and calls the action with the new value", async () => {
    mockToggleFeatureAction.mockResolvedValue({ ok: true });
    render(<FeaturesList slug="alder-creek" toggles={[TOGGLE]} />);

    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);

    expect(mockToggleFeatureAction).toHaveBeenCalledWith("alder-creek", {
      key: "org_portal.members_create",
      enabled: true,
    });
  });

  it("rolls back the switch and shows a toast error when the action is denied", async () => {
    mockToggleFeatureAction.mockResolvedValue({
      ok: false,
      error: "You don't have permission to manage features here.",
    });
    render(<FeaturesList slug="alder-creek" toggles={[TOGGLE]} />);

    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);

    // Wait for the async action to resolve and the rollback to apply.
    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "You don't have permission to manage features here.",
      );
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });
});
