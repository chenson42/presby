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
  designateTreasurerAction: (fd: FormData) => mockDesignate(fd),
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
    expect(screen.queryByRole("button", { name: /designate treasurer/i })).toBeNull();
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
  it("renders the email input, the member-first hint and the heading while nobody holds giving.manage", () => {
    render(<TreasurerDesignationSection {...PROPS} />);
    expect(screen.getByRole("heading", { name: /treasurer/i })).toBeTruthy();
    expect(screen.getByLabelText(/treasurer.s email address/i)).toBeTruthy();
    expect(screen.getByText(/must already be a member of this organization/i)).toBeTruthy();
  });

  it("disables the trigger until the email looks valid", () => {
    render(<TreasurerDesignationSection {...PROPS} />);
    const trigger = screen.getByRole("button", { name: /designate treasurer/i }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    typeEmail("not-an-email");
    expect(trigger.disabled).toBe(true);
    typeEmail("treasurer@example.invalid");
    expect(trigger.disabled).toBe(false);
  });

  it("confirms in an AlertDialog that names the person and the organization, then calls the action with the org id and the trimmed email", async () => {
    mockDesignate.mockResolvedValue({ ok: true });
    render(<TreasurerDesignationSection {...PROPS} />);
    typeEmail("  treasurer@example.invalid ");
    fireEvent.click(screen.getByRole("button", { name: /designate treasurer/i }));

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(/designate treasurer@example\.invalid as alder creek/i)).toBeTruthy();
    expect(mockDesignate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /yes, designate/i }));
    await waitFor(() => expect(mockDesignate).toHaveBeenCalledTimes(1));
    const fd = mockDesignate.mock.calls[0][0] as FormData;
    expect(fd.get("organizationId")).toBe("org-1");
    expect(fd.get("email")).toBe("treasurer@example.invalid");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(await screen.findByText(/treasurer designated/i)).toBeTruthy();
  });

  it("renders the action's error copy inline, verbatim, and toasts it", async () => {
    mockDesignate.mockResolvedValue({
      ok: false,
      error: "That account is not a member of this organization.",
    });
    render(<TreasurerDesignationSection {...PROPS} />);
    typeEmail("someone@example.invalid");
    fireEvent.click(screen.getByRole("button", { name: /designate treasurer/i }));
    fireEvent.click(await screen.findByRole("button", { name: /yes, designate/i }));
    expect(
      await screen.findByText("That account is not a member of this organization."),
    ).toBeTruthy();
    expect(toastError).toHaveBeenCalledWith("That account is not a member of this organization.");
  });

  it("never invokes a native dialog (Workflow Rule 2)", async () => {
    mockDesignate.mockResolvedValue({ ok: true });
    render(<TreasurerDesignationSection {...PROPS} />);
    typeEmail("treasurer@example.invalid");
    fireEvent.click(screen.getByRole("button", { name: /designate treasurer/i }));
    fireEvent.click(await screen.findByRole("button", { name: /yes, designate/i }));
    await waitFor(() => expect(mockDesignate).toHaveBeenCalled());
    expect(alertSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
  });
});
