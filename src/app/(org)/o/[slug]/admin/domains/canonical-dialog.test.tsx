// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const changeCanonicalAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ changeCanonicalAction: (...a: unknown[]) => changeCanonicalAction(...a) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { CanonicalDialog } from "./canonical-dialog";

afterEach(() => {
  cleanup();
  changeCanonicalAction.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

const open = () => fireEvent.click(screen.getByRole("button", { name: "Make church-one.invalid primary" }));
const confirm = () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Make primary" }));

describe("CanonicalDialog", () => {
  it("is an AlertDialog (no native confirm) that names the host and what changes", () => {
    const nativeConfirm = vi.spyOn(window, "confirm");
    render(<CanonicalDialog slug="alder-creek" domainId="d1" hostname="church-one.invalid" />);
    open();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toMatch(/Make church-one\.invalid your primary address\?/);
    expect(dialog.textContent).toMatch(/other addresses, and your PresbyPortal address, will be sent to church-one\.invalid/);
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it("cancelling changes nothing", () => {
    render(<CanonicalDialog slug="alder-creek" domainId="d1" hostname="church-one.invalid" />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(changeCanonicalAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("confirms with the right slug and id, thanks the person and closes", async () => {
    changeCanonicalAction.mockResolvedValue({ ok: true });
    render(<CanonicalDialog slug="alder-creek" domainId="d1" hostname="church-one.invalid" />);
    open();
    confirm();
    await waitFor(() => expect(changeCanonicalAction).toHaveBeenCalledWith("alder-creek", "d1"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("church-one.invalid is now your primary address."));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("a refusal keeps the dialog open and shows the server's reason", async () => {
    changeCanonicalAction.mockResolvedValue({ ok: false, code: "not_live", error: "That address isn't live yet. Make it your main address once it is." });
    render(<CanonicalDialog slug="alder-creek" domainId="d1" hostname="church-one.invalid" />);
    open();
    confirm();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That address isn't live yet. Make it your main address once it is."));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("a thrown action keeps the dialog open with a human toast", async () => {
    changeCanonicalAction.mockRejectedValue(new Error("boom"));
    render(<CanonicalDialog slug="alder-creek" domainId="d1" hostname="church-one.invalid" />);
    open();
    confirm();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("We couldn't change that right now. Try again in a few minutes."));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("a custom trigger label (the advisory banner) is used as given", () => {
    render(<CanonicalDialog slug="a" domainId="d1" hostname="www.x.invalid" triggerLabel="Make www.x.invalid primary" variant="default" />);
    expect(screen.getByRole("button", { name: "Make www.x.invalid primary" })).toBeTruthy();
  });
});
