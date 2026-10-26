// @vitest-environment jsdom
/**
 * Tests for <RevokeAllInvitations> (account-invitations Batch 3): the takedown
 * lever sits behind an AlertDialog, names the count, calls the action with the
 * organization id only, and announces its result inline.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const mockRevokeAll = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ revokeAllInvitationsAction: (fd: FormData) => mockRevokeAll(fd) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

import { RevokeAllInvitations } from "./revoke-all-invitations";

afterEach(() => {
  cleanup();
  mockRevokeAll.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

const PROPS = { organizationId: "org-1", organizationName: "Alder Creek Presbyterian Church" };

describe("RevokeAllInvitations", () => {
  it("names the open count (singular and plural)", () => {
    const { unmount } = render(<RevokeAllInvitations {...PROPS} openCount={1} />);
    expect(screen.getByText(/1 open invitation\./)).toBeTruthy();
    unmount();
    render(<RevokeAllInvitations {...PROPS} openCount={3} />);
    expect(screen.getByText(/3 open invitations\./)).toBeTruthy();
  });

  it("confirms in an AlertDialog naming the organization before calling the action", async () => {
    mockRevokeAll.mockResolvedValue({ ok: true });
    render(<RevokeAllInvitations {...PROPS} openCount={2} />);
    fireEvent.click(screen.getByRole("button", { name: /revoke all open invitations/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/alder creek presbyterian church/i);
    expect(mockRevokeAll).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /yes, revoke all/i }));
    });
    const fd = mockRevokeAll.mock.calls[0][0] as FormData;
    expect(fd.get("organizationId")).toBe("org-1");
    // The action requires a scope (F198); this control is the designations lever.
    expect(fd.get("scope")).toBe("designations");
    expect([...fd.keys()]).toEqual(["organizationId", "scope"]);
    expect(screen.getByRole("status").textContent).toMatch(/all open invitations were revoked/i);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("announces a failure as an alert, verbatim", async () => {
    mockRevokeAll.mockResolvedValue({ ok: false, error: "We couldn't complete that just now — try again in a moment." });
    render(<RevokeAllInvitations {...PROPS} openCount={2} />);
    fireEvent.click(screen.getByRole("button", { name: /revoke all open invitations/i }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /yes, revoke all/i }));
    });
    expect(screen.getByRole("alert").textContent).toMatch(/try again in a moment/i);
    expect(toastError).toHaveBeenCalled();
  });
});
