// @vitest-environment jsdom
/**
 * Per-fund controls (docs/work-log/2026-10-15-online-giving.md, G23): retire is
 * an AlertDialog, retiring the LAST online fund while the public page is live
 * asks a SECOND time, reactivate is one tap, edit opens the form inline.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const retireFundAction = vi.hoisted(() => vi.fn());
const reactivateFundAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  retireFundAction: (...a: unknown[]) => retireFundAction(...a),
  reactivateFundAction: (...a: unknown[]) => reactivateFundAction(...a),
}));
vi.mock("./fund-form", () => ({ FundForm: () => <div data-testid="fund-form" /> }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { FundRowActions } from "./fund-row-actions";

const fund = (over: Record<string, unknown> = {}) => ({
  id: "f1", name: "General Fund", onlineDisplayName: null, description: null, restrictionClass: "unrestricted",
  offeredOnline: false, isActive: true, retiredOn: null, sortOrder: 0, hasGifts: false, ...over,
}) as never;

afterEach(() => {
  cleanup();
  for (const fn of [retireFundAction, reactivateFundAction, refresh, toastSuccess, toastError]) fn.mockReset();
});

describe("FundRowActions", () => {
  it("an active fund offers Edit and Retire; a retired one offers Edit and Reactivate", () => {
    render(<FundRowActions slug="s" fund={fund()} />);
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retire" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reactivate" })).toBeNull();
    cleanup();
    render(<FundRowActions slug="s" fund={fund({ isActive: false })} />);
    expect(screen.getByRole("button", { name: "Reactivate" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retire" })).toBeNull();
  });

  it("Edit toggles the inline form", () => {
    render(<FundRowActions slug="s" fund={fund()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByTestId("fund-form")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    expect(screen.queryByTestId("fund-form")).toBeNull();
  });

  it("Retire asks in an AlertDialog (never a native confirm); confirming calls the action without confirm and refreshes", async () => {
    retireFundAction.mockResolvedValue({ ok: true, data: {} });
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<FundRowActions slug="alder-creek" fund={fund()} />);
    fireEvent.click(screen.getByRole("button", { name: "Retire" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Retire General Fund?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retire fund" }));
    await waitFor(() => expect(retireFundAction).toHaveBeenCalledWith("alder-creek", { fundId: "f1", confirm: false }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("General Fund retired."));
    expect(refresh).toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("Keep it closes without calling anything", async () => {
    render(<FundRowActions slug="s" fund={fund()} />);
    fireEvent.click(screen.getByRole("button", { name: "Retire" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep it" }));
    expect(retireFundAction).not.toHaveBeenCalled();
  });

  it("the last online fund asks a SECOND time, and 'Retire anyway' sends confirm: true", async () => {
    retireFundAction.mockResolvedValueOnce({ ok: true, data: { confirmRequired: "last_online_fund" } });
    render(<FundRowActions slug="s" fund={fund({ offeredOnline: true, onlineDisplayName: "Giving" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Retire" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retire fund" }));
    expect(await screen.findByText("This is your only online fund")).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
    retireFundAction.mockResolvedValueOnce({ ok: true, data: {} });
    fireEvent.click(screen.getByRole("button", { name: "Retire anyway" }));
    await waitFor(() => expect(retireFundAction).toHaveBeenLastCalledWith("s", { fundId: "f1", confirm: true }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("a failure toasts the server's message and does not refresh", async () => {
    retireFundAction.mockResolvedValue({ ok: false, error: "That fund is already retired." });
    render(<FundRowActions slug="s" fund={fund()} />);
    fireEvent.click(screen.getByRole("button", { name: "Retire" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retire fund" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("That fund is already retired."));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("Reactivate says it is NOT back online automatically", async () => {
    reactivateFundAction.mockResolvedValue({ ok: true });
    render(<FundRowActions slug="s" fund={fund({ isActive: false })} />);
    fireEvent.click(screen.getByRole("button", { name: "Reactivate" }));
    await waitFor(() => expect(reactivateFundAction).toHaveBeenCalledWith("s", { fundId: "f1" }));
    await waitFor(() => expect(toastSuccess.mock.calls[0]![0]).toMatch(/not offered online until you turn that on/));
  });
});
