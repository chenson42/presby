// @vitest-environment jsdom
/**
 * <AcceptNewAccountForm>: labels tied to inputs, rules stated before the
 * password field, autocomplete, the show/hide toggle, and an inline
 * `role="alert"` error that takes focus (the offending field when there is
 * one) without wiping what the visitor typed. `../actions` is mocked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AcceptFormState } from "../actions";

const mockAccept = vi.hoisted(() => vi.fn());
vi.mock("../actions", () => ({
  acceptNewAccountAction: (prev: unknown, fd: FormData) => mockAccept(prev, fd),
}));

import { AcceptNewAccountForm } from "./accept-form";

const TOKEN = "A".repeat(43);

afterEach(() => {
  cleanup();
  mockAccept.mockReset();
});

function setup() {
  render(<AcceptNewAccountForm token={TOKEN} defaultFirstName="Wilhelmina" defaultLastName="Thorncastle" />);
}
const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /create account|creating/i }));
  });
}

describe("AcceptNewAccountForm", () => {
  it("labels every field, marks them required, and sets new-password autocomplete", () => {
    setup();
    for (const label of [/first name/i, /last name/i, /^password/i, /confirm password/i]) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input.getAttribute("aria-required")).toBe("true");
    }
    expect((screen.getByLabelText(/^password/i) as HTMLInputElement).autocomplete).toBe("new-password");
    expect((screen.getByLabelText(/confirm password/i) as HTMLInputElement).autocomplete).toBe("new-password");
    expect((screen.getByLabelText(/first name/i) as HTMLInputElement).value).toBe("Wilhelmina");
  });

  it("states the password rules before the password field and ties them to it", () => {
    setup();
    const rules = screen.getByText(/at least 8 characters/i);
    const password = screen.getByLabelText(/^password/i);
    expect(rules.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(password.getAttribute("aria-describedby")).toContain(rules.id);
  });

  it("the show/hide toggle flips both password fields and exposes its state", () => {
    setup();
    const toggle = screen.getByRole("button", { name: /show passwords/i });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect((screen.getByLabelText(/^password/i) as HTMLInputElement).type).toBe("text");
    expect((screen.getByLabelText(/confirm password/i) as HTMLInputElement).type).toBe("text");
    expect(screen.getByRole("button", { name: /hide passwords/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("posts the token as a hidden field with the typed values", async () => {
    mockAccept.mockResolvedValue({ status: "idle" } satisfies AcceptFormState);
    setup();
    type(/^password/i, "correct horse battery");
    type(/confirm password/i, "correct horse battery");
    await submit();
    const fd = mockAccept.mock.calls[0][1] as FormData;
    expect(fd.get("token")).toBe(TOKEN);
    expect(fd.get("firstName")).toBe("Wilhelmina");
    expect(fd.get("password")).toBe("correct horse battery");
    expect(fd.get("confirm")).toBe("correct horse battery");
  });

  it("renders a field error inline in a role=alert, focuses that field, flags it invalid and keeps the entries", async () => {
    mockAccept.mockResolvedValue({
      status: "error",
      code: "invalid_input",
      message: "Use at least 8 characters.",
      field: "password",
    } satisfies AcceptFormState);
    setup();
    type(/first name/i, "Wilma");
    type(/^password/i, "short");
    type(/confirm password/i, "short");
    await submit();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Use at least 8 characters.");
    const password = screen.getByLabelText(/^password/i) as HTMLInputElement;
    expect(document.activeElement).toBe(password);
    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(password.getAttribute("aria-describedby")).toContain(alert.id);
    expect((screen.getByLabelText(/first name/i) as HTMLInputElement).value).toBe("Wilma");
    expect(password.value).toBe("short");
  });

  it("a non-field error (the dead link, a database blip) focuses the alert itself", async () => {
    mockAccept.mockResolvedValue({
      status: "error",
      code: "db_error",
      message: "We can't finish setting up your account right now. Your link is still good.",
    } satisfies AcceptFormState);
    setup();
    await submit();
    const alert = screen.getByRole("alert");
    expect(document.activeElement).toBe(alert);
    expect(alert.textContent).toMatch(/your link is still good/i);
  });

  it("never calls a native dialog", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const alertSpy = vi.spyOn(window, "alert");
    mockAccept.mockResolvedValue({ status: "idle" } satisfies AcceptFormState);
    setup();
    await submit();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("a blocked acceptance removes the submit button (the token is spent); a retryable error keeps it", async () => {
    mockAccept.mockResolvedValueOnce({ status: "error", code: "blocked", message: "Contact the person who invited you." } satisfies AcceptFormState);
    setup();
    await submit();
    expect(screen.queryByRole("button", { name: /create account/i })).toBeNull();
    cleanup();
    mockAccept.mockResolvedValueOnce({ status: "error", code: "db_error", message: "Your link is still good." } satisfies AcceptFormState);
    setup();
    await submit();
    expect(screen.getByRole("button", { name: /create account/i })).toBeTruthy();
  });
});
