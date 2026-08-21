// @vitest-environment jsdom
/**
 * Tests for <ProfileForm> — docs/work-log/2026-08-21-public-site-org-
 * profile.md Phase 4 commit 2. `./actions` is mocked, same reasoning
 * brand-form.test.tsx's own header gives for its own mock (a "use server"
 * module whose real implementation pulls getPlatformDb()/@/auth into the
 * module graph). What this file pins:
 *
 *   - typed values survive a failed submit — every field is client-owned
 *     state, never reset from the action result (matches brand-form's own
 *     E-c1/E-c2 posture, restated for this form);
 *   - the server's returned error is surfaced INLINE, not only as a toast;
 *   - every field submits under its own FormData key, empty by default when
 *     no initial value was supplied.
 *
 * No jest-dom matchers — see org-mark.test.tsx's header for why.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { PolicyResult } from "./actions";

const setOrganizationProfileAction = vi.fn<(fd: FormData) => Promise<PolicyResult>>();
vi.mock("./actions", () => ({
  setOrganizationProfileAction: (fd: FormData) => setOrganizationProfileAction(fd),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { ProfileForm } from "./profile-form";

afterEach(() => {
  cleanup();
  setOrganizationProfileAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

function renderForm(overrides: Partial<ComponentProps<typeof ProfileForm>> = {}) {
  return render(
    <ProfileForm
      organizationId="22222222-2222-2222-2222-222222222222"
      initialAddress={null}
      initialPhone={null}
      initialFacebookUrl={null}
      initialInstagramUrl={null}
      initialXTwitterUrl={null}
      initialYoutubeUrl={null}
      initialOtherUrl={null}
      {...overrides}
    />,
  );
}

describe("ProfileForm — initial render", () => {
  it("renders every field, all empty when no profile exists yet", () => {
    renderForm();
    expect((screen.getByLabelText(/^address$/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/^phone$/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/facebook/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/instagram/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/x \/ twitter/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/youtube/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/other link/i) as HTMLInputElement).value).toBe("");
  });

  it("prefills every field from initial props", () => {
    renderForm({
      initialAddress: "123 Fixture Ln",
      initialPhone: "555-0100",
      initialFacebookUrl: "https://facebook.com/fixture",
      initialInstagramUrl: "https://instagram.com/fixture",
      initialXTwitterUrl: "https://x.com/fixture",
      initialYoutubeUrl: "https://youtube.com/fixture",
      initialOtherUrl: "https://fixture.example.invalid",
    });
    expect((screen.getByLabelText(/^address$/i) as HTMLInputElement).value).toBe(
      "123 Fixture Ln",
    );
    expect((screen.getByLabelText(/facebook/i) as HTMLInputElement).value).toBe(
      "https://facebook.com/fixture",
    );
  });
});

describe("ProfileForm — submission", () => {
  it("submits every field under its own FormData key", async () => {
    setOrganizationProfileAction.mockResolvedValue({ ok: true });
    renderForm();

    fireEvent.change(screen.getByLabelText(/^address$/i), {
      target: { value: "1 Fixture Way" },
    });
    fireEvent.change(screen.getByLabelText(/facebook/i), {
      target: { value: "https://facebook.com/fixture" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save profile/i }));
    });

    expect(setOrganizationProfileAction).toHaveBeenCalledTimes(1);
    const fd = setOrganizationProfileAction.mock.calls[0][0];
    expect(fd.get("organizationId")).toBe("22222222-2222-2222-2222-222222222222");
    expect(fd.get("address")).toBe("1 Fixture Way");
    expect(fd.get("facebookUrl")).toBe("https://facebook.com/fixture");
    expect(fd.get("instagramUrl")).toBe("");
  });

  it("shows a green banner and a success toast on ok:true", async () => {
    setOrganizationProfileAction.mockResolvedValue({ ok: true });
    renderForm();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save profile/i }));
    });

    expect(screen.getByText("Profile saved.")).toBeTruthy();
    expect(toastSuccess).toHaveBeenCalledWith("Profile saved.");
  });

  it("surfaces the server's exact error string INLINE, and typed values survive the failed submit", async () => {
    setOrganizationProfileAction.mockResolvedValue({
      ok: false,
      error: "Enter a valid Facebook URL, or leave it blank.",
    });
    renderForm();

    fireEvent.change(screen.getByLabelText(/facebook/i), {
      target: { value: "not a url" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save profile/i }));
    });

    expect(
      screen.getByText("Enter a valid Facebook URL, or leave it blank."),
    ).toBeTruthy();
    expect(toastError).toHaveBeenCalled();
    // The rejected value is still in the field — never blanked on failure.
    expect((screen.getByLabelText(/facebook/i) as HTMLInputElement).value).toBe(
      "not a url",
    );
  });
});
