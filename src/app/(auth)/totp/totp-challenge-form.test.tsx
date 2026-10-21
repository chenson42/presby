// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const hydrated = vi.hoisted(() => ({ value: true }));
vi.mock("@/components/shared/use-hydrated", () => ({
  useHydrated: () => hydrated.value,
}));

const formStatus = vi.hoisted(() => ({ pending: false }));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, useFormStatus: () => ({ ...actual.useFormStatus(), pending: formStatus.pending }) };
});

const verifyTotpAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ verifyTotpAction }));

import { TotpChallengeForm } from "./totp-challenge-form";

beforeEach(() => {
  hydrated.value = true;
  formStatus.pending = false;
  verifyTotpAction.mockReset();
});
afterEach(cleanup);

const boxes = () =>
  Array.from({ length: 6 }, (_, i) => screen.getByLabelText(`Digit ${i + 1} of 6`)) as HTMLInputElement[];
const verify = () => screen.getByRole("button", { name: /^verify|verifying/i }) as HTMLButtonElement;
const toggle = () =>
  screen.getByRole("button", { name: /recovery code instead|authenticator app instead/i });
const tokenFields = () => document.querySelectorAll('[name="token"]');
const typeCode = (code: string) =>
  code.split("").forEach((d, i) => fireEvent.change(boxes()[i]!, { target: { value: d } }));

describe("TotpChallengeForm", () => {
  it("renders the six-box group, focused on box 1, with Verify disabled", () => {
    render(<TotpChallengeForm callbackUrl="/admin" />);
    expect(screen.getByRole("group", { name: /6-digit code/i })).toBeTruthy();
    expect(document.activeElement).toBe(boxes()[0]);
    expect(verify().disabled).toBe(true);
  });

  it("is wrapped in a HydrationGate that is busy until hydration", () => {
    hydrated.value = false;
    render(<TotpChallengeForm callbackUrl="/admin" />);
    const gate = document.querySelector('fieldset[data-slot="hydration-gate"]') as HTMLFieldSetElement;
    expect(gate.disabled).toBe(true);
    expect(gate.getAttribute("aria-busy")).toBe("true");
    expect(gate.contains(verify())).toBe(true);
    expect(gate.contains(boxes()[0]!)).toBe(true);
    expect(document.activeElement).toBe(document.body);
  });

  it("enables Verify only at six digits and moves focus to it, without submitting", async () => {
    render(<TotpChallengeForm callbackUrl="/admin" />);
    typeCode("12345");
    expect(verify().disabled).toBe(true);
    typeCode("123456");
    await waitFor(() => expect(verify().disabled).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(verify()));
    expect(verifyTotpAction).not.toHaveBeenCalled();
  });

  it("a short code keeps Verify disabled", () => {
    render(<TotpChallengeForm callbackUrl="/admin" />);
    typeCode("123");
    expect(verify().disabled).toBe(true);
  });

  it("posts exactly one token field and the callbackUrl, to the unchanged action", async () => {
    render(<TotpChallengeForm callbackUrl="/o/alder/directory" />);
    typeCode("123456");
    await waitFor(() => expect(verify().disabled).toBe(false));
    await act(async () => {
      fireEvent.submit(document.querySelector("form")!);
    });
    expect(verifyTotpAction).toHaveBeenCalledTimes(1);
    const fd = verifyTotpAction.mock.calls[0]![0] as FormData;
    expect(fd.getAll("token")).toEqual(["123456"]);
    expect(fd.get("callbackUrl")).toBe("/o/alder/directory");
  });

  describe("mutually exclusive token fields (R6)", () => {
    it("digit mode has exactly one token field: the hidden joined value", () => {
      render(<TotpChallengeForm callbackUrl="/admin" />);
      expect(tokenFields()).toHaveLength(1);
      expect((tokenFields()[0] as HTMLInputElement).type).toBe("hidden");
    });

    it("the toggle swaps in a recovery field and removes the digit boxes", () => {
      render(<TotpChallengeForm callbackUrl="/admin" />);
      fireEvent.click(toggle());
      expect(screen.queryByLabelText(/digit 1 of 6/i)).toBeNull();
      expect(tokenFields()).toHaveLength(1);
      const field = tokenFields()[0] as HTMLInputElement;
      expect(field.type).toBe("text");
      expect(screen.getByLabelText("Recovery code")).toBe(field);
      expect(document.activeElement).toBe(field);
    });

    it("toggling back restores the digit boxes (one token field again) and refocuses box 1", () => {
      render(<TotpChallengeForm callbackUrl="/admin" />);
      fireEvent.click(toggle());
      fireEvent.click(toggle());
      expect(tokenFields()).toHaveLength(1);
      expect((tokenFields()[0] as HTMLInputElement).type).toBe("hidden");
      expect(boxes()).toHaveLength(6);
      expect(document.activeElement).toBe(boxes()[0]);
    });

    it("toggle labels name the other mode", () => {
      render(<TotpChallengeForm callbackUrl="/admin" />);
      expect(toggle().textContent).toBe("Use a recovery code instead");
      fireEvent.click(toggle());
      expect(toggle().textContent).toBe("Use my authenticator app instead");
    });

    it("a half-typed code does not leak into recovery mode or back", () => {
      render(<TotpChallengeForm callbackUrl="/admin" />);
      typeCode("123");
      fireEvent.click(toggle());
      expect((screen.getByLabelText("Recovery code") as HTMLInputElement).value).toBe("");
      fireEvent.click(toggle());
      expect(boxes().map((b) => b.value)).toEqual(["", "", "", "", "", ""]);
    });

    it("recovery mode enables Verify only for a non-blank value and posts it as the one token", async () => {
      render(<TotpChallengeForm callbackUrl="/admin" />);
      fireEvent.click(toggle());
      expect(verify().disabled).toBe(true);
      const field = screen.getByLabelText("Recovery code") as HTMLInputElement;
      fireEvent.change(field, { target: { value: "   " } });
      expect(verify().disabled).toBe(true);
      fireEvent.change(field, { target: { value: "ABCD-EFGH" } });
      expect(verify().disabled).toBe(false);
      await act(async () => {
        fireEvent.submit(document.querySelector("form")!);
      });
      const fd = verifyTotpAction.mock.calls[0]![0] as FormData;
      expect(fd.getAll("token")).toEqual(["ABCD-EFGH"]);
    });

    it("the recovery field keeps its text-entry hints", () => {
      render(<TotpChallengeForm callbackUrl="/admin" />);
      fireEvent.click(toggle());
      const field = screen.getByLabelText("Recovery code");
      expect(field.getAttribute("autocomplete")).toBe("off");
      expect(field.getAttribute("autocapitalize")).toBe("characters");
      expect(field.getAttribute("spellcheck")).toBe("false");
    });
  });

  describe("pending", () => {
    it("disables Verify and says Verifying while the action runs, even for a complete code", async () => {
      const { rerender } = render(<TotpChallengeForm callbackUrl="/admin" />);
      typeCode("123456");
      await waitFor(() => expect(verify().disabled).toBe(false));
      formStatus.pending = true;
      rerender(<TotpChallengeForm callbackUrl="/admin" />);
      expect(verify().disabled).toBe(true);
      expect(verify().textContent).toBe("Verifying…");
    });
  });

  describe("errors", () => {
    it("shows nothing and marks nothing invalid with no error", () => {
      render(<TotpChallengeForm callbackUrl="/admin" />);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(boxes()[0]!.getAttribute("aria-invalid")).toBeNull();
    });

    it("invalid: one role=alert message, the existing copy, wired to every box", () => {
      render(<TotpChallengeForm callbackUrl="/admin" error="invalid" />);
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toBe("That code didn't match. Try again, or use a recovery code.");
      expect(screen.getAllByText(/didn.t match/i)).toHaveLength(1);
      for (const b of boxes()) {
        expect(b.getAttribute("aria-invalid")).toBe("true");
        expect(b.getAttribute("aria-describedby")).toBe(alert.id);
      }
      expect(alert.className).toContain("text-destructive");
      expect(alert.className).not.toMatch(/red-\d/);
    });

    it("rate_limited: the wait copy", () => {
      render(<TotpChallengeForm callbackUrl="/admin" error="rate_limited" />);
      expect(screen.getByRole("alert").textContent).toBe(
        "Too many attempts. Please wait a moment before trying again.",
      );
    });

    it("the error is wired to the recovery field too", () => {
      render(<TotpChallengeForm callbackUrl="/admin" error="invalid" />);
      fireEvent.click(toggle());
      const field = screen.getByLabelText("Recovery code");
      expect(field.getAttribute("aria-invalid")).toBe("true");
      expect(field.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    });
  });
});
