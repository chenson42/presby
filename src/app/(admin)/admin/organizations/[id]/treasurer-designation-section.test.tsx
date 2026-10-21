// @vitest-environment jsdom
/**
 * Tests for <TreasurerDesignationSection> — docs/work-log/
 * 2026-10-15-online-giving.md, Phase 3 "Designation". `./actions` is mocked
 * (the real module pulls `@/lib/db` into the graph).
 *
 * Pins: the control renders only while `canDesignate`, and the collapsed state
 * shows a COUNT and never a name; the confirm is an AlertDialog (Workflow Rule
 * 2); the trigger is disabled until the email looks valid; the action receives
 * the organization id and the trimmed email; the action's error copy renders
 * inline verbatim; no native dialog is ever invoked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockDesignate = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  inviteTreasurerAction: (fd: FormData) => mockDesignate(fd),
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
  currentHolderCount: 0,
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

describe("TreasurerDesignationSection — collapsed state", () => {
  it("shows a COUNT (plural) and no form when holders already exist", () => {
    render(<TreasurerDesignationSection {...PROPS} canDesignate={false} currentHolderCount={2} />);
    expect(screen.getByText(/2 people/i)).toBeTruthy();
    expect(screen.queryByLabelText(/email address/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /send invitation/i })).toBeNull();
  });

  it("says one person, singular", () => {
    render(<TreasurerDesignationSection {...PROPS} canDesignate={false} currentHolderCount={1} />);
    expect(screen.getByText(/one person/i)).toBeTruthy();
  });

  it("renders no names or emails at all in the collapsed state (a count only)", () => {
    const { container } = render(
      <TreasurerDesignationSection {...PROPS} canDesignate={false} currentHolderCount={3} />,
    );
    expect(container.textContent).not.toMatch(/@/);
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
    mockDesignate.mockResolvedValue({ ok: true, invitationId: "inv-1", delivery: "sent" });
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
    expect(await screen.findByText(/invitation sent\. nobody holds this access until it is accepted/i)).toBeTruthy();
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
