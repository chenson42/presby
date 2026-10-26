// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
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
const paste = (box: HTMLElement, text: string) =>
  fireEvent.paste(box, { clipboardData: { getData: () => text } });
const lastFormData = (n = verifyTotpAction.mock.calls.length - 1) =>
  verifyTotpAction.mock.calls[n]![0] as FormData;

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

  it("enables Verify at six digits", async () => {
    render(<TotpChallengeForm callbackUrl="/admin" />);
    typeCode("12345");
    expect(verify().disabled).toBe(true);
    typeCode("123456");
    await waitFor(() => expect(verify().disabled).toBe(false));
  });

  it("a short code keeps Verify disabled", () => {
    render(<TotpChallengeForm callbackUrl="/admin" />);
    typeCode("123");
    expect(verify().disabled).toBe(true);
  });

  it("F-1: the sixth digit posts exactly one token field and the callbackUrl, once, to the unchanged action", async () => {
    render(<TotpChallengeForm callbackUrl="/o/alder/directory" />);
    typeCode("123456");
    await waitFor(() => expect(verifyTotpAction).toHaveBeenCalledTimes(1));
    const fd = lastFormData(0);
    // The hidden value must already carry all six digits (DECISION-257: never submit
    // from the change handler, which runs before the hidden input commits).
    expect(fd.getAll("token")).toEqual(["123456"]);
    expect(fd.get("callbackUrl")).toBe("/o/alder/directory");
  });

  describe("auto-submit (DECISION-257)", () => {
    it("F-2: five digits never submit", async () => {
      render(<TotpChallengeForm callbackUrl="/admin" />);
      typeCode("12345");
      await act(async () => {});
      expect(verifyTotpAction).not.toHaveBeenCalled();
    });

    it("F-3: a spaced paste submits once", async () => {
      render(<TotpChallengeForm callbackUrl="/admin" />);
      paste(boxes()[0]!, "123 456");
      await waitFor(() => expect(verifyTotpAction).toHaveBeenCalledTimes(1));
      expect(lastFormData(0).getAll("token")).toEqual(["123456"]);
    });

    it("F-3: a whole-code fill on box 1 submits once", async () => {
      render(<TotpChallengeForm callbackUrl="/admin" />);
      fireEvent.change(boxes()[0]!, { target: { value: "482915" } });
      await waitFor(() => expect(verifyTotpAction).toHaveBeenCalledTimes(1));
      expect(lastFormData(0).getAll("token")).toEqual(["482915"]);
    });

    it("F-4: recovery mode never auto-submits; the form still posts the one token", async () => {
      render(<TotpChallengeForm callbackUrl="/admin" />);
      fireEvent.click(toggle());
      const field = screen.getByLabelText("Recovery code") as HTMLInputElement;
      fireEvent.change(field, { target: { value: "123456" } });
      fireEvent.change(field, { target: { value: "ABCD-EFGH" } });
      await act(async () => {});
      expect(verifyTotpAction).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.submit(document.querySelector("form")!);
      });
      expect(lastFormData(0).getAll("token")).toEqual(["ABCD-EFGH"]);
    });

    it("F-4b: a code typed, then a switch to recovery and back, does not submit on the way", async () => {
      render(<TotpChallengeForm callbackUrl="/admin" />);
      typeCode("12345");
      fireEvent.click(toggle());
      fireEvent.click(toggle());
      await act(async () => {});
      expect(verifyTotpAction).not.toHaveBeenCalled();
    });

    it("F-5: a paste of more than six digits fills the boxes, does not submit, and Verify posts it", async () => {
      render(<TotpChallengeForm callbackUrl="/admin" />);
      paste(boxes()[0]!, "1234567");
      await act(async () => {});
      expect(verifyTotpAction).not.toHaveBeenCalled();
      expect(boxes().map((b) => b.value).join("")).toBe("123456");
      expect(verify().disabled).toBe(false);
      await act(async () => {
        fireEvent.click(verify());
      });
      expect(verifyTotpAction).toHaveBeenCalledTimes(1);
      expect(lastFormData(0).getAll("token")).toEqual(["123456"]);
    });

    it("F-5b: three typed digits plus a four-digit paste into box 4 fills six, drops one, does not submit — regression for O-1", async () => {
      render(<TotpChallengeForm callbackUrl="/admin" />);
      "123".split("").forEach((d, i) => fireEvent.change(boxes()[i]!, { target: { value: d } }));
      paste(boxes()[3]!, "4567");
      await act(async () => {});
      expect(verifyTotpAction).not.toHaveBeenCalled();
      expect(boxes().map((b) => b.value).join("")).toBe("123456");
      expect(verify().disabled).toBe(false);
      await act(async () => {
        fireEvent.click(verify());
      });
      expect(verifyTotpAction).toHaveBeenCalledTimes(1);
      expect(lastFormData(0).getAll("token")).toEqual(["123456"]);
    });

    it("F-6: nothing submits before hydration, and a mount with no edit submits nothing", async () => {
      hydrated.value = false;
      const { unmount } = render(<TotpChallengeForm callbackUrl="/admin" />);
      await act(async () => {});
      expect(verifyTotpAction).not.toHaveBeenCalled();
      unmount();
      hydrated.value = true;
      render(<TotpChallengeForm callbackUrl="/admin" />);
      await act(async () => {});
      expect(verifyTotpAction).not.toHaveBeenCalled();
    });

    it("F-7: while a submission is pending, a complete code does not submit and Verify is disabled", async () => {
      formStatus.pending = true;
      render(<TotpChallengeForm callbackUrl="/admin" />);
      typeCode("123456");
      await act(async () => {});
      expect(verifyTotpAction).not.toHaveBeenCalled();
      expect(verify().disabled).toBe(true);
      fireEvent.click(verify());
      await act(async () => {});
      expect(verifyTotpAction).not.toHaveBeenCalled();
    });

    it("F-8: the same complete code is not resubmitted by a re-render; a hole then the same digit re-arms", async () => {
      const { rerender } = render(<TotpChallengeForm callbackUrl="/admin" />);
      typeCode("123456");
      await waitFor(() => expect(verifyTotpAction).toHaveBeenCalledTimes(1));
      rerender(<TotpChallengeForm callbackUrl="/admin" />);
      rerender(<TotpChallengeForm callbackUrl="/admin" error="invalid" />);
      await act(async () => {});
      expect(verifyTotpAction).toHaveBeenCalledTimes(1);
      // Backspace on box 6 leaves a hole; typing the same digit completes the same code again.
      boxes()[5]!.focus();
      fireEvent.keyDown(boxes()[5]!, { key: "Backspace" });
      fireEvent.change(boxes()[5]!, { target: { value: "6" } });
      await waitFor(() => expect(verifyTotpAction).toHaveBeenCalledTimes(2));
      expect(lastFormData().getAll("token")).toEqual(["123456"]);
    });

    it("F-9: when the attempt settles the boxes clear, box 1 is focused, and a new code submits again", async () => {
      const { rerender } = render(<TotpChallengeForm callbackUrl="/admin" />);
      typeCode("123456");
      await waitFor(() => expect(verifyTotpAction).toHaveBeenCalledTimes(1));

      formStatus.pending = true;
      rerender(<TotpChallengeForm callbackUrl="/admin" />);
      // The same URL twice in a row: only completion, never the error prop, can reset the form.
      formStatus.pending = false;
      rerender(<TotpChallengeForm callbackUrl="/admin" error="invalid" />);

      await waitFor(() => expect(boxes().map((b) => b.value).join("")).toBe(""));
      await waitFor(() => expect(document.activeElement).toBe(boxes()[0]));
      expect(boxes()[0]!.getAttribute("aria-invalid")).toBe("true");

      typeCode("654321");
      await waitFor(() => expect(verifyTotpAction).toHaveBeenCalledTimes(2));
      expect(lastFormData().getAll("token")).toEqual(["654321"]);
    });

    it("F-9b: the same wrong code typed again after a settle is submitted again", async () => {
      const { rerender } = render(<TotpChallengeForm callbackUrl="/admin" error="invalid" />);
      typeCode("000000");
      await waitFor(() => expect(verifyTotpAction).toHaveBeenCalledTimes(1));
      formStatus.pending = true;
      rerender(<TotpChallengeForm callbackUrl="/admin" error="invalid" />);
      formStatus.pending = false;
      rerender(<TotpChallengeForm callbackUrl="/admin" error="invalid" />);
      await waitFor(() => expect(boxes().map((b) => b.value).join("")).toBe(""));
      typeCode("000000");
      await waitFor(() => expect(verifyTotpAction).toHaveBeenCalledTimes(2));
    });

    it("F-10: the status region exists at rest with no text, and says Verifying your code. while pending", () => {
      const { rerender } = render(<TotpChallengeForm callbackUrl="/admin" />);
      const region = screen.getByRole("status");
      expect(region.textContent).toBe("");
      expect(region.className).toContain("sr-only");
      formStatus.pending = true;
      rerender(<TotpChallengeForm callbackUrl="/admin" />);
      expect(screen.getByRole("status").textContent).toBe("Verifying your code.");
    });

    it("F-11: the recovery toggle is disabled while a submission is pending", () => {
      const { rerender } = render(<TotpChallengeForm callbackUrl="/admin" />);
      expect((toggle() as HTMLButtonElement).disabled).toBe(false);
      formStatus.pending = true;
      rerender(<TotpChallengeForm callbackUrl="/admin" />);
      expect((toggle() as HTMLButtonElement).disabled).toBe(true);
    });

    it("F-12: focus stays on box 6 after the sixth digit (nothing jumps to Verify)", async () => {
      render(<TotpChallengeForm callbackUrl="/admin" />);
      typeCode("123456");
      await waitFor(() => expect(verifyTotpAction).toHaveBeenCalledTimes(1));
      expect(document.activeElement).toBe(boxes()[5]);
      expect(document.activeElement).not.toBe(verify());
    });
  });

  describe("S-1: the session grant opens only inside verifyTotpAction (0.42.3)", () => {
    const source = readFileSync(path.resolve(__dirname, "totp-challenge-form.tsx"), "utf8");
    // Import statements and call sites only; comments may name these on purpose.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    it("the form never imports or calls the auth modules or unstable_update", () => {
      expect(code).not.toMatch(/from\s+["']@\/auth["']/);
      expect(code).not.toMatch(/two-factor-grant/);
      expect(code).not.toMatch(/unstable_update/);
    });

    it("the form's only door to the server is the native action", () => {
      expect(code).toContain("action={verifyTotpAction}");
      expect(code).not.toMatch(/verifyTotpAction\(/);
    });
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
