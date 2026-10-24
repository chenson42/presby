// @vitest-environment jsdom
/**
 * Tests for <InvitationList> (account-invitations Batch 3): one row per
 * invitation with one status vocabulary, delivery state, the Self-designated
 * badge, blocked-reason copy; Resend one click; Revoke behind an AlertDialog
 * (Workflow Rule 2); every result inline and announced. `./actions` is mocked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { acceptanceSentence } from "@/lib/onboarding/invitation-copy";
import { invitationRow } from "./invitation-row.fixture";

const mockResend = vi.hoisted(() => vi.fn());
const mockRevoke = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  resendInvitationAction: (fd: FormData) => mockResend(fd),
  revokeInvitationAction: (fd: FormData) => mockRevoke(fd),
}));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

import { InvitationList } from "./invitation-list";

const confirmSpy = vi.spyOn(window, "confirm");

afterEach(() => {
  cleanup();
  mockResend.mockReset();
  mockRevoke.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  confirmSpy.mockClear();
});

const accepted = (overrides = {}) =>
  invitationRow({ status: "accepted", acceptedAt: new Date("2026-10-22T00:00:00Z"), ...overrides });

describe("InvitationList", () => {
  it("renders nothing for no invitations", () => {
    const { container } = render(<InvitationList organizationId="org-1" invitations={[]} purpose="founding_administrator" />);
    expect(container.textContent).toBe("");
  });

  it("shows address, status word, sent and expiry, and the delivery state for an open row", () => {
    render(
      <InvitationList organizationId="org-1" invitations={[invitationRow({ delivery: "bounced" })]} purpose="founding_administrator" />,
    );
    const row = screen.getByTestId("invitation-row");
    expect(within(row).getByText("clerk@example.invalid")).toBeTruthy();
    expect(within(row).getByText("Pending")).toBeTruthy();
    expect(within(row).getByText("Sent")).toBeTruthy();
    expect(within(row).getByText("Expires")).toBeTruthy();
    expect(within(row).getByText("Bounced. Check the address")).toBeTruthy();
  });

  it("each status carries a word (never colour alone) from the one vocabulary", () => {
    render(
      <InvitationList
        organizationId="org-1"
        purpose="founding_administrator"
        invitations={[
          invitationRow({ id: "1", status: "pending" }),
          accepted({ id: "2" }),
          invitationRow({ id: "3", status: "expired" }),
          invitationRow({ id: "4", status: "revoked" }),
          invitationRow({ id: "5", status: "blocked", blockedReason: "has_holders" }),
        ]}
      />,
    );
    for (const word of ["Pending", "Accepted", "Expired", "Revoked", "Couldn't be completed"]) {
      expect(screen.getAllByText(word).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/someone else gained this access before the invitation was accepted/i)).toBeTruthy();
    expect(screen.getByText(/expired\. resend it, or revoke it/i)).toBeTruthy();
  });

  it("offers Resend and Revoke only on open rows (pending, expired)", () => {
    render(
      <InvitationList
        organizationId="org-1"
        purpose="founding_administrator"
        invitations={[
          accepted({ id: "1" }),
          invitationRow({ id: "2", status: "revoked" }),
          invitationRow({ id: "3", status: "blocked", blockedReason: "person_merged" }),
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: /resend/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /revoke/i })).toBeNull();
  });

  it("shows the Self-designated badge only when the accepter was the sender", () => {
    render(
      <InvitationList
        organizationId="org-1"
        purpose="founding_administrator"
        invitations={[accepted({ id: "1", selfDesignated: true }), accepted({ id: "2", selfDesignated: false })]}
      />,
    );
    expect(screen.getAllByText("Self-designated")).toHaveLength(1);
  });

  it("Resend is one click, sends org and invitation ids, and announces the result inline", async () => {
    mockResend.mockResolvedValue({
      ok: true,
      invitationId: "inv-2",
      expiresAt: "2026-10-29T12:00:00.000Z",
      delivery: "sent",
      inviteeDisplayName: "Marisol Quenby",
    });
    render(<InvitationList organizationId="org-1" invitations={[invitationRow({ id: "inv-1" })]} purpose="founding_administrator" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^resend$/i }));
    });
    const fd = mockResend.mock.calls[0][0] as FormData;
    expect(fd.get("organizationId")).toBe("org-1");
    expect(fd.get("invitationId")).toBe("inv-1");
    expect(screen.getByRole("status").textContent).toMatch(/invitation sent to clerk@example\.invalid/i);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("a Resend names who must accept, in the shared copy (founding administrator)", async () => {
    mockResend.mockResolvedValue({
      ok: true,
      invitationId: "inv-2",
      expiresAt: "2026-10-29T12:00:00.000Z",
      delivery: "sent",
      inviteeDisplayName: "Marisol Quenby",
    });
    render(<InvitationList organizationId="org-1" invitations={[invitationRow({ id: "inv-1" })]} purpose="founding_administrator" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^resend$/i }));
    });
    const expected = acceptanceSentence({
      purpose: "founding_administrator",
      name: "Marisol Quenby",
      address: "clerk@example.invalid",
    });
    expect(screen.getByRole("status").textContent).toContain(expected);
    expect(screen.getByRole("status").textContent).toContain("Marisol Quenby accepts it from the email");
    expect(screen.getByRole("status").textContent).not.toContain("Nobody holds this role until it is accepted");
  });

  it("a Resend on a treasurer row names the roster first name only", async () => {
    mockResend.mockResolvedValue({
      ok: true,
      invitationId: "inv-2",
      expiresAt: "2026-10-29T12:00:00.000Z",
      delivery: "queued",
      inviteeDisplayName: "Perpetua",
    });
    render(
      <InvitationList
        organizationId="org-1"
        purpose="treasurer"
        invitations={[invitationRow({ id: "inv-1", purpose: "treasurer", inviteeFirstName: null, inviteeLastName: null, inviteeDisplayName: "Perpetua" })]}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^resend$/i }));
    });
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("The treasurer designation takes effect when Perpetua accepts it from the email. Until then nobody holds this access.");
  });

  it("shows the server-derived name as the For line for both purposes, and no For line when there is none", () => {
    render(
      <InvitationList
        organizationId="org-1"
        purpose="treasurer"
        invitations={[
          invitationRow({ id: "1", purpose: "treasurer", inviteeFirstName: null, inviteeLastName: null, inviteeDisplayName: "Perpetua" }),
          invitationRow({ id: "2", inviteeDisplayName: null, inviteeFirstName: null, inviteeLastName: null }),
        ]}
      />,
    );
    const [first, second] = screen.getAllByTestId("invitation-row");
    expect(within(first).getByText("For")).toBeTruthy();
    expect(within(first).getByText("Perpetua")).toBeTruthy();
    expect(within(second).queryByText("For")).toBeNull();
  });

  it("a Resend refusal (the cooldown) renders verbatim in an alert", async () => {
    mockResend.mockResolvedValue({ ok: false, error: "Too many invitations right now. Try again later." });
    render(<InvitationList organizationId="org-1" invitations={[invitationRow()]} purpose="founding_administrator" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^resend$/i }));
    });
    expect(screen.getByRole("alert").textContent).toMatch(/too many invitations right now\. try again later\./i);
    expect(toastError).toHaveBeenCalledWith("Too many invitations right now. Try again later.");
  });

  it("Revoke opens an AlertDialog and does nothing until confirmed; never a native confirm", async () => {
    mockRevoke.mockResolvedValue({ ok: true, invitationId: "inv-1" });
    render(<InvitationList organizationId="org-1" invitations={[invitationRow({ id: "inv-1" })]} purpose="founding_administrator" />);
    fireEvent.click(screen.getByRole("button", { name: /^revoke$/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/stops working immediately/i);
    expect(dialog.textContent).toMatch(/clerk@example\.invalid/);
    expect(mockRevoke).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /yes, revoke/i }));
    });
    expect((mockRevoke.mock.calls[0][0] as FormData).get("invitationId")).toBe("inv-1");
    expect(toastSuccess).toHaveBeenCalledWith("Invitation revoked.");
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("Keep it closes the Revoke dialog without calling the action", async () => {
    render(<InvitationList organizationId="org-1" invitations={[invitationRow()]} purpose="founding_administrator" />);
    fireEvent.click(screen.getByRole("button", { name: /^revoke$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /keep it/i }));
    expect(mockRevoke).not.toHaveBeenCalled();
  });
});
