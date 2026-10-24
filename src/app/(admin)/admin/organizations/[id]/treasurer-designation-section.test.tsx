// @vitest-environment jsdom
/**
 * Tests for <TreasurerDesignationSection> — docs/work-log/
 * 2026-10-15-online-giving.md, Phase 3 "Designation". `./actions` is mocked
 * (the real module pulls `@/lib/db` into the graph).
 *
 * Pins: the control renders only while `canDesignate`, and the collapsed state
 * lists the holders by DISPLAY NAME (DECISION-195, reversing the earlier
 * count-only rule) and never an email, with a Revoke on each revocable row; the confirm is an AlertDialog (Workflow Rule
 * 2); the trigger is disabled until the email looks valid; the action receives
 * the organization id and the trimmed email; the action's error copy renders
 * inline verbatim; no native dialog is ever invoked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { InvitationListRow } from "@/lib/onboarding/issue";
import { expiredInvitationLine, openInvitationLine } from "@/lib/onboarding/invitation-copy";
import { invitationRow } from "./invitation-row.fixture";
import { derivedGroupHolderRow, groupHolderRow, holderRow } from "./holder-row.fixture";
import type { HolderRow } from "@/lib/onboarding/designation-holder-types";

const mockDesignate = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  inviteTreasurerAction: (fd: FormData) => mockDesignate(fd),
  resendInvitationAction: vi.fn(),
  revokeInvitationAction: vi.fn(),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

import { TreasurerDesignationSection } from "./treasurer-designation-section";

const PROPS = {
  organizationId: "org-1",
  organizationName: "Alder Creek Presbyterian Church",
  canDesignate: true,
  holderPeopleCount: 0,
  holders: [] as HolderRow[],
  invitations: [] as InvitationListRow[],
  localLoginEnabled: true,
  totpConfigured: true,
  inviterEmail: "operator@example.invalid" as string | null,
};

const alertSpy = vi.spyOn(window, "alert");
const confirmSpy = vi.spyOn(window, "confirm");
const promptSpy = vi.spyOn(window, "prompt");

afterEach(() => {
  cleanup();
  mockDesignate.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  alertSpy.mockClear();
  confirmSpy.mockClear();
  promptSpy.mockClear();
});

const typeEmail = (value: string) =>
  fireEvent.change(screen.getByLabelText(/treasurer.s email address/i), {
    target: { value },
  });

describe("TreasurerDesignationSection — holders state", () => {
  const people = [
    holderRow({ roleNames: ["Treasurer"], companionRoleNames: [], displayName: "Ottoline Fairweather" }),
    holderRow({ key: "person:2", subjectId: "p2", roleNames: ["Treasurer"], companionRoleNames: [], displayName: "Barnaby Quill" }),
  ];

  it("lists the holders by name and renders no form when holders already exist", () => {
    render(
      <TreasurerDesignationSection {...PROPS} canDesignate={false} holderPeopleCount={2} holders={people} />,
    );
    expect(screen.getByText(/2 people can manage giving/i)).toBeTruthy();
    expect(screen.getByText("Ottoline Fairweather")).toBeTruthy();
    expect(screen.getByText("Barnaby Quill")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^revoke access for/i })).toHaveLength(2);
    expect(screen.queryByLabelText(/email address/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /send invitation/i })).toBeNull();
  });

  it("says one person, singular", () => {
    render(
      <TreasurerDesignationSection {...PROPS} canDesignate={false} holderPeopleCount={1} holders={[people[0]!]} />,
    );
    expect(screen.getByText(/1 person can manage giving/i)).toBeTruthy();
  });

  it("states that gift and donor records are not changed and that every designation and ending is audited, with no claim about operator access", () => {
    render(
      <TreasurerDesignationSection {...PROPS} canDesignate={false} holderPeopleCount={1} holders={[people[0]!]} />,
    );
    expect(
      screen.getByText(/Gift and donor records are not changed by ending access here\. Every designation and every ending of access is recorded in the audit log\./),
    ).toBeTruthy();
    expect(screen.queryByText(/gains no access/i)).toBeNull();
  });

  it("renders no email address and no group-member names in the holders state", () => {
    const { container } = render(
      <TreasurerDesignationSection
        {...PROPS}
        canDesignate={false}
        holderPeopleCount={5}
        holders={[people[0]!, groupHolderRow(), derivedGroupHolderRow()]}
      />,
    );
    expect(container.textContent).not.toMatch(/@/);
    expect(screen.getByText("Office Volunteers (group)")).toBeTruthy();
  });

  it("zero holders is the unchanged invite form", () => {
    render(<TreasurerDesignationSection {...PROPS} />);
    expect(screen.getByLabelText(/treasurer.s email address/i)).toBeTruthy();
    expect(screen.queryByTestId("designation-holder-list")).toBeNull();
  });
});

describe("TreasurerDesignationSection — the control", () => {
  it("renders the email input, the on-file-address hint and the heading while nobody holds giving.manage (no 'platform account' prerequisite - C5)", () => {
    const { container } = render(<TreasurerDesignationSection {...PROPS} />);
    expect(screen.getByRole("heading", { name: /treasurer/i })).toBeTruthy();
    expect(screen.getByLabelText(/treasurer.s email address/i)).toBeTruthy();
    expect(screen.getByText(/must be the one on file for a member of this organization/i)).toBeTruthy();
    expect(container.textContent).not.toMatch(/have a\s+platform account|sign up/i);
  });

  it("disables the trigger until the email looks valid", () => {
    render(<TreasurerDesignationSection {...PROPS} />);
    const trigger = screen.getByRole("button", { name: /send invitation/i }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    typeEmail("not-an-email");
    expect(trigger.disabled).toBe(true);
    typeEmail("treasurer@example.invalid");
    expect(trigger.disabled).toBe(false);
  });

  it("confirms in an AlertDialog that names the person and the organization, then calls the action with the org id and the trimmed email", async () => {
    mockDesignate.mockResolvedValue({
      ok: true,
      invitationId: "inv-1",
      delivery: "sent",
      expiresAt: "2026-10-28T12:00:00.000Z",
      inviteeDisplayName: "Perpetua",
    });
    render(<TreasurerDesignationSection {...PROPS} />);
    typeEmail("  treasurer@example.invalid ");
    fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(/invite treasurer@example\.invalid to be alder creek/i)).toBeTruthy();
    expect(mockDesignate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /yes, send invitation/i }));
    await waitFor(() => expect(mockDesignate).toHaveBeenCalledTimes(1));
    const fd = mockDesignate.mock.calls[0][0] as FormData;
    expect(fd.get("organizationId")).toBe("org-1");
    expect(fd.get("email")).toBe("treasurer@example.invalid");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(
      await screen.findByText(
        /invitation sent to treasurer@example\.invalid\. it expires on .* the treasurer designation takes effect when perpetua accepts it from the email\. until then nobody holds this access\./i,
      ),
    ).toBeTruthy();
  });

  it("renders the action's error copy inline, verbatim, and toasts it", async () => {
    mockDesignate.mockResolvedValue({
      ok: false,
      error: "Nobody enrolled at this congregation has that email on file.",
    });
    render(<TreasurerDesignationSection {...PROPS} />);
    typeEmail("someone@example.invalid");
    fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));
    fireEvent.click(await screen.findByRole("button", { name: /yes, send invitation/i }));
    expect(
      await screen.findByText("Nobody enrolled at this congregation has that email on file."),
    ).toBeTruthy();
    expect(toastError).toHaveBeenCalledWith("Nobody enrolled at this congregation has that email on file.");
  });

  it("never invokes a native dialog (Workflow Rule 2)", async () => {
    mockDesignate.mockResolvedValue({ ok: true, invitationId: "inv-1", delivery: "sent" });
    render(<TreasurerDesignationSection {...PROPS} />);
    typeEmail("treasurer@example.invalid");
    fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));
    fireEvent.click(await screen.findByRole("button", { name: /yes, send invitation/i }));
    await waitFor(() => expect(mockDesignate).toHaveBeenCalled());
    expect(alertSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
  });
});

describe("TreasurerDesignationSection — Batch 3 states", () => {
  it("an open invitation replaces the form with its row", () => {
    render(
      <TreasurerDesignationSection
        {...PROPS}
        invitations={[invitationRow({ purpose: "treasurer", status: "pending" })]}
      />,
    );
    expect(screen.queryByLabelText(/email address/i)).toBeNull();
    expect(screen.getByText(/an invitation is open/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^resend$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^revoke$/i })).toBeTruthy();
  });

  it("the open line names the roster first name; the expired line says it has expired", () => {
    const { unmount } = render(
      <TreasurerDesignationSection
        {...PROPS}
        invitations={[invitationRow({ purpose: "treasurer", status: "pending", inviteeFirstName: null, inviteeLastName: null, inviteeDisplayName: "Perpetua" })]}
      />,
    );
    expect(screen.getByText(openInvitationLine("treasurer", "Perpetua"))).toBeTruthy();
    expect(screen.getByText(/an invitation is open for perpetua\. nobody holds this access until perpetua accepts it\./i)).toBeTruthy();
    // The treasurer's row shows the same first name as its "For" line.
    expect(screen.getByText("For")).toBeTruthy();
    unmount();
    render(
      <TreasurerDesignationSection
        {...PROPS}
        invitations={[invitationRow({ purpose: "treasurer", status: "expired", inviteeFirstName: null, inviteeLastName: null, inviteeDisplayName: "Perpetua" })]}
      />,
    );
    expect(screen.getByText(expiredInvitationLine("treasurer", "Perpetua"))).toBeTruthy();
    expect(screen.getByText(/the invitation for perpetua has expired\. nobody holds this access\. resend it or revoke it/i)).toBeTruthy();
    expect(screen.queryByText(/an invitation is open/i)).toBeNull();
  });

  it("an expired invitation with no name still says expired, never 'open'", () => {
    render(
      <TreasurerDesignationSection
        {...PROPS}
        invitations={[invitationRow({ purpose: "treasurer", status: "expired", inviteeDisplayName: null })]}
      />,
    );
    expect(screen.getByText(expiredInvitationLine("treasurer", null))).toBeTruthy();
    expect(screen.getByText(/^the invitation has expired\. nobody holds this access\./i)).toBeTruthy();
    expect(screen.queryByText(/an invitation is open/i)).toBeNull();
  });

  it("with no name the open line falls back to the unnamed wording", () => {
    render(
      <TreasurerDesignationSection
        {...PROPS}
        invitations={[invitationRow({ purpose: "treasurer", status: "pending", inviteeDisplayName: null })]}
      />,
    );
    expect(screen.getByText(openInvitationLine("treasurer", null))).toBeTruthy();
  });

  it("adds the self-address sentence only for the operator's own address", () => {
    render(<TreasurerDesignationSection {...PROPS} />);
    typeEmail("operator@example.invalid");
    fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));
    expect(screen.getByTestId("self-address-sentence")).toBeTruthy();
  });

  it("warns when password sign-in is off", () => {
    render(<TreasurerDesignationSection {...PROPS} localLoginEnabled={false} />);
    typeEmail("treasurer@example.invalid");
    fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));
    expect(screen.getByTestId("local-login-off-sentence")).toBeTruthy();
  });

  it("with two-factor not configured the send is disabled", () => {
    render(<TreasurerDesignationSection {...PROPS} totpConfigured={false} />);
    typeEmail("treasurer@example.invalid");
    expect((screen.getByRole("button", { name: /send invitation/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/two-factor sign-in isn.t set up/i);
  });

  it("do-not-contact: acknowledged re-submit carries acknowledge=true", async () => {
    mockDesignate
      .mockResolvedValueOnce({ ok: false, error: "This person asked not to be contacted.", needsAcknowledgement: "do_not_contact" })
      .mockResolvedValueOnce({ ok: true, invitationId: "inv-1", expiresAt: "2026-10-28T12:00:00.000Z", delivery: "sent" });
    render(<TreasurerDesignationSection {...PROPS} />);
    typeEmail("treasurer@example.invalid");
    fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));
    fireEvent.click(await screen.findByRole("button", { name: /yes, send invitation/i }));
    fireEvent.click(await screen.findByRole("button", { name: /send anyway/i }));
    await waitFor(() => expect(mockDesignate).toHaveBeenCalledTimes(2));
    expect((mockDesignate.mock.calls[0][0] as FormData).get("acknowledge")).toBeNull();
    expect((mockDesignate.mock.calls[1][0] as FormData).get("acknowledge")).toBe("true");
  });
});
