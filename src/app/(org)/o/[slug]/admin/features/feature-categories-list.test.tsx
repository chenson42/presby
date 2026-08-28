// @vitest-environment jsdom
/**
 * `FeatureCategoriesList` — the category-picker client component (docs/
 * work-log/2026-08-27-feature-categories.md, Phase 3/4; DECISION-130).
 * Mirrors `features-list.test.tsx`'s exact assertion style: mocked at the
 * `./actions` boundary (`toggleFeatureCategoryAction`'s own contract is
 * proven by `actions.test.ts`), this file pins the CLIENT-side behavior —
 * optimistic toggle, rollback on a denied result, and the fresh-install
 * intro copy (Phase 1 Gap 8).
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

const mockToggleFeatureCategoryAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  toggleFeatureCategoryAction: (...args: unknown[]) =>
    mockToggleFeatureCategoryAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { FeatureCategoriesList } from "./feature-categories-list";
import type { FeatureCategoryEntry } from "@/lib/org-feature-categories";

const PEOPLE: FeatureCategoryEntry = {
  category: "people",
  label: "People & Membership",
  enabled: true,
  updatedAt: null,
  updatedByEmail: null,
};

const WORSHIP: FeatureCategoryEntry = {
  category: "worship",
  label: "Worship & Events",
  enabled: false,
  updatedAt: "2026-08-20T00:00:00.000Z",
  updatedByEmail: "clerk@example.invalid",
};

afterEach(() => {
  cleanup();
  mockRefresh.mockClear();
  mockToggleFeatureCategoryAction.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe("FeatureCategoriesList — fresh-install copy (Phase 1 Gap 8)", () => {
  it("reads as a default-on choice, not an error or empty state", () => {
    render(<FeatureCategoriesList slug="alder-creek" categories={[PEOPLE]} />);
    expect(
      screen.getByRole("heading", { name: /^ministry areas$/i }),
    ).toBeTruthy();
    expect(screen.getByText(/all are on by default/i)).toBeTruthy();
    // Distinct from FeaturesList's own "No optional features yet" empty
    // state — never rendered by this component at all.
    expect(screen.queryByText(/no optional features yet/i)).toBeNull();
  });
});

describe("FeatureCategoriesList — toggling", () => {
  it("flips the switch immediately (optimistic) and calls the action with the new value", () => {
    mockToggleFeatureCategoryAction.mockResolvedValue({ ok: true });
    render(<FeatureCategoriesList slug="alder-creek" categories={[WORSHIP]} />);

    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);

    expect(mockToggleFeatureCategoryAction).toHaveBeenCalledWith(
      "alder-creek",
      { category: "worship", enabled: true },
    );
  });

  it("rolls back the switch and shows a toast error when the action is denied", async () => {
    mockToggleFeatureCategoryAction.mockResolvedValue({
      ok: false,
      error: "You don't have permission to manage features here.",
    });
    render(<FeatureCategoriesList slug="alder-creek" categories={[PEOPLE]} />);

    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "You don't have permission to manage features here.",
      );
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("renders every offered category as its own row", () => {
    render(
      <FeatureCategoriesList
        slug="alder-creek"
        categories={[PEOPLE, WORSHIP]}
      />,
    );
    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(screen.getByText("People & Membership")).toBeTruthy();
    expect(screen.getByText("Worship & Events")).toBeTruthy();
  });
});
