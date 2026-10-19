// @vitest-environment jsdom
/**
 * The email-a-notice control (docs/work-log/2026-10-15-online-giving.md, Batch
 * 5b, R12): an AlertDialog confirm that says the email shows no amounts and
 * never carries the statement, then a loop over the server action.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const sendStatementNoticesAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ sendStatementNoticesAction: (...a: unknown[]) => sendStatementNoticesAction(...a) }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { SendNoticesButton } from "./notices-button";

const page = (over: Record<string, unknown> = {}) => ({ ok: true, data: { sent: 50, skipped: 0, failed: 0, nextCursor: null, ...over } });

afterEach(() => {
  cleanup();
  sendStatementNoticesAction.mockReset();
  refresh.mockReset();
  for (const fn of Object.values(toast)) fn.mockReset();
});

async function open() {
  render(<SendNoticesButton slug="alder-creek" year={2027} candidates={120} />);
  fireEvent.click(screen.getByRole("button", { name: "Email a notice (120)" }));
  return screen.findByRole("alertdialog");
}

describe("SendNoticesButton", () => {
  it("says what the email is and is not before anything is sent", async () => {
    const dialog = await open();
    expect(within(dialog).getByText("Email 120 notices?")).toBeTruthy();
    expect(dialog.textContent).toMatch(/shows no amounts and no gifts\. The statement itself is never emailed/);
    expect(sendStatementNoticesAction).not.toHaveBeenCalled();
  });

  it("loops with the cursor until done, then toasts the total and refreshes", async () => {
    sendStatementNoticesAction
      .mockResolvedValueOnce(page({ nextCursor: "c1" }))
      .mockResolvedValueOnce(page({ sent: 50, nextCursor: "c2" }))
      .mockResolvedValueOnce(page({ sent: 20 }));
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send notices" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("120 notices sent."));
    expect(sendStatementNoticesAction.mock.calls.map((c) => c[1])).toEqual([
      { year: 2027, cursor: null },
      { year: 2027, cursor: "c1" },
      { year: 2027, cursor: "c2" },
    ]);
    expect(refresh).toHaveBeenCalled();
  });

  it("a failure inside a page is a warning with the count, not a silent success", async () => {
    sendStatementNoticesAction.mockResolvedValue(page({ sent: 118, failed: 2 }));
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send notices" }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("118 notices sent. 2 could not be sent; try again."));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a refused call shows the message inside the dialog and sends nothing more", async () => {
    sendStatementNoticesAction.mockResolvedValue({ ok: false, error: "This site has no secure web address configured." });
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send notices" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toMatch(/no secure web address/));
    expect(sendStatementNoticesAction).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });
});
