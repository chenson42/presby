// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockUpdateGroupAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  updateGroupAction: (...args: unknown[]) => mockUpdateGroupAction(...args),
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

import { EditGroupForm } from "./edit-group-form";

afterEach(() => {
  cleanup();
  mockUpdateGroupAction.mockReset();
  mockPush.mockReset();
  mockRefresh.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("EditGroupForm", () => {
  it("pre-fills the existing name/description/meetsWhen", () => {
    render(
      <EditGroupForm
        slug="alder-creek"
        groupId="group-2"
        name="Property Committee"
        description="Handles building maintenance"
        meetsWhen="First Monday"
      />,
    );
    expect(screen.getByDisplayValue("Property Committee")).toBeTruthy();
    expect(
      screen.getByDisplayValue("Handles building maintenance"),
    ).toBeTruthy();
    expect(screen.getByDisplayValue("First Monday")).toBeTruthy();
  });

  it("submits the edited name and navigates back to the detail page on success", async () => {
    mockUpdateGroupAction.mockResolvedValueOnce({
      ok: true,
      data: { groupId: "group-2" },
    });

    render(
      <EditGroupForm
        slug="alder-creek"
        groupId="group-2"
        name="Property Committee"
        description={null}
        meetsWhen={null}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Renamed Committee" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    });

    expect(mockUpdateGroupAction).toHaveBeenCalledWith("alder-creek", {
      groupId: "group-2",
      name: "Renamed Committee",
      description: undefined,
      meetsWhen: undefined,
    });
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith(
      "/o/alder-creek/admin/groups/group-2",
    );
  });

  it("surfaces the derived-group denial copy verbatim via toast.error, without navigating away", async () => {
    mockUpdateGroupAction.mockResolvedValueOnce({
      ok: false,
      error: "That group doesn't exist, or can't be edited directly.",
    });

    render(
      <EditGroupForm
        slug="alder-creek"
        groupId="group-2"
        name="Property Committee"
        description={null}
        meetsWhen={null}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    });

    expect(toastError).toHaveBeenCalledWith(
      "That group doesn't exist, or can't be edited directly.",
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});
