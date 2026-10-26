// @vitest-environment jsdom
/**
 * The platform organization page's panel for the sign-in invitations a
 * congregation sent to its own people (Community Increment 2b, Copy: platform
 * panel). Masked addresses only, no names, and the second takedown lever posts
 * `scope=org_sent` to the existing action.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const mockRevokeAll = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ revokeAllInvitationsAction: (fd: FormData) => mockRevokeAll(fd) }));
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));

import type { OrgSentSummary } from "@/lib/onboarding/issue";
import { ORG_SENT_PANEL_COPY, SIGN_IN_CARD_COPY } from "@/lib/onboarding/sign-in-copy";
import { OrgSentInvitations } from "./org-sent-invitations";

afterEach(() => {
  cleanup();
  mockRevokeAll.mockReset();
  toastSuccess.mockReset();
});

function summary(over: Partial<OrgSentSummary> = {}): OrgSentSummary {
  return {
    counts: { pending: 2, accepted: 1, expired: 1, revoked: 3, blocked: 0 },
    revocable: 3,
    rows: [
      { id: "a", status: "pending", maskedAddress: "m***@example.invalid", createdAt: new Date("2026-10-20T12:00:00Z"), expiresAt: new Date("2026-10-27T12:00:00Z") },
      { id: "b", status: "accepted", maskedAddress: null, createdAt: new Date("2026-10-18T12:00:00Z"), expiresAt: new Date("2026-10-25T12:00:00Z") },
    ],
    ...over,
  };
}

describe("OrgSentInvitations", () => {
  it("shows the heading, the counts in the Copy's words, and a masked row per invitation with no name", () => {
    render(<OrgSentInvitations organizationId="org-1" summary={summary()} />);
    expect(screen.getByRole("heading", { name: ORG_SENT_PANEL_COPY.heading })).toBeTruthy();
    expect(screen.getByText("2 open, 1 accepted, 1 expired, 3 cancelled.")).toBeTruthy();
    const rows = screen.getAllByTestId("org-sent-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("m***@example.invalid");
    expect(rows[0].textContent).toContain("Pending");
    expect(rows[1].textContent).toContain("Address removed");
    expect(rows[1].textContent).toContain("Accepted");
  });

  it("offers 'Cancel all open sign-in invitations (n)' with the confirm, and posts scope=org_sent", async () => {
    mockRevokeAll.mockResolvedValue({ ok: true });
    render(<OrgSentInvitations organizationId="org-1" summary={summary()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel all open sign-in invitations (3)" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(ORG_SENT_PANEL_COPY.revokeAllConfirm);
    expect(mockRevokeAll).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /yes, revoke all/i }));
    });
    const fd = mockRevokeAll.mock.calls[0][0] as FormData;
    expect(fd.get("organizationId")).toBe("org-1");
    expect(fd.get("scope")).toBe("org_sent");
    expect(screen.getByRole("status").textContent).toBe("All open sign-in invitations were revoked.");
    expect(screen.getByRole("status").textContent).not.toContain("designation");
    expect(toastSuccess).toHaveBeenCalledWith("All open sign-in invitations revoked.");
  });

  it("offers no takedown when nothing is revocable", () => {
    render(<OrgSentInvitations organizationId="org-1" summary={summary({ revocable: 0 })} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("an empty congregation still shows the panel with zero counts and no rows", () => {
    render(
      <OrgSentInvitations
        organizationId="org-1"
        summary={summary({ counts: { pending: 0, accepted: 0, expired: 0, revoked: 0, blocked: 0 }, revocable: 0, rows: [] })}
      />,
    );
    expect(screen.getByText("0 open, 0 accepted, 0 expired, 0 cancelled.")).toBeTruthy();
    expect(screen.queryAllByTestId("org-sent-row")).toHaveLength(0);
  });

  it("a failed read says so as an alert, never an all-clear list", () => {
    render(<OrgSentInvitations organizationId="org-1" summary={null} />);
    expect(screen.getByRole("alert").textContent).toBe(SIGN_IN_CARD_COPY.loadFailed);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/open,/)).toBeNull();
  });
});
