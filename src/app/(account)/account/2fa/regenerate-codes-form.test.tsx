// @vitest-environment jsdom
/**
 * RegenerateCodesForm (F166 Flow 4, F344). The new codes are shown from this
 * form's own state; the fresh-codes cookie that used to produce a second,
 * duplicate panel is gone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const regenerateRecoveryCodes = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ regenerateRecoveryCodes }));

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

import { RegenerateCodesForm } from "./regenerate-codes-form";

const CODES = Array.from({ length: 10 }, (_, i) => `BBBB-${String(2000 + i)}`);
const codesShown = () => Array.from(document.querySelectorAll("ul.font-mono li")).map((li) => li.textContent);

beforeEach(() => {
  regenerateRecoveryCodes.mockReset();
  toastError.mockReset();
});
afterEach(cleanup);

describe("RegenerateCodesForm", () => {
  it("RG1: success shows the shared panel with its heading, intro, ten codes and the shown-once footnote", async () => {
    regenerateRecoveryCodes.mockResolvedValue({ ok: true, data: { recoveryCodes: CODES } });
    render(<RegenerateCodesForm />);
    fireEvent.click(screen.getByRole("button", { name: /regenerate recovery codes/i }));
    await waitFor(() => expect(codesShown()).toEqual(CODES));
    expect(screen.getByRole("heading", { level: 3, name: "New recovery codes — save these now" })).toBeTruthy();
    expect(screen.getByText("Your old codes are no longer valid. Each new code can be used once.")).toBeTruthy();
    expect(screen.getByText("If you reload or leave this page, these codes will not be shown again.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /regenerate recovery codes/i })).toBeNull();
  });

  it("RG2: a failure toasts the server's message and keeps the button", async () => {
    regenerateRecoveryCodes.mockResolvedValue({ ok: false, error: "Unauthorized." });
    render(<RegenerateCodesForm />);
    fireEvent.click(screen.getByRole("button", { name: /regenerate recovery codes/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Unauthorized."));
    expect(screen.getByRole("button", { name: /regenerate recovery codes/i })).toBeTruthy();
    expect(codesShown()).toEqual([]);
  });

  it("RG3: the panel survives a parent re-render (the revalidatePath that refreshes the unused count)", async () => {
    regenerateRecoveryCodes.mockResolvedValue({ ok: true, data: { recoveryCodes: CODES } });
    const { rerender } = render(
      <div>
        <RegenerateCodesForm />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /regenerate recovery codes/i }));
    await waitFor(() => expect(codesShown()).toEqual(CODES));
    rerender(
      <div>
        <RegenerateCodesForm />
      </div>,
    );
    expect(codesShown()).toEqual(CODES);
    expect(document.querySelectorAll("ul.font-mono").length, "exactly one panel").toBe(1);
  });

  it("RG4: a refusal (an unverified session) toasts the server's message and shows no panel — F344", async () => {
    const refusal = "Confirm it's you with your authenticator app or a recovery code first. Reload this page to see how.";
    regenerateRecoveryCodes.mockResolvedValue({ ok: false, error: refusal });
    render(<RegenerateCodesForm />);
    fireEvent.click(screen.getByRole("button", { name: /regenerate recovery codes/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(refusal));
    expect(codesShown()).toEqual([]);
  });
});
