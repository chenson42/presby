// @vitest-environment jsdom
/**
 * Tests for <DisplayOrderInput> (groups) — public-directory-primitives
 * Phase 3/4 (docs/work-log/2026-08-28-public-directory-primitives.md),
 * ux-developer slice. Mirrors `admin/staff`/`admin/officers`'s own
 * `display-order-input.test.tsx` coverage exactly, adapted to this file's
 * `groupId`/`groupMembershipId` shape.
 *
 * `./actions` and `sonner` are mocked so this can mount without pulling
 * `@/lib/groups` into the module graph.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  setGroupMembershipPublicDisplayOrderAction: (...args: unknown[]) =>
    mockAction(...args),
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

import { DisplayOrderInput } from "./display-order-input";

afterEach(() => {
  cleanup();
  mockAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterRefresh.mockReset();
});

function renderInput(publicDisplayOrder: number | null = null) {
  return render(
    <DisplayOrderInput
      slug="alder-creek"
      groupId="group-1"
      groupMembershipId="membership-1"
      personName="Marisol Windham"
      publicDisplayOrder={publicDisplayOrder}
    />,
  );
}

describe("DisplayOrderInput (groups) — initial render", () => {
  it("starts blank when publicDisplayOrder is null", () => {
    renderInput(null);
    expect(screen.getByLabelText(/Marisol Windham/i)).toHaveProperty("value", "");
  });

  it("shows the numeric value when set", () => {
    renderInput(3);
    expect(screen.getByLabelText(/Marisol Windham/i)).toHaveProperty("value", "3");
  });
});

describe("DisplayOrderInput (groups) — no-op blur", () => {
  it("never calls the server action when the value is unchanged", () => {
    renderInput(3);
    const input = screen.getByLabelText(/Marisol Windham/i);
    fireEvent.blur(input);
    expect(mockAction).not.toHaveBeenCalled();
  });
});

describe("DisplayOrderInput (groups) — committing a change", () => {
  it("commits the parsed integer AND the caller-supplied groupId (for revalidatePath) on blur, and refreshes the router on success", async () => {
    mockAction.mockResolvedValueOnce({
      ok: true,
      data: { groupMembershipId: "membership-1", publicDisplayOrder: 2 },
    });
    renderInput(null);
    const input = screen.getByLabelText(/Marisol Windham/i);
    fireEvent.change(input, { target: { value: "2" } });

    await act(async () => {
      fireEvent.blur(input);
    });

    expect(mockAction).toHaveBeenCalledWith("alder-creek", {
      groupMembershipId: "membership-1",
      publicDisplayOrder: 2,
      groupId: "group-1",
    });
    expect(mockRouterRefresh).toHaveBeenCalled();
  });

  it("commits null when the field is emptied out", async () => {
    mockAction.mockResolvedValueOnce({
      ok: true,
      data: { groupMembershipId: "membership-1", publicDisplayOrder: null },
    });
    renderInput(2);
    const input = screen.getByLabelText(/Marisol Windham/i);
    fireEvent.change(input, { target: { value: "" } });

    await act(async () => {
      fireEvent.blur(input);
    });

    expect(mockAction).toHaveBeenCalledWith("alder-creek", {
      groupMembershipId: "membership-1",
      publicDisplayOrder: null,
      groupId: "group-1",
    });
  });

  it("commits on Enter the same way it commits on blur", async () => {
    mockAction.mockResolvedValueOnce({
      ok: true,
      data: { groupMembershipId: "membership-1", publicDisplayOrder: 5 },
    });
    renderInput(null);
    const input = screen.getByLabelText(/Marisol Windham/i);
    input.focus();
    fireEvent.change(input, { target: { value: "5" } });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(mockAction).toHaveBeenCalledWith("alder-creek", {
      groupMembershipId: "membership-1",
      publicDisplayOrder: 5,
      groupId: "group-1",
    });
  });
});

describe("DisplayOrderInput (groups) — client-side validation", () => {
  it("rejects a negative value without calling the server, and reverts the field", () => {
    renderInput(3);
    const input = screen.getByLabelText(/Marisol Windham/i);
    fireEvent.change(input, { target: { value: "-1" } });
    fireEvent.blur(input);

    expect(mockAction).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Display order must be a whole number, 0 or greater.",
    );
    expect(input).toHaveProperty("value", "3");
  });

  it("rejects a non-integer value without calling the server", () => {
    renderInput(null);
    const input = screen.getByLabelText(/Marisol Windham/i);
    fireEvent.change(input, { target: { value: "2.5" } });
    fireEvent.blur(input);

    expect(mockAction).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
    expect(input).toHaveProperty("value", "");
  });
});

describe("DisplayOrderInput (groups) — denied server result", () => {
  it("surfaces the server's own error via toast.error and reverts to the last-committed value — covers the derived-group invalid_target collapse too", async () => {
    mockAction.mockResolvedValueOnce({
      ok: false,
      error: "That group membership no longer exists.",
    });
    renderInput(3);
    const input = screen.getByLabelText(/Marisol Windham/i);
    fireEvent.change(input, { target: { value: "9" } });

    await act(async () => {
      fireEvent.blur(input);
    });

    expect(toastError).toHaveBeenCalledWith("That group membership no longer exists.");
    expect(input).toHaveProperty("value", "3");
  });
});
