// @vitest-environment jsdom
/**
 * /signin: the help link (user-help Inc 1, Copy C3). It is under the forms and always
 * visible, with the password form on or off, and it carries nothing from the page's query.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const localLogin = vi.fn();
vi.mock("@/auth", () => ({ signIn: vi.fn() }));
vi.mock("@/lib/auth/local-login", () => ({ isLocalLoginEnabled: () => localLogin() }));
vi.mock("@/lib/flags", () => ({ isFlagEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/sites", () => ({ getPublishedSiteBrand: vi.fn().mockResolvedValue(null) }));
vi.mock("./google-sign-in-button", () => ({ GoogleSignInButton: () => <button type="submit">Google</button> }));
vi.mock("./signin-credentials-form", () => ({ SignInCredentialsForm: () => <form data-testid="credentials" /> }));

import SignInPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("/signin", () => {
  it("shows 'Help with signing in' to signing-in, after the credentials form", async () => {
    localLogin.mockResolvedValue(true);
    render(await SignInPage({ searchParams: Promise.resolve({ callbackUrl: "/o/alder-creek", error: "CredentialsSignin" }) }));

    const link = screen.getByRole("link", { name: "Help with signing in" });
    expect(link.getAttribute("href")).toBe("/help/signing-in");
    const form = screen.getByTestId("credentials");
    expect(form.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is still shown when the password form is turned off", async () => {
    localLogin.mockResolvedValue(false);
    render(await SignInPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByTestId("credentials")).toBeNull();
    expect(screen.getByRole("link", { name: "Help with signing in" }).getAttribute("href")).toBe("/help/signing-in");
  });
});
