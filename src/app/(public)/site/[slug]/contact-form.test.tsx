// @vitest-environment jsdom
/**
 * Tests for <ContactForm> — the one anonymous write path in this feature
 * (DECISION-083). The form receives its `action` ALREADY BOUND on the server to
 * the page's site key (Track F, R5), so these tests hand it a mock: the real
 * action is a "use server" module whose implementation pulls `@/lib/sites`,
 * `@/lib/rate-limit`, and `next/headers` into the module graph.
 *
 * What this file exists to pin:
 *   - The honeypot field (`_hp`) exists, is empty by default, and is hidden
 *     from a real visitor (off-screen, `tabIndex={-1}`, `autoComplete="off"`).
 *   - Submitting calls the bound action with the FormData only. There is NO
 *     organization field in the form (the old hidden `__slug` is gone), so
 *     nothing a client edits in the DOM can name a different organization.
 *   - Success replaces the form with a persistent thank-you message (not
 *     just a toast that vanishes).
 *   - Failure shows an inline, persistent error banner alongside the toast.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// The bound server action the page passes in: `submitContactMessageAction.bind(null, key)`.
const mockSubmitContactMessageAction = vi.hoisted(() => vi.fn());
const boundAction = (formData: FormData) => mockSubmitContactMessageAction(formData);

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { ContactForm } from "./contact-form";

afterEach(() => {
  cleanup();
  mockSubmitContactMessageAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

function fillForm() {
  fireEvent.change(screen.getByLabelText(/^name$/i), {
    target: { value: "Nadia Okonkwo" },
  });
  fireEvent.change(screen.getByLabelText(/^email$/i), {
    target: { value: "nadia@example.invalid" },
  });
  fireEvent.change(screen.getByLabelText(/^message$/i), {
    target: { value: "Is there a Wednesday evening service?" },
  });
}

describe("ContactForm — the honeypot field", () => {
  it("renders a hidden _hp field, empty by default, unreachable by tab order", () => {
    render(<ContactForm action={boundAction} />);
    const honeypot = document.querySelector(
      'input[name="_hp"]',
    ) as HTMLInputElement;
    expect(honeypot).toBeTruthy();
    expect(honeypot.value).toBe("");
    expect(honeypot.tabIndex).toBe(-1);
    expect(honeypot.autocomplete).toBe("off");
  });
});

describe("ContactForm — submission", () => {
  it("submits through the bound action with the form's own fields", async () => {
    mockSubmitContactMessageAction.mockResolvedValue({ ok: true });
    render(<ContactForm action={boundAction} />);

    fillForm();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    });

    expect(mockSubmitContactMessageAction).toHaveBeenCalledTimes(1);
    const [formDataArg] = mockSubmitContactMessageAction.mock.calls[0];
    expect(formDataArg.get("name")).toBe("Nadia Okonkwo");
    expect(formDataArg.get("email")).toBe("nadia@example.invalid");
  });

  it("replaces the form with a persistent thank-you message on success", async () => {
    mockSubmitContactMessageAction.mockResolvedValue({ ok: true });
    render(<ContactForm action={boundAction} />);

    fillForm();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    });

    expect(screen.getByText(/thanks — your message has been sent/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /send message/i })).toBeNull();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("shows a persistent inline error banner (not just a toast) on failure", async () => {
    mockSubmitContactMessageAction.mockResolvedValue({
      ok: false,
      error: "Too many messages sent. Try again in 60 minutes.",
    });
    render(<ContactForm action={boundAction} />);

    fillForm();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    });

    expect(
      screen.getByText(/too many messages sent\. try again in 60 minutes\./i),
    ).toBeTruthy();
    expect(toastError).toHaveBeenCalled();
    // The form is still present — a rejected submission does not silently
    // lose the visitor's typed content.
    expect(screen.getByRole("button", { name: /send message/i })).toBeTruthy();
  });
});

describe("ContactForm - the organization is not a form field (Track F, R5, A10)", () => {
  it("renders no hidden input that names an organization, and posts none", async () => {
    mockSubmitContactMessageAction.mockResolvedValue({ ok: true });
    render(<ContactForm action={boundAction} />);

    expect(document.querySelector('input[name="__slug"]')).toBeNull();
    expect(document.querySelector('input[type="hidden"]')).toBeNull();

    fillForm();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    });

    const [formDataArg] = mockSubmitContactMessageAction.mock.calls[0];
    const names = [...(formDataArg as FormData).keys()].sort();
    expect(names).toEqual(["_hp", "body", "email", "name"]);
  });

  it("a field a visitor injects into the DOM to name another organization is not something the bound action reads", async () => {
    // The action's FIRST argument (the key) is bound on the server and cannot be reached from the
    // DOM: whatever extra input is appended, the form still calls the same bound function with
    // FormData alone. (The action itself ignores any `__slug` it is sent - actions.test.ts.)
    mockSubmitContactMessageAction.mockResolvedValue({ ok: true });
    render(<ContactForm action={boundAction} />);
    const injected = document.createElement("input");
    injected.type = "hidden";
    injected.name = "__slug";
    injected.value = "someone-elses-church";
    document.querySelector("form")!.appendChild(injected);

    fillForm();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    });

    expect(mockSubmitContactMessageAction).toHaveBeenCalledTimes(1);
    expect(mockSubmitContactMessageAction.mock.calls[0]).toHaveLength(1);
  });
});
