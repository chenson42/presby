// @vitest-environment jsdom
/**
 * The issue-statements dialog (docs/work-log/2026-10-15-online-giving.md, Batch
 * 5b): an AlertDialog (never a native confirm), a progress loop over the server
 * action until there is no cursor, failures listed by donor and reason, no
 * dismissal mid-run, and a resumable error state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const issueStatementBatchAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ issueStatementBatchAction: (...a: unknown[]) => issueStatementBatchAction(...a) }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn(), warning: vi.fn() } }));

import { IssueStatementsDialog } from "./issue-dialog";

const batch = (over: Record<string, unknown> = {}) => ({ ok: true, data: { issued: 25, skipped: 0, failed: [], nextCursor: null, ...over } });
const renderIt = (props: Partial<{ toIssue: number; alreadyIssued: number }> = {}) =>
  render(<IssueStatementsDialog slug="alder-creek" year={2027} toIssue={props.toIssue ?? 3} alreadyIssued={props.alreadyIssued ?? 1} />);
const openIt = async () => {
  fireEvent.click(screen.getByRole("button", { name: /^Issue \d+ statements?$/ }));
  return screen.findByRole("alertdialog");
};

afterEach(() => {
  cleanup();
  issueStatementBatchAction.mockReset();
  refresh.mockReset();
  toastSuccess.mockReset();
});

describe("IssueStatementsDialog", () => {
  it("confirms first: says what will be created and that issued statements are frozen; calls nothing until confirmed", async () => {
    renderIt({ toIssue: 3, alreadyIssued: 1 });
    expect(screen.getByRole("button", { name: "Issue 3 statements" })).toBeTruthy();
    const dialog = await openIt();
    expect(within(dialog).getByText("Issue 2027 statements?")).toBeTruthy();
    expect(dialog.textContent).toMatch(/3 donors who don.t have one yet \(1 already have one\)/);
    expect(dialog.textContent).toMatch(/frozen: it can.t be edited/);
    expect(issueStatementBatchAction).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Not yet" }));
    expect(issueStatementBatchAction).not.toHaveBeenCalled();
  });

  it("loops over the server action, threading the cursor, until none is left; shows progress; toasts and refreshes", async () => {
    issueStatementBatchAction
      .mockResolvedValueOnce(batch({ issued: 25, nextCursor: "cursor-1" }))
      .mockResolvedValueOnce(batch({ issued: 25, nextCursor: "cursor-2" }))
      .mockResolvedValueOnce(batch({ issued: 10, nextCursor: null }));
    renderIt({ toIssue: 60, alreadyIssued: 0 });
    const dialog = await openIt();
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue statements" }));
    await waitFor(() => expect(within(dialog).getByText("Statements issued")).toBeTruthy());
    expect(issueStatementBatchAction.mock.calls).toEqual([
      ["alder-creek", { year: 2027, cursor: null }],
      ["alder-creek", { year: 2027, cursor: "cursor-1" }],
      ["alder-creek", { year: 2027, cursor: "cursor-2" }],
    ]);
    expect(within(dialog).getByTestId("issue-progress").textContent).toBe("60 issued of 60");
    const bar = within(dialog).getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("60");
    expect(bar.getAttribute("aria-valuemax")).toBe("60");
    expect(toastSuccess).toHaveBeenCalledWith("60 statements issued.");
    expect(refresh).toHaveBeenCalled();
  });

  it("lists a donor that failed by name and reason, and keeps going", async () => {
    issueStatementBatchAction
      .mockResolvedValueOnce(batch({ issued: 24, failed: [{ donorId: "d9", donorName: "Fixture Donor", reason: "consistency" }], nextCursor: "c" }))
      .mockResolvedValueOnce(batch({ issued: 1, skipped: 1 }));
    renderIt({ toIssue: 27 });
    const dialog = await openIt();
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue statements" }));
    await waitFor(() => expect(within(dialog).getByText("Statements issued")).toBeTruthy());
    const failures = within(dialog).getByTestId("issue-failures");
    expect(failures.textContent).toContain("Fixture Donor");
    expect(failures.textContent).toMatch(/did not match the gift records/);
    expect(within(dialog).getByTestId("issue-progress").textContent).toBe("25 issued, 1 skipped, 1 need attention of 27");
  });

  it("cannot be dismissed while running: no cancel, an inert button, and Escape does not close it", async () => {
    let release!: (v: unknown) => void;
    issueStatementBatchAction.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    renderIt();
    const dialog = await openIt();
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue statements" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Issuing/ })).toBeTruthy());
    expect((within(dialog).getByRole("button", { name: /Issuing/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).queryByRole("button", { name: "Not yet" })).toBeNull();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    await act(async () => release(batch({ issued: 3 })));
    await waitFor(() => expect(within(dialog).getByText("Statements issued")).toBeTruthy());
  });

  it("a refused call stops the run with the server's message and offers 'Issue again', which resumes", async () => {
    issueStatementBatchAction
      .mockResolvedValueOnce(batch({ issued: 25, nextCursor: "c1" }))
      .mockResolvedValueOnce({ ok: false, error: "We couldn't check your access just now. Try again in a moment." })
      .mockResolvedValueOnce(batch({ issued: 5 }));
    renderIt({ toIssue: 30, alreadyIssued: 0 });
    const dialog = await openIt();
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue statements" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toMatch(/couldn.t check your access/));
    expect(within(dialog).getByTestId("issue-progress").textContent).toBe("25 issued of 30");
    expect(toastSuccess).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue again" }));
    await waitFor(() => expect(within(dialog).getByText("Statements issued")).toBeTruthy());
    expect(within(dialog).getByTestId("issue-progress").textContent).toBe("30 issued of 30");
    // The resumed run starts from the beginning of the candidates (donors already issued are not candidates).
    expect(issueStatementBatchAction.mock.calls[2]).toEqual(["alder-creek", { year: 2027, cursor: null }]);
  });

  it("a thrown network error is an honest message, not a frozen dialog", async () => {
    issueStatementBatchAction.mockRejectedValue(new Error("network"));
    renderIt();
    const dialog = await openIt();
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue statements" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toMatch(/lost the connection/));
  });

  it("a 2FA refusal sends the person to the challenge", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    issueStatementBatchAction.mockResolvedValue({ ok: false, error: "x", kind: "two_factor_required", redirectTo: "/totp?callbackUrl=%2Fo%2Fx" });
    renderIt();
    const dialog = await openIt();
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue statements" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/totp?callbackUrl=%2Fo%2Fx"));
    vi.unstubAllGlobals();
  });

  it("a double click cannot start two runs", async () => {
    let release!: (v: unknown) => void;
    issueStatementBatchAction.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    renderIt();
    const dialog = await openIt();
    const go = within(dialog).getByRole("button", { name: "Issue statements" });
    fireEvent.click(go);
    fireEvent.click(go);
    expect(issueStatementBatchAction).toHaveBeenCalledTimes(1);
    await act(async () => release(batch({ issued: 3 })));
  });
});
