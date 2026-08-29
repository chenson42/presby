// @vitest-environment jsdom
/**
 * Tests for <DisplayOrderInput> (officers) — public-directory-primitives
 * Phase 3/4 (docs/work-log/2026-08-28-public-directory-primitives.md),
 * ux-developer slice.
 *
 * `./actions` and `sonner` are mocked so this can mount without pulling
 * `@/lib/officers` into the module graph — same reasoning
 * `public-listing-toggle.test.tsx`'s header gives for the sibling control.
 *
 * What this file exists to pin:
 *   - the input starts blank when `publicDisplayOrder` is `null`, and shows
 *     the numeric value otherwise;
 *   - blurring with NO change never calls the server action at all;
 *   - blurring after a change commits the parsed integer (or `null` for an
 *     emptied field), and refreshes the router on success;
 *   - a negative or non-integer value is rejected client-side (toast.error,
 *     reverted to the last-committed value, action never called);
 *   - a denied/failed server result surfaces via toast.error and reverts the
 *     input to the last-committed value, never leaving the rejected attempt
 *     displayed;
 *   - Enter commits the same way blur does (no AlertDialog anywhere — this
 *     control is presentation-order only, unlike PublicListingToggle).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  setOfficerTermPublicDisplayOrderAction: (...args: unknown[]) =>
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
      termId="term-1"
      personName="Marisol Windham"
      publicDisplayOrder={publicDisplayOrder}
    />,
  );
}

describe("DisplayOrderInput (officers) — initial render", () => {
  it("starts blank when publicDisplayOrder is null", () => {
    renderInput(null);
    expect(screen.getByLabelText(/Marisol Windham/i)).toHaveProperty("value", "");
  });

  it("shows the numeric value when set", () => {
    renderInput(3);
    expect(screen.getByLabelText(/Marisol Windham/i)).toHaveProperty("value", "3");
  });
});

describe("DisplayOrderInput (officers) — no-op blur", () => {
  it("never calls the server action when the value is unchanged", () => {
    renderInput(3);
    const input = screen.getByLabelText(/Marisol Windham/i);
    fireEvent.blur(input);
    expect(mockAction).not.toHaveBeenCalled();
  });
});

describe("DisplayOrderInput (officers) — committing a change", () => {
  it("commits the parsed integer on blur, and refreshes the router on success", async () => {
    mockAction.mockResolvedValueOnce({
      ok: true,
      data: { termId: "term-1", publicDisplayOrder: 2 },
    });
    renderInput(null);
    const input = screen.getByLabelText(/Marisol Windham/i);
    fireEvent.change(input, { target: { value: "2" } });

    await act(async () => {
      fireEvent.blur(input);
    });

    expect(mockAction).toHaveBeenCalledWith("alder-creek", {
      termId: "term-1",
      publicDisplayOrder: 2,
    });
    expect(mockRouterRefresh).toHaveBeenCalled();
  });

  it("commits null when the field is emptied out", async () => {
    mockAction.mockResolvedValueOnce({
      ok: true,
      data: { termId: "term-1", publicDisplayOrder: null },
    });
    renderInput(2);
    const input = screen.getByLabelText(/Marisol Windham/i);
    fireEvent.change(input, { target: { value: "" } });

    await act(async () => {
      fireEvent.blur(input);
    });

    expect(mockAction).toHaveBeenCalledWith("alder-creek", {
      termId: "term-1",
      publicDisplayOrder: null,
    });
  });

  it("commits on Enter the same way it commits on blur", async () => {
    mockAction.mockResolvedValueOnce({
      ok: true,
      data: { termId: "term-1", publicDisplayOrder: 5 },
    });
    renderInput(null);
    const input = screen.getByLabelText(/Marisol Windham/i);
    input.focus();
    fireEvent.change(input, { target: { value: "5" } });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(mockAction).toHaveBeenCalledWith("alder-creek", {
      termId: "term-1",
      publicDisplayOrder: 5,
    });
  });
});

describe("DisplayOrderInput (officers) — client-side validation", () => {
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

describe("DisplayOrderInput (officers) — denied server result", () => {
  it("surfaces the server's own error via toast.error and reverts to the last-committed value", async () => {
    mockAction.mockResolvedValueOnce({
      ok: false,
      error: "You don't have permission to manage officer terms here.",
    });
    renderInput(3);
    const input = screen.getByLabelText(/Marisol Windham/i);
    fireEvent.change(input, { target: { value: "9" } });

    await act(async () => {
      fireEvent.blur(input);
    });

    expect(toastError).toHaveBeenCalledWith(
      "You don't have permission to manage officer terms here.",
    );
    expect(input).toHaveProperty("value", "3");
  });
});
