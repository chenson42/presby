// @vitest-environment jsdom
/**
 * `/invite` page: exactly one state per (token, session, preview). Mocked at
 * its boundaries: `auth()`, the cookie jar, `previewInvitation`,
 * `isLocalLoginEnabled`, and the `(invite)` actions (their real module pulls
 * the database into the graph). Source-scan properties of this page (session
 * id as the preview's second argument, no database import, no layout or
 * loading boundary) live in `src/lib/onboarding/boundaries.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { InvitationPreview } from "@/lib/onboarding/accept";

vi.mock("server-only", () => ({}));

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
const mockCookieGet = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => mockCookieGet(name) }),
}));
const mockPreview = vi.hoisted(() => vi.fn());
vi.mock("@/lib/onboarding/accept", () => ({
  previewInvitation: (...args: unknown[]) => mockPreview(...args),
}));
const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
const mockLocalLogin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/local-login", () => ({ isLocalLoginEnabled: () => mockLocalLogin() }));
vi.mock("../actions", () => ({
  acceptNewAccountAction: vi.fn(),
  acceptSignedInAction: vi.fn(),
  startSignInToAcceptAction: vi.fn(),
  continueToVerifyAction: vi.fn(),
  switchAccountAction: vi.fn(),
}));

import { INVITATION_DEAD_LINK_COPY } from "@/lib/onboarding/labels";
import InvitePage from "./page";

const TOKEN = "A".repeat(43);
const OTHER_TOKEN = "B".repeat(43);

function preview(overrides: Partial<InvitationPreview> = {}): InvitationPreview {
  return {
    organizationName: "Quillhaven Presbyterian Church",
    organizationType: "congregation",
    purpose: "founding_administrator",
    inviteeFirstName: "Wilhelmina",
    inviteeLastName: "Thorncastle",
    personDisplayName: "Wilhelmina Thorncastle",
    maskedEmail: "i***@example.invalid",
    expiresAt: new Date("2099-01-30T00:00:00.000Z"),
    sessionMatches: null,
    ...overrides,
  };
}

async function renderPage(search: { token?: string } = { token: TOKEN }) {
  render(await InvitePage({ searchParams: Promise.resolve(search) }));
}

beforeEach(() => {
  mockAuth.mockResolvedValue(null);
  mockCookieGet.mockReturnValue(undefined);
  mockPreview.mockResolvedValue(preview());
  mockLocalLogin.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  mockAuth.mockReset();
  mockCookieGet.mockReset();
  mockPreview.mockReset();
  mockLocalLogin.mockReset();
  mockRefresh.mockReset();
});

describe("dead link", () => {
  it("no token at all renders the one dead-link copy and never calls the database", async () => {
    await renderPage({});
    expect(screen.getByText(INVITATION_DEAD_LINK_COPY)).toBeTruthy();
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it("no token at all re-asks the browser once (a server action's redirect prerenders /invite without the path-scoped cookie); a token that is present never does", async () => {
    await renderPage({});
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    cleanup();
    mockRefresh.mockReset();
    mockPreview.mockResolvedValue(null);
    await renderPage({ token: TOKEN });
    await renderPage({ token: "not-a-token" });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("a malformed token is the dead link without a round trip", async () => {
    await renderPage({ token: "not-a-token" });
    expect(screen.getByText(INVITATION_DEAD_LINK_COPY)).toBeTruthy();
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it("an unknown/expired/revoked/used token (null preview) renders the SAME markup as no token (one bucket)", async () => {
    await renderPage({});
    const noToken = document.body.innerHTML;
    cleanup();
    mockPreview.mockResolvedValue(null);
    await renderPage();
    expect(document.body.innerHTML).toBe(noToken);
  });

  it("a database failure is not the dead link: it says the link is still good", async () => {
    mockPreview.mockRejectedValue(new Error("boom"));
    await renderPage();
    expect(screen.queryByText(INVITATION_DEAD_LINK_COPY)).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/your link is still good/i);
  });
});

describe("token source", () => {
  it("falls back to the hand-off cookie when the query has no token", async () => {
    mockCookieGet.mockReturnValue({ value: OTHER_TOKEN });
    await renderPage({});
    expect(mockPreview).toHaveBeenCalledWith(OTHER_TOKEN, undefined);
  });

  it("the query token wins over the cookie", async () => {
    mockCookieGet.mockReturnValue({ value: OTHER_TOKEN });
    await renderPage({ token: TOKEN });
    expect(mockPreview).toHaveBeenCalledWith(TOKEN, undefined);
  });
});

describe("anonymous", () => {
  it("offers BOTH create-account and sign-in-to-accept (S1) with the summary and the masked address", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/you.re invited/i);
    expect(document.body.textContent).toMatch(/founding administrator at\s*Quillhaven Presbyterian Church/);
    expect(document.body.textContent).toMatch(/i\*\*\*@example\.invalid/);
    expect(screen.getByRole("heading", { name: /create your account/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /create account/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign in to accept/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /accept invitation/i })).toBeNull();
  });

  it("prefills the names the operator typed (editable)", async () => {
    await renderPage();
    expect((screen.getByLabelText(/first name/i) as HTMLInputElement).value).toBe("Wilhelmina");
    expect((screen.getByLabelText(/last name/i) as HTMLInputElement).value).toBe("Thorncastle");
  });

  it("splits a treasurer's roster name into first and last as a starting guess", async () => {
    mockPreview.mockResolvedValue(
      preview({ purpose: "treasurer", inviteeFirstName: null, inviteeLastName: null, personDisplayName: "Odalys Mae Winterbourne" }),
    );
    await renderPage();
    expect((screen.getByLabelText(/first name/i) as HTMLInputElement).value).toBe("Odalys");
    expect((screen.getByLabelText(/last name/i) as HTMLInputElement).value).toBe("Mae Winterbourne");
    expect(document.body.textContent).toMatch(/the treasurer at/);
    expect(document.body.textContent).toMatch(/requires two-factor sign-in/i);
  });

  it("with password sign-in off: no create form, a plain sentence, and sign-in remains the door (G8)", async () => {
    mockLocalLogin.mockResolvedValue(false);
    await renderPage();
    expect(screen.queryByLabelText(/^password/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /create account/i })).toBeNull();
    expect(document.body.textContent).toMatch(/password sign-in is turned off/i);
    expect(screen.getByRole("button", { name: /sign in to accept/i })).toBeTruthy();
  });

  it("passes the token to the sign-in form as a hidden field, never in a link", async () => {
    await renderPage();
    const hidden = document.querySelectorAll('input[type="hidden"][name="token"]');
    expect(hidden.length).toBeGreaterThan(0);
    for (const input of hidden) expect((input as HTMLInputElement).value).toBe(TOKEN);
    expect([...document.querySelectorAll("a")].some((a) => a.getAttribute("href")?.includes(TOKEN))).toBe(false);
  });
});

describe("signed in", () => {
  const session = (user: Record<string, unknown> = {}) => ({
    user: { id: "user-1", twoFactorRequired: false, twoFactorVerified: false, ...user },
  });

  it("asks the database about the session user, from the session id only (D-3)", async () => {
    mockAuth.mockResolvedValue(session());
    mockPreview.mockResolvedValue(preview({ sessionMatches: true }));
    await renderPage();
    expect(mockPreview).toHaveBeenCalledWith(TOKEN, "user-1");
  });

  it("another account: the mismatch state with the masked address and a sign-out; no Accept", async () => {
    mockAuth.mockResolvedValue(session());
    mockPreview.mockResolvedValue(preview({ sessionMatches: false }));
    await renderPage();
    expect(screen.getByRole("alert").textContent).toMatch(/signed in as another account/i);
    expect(screen.getByRole("alert").textContent).toMatch(/i\*\*\*@example\.invalid/);
    expect(screen.getByRole("button", { name: /sign out to accept/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /accept invitation/i })).toBeNull();
    expect(screen.queryByLabelText(/^password/i)).toBeNull();
  });

  it("mismatch outranks the 2FA step (no point verifying the wrong account)", async () => {
    mockAuth.mockResolvedValue(session({ twoFactorRequired: true }));
    mockPreview.mockResolvedValue(preview({ sessionMatches: false }));
    await renderPage();
    expect(screen.getByRole("button", { name: /sign out to accept/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /verify and continue/i })).toBeNull();
  });

  it("the right account that requires 2FA but has not passed it is sent to verify first (G9)", async () => {
    mockAuth.mockResolvedValue(session({ twoFactorRequired: true, twoFactorVerified: false }));
    mockPreview.mockResolvedValue(preview({ sessionMatches: true }));
    await renderPage();
    expect(screen.getByRole("button", { name: /verify and continue/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /accept invitation/i })).toBeNull();
  });

  it("the right account, 2FA verified: names the person and the organization and offers Accept", async () => {
    mockAuth.mockResolvedValue(session({ twoFactorRequired: true, twoFactorVerified: true }));
    mockPreview.mockResolvedValue(preview({ sessionMatches: true }));
    await renderPage();
    expect(document.body.textContent).toMatch(/Accepting as\s*Wilhelmina Thorncastle\s*at\s*Quillhaven Presbyterian Church/);
    expect(screen.getByRole("button", { name: /accept invitation/i })).toBeTruthy();
    expect(screen.queryByLabelText(/^password/i)).toBeNull();
  });

  it("the right account that does not require 2FA goes straight to Accept", async () => {
    mockAuth.mockResolvedValue(session());
    mockPreview.mockResolvedValue(preview({ sessionMatches: true }));
    await renderPage();
    expect(screen.getByRole("button", { name: /accept invitation/i })).toBeTruthy();
  });
});
