// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockEndGroupMembershipAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  endGroupMembershipAction: (...args: unknown[]) =>
    mockEndGroupMembershipAction(...args),
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

import { EndGroupMembershipDialog } from "./end-group-membership-dialog";

afterEach(() => {
  cleanup();
  mockEndGroupMembershipAction.mockReset();
  mockRefresh.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

const PROPS = {
  slug: "alder-creek",
  groupMembershipId: "gm-1",
  groupId: "group-2",
  personId: "person-2",
  personName: "Tobias Renwick",
  groupName: "Property Committee",
  startsOn: "2026-01-01",
};

describe("EndGroupMembershipDialog", () => {
  it("names BOTH the person and the group in the confirmation copy — never a generic 'Are you sure?'", async () => {
    render(<EndGroupMembershipDialog {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /end membership/i }));

    expect(
      await screen.findByText(
        /end tobias renwick.s membership in property committee\?/i,
      ),
    ).toBeTruthy();
  });

  it("calls endGroupMembershipAction with groupMembershipId/endsOn/personId/groupId/groupName on confirm", async () => {
    mockEndGroupMembershipAction.mockResolvedValueOnce({
      ok: true,
      data: { groupMembershipId: "gm-1" },
    });

    render(<EndGroupMembershipDialog {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /end membership/i }));

    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: /yes, end membership/i }),
      );
    });

    expect(mockEndGroupMembershipAction).toHaveBeenCalledWith("alder-creek", {
      groupMembershipId: "gm-1",
      endsOn: expect.any(String),
      personId: "person-2",
      groupId: "group-2",
      groupName: "Property Committee",
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      "Tobias Renwick is no longer active in Property Committee.",
    );
  });

  it("surfaces the server's error copy verbatim via toast.error on failure", async () => {
    mockEndGroupMembershipAction.mockResolvedValueOnce({
      ok: false,
      error: "That group membership no longer exists.",
    });

    render(<EndGroupMembershipDialog {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /end membership/i }));

    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: /yes, end membership/i }),
      );
    });

    expect(toastError).toHaveBeenCalledWith(
      "That group membership no longer exists.",
    );
  });
});
