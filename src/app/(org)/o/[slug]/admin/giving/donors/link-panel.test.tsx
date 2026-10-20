// @vitest-environment jsdom
/**
 * The donor -> member link panel (docs/work-log/2026-10-15-online-giving.md,
 * Flow 9 and the account-takeover row of the adversarial table). Pins: a
 * proposal is shown as "Looks like <name>", CONFIRMING names the person in an
 * AlertDialog and says what the link does, dismissing and removing are
 * recorded, and a holder who can only view sees the state but no controls.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const actions = vi.hoisted(() => ({ confirmLinkAction: vi.fn(), dismissLinkAction: vi.fn(), removeLinkAction: vi.fn() }));
vi.mock("./actions", () => actions);
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { LinkPanel } from "./link-panel";

const PROPOSAL = { membershipId: "m-1", personName: "Winifred Ashgrove" };

afterEach(() => {
  cleanup();
  for (const fn of [...Object.values(actions), refresh, toastSuccess, toastError]) fn.mockReset();
});

describe("a proposal", () => {
  it("reads 'Looks like <name> - the same email is on file' (a hint, not a fact)", () => {
    render(<LinkPanel slug="s" donorId="d1" link={null} proposals={[PROPOSAL]} canLink />);
    expect(screen.getByText(/Looks like/).textContent).toMatch(/Looks like Winifred Ashgrove — the same email is on file\./);
  });

  it("confirming opens an AlertDialog that NAMES the person and says what the link does - and calls nothing until they say yes", async () => {
    actions.confirmLinkAction.mockResolvedValue({ ok: true, data: { personName: "Winifred Ashgrove" } });
    render(<LinkPanel slug="alder-creek" donorId="d1" link={null} proposals={[PROPOSAL]} canLink />);
    fireEvent.click(screen.getByRole("button", { name: "Link to Winifred Ashgrove" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Link this donor to Winifred Ashgrove?")).toBeTruthy();
    expect(dialog.textContent).toMatch(/will be able to see this donor.s giving history in the member portal/);
    expect(dialog.textContent).toMatch(/a matching email is a hint, not proof/);
    expect(actions.confirmLinkAction).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, link them" }));
    await waitFor(() => expect(actions.confirmLinkAction).toHaveBeenCalledWith("alder-creek", { donorId: "d1", membershipId: "m-1" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Donor linked."));
    expect(refresh).toHaveBeenCalled();
  });

  it("'Not yet' leaves everything untouched", async () => {
    render(<LinkPanel slug="s" donorId="d1" link={null} proposals={[PROPOSAL]} canLink />);
    fireEvent.click(screen.getByRole("button", { name: "Link to Winifred Ashgrove" }));
    fireEvent.click(await screen.findByRole("button", { name: "Not yet" }));
    expect(actions.confirmLinkAction).not.toHaveBeenCalled();
  });

  it("'Not this person' dismisses (recorded, so it is never suggested again)", async () => {
    actions.dismissLinkAction.mockResolvedValue({ ok: true });
    render(<LinkPanel slug="s" donorId="d1" link={null} proposals={[PROPOSAL]} canLink />);
    fireEvent.click(screen.getByRole("button", { name: "Not this person" }));
    await waitFor(() => expect(actions.dismissLinkAction).toHaveBeenCalledWith("s", { donorId: "d1", membershipId: "m-1" }));
    await waitFor(() => expect(toastSuccess.mock.calls[0]![0]).toMatch(/won't suggest them again/));
  });

  it("a stale suggestion surfaces the server's message", async () => {
    actions.confirmLinkAction.mockResolvedValue({ ok: false, error: "That suggestion is no longer available. Reload the page." });
    render(<LinkPanel slug="s" donorId="d1" link={null} proposals={[PROPOSAL]} canLink />);
    fireEvent.click(screen.getByRole("button", { name: "Link to Winifred Ashgrove" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, link them" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("That suggestion is no longer available. Reload the page."));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("without canLink (giving.view alone) the suggestion is shown but there are NO controls", () => {
    render(<LinkPanel slug="s" donorId="d1" link={null} proposals={[PROPOSAL]} canLink={false} />);
    expect(screen.getByText(/Looks like/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Someone who records gifts can confirm or dismiss this/)).toBeTruthy();
  });

  it("no proposals and no link: explains when a suggestion will appear", () => {
    render(<LinkPanel slug="s" donorId="d1" link={null} proposals={[]} canLink />);
    expect(screen.getByText(/When a donor.s email matches a member.s, a suggestion appears here/)).toBeTruthy();
  });
});

describe("an existing link", () => {
  const LINK = { membershipId: "m-1", personName: "Winifred Ashgrove", source: "recorder_confirmed" as const };

  it("names the member, says what they can see, and removing asks first", async () => {
    actions.removeLinkAction.mockResolvedValue({ ok: true });
    render(<LinkPanel slug="s" donorId="d1" link={LINK} proposals={[]} canLink />);
    expect(screen.getByTestId("linked-member").textContent).toBe("Winifred Ashgrove");
    expect(screen.getByText(/can see this donor.s giving history in the member portal/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/won.t be suggested for this donor again/);
    expect(actions.removeLinkAction).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove link" }));
    await waitFor(() => expect(actions.removeLinkAction).toHaveBeenCalledWith("s", { donorId: "d1" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Link removed."));
  });

  it("read-only for a holder without giving.record: no Remove link button", () => {
    render(<LinkPanel slug="s" donorId="d1" link={LINK} proposals={[]} canLink={false} />);
    expect(screen.queryByRole("button", { name: "Remove link" })).toBeNull();
    expect(screen.getByTestId("linked-member")).toBeTruthy();
  });
});
