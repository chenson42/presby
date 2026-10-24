// @vitest-environment jsdom
/**
 * Tests for <FoundingAdministratorSection> —
 * docs/work-log/2026-09-28-founding-administrator.md Phase 4 Batch C.
 * `./actions` is mocked (a "use server" module whose real implementation
 * pulls `@/lib/onboarding/issue` -> `@/lib/db` into the module graph — same
 * reasoning `profile-form.test.tsx`'s own header gives).
 *
 * Pins:
 *   - `canDesignate: false` renders the holders by display name (never an
 *     email) with a Revoke on each revocable row, the lead sentence naming the
 *     holder count, and no form; zero holders is the unchanged invite form.
 *   - `canDesignate: true` renders the form (email, first and last name) and
 *     says the person needs no account yet - no copy anywhere tells the
 *     operator to have them "sign up first" (C5, the 2026-10-21 blocker).
 *   - The `AlertDialog` confirm names the actual permission list, singular/
 *     plural office-template clause included only when one is present.
 *   - Every `InvitationActionResult` variant's copy is rendered inline, verbatim,
 *     because the server action already returns the exact string — this
 *     component does not re-derive or re-word it.
 *   - The "Send invitation" trigger is disabled until the email looks valid
 *     and both names are filled.
 *   - No `confirm()`/`alert()`/`prompt()` is ever invoked (Workflow Rule 2).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { InvitationActionResult } from "./actions";
import type { InvitationListRow } from "@/lib/onboarding/issue";
import type { HolderRow } from "@/lib/onboarding/designation-holder-types";
import { expiredInvitationLine, openInvitationLine } from "@/lib/onboarding/invitation-copy";
import { invitationRow } from "./invitation-row.fixture";
import { derivedGroupHolderRow, groupHolderRow, holderRow } from "./holder-row.fixture";

const mockDesignateAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  inviteFoundingAdministratorAction: (fd: FormData) => mockDesignateAction(fd),
  resendInvitationAction: vi.fn(),
  revokeInvitationAction: vi.fn(),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { FoundingAdministratorSection } from "./founding-administrator-section";

const BASE_PROPS = {
  organizationId: "org-1",
  organizationName: "Alder Creek Presbyterian Church",
  organizationType: "congregation" as const,
  canDesignate: true,
  holderPeopleCount: 0,
  holders: [] as HolderRow[],
  administrationPermissionKeys: [
    "people.manage",
    "roles.manage",
    "role_grants.manage",
    "groups.manage",
    "officers.manage",
    "org_features.manage",
    "tickets.file",
    "staff.manage",
    "domains.manage",
  ],
  officeTemplateName: "Congregation Stated Clerk" as string | null,
  invitations: [] as InvitationListRow[],
  localLoginEnabled: true,
  totpConfigured: true,
  inviterEmail: "operator@example.invalid" as string | null,
};

const globalAlertSpy = vi.spyOn(window, "alert");
const globalConfirmSpy = vi.spyOn(window, "confirm");
const globalPromptSpy = vi.spyOn(window, "prompt");

afterEach(() => {
  cleanup();
  mockDesignateAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  globalAlertSpy.mockClear();
  globalConfirmSpy.mockClear();
  globalPromptSpy.mockClear();
});

function typeEmail(value: string) {
  fireEvent.change(screen.getByLabelText(/email address/i), {
    target: { value },
  });
}

function typeNames(first = "Marisol", last = "Quenby") {
  fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: first } });
  fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: last } });
}

/** Everything the trigger needs: a valid address and both names. */
function fillForm(email = "clerk@example.invalid") {
  typeEmail(email);
  typeNames();
}

describe("FoundingAdministratorSection — holders state", () => {
  it("lists the holders and renders no form when canDesignate is false", () => {
    render(
      <FoundingAdministratorSection
        {...BASE_PROPS}
        canDesignate={false}
        holderPeopleCount={2}
        holders={[holderRow(), holderRow({ key: "person:2", subjectId: "p2", displayName: "Barnaby Quill" })]}
      />,
    );

    expect(screen.getByText(/2 people can manage roles/i)).toBeTruthy();
    expect(screen.getByText("Perpetua Ashgrove")).toBeTruthy();
    expect(screen.getByText("Barnaby Quill")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^revoke access for/i })).toHaveLength(2);
    expect(screen.queryByLabelText(/email address/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /send invitation/i })).toBeNull();
  });

  it("says one person, singular, when the holder count is 1", () => {
    render(
      <FoundingAdministratorSection
        {...BASE_PROPS}
        canDesignate={false}
        holderPeopleCount={1}
        holders={[holderRow()]}
      />,
    );
    expect(screen.getByText(/1 person can manage roles/i)).toBeTruthy();
  });

  it("a derived-group holder row has no Revoke and says the congregation's officers change it", () => {
    render(
      <FoundingAdministratorSection
        {...BASE_PROPS}
        canDesignate={false}
        holderPeopleCount={7}
        holders={[derivedGroupHolderRow()]}
      />,
    );
    expect(screen.queryByRole("button", { name: /revoke access/i })).toBeNull();
    expect(screen.getByTestId("derived-holder-note").textContent).toMatch(/officers change this/i);
  });

  it("renders no email address anywhere in the holders state", () => {
    const { container } = render(
      <FoundingAdministratorSection
        {...BASE_PROPS}
        canDesignate={false}
        holderPeopleCount={4}
        holders={[holderRow(), groupHolderRow()]}
      />,
    );
    expect(container.textContent).not.toMatch(/@/);
  });

  it("zero holders is the unchanged invite form (no list, no lead sentence)", () => {
    render(<FoundingAdministratorSection {...BASE_PROPS} />);
    expect(screen.getByLabelText(/email address/i)).toBeTruthy();
    expect(screen.queryByTestId("designation-holder-list")).toBeNull();
    expect(screen.queryByText(/can manage roles at this organization/i)).toBeNull();
  });

  it("an open invitation with zero holders renders its row and no holder list", () => {
    render(
      <FoundingAdministratorSection
        {...BASE_PROPS}
        invitations={[invitationRow({ status: "pending" })]}
      />,
    );
    expect(screen.getByText(/an invitation is open/i)).toBeTruthy();
    expect(screen.queryByTestId("designation-holder-list")).toBeNull();
  });
});

describe("FoundingAdministratorSection — form and hint", () => {
  it("renders the email and name inputs and says the person needs no account yet (C5: no 'sign up first' copy)", () => {
    const { container } = render(<FoundingAdministratorSection {...BASE_PROPS} />);

    expect(screen.getByLabelText(/email address/i)).toBeTruthy();
    expect(screen.getByLabelText(/first name/i)).toBeTruthy();
    expect(screen.getByLabelText(/last name/i)).toBeTruthy();
    expect(screen.getByText(/does not need an account yet/i)).toBeTruthy();
    expect(container.textContent).not.toMatch(/sign up/i);
  });

  it("disables the send trigger until the email looks valid and both names are filled", () => {
    render(<FoundingAdministratorSection {...BASE_PROPS} />);

    const trigger = screen.getByRole("button", {
      name: /send invitation/i,
    }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);

    typeEmail("not-an-email");
    typeNames();
    expect(trigger.disabled).toBe(true);

    typeEmail("clerk@example.invalid");
    typeNames("", "Quenby");
    expect(trigger.disabled).toBe(true);
    typeNames("Marisol", "  ");
    expect(trigger.disabled).toBe(true);

    typeNames("Marisol", "Quenby");
    expect(trigger.disabled).toBe(false);
  });

  it("never calls a native browser dialog", () => {
    render(<FoundingAdministratorSection {...BASE_PROPS} />);
    fillForm();
    fireEvent.click(
      screen.getByRole("button", { name: /send invitation/i }),
    );
    expect(globalAlertSpy).not.toHaveBeenCalled();
    expect(globalConfirmSpy).not.toHaveBeenCalled();
    expect(globalPromptSpy).not.toHaveBeenCalled();
  });
});

describe("FoundingAdministratorSection — confirm dialog copy", () => {
  it("names the actual permission list and the office template", () => {
    render(<FoundingAdministratorSection {...BASE_PROPS} />);
    fillForm();
    fireEvent.click(
      screen.getByRole("button", { name: /send invitation/i }),
    );

    const body = document.body.textContent ?? "";
    expect(body).toMatch(/invite clerk@example\.invalid/i);
    expect(body).toMatch(/alder creek presbyterian church/i);
    expect(body).toMatch(/people/i);
    expect(body).toMatch(/roles/i);
    expect(body).toMatch(/role assignments/i);
    expect(body).toMatch(/groups/i);
    expect(body).toMatch(/officers/i);
    expect(body).toMatch(/feature toggles/i);
    expect(body).toMatch(/support tickets/i);
    // F118 — staff.manage joins the bundle. A raw key rendering verbatim
    // (PERMISSION_LABELS drift) is a FAIL, not a cosmetic nit: the label
    // must read "staff", never the literal "staff.manage".
    expect(body).toMatch(/staff/i);
    expect(body).not.toMatch(/staff\.manage/i);
    // F150 — domains.manage joins the bundle; same drift guard: a raw key
    // rendering verbatim is a FAIL.
    expect(body).toMatch(/website domains/i);
    expect(body).not.toMatch(/domains\.manage/i);
    expect(body).toMatch(/congregation stated clerk/i);
    expect(body).toMatch(/nobody holds this role until it is accepted/i);
  });

  it("includes congregation oversight for a presbytery, via the passed-in permission keys", () => {
    render(
      <FoundingAdministratorSection
        {...BASE_PROPS}
        organizationType="presbytery"
        officeTemplateName="Presbytery Stated Clerk"
        administrationPermissionKeys={[
          ...BASE_PROPS.administrationPermissionKeys,
          "congregation_oversight.manage",
        ]}
      />,
    );
    fillForm();
    fireEvent.click(
      screen.getByRole("button", { name: /send invitation/i }),
    );

    const body = document.body.textContent ?? "";
    expect(body).toMatch(/congregation oversight/i);
    expect(body).toMatch(/presbytery stated clerk/i);
  });

  it("omits the office-template clause when there is none (synod/GA/NWC)", () => {
    render(
      <FoundingAdministratorSection
        {...BASE_PROPS}
        organizationType="synod"
        officeTemplateName={null}
      />,
    );
    fillForm();
    fireEvent.click(
      screen.getByRole("button", { name: /send invitation/i }),
    );

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/stated clerk/i);
  });
});

describe("FoundingAdministratorSection — every result variant's copy", () => {
  const CASES: Array<{ name: string; result: InvitationActionResult; expected: RegExp }> = [
    {
      name: "has_holders",
      result: {
        ok: false,
        error:
          "This organization already has someone who can manage roles — an invitation is only available while nobody does (including as a lockout recovery).",
      },
      expected: /an invitation is only available while nobody does/i,
    },
    {
      name: "already_pending",
      result: { ok: false, error: "An invitation is already pending. Resend or revoke it." },
      expected: /already pending\. resend or revoke it/i,
    },
    {
      name: "provisioning_incomplete",
      result: {
        ok: false,
        error:
          "This organization is missing its baseline setup or a role template — contact an engineer before sending an invitation.",
      },
      expected: /contact an engineer/i,
    },
    {
      name: "rate_limited",
      result: { ok: false, error: "Too many invitations right now. Try again later." },
      expected: /too many invitations right now/i,
    },
    {
      name: "db_error",
      result: {
        ok: false,
        error: "We couldn't complete that just now — try again in a moment.",
      },
      expected: /try again in a moment/i,
    },
    {
      name: "ok",
      result: {
        ok: true,
        invitationId: "inv-1",
        expiresAt: "2026-10-28T12:00:00.000Z",
        delivery: "sent",
        inviteeDisplayName: "Marisol Quenby",
      },
      expected: /invitation sent to clerk@example\.invalid\. it expires on .* the founding administrator designation takes effect when marisol quenby accepts it from the email\. until then nobody holds this role\./i,
    },
  ];

  for (const { name, result, expected } of CASES) {
    it(`renders the ${name} result inline`, async () => {
      mockDesignateAction.mockResolvedValueOnce(result);

      render(<FoundingAdministratorSection {...BASE_PROPS} />);
      fillForm();
      fireEvent.click(
        screen.getByRole("button", { name: /send invitation/i }),
      );

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /yes, send invitation/i }));
      });

      expect(mockDesignateAction).toHaveBeenCalledTimes(1);
      const submittedFormData = mockDesignateAction.mock.calls[0][0] as FormData;
      expect(submittedFormData.get("organizationId")).toBe("org-1");
      expect(submittedFormData.get("email")).toBe("clerk@example.invalid");
      expect(submittedFormData.get("firstName")).toBe("Marisol");
      expect(submittedFormData.get("lastName")).toBe("Quenby");

      expect(screen.getByText(expected)).toBeTruthy();
      if (result.ok) {
        expect(toastSuccess).toHaveBeenCalled();
      } else {
        expect(toastError).toHaveBeenCalledWith(result.error);
      }
    });
  }
});

describe("FoundingAdministratorSection — Batch 3 states", () => {
  it("an open invitation replaces the form with its row (no email field, no send button)", () => {
    render(
      <FoundingAdministratorSection
        {...BASE_PROPS}
        invitations={[invitationRow({ status: "pending" })]}
      />,
    );
    expect(screen.queryByLabelText(/email address/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /send invitation/i })).toBeNull();
    expect(screen.getByText(/an invitation is open/i)).toBeTruthy();
    expect(screen.getByTestId("invitation-row")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^resend$/i })).toBeTruthy();
  });

  it("the open line names the person; the expired line says it has expired (not 'open')", () => {
    const { unmount } = render(
      <FoundingAdministratorSection
        {...BASE_PROPS}
        invitations={[invitationRow({ status: "pending" })]}
      />,
    );
    expect(
      screen.getByText(openInvitationLine("founding_administrator", "Marisol Quenby")),
    ).toBeTruthy();
    expect(screen.getByText(/an invitation is open for marisol quenby\. nobody holds this role until marisol quenby accepts it\./i)).toBeTruthy();
    unmount();
    render(
      <FoundingAdministratorSection
        {...BASE_PROPS}
        invitations={[invitationRow({ status: "expired" })]}
      />,
    );
    expect(
      screen.getByText(expiredInvitationLine("founding_administrator", "Marisol Quenby")),
    ).toBeTruthy();
    expect(screen.getByText(/the invitation for marisol quenby has expired\. nobody holds this role\. resend it or revoke it to invite someone else\./i)).toBeTruthy();
    expect(screen.queryByText(/an invitation is open/i)).toBeNull();
  });

  it("with no name the open line falls back to the unnamed wording", () => {
    render(
      <FoundingAdministratorSection
        {...BASE_PROPS}
        invitations={[invitationRow({ status: "pending", inviteeDisplayName: null })]}
      />,
    );
    expect(screen.getByText(openInvitationLine("founding_administrator", null))).toBeTruthy();
    expect(screen.getByText(/^an invitation is open\. nobody holds this role until it is accepted\./i)).toBeTruthy();
  });

  it("an expired invitation with no name still says expired, never 'open'", () => {
    render(
      <FoundingAdministratorSection
        {...BASE_PROPS}
        invitations={[invitationRow({ status: "expired", inviteeDisplayName: null })]}
      />,
    );
    expect(screen.getByText(expiredInvitationLine("founding_administrator", null))).toBeTruthy();
    expect(screen.getByText(/^the invitation has expired\. nobody holds this role\. resend it or revoke it to invite someone else\./i)).toBeTruthy();
    expect(screen.queryByText(/an invitation is open/i)).toBeNull();
  });

  it("an expired invitation still holds the slot and offers Resend", () => {
    render(
      <FoundingAdministratorSection
        {...BASE_PROPS}
        invitations={[invitationRow({ status: "expired" })]}
      />,
    );
    expect(screen.queryByLabelText(/email address/i)).toBeNull();
    expect(screen.getByRole("button", { name: /^resend$/i })).toBeTruthy();
  });

  it("a finished invitation (revoked) does not hide the form, and stays listed as history", () => {
    render(
      <FoundingAdministratorSection
        {...BASE_PROPS}
        invitations={[invitationRow({ status: "revoked" })]}
      />,
    );
    expect(screen.getByLabelText(/email address/i)).toBeTruthy();
    expect(screen.getByTestId("invitation-row")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^resend$/i })).toBeNull();
  });

  it("adds the self-address sentence only when the address is the operator's own (case-insensitive)", () => {
    render(<FoundingAdministratorSection {...BASE_PROPS} />);
    fillForm("Operator@Example.invalid");
    fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));
    expect(screen.getByTestId("self-address-sentence").textContent).toMatch(/your own address/i);
    expect(screen.getByTestId("self-address-sentence").textContent).toMatch(/self-designation/i);
  });

  it("omits the self-address sentence for someone else", () => {
    render(<FoundingAdministratorSection {...BASE_PROPS} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));
    expect(screen.queryByTestId("self-address-sentence")).toBeNull();
  });

  it("warns in the confirm when password sign-in is off, and not when it is on", () => {
    const { unmount } = render(
      <FoundingAdministratorSection {...BASE_PROPS} localLoginEnabled={false} />,
    );
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));
    expect(screen.getByTestId("local-login-off-sentence").textContent).toMatch(/password sign-in is turned off/i);
    unmount();
    cleanup();
    render(<FoundingAdministratorSection {...BASE_PROPS} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));
    expect(screen.queryByTestId("local-login-off-sentence")).toBeNull();
  });

  it("do-not-contact: the first result swaps the dialog for the warning, 'Send anyway' re-submits with acknowledge", async () => {
    mockDesignateAction
      .mockResolvedValueOnce({
        ok: false,
        error: "This person asked not to be contacted. Account invitations are not marketing mail.",
        needsAcknowledgement: "do_not_contact",
      })
      .mockResolvedValueOnce({ ok: true, invitationId: "inv-1", expiresAt: "2026-10-28T12:00:00.000Z", delivery: "sent" });
    render(<FoundingAdministratorSection {...BASE_PROPS} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /yes, send invitation/i }));
    });
    expect((mockDesignateAction.mock.calls[0][0] as FormData).get("acknowledge")).toBeNull();
    expect(screen.getByRole("alertdialog").textContent).toMatch(/asked not to be contacted/i);
    expect(toastError).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send anyway/i }));
    });
    expect((mockDesignateAction.mock.calls[1][0] as FormData).get("acknowledge")).toBe("true");
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("with two-factor not configured the send is disabled and the operator is told why", () => {
    render(<FoundingAdministratorSection {...BASE_PROPS} totpConfigured={false} />);
    expect(screen.getByRole("alert").textContent).toMatch(/two-factor sign-in isn.t set up/i);
    fillForm();
    expect((screen.getByRole("button", { name: /send invitation/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a queued delivery says delivery is delayed", async () => {
    mockDesignateAction.mockResolvedValueOnce({
      ok: true,
      invitationId: "inv-1",
      expiresAt: "2026-10-28T12:00:00.000Z",
      delivery: "queued",
      inviteeDisplayName: "Marisol Quenby",
    });
    render(<FoundingAdministratorSection {...BASE_PROPS} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /yes, send invitation/i }));
    });
    expect(screen.getByText(/email delivery is delayed/i)).toBeTruthy();
    // The lead line names the submitted address even after the form has cleared.
    expect(screen.getByText(/invitation created for clerk@example\.invalid\./i)).toBeTruthy();
  });

  it("the holders state still lists history rows (an accepted invitation)", () => {
    render(
      <FoundingAdministratorSection
        {...BASE_PROPS}
        canDesignate={false}
        holderPeopleCount={1}
        holders={[holderRow()]}
        invitations={[invitationRow({ status: "accepted", acceptedAt: new Date("2026-10-22T09:00:00.000Z"), selfDesignated: true })]}
      />,
    );
    expect(screen.getByText(/1 person can manage roles/i)).toBeTruthy();
    // The holder row never says "Self-designated" or "Accepted": those are the
    // invitation row's facts, so strict-mode matches elsewhere stay unique.
    expect(screen.getAllByText("Accepted")).toHaveLength(2); // the status badge and the date label
    expect(screen.getByText("Self-designated")).toBeTruthy();
  });
});
