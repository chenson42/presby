// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const removeClaimAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ removeClaimAction: (...a: unknown[]) => removeClaimAction(...a) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { RemoveDialog } from "./remove-dialog";

afterEach(() => {
  cleanup();
  removeClaimAction.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

const props = { slug: "alder-creek", claimName: "church-one.invalid", displayName: "church-one.invalid", wasConnected: true, replacements: [] };
const open = () => fireEvent.click(screen.getByRole("button", { name: /^Remove/ }));
const confirm = () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove domain" }));

describe("RemoveDialog", () => {
  it("a connected domain: explains the dark period, the 30 days, the clean-up and that it can be reconnected", () => {
    render(<RemoveDialog {...props} />);
    open();
    const text = screen.getByRole("alertdialog").textContent!;
    expect(text).toMatch(/page not found/);
    expect(text).toMatch(/30 days/);
    expect(text).toMatch(/DNS records to delete/);
    expect(text).toMatch(/reconnect it/);
    expect(text).toMatch(/PresbyPortal address will serve your site again/);
  });

  it("a never-proven claim promises nothing more than it does", () => {
    render(<RemoveDialog {...props} wasConnected={false} />);
    open();
    const text = screen.getByRole("alertdialog").textContent!;
    expect(text).toMatch(/Nothing was connected, so nothing else changes/);
    expect(text).not.toMatch(/30 days/);
  });

  it("removes with no replacement when this is not the primary address", async () => {
    removeClaimAction.mockResolvedValue({ ok: true });
    render(<RemoveDialog {...props} />);
    open();
    confirm();
    await waitFor(() => expect(removeClaimAction).toHaveBeenCalledWith("alder-creek", "church-one.invalid", undefined));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("church-one.invalid was removed."));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("the primary domain with other live addresses must choose a replacement, defaulting to the first, and sends the choice", async () => {
    removeClaimAction.mockResolvedValue({ ok: true });
    render(
      <RemoveDialog
        {...props}
        replacements={[
          { id: "r1", displayHostname: "www.other.invalid" },
          { id: "r2", displayHostname: "other.invalid" },
        ]}
      />,
    );
    open();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Which address becomes your primary address?")).toBeTruthy();
    const radios = within(dialog).getAllByRole("radio") as HTMLInputElement[];
    expect(radios[0]!.checked).toBe(true);
    fireEvent.click(radios[1]!);
    confirm();
    await waitFor(() => expect(removeClaimAction).toHaveBeenCalledWith("alder-creek", "church-one.invalid", "r2"));
  });

  it("a refusal keeps the dialog open with the server's reason; a thrown action is a human toast", async () => {
    removeClaimAction.mockResolvedValueOnce({ ok: false, code: "needs_canonical", error: "This is your main address, and other addresses are live. Choose which one becomes the main address first." });
    render(<RemoveDialog {...props} />);
    open();
    confirm();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Choose which one becomes the main address first/)));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    removeClaimAction.mockRejectedValueOnce(new Error("boom"));
    confirm();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("We couldn't remove it right now. Try again in a few minutes."));
  });

  it("'Keep it' cancels without calling the server", () => {
    render(<RemoveDialog {...props} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(removeClaimAction).not.toHaveBeenCalled();
  });
});
