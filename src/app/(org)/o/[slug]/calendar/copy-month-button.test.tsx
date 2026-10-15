// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const hydrated = vi.hoisted(() => ({ value: true }));
vi.mock("@/components/shared/use-hydrated", () => ({
  useHydrated: () => hydrated.value,
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { CopyMonthButton } from "./copy-month-button";

class FakeClipboardItem {
  constructor(public data: Record<string, Blob>) {}
}

const write = vi.fn();

beforeEach(() => {
  hydrated.value = true;
  write.mockReset();
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
});

afterEach(() => {
  cleanup();
  toastSuccess.mockReset();
  toastError.mockReset();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
});

function renderButton(props: Partial<React.ComponentProps<typeof CopyMonthButton>> = {}) {
  return render(
    <CopyMonthButton
      html="<h2>October 2026</h2>"
      text={"October 2026\n"}
      leftOutCount={0}
      filterLabel={null}
      {...props}
    />,
  );
}

describe("CopyMonthButton", () => {
  it("is disabled until the page has hydrated (a pre-hydration click would be lost)", () => {
    hydrated.value = false;
    renderButton();
    expect(screen.getByRole("button", { name: "Copy month" }).hasAttribute("disabled")).toBe(true);
  });

  it("is enabled once hydrated, at a 44px target", () => {
    renderButton();
    const button = screen.getByRole("button", { name: "Copy month" });
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.className).toContain("min-h-11");
  });

  it("calls navigator.clipboard.write synchronously in the click, with an HTML and a plain-text blob", () => {
    write.mockReturnValue(new Promise(() => {})); // never settles: only the synchronous part runs
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Copy month" }));

    // No await between the click and this assertion: the write happened in the gesture.
    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0][0][0] as FakeClipboardItem;
    expect(Object.keys(item.data).sort()).toEqual(["text/html", "text/plain"]);
    expect(item.data["text/html"].type).toBe("text/html");
    expect(item.data["text/plain"].type).toBe("text/plain");
  });

  it("toasts 'Calendar copied' on success", async () => {
    write.mockResolvedValue(undefined);
    renderButton();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy month" }));
    });
    expect(toastSuccess).toHaveBeenCalledWith("Calendar copied");
  });

  it("names the members-only events left out and the filter in the success toast", async () => {
    write.mockResolvedValue(undefined);
    renderButton({ leftOutCount: 1, filterLabel: "Worship only" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy month" }));
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      "Calendar copied (1 members-only event left out; Worship only)",
    );
  });

  it("toasts an error when the browser rejects the write", async () => {
    write.mockRejectedValue(new Error("denied"));
    renderButton();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy month" }));
    });
    expect(toastError).toHaveBeenCalledWith("Couldn't copy the calendar. Try again.");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("toasts an error when write throws synchronously", () => {
    write.mockImplementation(() => {
      throw new Error("boom");
    });
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Copy month" }));
    expect(toastError).toHaveBeenCalledWith("Couldn't copy the calendar. Try again.");
  });

  it("toasts when the browser has no clipboard API", () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Copy month" }));
    expect(toastError).toHaveBeenCalledWith("Your browser can't copy to the clipboard.");
  });

  it("toasts when ClipboardItem is missing", () => {
    vi.stubGlobal("ClipboardItem", undefined);
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Copy month" }));
    expect(toastError).toHaveBeenCalledWith("Your browser can't copy to the clipboard.");
    expect(write).not.toHaveBeenCalled();
  });

  it("never renders the HTML string into the DOM", () => {
    const { container } = renderButton({ html: "<h2>SECRET-MARKER</h2>" });
    expect(container.innerHTML).not.toContain("SECRET-MARKER");
  });
});
