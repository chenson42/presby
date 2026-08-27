// @vitest-environment jsdom
/**
 * Component test for `NewGroupForm` — docs/work-log/2026-08-26-groups-admin.md,
 * Phase 4 commit 2. Mirrors `add-officer-term-form.test.tsx`'s style: the
 * group-type `<select>` only ever renders the options it was handed
 * (`getGroupFormOptions()`'s own server-side filter, never re-implemented
 * here), and a successful submit calls `createGroupAction` with the
 * expected shape and surfaces its result via toast.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockCreateGroupAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  createGroupAction: (...args: unknown[]) => mockCreateGroupAction(...args),
}));

const mockPush = vi.hoisted(() => vi.fn());
const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { NewGroupForm } from "./new-group-form";

const OPTIONS = {
  groupTypes: [
    { id: "type-committee", key: "committee" as const, name: "Committee" },
    { id: "type-choir", key: "choir" as const, name: "Choir" },
  ],
  people: [{ personId: "person-1", displayName: "Tobias Renwick" }],
};

afterEach(() => {
  cleanup();
  mockCreateGroupAction.mockReset();
  mockPush.mockReset();
  mockRefresh.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("NewGroupForm", () => {
  it("renders only the manageable-subset group types it was handed, nothing else", () => {
    render(<NewGroupForm slug="alder-creek" options={OPTIONS} />);
    expect(screen.getByRole("option", { name: "Committee" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Choir" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /court/i })).toBeNull();
    expect(screen.queryByRole("option", { name: /roster/i })).toBeNull();
  });

  it("renders a message instead of a form when no group types are available", () => {
    render(
      <NewGroupForm
        slug="alder-creek"
        options={{ groupTypes: [], people: [] }}
      />,
    );
    expect(screen.getByText(/no group types are available/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /create group/i })).toBeNull();
  });

  it("submits the chosen groupTypeId and name, and shows a success toast on ok", async () => {
    mockCreateGroupAction.mockResolvedValueOnce({
      ok: true,
      data: { groupId: "group-99" },
    });

    render(<NewGroupForm slug="alder-creek" options={OPTIONS} />);

    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Property Committee" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create group/i }));
    });

    expect(mockCreateGroupAction).toHaveBeenCalledWith(
      "alder-creek",
      expect.objectContaining({
        groupTypeId: "type-committee",
        name: "Property Committee",
      }),
    );
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith(
      "/o/alder-creek/admin/groups/group-99",
    );
  });

  it("surfaces the server's error copy verbatim via toast.error on failure", async () => {
    mockCreateGroupAction.mockResolvedValueOnce({
      ok: false,
      error:
        "Choose a valid group type — committee, small group, choir, or team.",
    });

    render(<NewGroupForm slug="alder-creek" options={OPTIONS} />);
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Property Committee" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create group/i }));
    });

    expect(toastError).toHaveBeenCalledWith(
      "Choose a valid group type — committee, small group, choir, or team.",
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});
