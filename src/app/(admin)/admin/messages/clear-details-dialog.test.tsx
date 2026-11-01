// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const clearContactMessageDetails = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ clearContactMessageDetails, setContactMessageStatus: vi.fn() }));

import { ClearDetailsDialog } from "./clear-details-dialog";

const ID = "11111111-2222-4333-8444-555555555555";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function open() {
  render(<ClearDetailsDialog id={ID} />);
  fireEvent.click(screen.getByRole("button", { name: "Clear details" }));
}

describe("ClearDetailsDialog", () => {
  it("opening it clears nothing, and says the clear cannot be undone", async () => {
    open();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Clear this message's details?");
    expect(dialog.textContent).toContain("This cannot be undone.");
    expect(clearContactMessageDetails).not.toHaveBeenCalled();
  });

  it("Keep details closes it without calling the action", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Keep details" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(clearContactMessageDetails).not.toHaveBeenCalled();
  });

  it("confirming calls the action, toasts and refreshes", async () => {
    clearContactMessageDetails.mockResolvedValue({ ok: true });
    open();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Clear details")!);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(clearContactMessageDetails).toHaveBeenCalledWith(ID);
    expect(toast.success).toHaveBeenCalledWith("Details cleared.");
  });

  it("a refusal toasts the sentence and does not refresh", async () => {
    clearContactMessageDetails.mockResolvedValue({ ok: false, error: "Its details were already cleared." });
    open();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Clear details")!);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Its details were already cleared."));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a thrown action toasts the failure sentence", async () => {
    clearContactMessageDetails.mockRejectedValue(new Error("x"));
    open();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Clear details")!);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not clear the details. Try again."));
  });
});
