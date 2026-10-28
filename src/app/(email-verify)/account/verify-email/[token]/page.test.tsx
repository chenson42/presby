// @vitest-environment jsdom
/**
 * The verify-email page is a thin caller of `completeEmailChange` since
 * Community Increment 2b (R38). The page's three user-facing messages are the
 * long-standing copy and must stay byte for byte; success revalidates and
 * redirects with the toast flag; an unexpected failure is not given a message of
 * its own (it reaches the error boundary, as before). Mocked at the one
 * boundary the page has.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));
const completeEmailChange = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/email-change", () => ({ completeEmailChange }));
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

import VerifyEmailPage from "./page";

const params = (token: string) => ({ params: Promise.resolve({ token }) });

afterEach(() => {
  cleanup();
  completeEmailChange.mockReset();
  redirect.mockClear();
  revalidatePath.mockReset();
});

describe("/account/verify-email/[token]", () => {
  it("hands the raw token from the URL to completeEmailChange and nothing else", async () => {
    completeEmailChange.mockResolvedValue({ kind: "invalid" });
    await VerifyEmailPage(params("raw-token-from-the-url"));
    expect(completeEmailChange).toHaveBeenCalledWith("raw-token-from-the-url");
  });

  it.each([
    ["invalid", "This verification link is invalid or has already been used."],
    ["expired", "This verification link has expired. Request a new one from your account settings."],
    [
      "email_taken",
      "This email address has already been claimed by another account. Request a new verification link from your account settings.",
    ],
  ] as const)("%s shows the page's long-standing message, byte for byte", async (kind, message) => {
    completeEmailChange.mockResolvedValue({ kind });
    render(await VerifyEmailPage(params("t")));
    expect(screen.getByRole("heading", { name: "Email verification failed" })).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to account settings" }).getAttribute("href")).toBe("/account");
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("ok revalidates /account and redirects with the success flag", async () => {
    completeEmailChange.mockResolvedValue({ kind: "ok" });
    await expect(VerifyEmailPage(params("t"))).rejects.toThrow("NEXT_REDIRECT:/account?emailChanged=1");
    expect(revalidatePath).toHaveBeenCalledWith("/account");
  });

  it("an unexpected failure throws to the error boundary (no new message is invented)", async () => {
    completeEmailChange.mockResolvedValue({ kind: "error" });
    await expect(VerifyEmailPage(params("t"))).rejects.toThrow(/could not be completed/);
    expect(redirect).not.toHaveBeenCalled();
  });
});
