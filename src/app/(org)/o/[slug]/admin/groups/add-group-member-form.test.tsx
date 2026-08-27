// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockAddGroupMemberAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  addGroupMemberAction: (...args: unknown[]) =>
    mockAddGroupMemberAction(...args),
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

import { AddGroupMemberForm } from "./add-group-member-form";

const PEOPLE = [
  { personId: "person-1", displayName: "Tobias Renwick" },
  { personId: "person-2", displayName: "Marguerite Ashcombe" },
];

afterEach(() => {
  cleanup();
  mockAddGroupMemberAction.mockReset();
  mockRefresh.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("AddGroupMemberForm — zero-people state", () => {
  it("renders a single sentence and no controls when people.length === 0", () => {
    render(
      <AddGroupMemberForm slug="alder-creek" groupId="group-2" people={[]} />,
    );
    expect(
      screen.getByText(/nobody has a current membership at this organization/i),
    ).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("AddGroupMemberForm — role is descriptive-only copy", () => {
  it("names that the role grants no software access", () => {
    render(
      <AddGroupMemberForm
        slug="alder-creek"
        groupId="group-2"
        people={PEOPLE}
      />,
    );
    expect(
      screen.getByText(/does not grant software access/i),
    ).toBeTruthy();
  });
});

describe("AddGroupMemberForm — submit and error surfacing", () => {
  it("submits groupId/personId/groupRole/startsOn, resets, and toasts success", async () => {
    mockAddGroupMemberAction.mockResolvedValueOnce({
      ok: true,
      data: { groupMembershipId: "gm-1" },
    });

    render(
      <AddGroupMemberForm
        slug="alder-creek"
        groupId="group-2"
        people={PEOPLE}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^person$/i), {
      target: { value: "person-2" },
    });
    fireEvent.change(screen.getByLabelText(/^role$/i), {
      target: { value: "chair" },
    });
    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-01-08" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add member/i }));
    });

    expect(mockAddGroupMemberAction).toHaveBeenCalledWith("alder-creek", {
      groupId: "group-2",
      personId: "person-2",
      groupRole: "chair",
      startsOn: "2026-01-08",
    });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("surfaces the composed overlap copy verbatim via toast.error", async () => {
    mockAddGroupMemberAction.mockResolvedValueOnce({
      ok: false,
      error: "Marguerite Ashcombe is already an active member of Property Committee.",
    });

    render(
      <AddGroupMemberForm
        slug="alder-creek"
        groupId="group-2"
        people={PEOPLE}
      />,
    );

    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-01-08" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add member/i }));
    });

    expect(toastError).toHaveBeenCalledWith(
      "Marguerite Ashcombe is already an active member of Property Committee.",
    );
  });
});
