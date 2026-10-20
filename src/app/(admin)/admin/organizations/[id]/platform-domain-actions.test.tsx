// @vitest-environment jsdom
/**
 * The platform admin's per-host controls: every state-changing action is an
 * AlertDialog naming the host, takes a required 10-500 character reason where the
 * server demands one, and shows the server's refusal.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const actions = vi.hoisted(() => ({
  checkDomainPlatformAction: vi.fn(),
  setDomainHoldAction: vi.fn(),
  forceReleaseDomainAction: vi.fn(),
}));
vi.mock("./domains-actions", () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { PlatformDomainActions } from "./platform-domain-actions";

afterEach(() => {
  cleanup();
  for (const fn of Object.values(actions)) fn.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

const host = (over: Partial<React.ComponentProps<typeof PlatformDomainActions>["host"]> = {}) => ({
  id: "d1",
  displayHostname: "church-one.invalid",
  hold: null,
  state: "live" as const,
  ...over,
});
const renderActions = (h = host()) => render(<PlatformDomainActions host={h} organizationName="Alder Creek Church" />);
const REASON = "Disputed ownership reported by the previous webmaster.";
const reasonBox = () => within(screen.getByRole("alertdialog")).getByLabelText(/^Reason/) as HTMLTextAreaElement;
const inDialog = (name: RegExp | string) => within(screen.getByRole("alertdialog")).getByRole("button", { name });

describe("PlatformDomainActions", () => {
  it("offers Check now, Pause, Dispute and Force-release to a healthy host, each named for the host", () => {
    renderActions();
    for (const n of ["Check now church-one.invalid", "Pause church-one.invalid", "Dispute church-one.invalid", "Force-release church-one.invalid"]) {
      expect(screen.getByRole("button", { name: n }), n).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: /^Resume/ })).toBeNull();
  });

  it("Check now runs the platform check for THIS host", async () => {
    actions.checkDomainPlatformAction.mockResolvedValue({ ok: true, data: { outcome: "live", checkedAt: "x" } });
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Check now church-one.invalid" }));
    await waitFor(() => expect(actions.checkDomainPlatformAction).toHaveBeenCalledWith("d1"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Checked church-one.invalid: live."));
  });

  it("Pause needs a real reason: the confirm stays disabled until 10 characters, then sends the trimmed reason", async () => {
    actions.setDomainHoldAction.mockResolvedValue({ ok: true, data: { changed: true } });
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Pause church-one.invalid" }));
    expect(screen.getByRole("alertdialog").textContent).toMatch(/Pause church-one\.invalid\?/);
    const confirm = inDialog("Pause") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(reasonBox(), { target: { value: "too short" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(reasonBox(), { target: { value: `  ${REASON}  ` } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(actions.setDomainHoldAction).toHaveBeenCalledWith("d1", "paused", REASON));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("a reason over 500 characters cannot be submitted", () => {
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Dispute church-one.invalid" }));
    fireEvent.change(reasonBox(), { target: { value: "x".repeat(501) } });
    expect((inDialog("Mark disputed") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Dispute sets the disputed hold", async () => {
    actions.setDomainHoldAction.mockResolvedValue({ ok: true, data: { changed: true } });
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Dispute church-one.invalid" }));
    fireEvent.change(reasonBox(), { target: { value: REASON } });
    fireEvent.click(inDialog("Mark disputed"));
    await waitFor(() => expect(actions.setDomainHoldAction).toHaveBeenCalledWith("d1", "disputed", REASON));
  });

  it("a held host offers Resume (paused) or Clear dispute (disputed) instead of Pause and Dispute, with no reason", async () => {
    actions.setDomainHoldAction.mockResolvedValue({ ok: true, data: { changed: true } });
    const { unmount } = renderActions(host({ hold: "paused" }));
    expect(screen.queryByRole("button", { name: /^Pause/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume church-one.invalid" }));
    expect(within(screen.getByRole("alertdialog")).queryByLabelText(/^Reason/)).toBeNull();
    fireEvent.click(inDialog("Resume"));
    await waitFor(() => expect(actions.setDomainHoldAction).toHaveBeenCalledWith("d1", null, null));
    unmount();
    renderActions(host({ hold: "disputed" }));
    expect(screen.getByRole("button", { name: "Clear dispute church-one.invalid" })).toBeTruthy();
  });

  it("Force-release requires a reason, defaults to 'Released by support', and can be an eviction", async () => {
    actions.forceReleaseDomainAction.mockResolvedValue({ ok: true, data: { state: "release_pending" } });
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Force-release church-one.invalid" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toMatch(/skipping the 30-day hold/);
    expect(dialog.textContent).toMatch(/Alder Creek Church/);
    const radios = within(dialog).getAllByRole("radio") as HTMLInputElement[];
    expect(radios[0]!.checked).toBe(true);
    fireEvent.click(radios[1]!);
    fireEvent.change(reasonBox(), { target: { value: REASON } });
    fireEvent.click(inDialog("Force-release"));
    await waitFor(() => expect(actions.forceReleaseDomainAction).toHaveBeenCalledWith("d1", { reason: REASON, cause: "evicted" }));
  });

  it("a host already releasing cannot be force-released again", () => {
    renderActions(host({ state: "release_pending" }));
    expect(screen.queryByRole("button", { name: /^Force-release/ })).toBeNull();
  });

  it("a server refusal is shown and keeps the dialog open; a thrown action is a human toast", async () => {
    actions.setDomainHoldAction.mockResolvedValueOnce({ ok: false, code: "invalid_reason", error: "Give a reason of 10 to 500 characters." });
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Pause church-one.invalid" }));
    fireEvent.change(reasonBox(), { target: { value: REASON } });
    fireEvent.click(inDialog("Pause"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Give a reason of 10 to 500 characters."));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    actions.setDomainHoldAction.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(inDialog("Pause"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That didn't go through. Try again."));
  });

  it("uses no native dialog", () => {
    const confirm = vi.spyOn(window, "confirm");
    const prompt = vi.spyOn(window, "prompt");
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Force-release church-one.invalid" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
  });
});
