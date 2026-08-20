// @vitest-environment jsdom
/**
 * Tests for <ContactForm> — the one anonymous write path in this feature
 * (DECISION-083). `./actions` is mocked — a "use server" module whose real
 * implementation pulls `@/lib/sites`, `@/lib/rate-limit`, and `next/headers`
 * into the module graph, same reasoning `file-ticket-form.test.tsx`'s header
 * gives for its own mock.
 *
 * What this file exists to pin:
 *   - The honeypot field (`_hp`) exists, is empty by default, and is hidden
 *     from a real visitor (off-screen, `tabIndex={-1}`, `autoComplete="off"`).
 *   - Submitting calls `submitContactMessageAction(slug, formData)` with the
 *     slug baked into the form, never something a client could override to a
 *     different organization.
 *   - Success replaces the form with a persistent thank-you message (not
 *     just a toast that vanishes).
 *   - Failure shows an inline, persistent error banner alongside the toast.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockSubmitContactMessageAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  submitContactMessageAction: (...args: unknown[]) =>
    mockSubmitContactMessageAction(...args),
}));

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
    render(<ContactForm slug="alder-creek" />);
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
  it("submits through submitContactMessageAction with the slug baked into the form", async () => {
    mockSubmitContactMessageAction.mockResolvedValue({ ok: true });
    render(<ContactForm slug="alder-creek" />);

    fillForm();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    });

    expect(mockSubmitContactMessageAction).toHaveBeenCalledTimes(1);
    const [slugArg, formDataArg] = mockSubmitContactMessageAction.mock.calls[0];
    expect(slugArg).toBe("alder-creek");
    expect(formDataArg.get("name")).toBe("Nadia Okonkwo");
    expect(formDataArg.get("email")).toBe("nadia@example.invalid");
  });

  it("replaces the form with a persistent thank-you message on success", async () => {
    mockSubmitContactMessageAction.mockResolvedValue({ ok: true });
    render(<ContactForm slug="alder-creek" />);

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
    render(<ContactForm slug="alder-creek" />);

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
