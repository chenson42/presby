// @vitest-environment jsdom
/**
 * T13 (F343, DECISION-291), Copy S4 to S6: the per-person card is honest about
 * scope. Its badge and checkbox describe the account's OWN setting, never the
 * effective requirement; the off-toast does not claim to have released a person
 * a role or a congregation may still require.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const setTwoFactorRequired = vi.hoisted(() => vi.fn());
const forceResetTwoFactor = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ setTwoFactorRequired, forceResetTwoFactor }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/shared/formatted-date", () => ({ FormattedDate: () => "a date" }));

import { TwoFactorCard } from "./two-factor-card";

const base = {
  userId: "u-1",
  twoFactorRequired: false,
  enrolled: false,
  enrolledAt: null,
  unusedRecoveryCodeCount: 0,
  isSelf: false,
};

beforeEach(() => {
  setTwoFactorRequired.mockResolvedValue({ ok: true });
  forceResetTwoFactor.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TwoFactorCard copy (F343)", () => {
  it("S4: the badge is column-scoped when the own setting is off", () => {
    render(<TwoFactorCard {...base} />);
    expect(screen.getByText("Own setting: not required")).toBeTruthy();
    expect(screen.queryByText("2FA not required")).toBeNull();
  });

  it("S5: the paragraph says a role or a congregation can still require it, and that an enrolled authenticator is kept", () => {
    const { container } = render(<TwoFactorCard {...base} />);
    expect((container.textContent ?? "").replace(/\s+/g, " ")).toContain(
      "This account's own setting is off. A role or a congregation's policy can still require two-factor. An enrolled authenticator is kept either way, and is used again if the setting is switched back on.",
    );
    expect(container.textContent).not.toMatch(/Disabling does not remove/);
  });

  it("S5: the enrolled paragraph still shows when the own setting is off", () => {
    const { container } = render(
      <TwoFactorCard {...base} enrolled enrolledAt={new Date("2026-01-01T00:00:00Z")} unusedRecoveryCodeCount={3} />,
    );
    expect(container.textContent).toContain("3 unused recovery codes remaining");
    expect(container.textContent).toContain("A role or a congregation's policy can still require two-factor.");
  });

  it("S6: switching the own setting off toasts the hedged text, not a release", async () => {
    render(<TwoFactorCard {...base} twoFactorRequired enrolled enrolledAt={new Date("2026-01-01T00:00:00Z")} />);
    fireEvent.click(screen.getByLabelText("Require 2FA"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(setTwoFactorRequired).toHaveBeenCalledWith({ userId: "u-1", required: false });
    expect(toast.success).toHaveBeenCalledWith(
      "This account's own requirement is off. A role or a congregation's policy may still require two-factor.",
    );
  });

  it("S6: switching it on keeps the existing text", async () => {
    render(<TwoFactorCard {...base} />);
    fireEvent.click(screen.getByLabelText("Require 2FA"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("2FA is now required. Takes effect on the user's next page load.");
  });

  it("the checkbox is disabled for the viewer's own account, and says so", () => {
    render(<TwoFactorCard {...base} twoFactorRequired isSelf />);
    expect((screen.getByLabelText("Require 2FA") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("You cannot change your own 2FA requirement.")).toBeTruthy();
  });

  it("an own setting that is on keeps the Enrolled / Not enrolled badges and the next-sign-in line", () => {
    const { container, rerender } = render(<TwoFactorCard {...base} twoFactorRequired />);
    expect(screen.getByText("Not enrolled")).toBeTruthy();
    expect(container.textContent).toContain("They will be prompted on next sign-in.");
    rerender(<TwoFactorCard {...base} twoFactorRequired enrolled enrolledAt={new Date("2026-01-01T00:00:00Z")} />);
    expect(screen.getByText("Enrolled")).toBeTruthy();
  });

  // S9 and S10: Force-reset does not promise a re-enrolment. Whether the person is
  // asked again depends on their own setting, a role or a congregation, none of
  // which the card reads, so the copy is conditional on what the action does.
  const S9 =
    "2FA enrollment wiped. If something still requires two-factor of this user, they will be asked to set it up again at their next sign-in. If nothing does, they will not be asked.";
  const S10 =
    "This will permanently delete the user's TOTP secret, recovery codes, and any pending enrollment. While enforcement is on, if their own setting, a role or a congregation's policy requires two-factor, they will be asked to set it up again at their next sign-in. If nothing requires it, they will not be asked, and can set it up again themselves at Account \u2192 Two-factor.";

  it.each([
    ["own setting on", true],
    ["own setting off", false],
  ])("S9 and S10: the Force-reset dialog and toast do not promise re-enrolment (%s)", async (_label, own) => {
    render(
      <TwoFactorCard {...base} twoFactorRequired={own} enrolled enrolledAt={new Date("2026-01-01T00:00:00Z")} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Force-reset 2FA enrollment" }));
    const dialog = await screen.findByRole("dialog");
    const text = (dialog.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain(S10);
    expect(text).not.toMatch(/will be required to re-enroll/);

    fireEvent.click(screen.getByRole("button", { name: "Yes, reset enrollment" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(S9));
    expect(forceResetTwoFactor).toHaveBeenCalledWith({ userId: "u-1" });
    for (const [arg] of toast.success.mock.calls) {
      expect(String(arg)).not.toMatch(/required to re-enroll/);
    }
  });
});
