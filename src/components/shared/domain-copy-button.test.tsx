// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { DomainCopyAllButton } from "./domain-copy-all-button";
import { copyText, DomainCopyButton } from "./domain-copy-button";

afterEach(() => {
  cleanup();
  toastSuccess.mockReset();
  toastError.mockReset();
  vi.unstubAllGlobals();
});

function stubClipboard(impl: (t: string) => Promise<void>) {
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

describe("DomainCopyButton", () => {
  it("copies the value, says so, and flips to 'Copied'", async () => {
    const write = stubClipboard(async () => {});
    render(
      <>
        <code id="v">presby-verify=abc</code>
        <DomainCopyButton value="presby-verify=abc" label="the record value" targetId="v" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy the record value" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith("presby-verify=abc"));
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("Copied"));
    expect(toastSuccess).toHaveBeenCalledWith("Copied.");
  });

  it("when the clipboard is refused it SELECTS the visible text and says to copy it by hand - never a silent no-op", async () => {
    stubClipboard(async () => {
      throw new Error("denied");
    });
    render(
      <>
        <code id="v">presby-verify=abc</code>
        <DomainCopyButton value="presby-verify=abc" label="the record value" targetId="v" />
      </>,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0]![0])).toMatch(/selected; copy it from there/);
    expect(window.getSelection()?.toString()).toBe("presby-verify=abc");
  });

  it("when there is no clipboard API at all the same fallback applies", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    expect(await copyText("x")).toBe(false);
  });

  it("has a 44px minimum target", () => {
    stubClipboard(async () => {});
    render(<DomainCopyButton value="x" label="the record name" />);
    expect(screen.getByRole("button").className).toMatch(/min-h-11/);
  });
});

describe("DomainCopyAllButton", () => {
  it("copies the whole text and exposes a mailto link", async () => {
    const write = stubClipboard(async () => {});
    render(<DomainCopyAllButton text="ALL THE RECORDS" mailto="mailto:?subject=s&body=b" idPrefix="c0" />);
    fireEvent.click(screen.getByRole("button", { name: /Copy all records as text/ }));
    await waitFor(() => expect(write).toHaveBeenCalledWith("ALL THE RECORDS"));
    expect(toastSuccess).toHaveBeenCalledWith("Copied all records.");
    expect(screen.getByRole("link", { name: /Email these to my DNS person/ }).getAttribute("href")).toBe("mailto:?subject=s&body=b");
    expect(screen.queryByLabelText("All records, as text")).toBeNull();
  });

  it("falls back to a read-only, selected text box when the clipboard is unavailable", async () => {
    stubClipboard(async () => {
      throw new Error("denied");
    });
    render(<DomainCopyAllButton text="ALL THE RECORDS" mailto="mailto:?" idPrefix="c0" />);
    fireEvent.click(screen.getByRole("button", { name: /Copy all records as text/ }));
    const box = (await screen.findByLabelText("All records, as text")) as HTMLTextAreaElement;
    expect(box.readOnly).toBe(true);
    expect(box.value).toBe("ALL THE RECORDS");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(toastError).toHaveBeenCalled();
  });
});

describe("hydration", () => {
  beforeEach(() => stubClipboard(async () => {}));
  it("the copy controls are disabled on the server render (before hydration) and enabled once hydrated", async () => {
    const { renderToString } = await import("react-dom/server");
    const html = renderToString(<DomainCopyButton value="x" label="the record name" />);
    expect(html).toMatch(/<button[^>]*disabled/);
    render(<DomainCopyButton value="x" label="the record name" />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  });
});
