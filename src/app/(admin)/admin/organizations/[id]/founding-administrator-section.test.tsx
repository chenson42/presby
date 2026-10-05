// @vitest-environment jsdom
/**
 * Tests for <FoundingAdministratorSection> —
 * docs/work-log/2026-09-28-founding-administrator.md Phase 4 Batch C.
 * `./actions` is mocked (a "use server" module whose real implementation
 * pulls `@/lib/founding-administrator` -> `@/lib/db` into the module
 * graph — same reasoning `profile-form.test.tsx`'s own header gives).
 *
 * Pins:
 *   - `canDesignate: false` renders the read-only line naming the holder
 *     count and no form.
 *   - `canDesignate: true` renders the form and the "sign up first" hint
 *     UNCONDITIONALLY (not only on a `no_such_user` error).
 *   - The `AlertDialog` confirm names the actual permission list, singular/
 *     plural office-template clause included only when one is present.
 *   - Every `PolicyResult` variant's copy is rendered inline, verbatim,
 *     because the server action already returns the exact string — this
 *     component does not re-derive or re-word it.
 *   - The "Designate" trigger is disabled until the email looks valid.
 *   - No `confirm()`/`alert()`/`prompt()` is ever invoked (Workflow Rule 2).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PolicyResult } from "./actions";

const mockDesignateAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  designateFoundingAdministratorAction: (fd: FormData) => mockDesignateAction(fd),
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
  currentHolderCount: 0,
  administrationPermissionKeys: [
    "people.manage",
    "roles.manage",
    "role_grants.manage",
    "groups.manage",
    "officers.manage",
    "org_features.manage",
    "tickets.file",
    "staff.manage",
  ],
  officeTemplateName: "Congregation Stated Clerk" as string | null,
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

describe("FoundingAdministratorSection — disabled/read-only state", () => {
  it("collapses to a read-only line naming the holder count and renders no form when canDesignate is false", () => {
    render(
      <FoundingAdministratorSection
        {...BASE_PROPS}
        canDesignate={false}
        currentHolderCount={2}
      />,
    );

    expect(screen.getByText(/2 people/i)).toBeTruthy();
    expect(screen.queryByLabelText(/email address/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /designate founding administrator/i }),
    ).toBeNull();
  });

  it("says one person, singular, when currentHolderCount is 1", () => {
    render(
      <FoundingAdministratorSection
        {...BASE_PROPS}
        canDesignate={false}
        currentHolderCount={1}
      />,
    );
    expect(screen.getByText(/one person/i)).toBeTruthy();
  });
});

describe("FoundingAdministratorSection — form and hint", () => {
  it("renders the email input and the sign-up-first hint unconditionally, with no prior error", () => {
    render(<FoundingAdministratorSection {...BASE_PROPS} />);

    expect(screen.getByLabelText(/email address/i)).toBeTruthy();
    expect(
      screen.getByText(/must sign up for a platform account first/i),
    ).toBeTruthy();
  });

  it("disables the designate trigger until the email looks valid", () => {
    render(<FoundingAdministratorSection {...BASE_PROPS} />);

    const trigger = screen.getByRole("button", {
      name: /designate founding administrator/i,
    }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);

    typeEmail("not-an-email");
    expect(trigger.disabled).toBe(true);

    typeEmail("clerk@example.invalid");
    expect(trigger.disabled).toBe(false);
  });

  it("never calls a native browser dialog", () => {
    render(<FoundingAdministratorSection {...BASE_PROPS} />);
    typeEmail("clerk@example.invalid");
    fireEvent.click(
      screen.getByRole("button", { name: /designate founding administrator/i }),
    );
    expect(globalAlertSpy).not.toHaveBeenCalled();
    expect(globalConfirmSpy).not.toHaveBeenCalled();
    expect(globalPromptSpy).not.toHaveBeenCalled();
  });
});

describe("FoundingAdministratorSection — confirm dialog copy", () => {
  it("names the actual permission list and the office template", () => {
    render(<FoundingAdministratorSection {...BASE_PROPS} />);
    typeEmail("clerk@example.invalid");
    fireEvent.click(
      screen.getByRole("button", { name: /designate founding administrator/i }),
    );

    const body = document.body.textContent ?? "";
    expect(body).toMatch(/designate clerk@example\.invalid/i);
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
    expect(body).toMatch(/congregation stated clerk/i);
    expect(body).toMatch(/can only be done once/i);
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
    typeEmail("clerk@example.invalid");
    fireEvent.click(
      screen.getByRole("button", { name: /designate founding administrator/i }),
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
    typeEmail("clerk@example.invalid");
    fireEvent.click(
      screen.getByRole("button", { name: /designate founding administrator/i }),
    );

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/stated clerk/i);
  });
});

describe("FoundingAdministratorSection — every result variant's copy", () => {
  const CASES: Array<{ name: string; result: PolicyResult; expected: RegExp }> = [
    {
      name: "no_such_user",
      result: {
        ok: false,
        error:
          "No platform account exists for that email yet. Ask them to sign up first (they'll land on a page saying they have no organizations), then designate them here.",
      },
      expected: /ask them to sign up first/i,
    },
    {
      name: "user_inactive",
      result: { ok: false, error: "That account has been deactivated." },
      expected: /account has been deactivated/i,
    },
    {
      name: "person_elsewhere",
      result: {
        ok: false,
        error:
          "That account is already linked to a person at a different organization. Cross-organization transfers go through the certificate/transfer process, not this designation.",
      },
      expected: /already linked to a person at a different organization/i,
    },
    {
      name: "membership_ended (dated)",
      result: {
        ok: false,
        error:
          "That person's relationship with this organization ended on 2020-06-15.",
      },
      expected: /ended on 2020-06-15/i,
    },
    {
      name: "membership_ended (unknown)",
      result: {
        ok: false,
        error: "That person's relationship with this organization has ended.",
      },
      expected: /relationship with this organization has ended/i,
    },
    {
      name: "has_holders",
      result: {
        ok: false,
        error:
          "This organization already has someone who can manage roles — designation is only available while nobody does (including as a lockout recovery).",
      },
      expected: /designation is only available while nobody does/i,
    },
    {
      name: "provisioning_incomplete",
      result: {
        ok: false,
        error:
          "This organization is missing its baseline setup — contact an engineer before designating an administrator.",
      },
      expected: /contact an engineer/i,
    },
    {
      name: "race",
      result: {
        ok: false,
        error:
          "Someone just designated a founding administrator for this organization — refresh the page.",
      },
      expected: /refresh the page/i,
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
      result: { ok: true },
      expected: /founding administrator designated/i,
    },
  ];

  for (const { name, result, expected } of CASES) {
    it(`renders the ${name} result inline`, async () => {
      mockDesignateAction.mockResolvedValueOnce(result);

      render(<FoundingAdministratorSection {...BASE_PROPS} />);
      typeEmail("clerk@example.invalid");
      fireEvent.click(
        screen.getByRole("button", { name: /designate founding administrator/i }),
      );

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /yes, designate/i }));
      });

      expect(mockDesignateAction).toHaveBeenCalledTimes(1);
      const submittedFormData = mockDesignateAction.mock.calls[0][0] as FormData;
      expect(submittedFormData.get("organizationId")).toBe("org-1");
      expect(submittedFormData.get("email")).toBe("clerk@example.invalid");

      expect(screen.getByText(expected)).toBeTruthy();
      if (result.ok) {
        expect(toastSuccess).toHaveBeenCalled();
      } else {
        expect(toastError).toHaveBeenCalledWith(result.error);
      }
    });
  }
});
