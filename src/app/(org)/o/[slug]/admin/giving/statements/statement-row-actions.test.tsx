// @vitest-environment jsdom
/**
 * The per-statement actions (docs/work-log/2026-10-15-online-giving.md, Batch
 * 5b): "Mark as mailed" and "Issue corrected statement" (an AlertDialog that
 * says the original is kept, never edited or deleted).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const recordDeliveryAction = vi.hoisted(() => vi.fn());
const reissueStatementAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  recordDeliveryAction: (...a: unknown[]) => recordDeliveryAction(...a),
  reissueStatementAction: (...a: unknown[]) => reissueStatementAction(...a),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { StatementRowActions } from "./statement-row-actions";

const renderIt = (over: Partial<React.ComponentProps<typeof StatementRowActions>> = {}) =>
  render(
    <StatementRowActions slug="alder-creek" statementId="s1" donorName="Linden Marsh" year={2027} showMarkMailed showReissue issuingEnabled {...over} />,
  );

afterEach(() => {
  cleanup();
  recordDeliveryAction.mockReset();
  reissueStatementAction.mockReset();
  refresh.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("StatementRowActions", () => {
  it("renders only the actions it is told to", () => {
    renderIt({ showMarkMailed: false, showReissue: false });
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    renderIt({ showReissue: false });
    expect(screen.getByRole("button", { name: "Mark as mailed" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Issue corrected statement" })).toBeNull();
    cleanup();
    renderIt({ issuingEnabled: false });
    expect(screen.queryByRole("button", { name: "Issue corrected statement" })).toBeNull();
  });

  it("mark as mailed: calls the action, toasts, refreshes", async () => {
    recordDeliveryAction.mockResolvedValue({ ok: true });
    renderIt({ showReissue: false });
    fireEvent.click(screen.getByRole("button", { name: "Mark as mailed" }));
    await waitFor(() => expect(recordDeliveryAction).toHaveBeenCalledWith("alder-creek", "s1"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Marked as mailed."));
    expect(refresh).toHaveBeenCalled();
  });

  it("mark as mailed: a refusal is a toast, not a refresh", async () => {
    recordDeliveryAction.mockResolvedValue({ ok: false, error: "You don't have permission to do that." });
    renderIt({ showReissue: false });
    fireEvent.click(screen.getByRole("button", { name: "Mark as mailed" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You don't have permission to do that."));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("corrected statement: confirms in an AlertDialog saying the original is kept, then issues", async () => {
    reissueStatementAction.mockResolvedValue({ ok: true, data: { statementId: "s2", version: 2 } });
    renderIt({ showMarkMailed: false });
    fireEvent.click(screen.getByRole("button", { name: "Issue corrected statement" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Issue a corrected 2027 statement?")).toBeTruthy();
    expect(dialog.textContent).toMatch(/Linden Marsh/);
    expect(dialog.textContent).toMatch(/original is kept and marked as replaced; nothing is edited or deleted/);
    expect(reissueStatementAction).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue corrected statement" }));
    await waitFor(() => expect(reissueStatementAction).toHaveBeenCalledWith("alder-creek", "s1"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Corrected statement issued."));
    expect(refresh).toHaveBeenCalled();
  });

  it("corrected statement: a refusal stays in the dialog so the person can read it", async () => {
    reissueStatementAction.mockResolvedValue({ ok: false, error: "A newer version of this statement has already been issued." });
    renderIt({ showMarkMailed: false });
    fireEvent.click(screen.getByRole("button", { name: "Issue corrected statement" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue corrected statement" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toMatch(/newer version/));
    expect(refresh).not.toHaveBeenCalled();
  });
});
