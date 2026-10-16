// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const requeueDeadLetterAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ requeueDeadLetterAction: (...a: unknown[]) => requeueDeadLetterAction(...a) }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { DeadLettersTable } from "./dead-letters-table";

afterEach(() => {
  cleanup();
  for (const fn of [requeueDeadLetterAction, refresh, toastSuccess, toastError]) fn.mockReset();
});

const dl = (over: Record<string, unknown> = {}) => ({
  eventId: "11111111-1111-4111-8111-111111111111",
  connectionId: "c1",
  organizationId: "org-1",
  externalEventId: "evt_fixture0001",
  eventType: "charge.refunded",
  receivedAt: "2026-10-14T12:00:00.000Z",
  attempts: 8,
  lastErrorClass: "over_reversal",
  ...over,
}) as never;

const names = { "org-1": "Alder Creek Presbyterian Church" };

describe("DeadLettersTable", () => {
  it("lists each dead letter with the organization, type, provider id, attempts and error CODE", () => {
    render(<DeadLettersTable rows={[dl()]} names={names} />);
    const row = screen.getByTestId("dead-letter-row");
    expect(within(row).getByRole("link", { name: "Alder Creek Presbyterian Church" }).getAttribute("href")).toBe("/admin/organizations/org-1");
    expect(row.textContent).toMatch(/charge\.refunded/);
    expect(row.textContent).toMatch(/evt_fixture0001/);
    expect(row.textContent).toMatch(/over_reversal/);
    expect(row.textContent).toMatch(/8/);
  });

  it("a missing error class reads 'unknown', not blank", () => {
    render(<DeadLettersTable rows={[dl({ lastErrorClass: null })]} names={names} />);
    expect(screen.getByTestId("dead-letter-row").textContent).toMatch(/unknown/);
  });

  it("Requeue asks in an AlertDialog (never a native confirm) and calls nothing until confirmed", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<DeadLettersTable rows={[dl()]} names={names} />);
    fireEvent.click(screen.getByRole("button", { name: "Requeue evt_fixture0001" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/evt_fixture0001/);
    expect(dialog.textContent).toMatch(/retried on the next run/);
    expect(dialog.textContent).toMatch(/recorded in the audit log/);
    expect(requeueDeadLetterAction).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("confirming sends THAT row's event id, toasts, and refreshes the list", async () => {
    requeueDeadLetterAction.mockResolvedValue({ ok: true });
    render(<DeadLettersTable rows={[dl(), dl({ eventId: "22222222-2222-4222-8222-222222222222", externalEventId: "evt_fixture0002" })]} names={names} />);
    fireEvent.click(screen.getByRole("button", { name: "Requeue evt_fixture0002" }));
    fireEvent.click(await screen.findByRole("button", { name: "Requeue event" }));
    await waitFor(() => expect(requeueDeadLetterAction).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Event requeued. It will be retried on the next run."));
    expect(refresh).toHaveBeenCalled();
  });

  it("Cancel calls nothing", async () => {
    render(<DeadLettersTable rows={[dl()]} names={names} />);
    fireEvent.click(screen.getByRole("button", { name: "Requeue evt_fixture0001" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(requeueDeadLetterAction).not.toHaveBeenCalled();
  });

  it("a refusal toasts the action's message and still refreshes (the list may have moved)", async () => {
    requeueDeadLetterAction.mockResolvedValue({ ok: false, error: "That event is no longer a dead letter. Reload the page to see the current list." });
    render(<DeadLettersTable rows={[dl()]} names={names} />);
    fireEvent.click(screen.getByRole("button", { name: "Requeue evt_fixture0001" }));
    fireEvent.click(await screen.findByRole("button", { name: "Requeue event" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/no longer a dead letter/)));
    expect(refresh).toHaveBeenCalled();
  });

  it("empty: a designed empty state", () => {
    render(<DeadLettersTable rows={[]} names={names} />);
    expect(screen.getByTestId("dead-letters-empty").textContent).toMatch(/No dead letters/);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("touch target: the Requeue button is at least 44px tall", () => {
    render(<DeadLettersTable rows={[dl()]} names={names} />);
    expect(screen.getByRole("button", { name: /Requeue/ }).className).toMatch(/min-h-11/);
  });
});
