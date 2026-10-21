/**
 * Orchestration tests for the `(invite)` actions (docs/work-log/
 * 2026-10-21-invitations.md Phase 3 section 3; R6; G9; D-3). Mocked at the
 * `@/lib/onboarding/accept` / `@/auth` / `@/lib/rate-limit` boundary - the SQL
 * and the per-outcome audit rows are proven against a real Postgres connection
 * in src/lib/onboarding/accept.db.test.ts. What this file pins is the contract
 * this actions.ts layer owns:
 *
 *   1. The IP-keyed rate limit is the FIRST thing every accept action does and
 *      is never keyed by the token.
 *   2. A signed-in visitor cannot mint a second account; an account that
 *      requires 2FA cannot accept from a session that is not 2FA-verified.
 *   3. The identity passed to acceptInvitation comes from auth() and nowhere
 *      else, whatever the form says (D-3).
 *   4. The token travels ONLY in the httpOnly cookie, never in a redirect URL.
 *   5. Every refusal is an inline-error state; success clears the cookie and
 *      redirects (the slug from the function's row, not from the request).
 */
vi.mock("server-only", () => ({}));

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const cookieJar = vi.hoisted(() => ({ set: vi.fn() }));
const mockHeaders = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({
  headers: mockHeaders,
  cookies: async () => cookieJar,
}));

const mockRedirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

const mockSignOut = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/sign-out-action", () => ({ signOutAction: mockSignOut }));

const mockLocalLogin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/local-login", () => ({ isLocalLoginEnabled: mockLocalLogin }));

const mockRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockRateLimit }));

const mockGetIp = vi.hoisted(() => vi.fn());
vi.mock("@/lib/request-ip", () => ({ getRequestIp: mockGetIp }));

const mockAccept = vi.hoisted(() => vi.fn());
vi.mock("@/lib/onboarding/accept", () => ({ acceptInvitation: mockAccept }));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mintInvitationToken } from "@/lib/onboarding/invitation-token";
import { INVITATION_DEAD_LINK_COPY, INVITEE_BLOCKED_COPY } from "@/lib/onboarding/labels";
import {
  acceptNewAccountAction,
  acceptSignedInAction,
  continueToVerifyAction,
  startSignInToAcceptAction,
  switchAccountAction,
  type AcceptFormState,
} from "./actions";

const IDLE: AcceptFormState = { status: "idle" };
const { token: TOKEN } = mintInvitationToken();
const USER_ID = "c1000000-0000-4000-8000-000000000001";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const NEW_FIELDS = {
  token: TOKEN, firstName: "Marisol", lastName: "Quenby", password: "correct horse", confirm: "correct horse",
};

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const m = /^REDIRECT:(.*)$/.exec((err as Error).message);
    if (m) return m[1]!;
    throw err;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders.mockResolvedValue(new Headers());
  mockGetIp.mockReturnValue("203.0.113.9");
  mockRateLimit.mockResolvedValue({ allowed: true });
  mockAuth.mockResolvedValue(null);
  mockLocalLogin.mockResolvedValue(true);
  mockAccept.mockResolvedValue({ kind: "accepted", mode: "new_account", organizationSlug: "quillhaven" });
});

describe("acceptNewAccountAction", () => {
  it("rate-limits by IP (never by token) before anything else, then stops", async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 600 });
    const state = await acceptNewAccountAction(IDLE, form(NEW_FIELDS));
    expect(mockRateLimit).toHaveBeenCalledWith(
      "invite_accept:203.0.113.9",
      { max: 10, windowSeconds: 3600 },
      expect.objectContaining({ userId: null, actor: "203.0.113.9" }),
    );
    expect(mockRateLimit.mock.calls[0]![0]).not.toContain(TOKEN);
    expect(state).toMatchObject({ status: "error", code: "rate_limited", message: "Too many attempts. Try again in 10 minutes." });
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it("refuses when a session exists (a signed-in visitor accepts as that account)", async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } });
    const state = await acceptNewAccountAction(IDLE, form(NEW_FIELDS));
    expect(state).toMatchObject({ status: "error", code: "signed_in" });
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it("refuses mismatched passwords on the confirm field, before the database", async () => {
    const state = await acceptNewAccountAction(IDLE, form({ ...NEW_FIELDS, confirm: "different" }));
    expect(state).toMatchObject({ status: "error", code: "password_mismatch", field: "confirm" });
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it("refuses to create a password account while local login is off", async () => {
    mockLocalLogin.mockResolvedValue(false);
    const state = await acceptNewAccountAction(IDLE, form(NEW_FIELDS));
    expect(state).toMatchObject({ status: "error", code: "local_login_disabled" });
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it("on success clears the hand-off cookie and redirects to the static confirmation page (no token in the URL)", async () => {
    const url = await redirectOf(acceptNewAccountAction(IDLE, form(NEW_FIELDS)));
    expect(url).toBe("/invite/accepted");
    expect(url).not.toContain(TOKEN);
    expect(cookieJar.set).toHaveBeenCalledWith("invite_token", "", expect.objectContaining({ maxAge: 0, path: "/invite", httpOnly: true }));
    expect(mockAccept).toHaveBeenCalledWith({
      token: TOKEN,
      mode: { kind: "new_account", firstName: "Marisol", lastName: "Quenby", password: "correct horse" },
    });
  });

  it("passes a malformed or missing token through as an empty token (the dead bucket does the same work)", async () => {
    mockAccept.mockResolvedValue({ kind: "dead" });
    const state = await acceptNewAccountAction(IDLE, form({ ...NEW_FIELDS, token: "short" }));
    expect(mockAccept).toHaveBeenCalledWith(expect.objectContaining({ token: "" }));
    expect(state).toMatchObject({ status: "error", code: "dead", message: INVITATION_DEAD_LINK_COPY });
  });

  it.each([
    [{ kind: "dead" }, "dead", INVITATION_DEAD_LINK_COPY],
    [{ kind: "account_exists" }, "account_exists", "An account already exists for this address. Sign in to accept."],
    [{ kind: "db_error" }, "db_error", "We can't finish setting up your account right now. Your link is still good."],
  ])("maps %j to an inline error", async (result, code, message) => {
    mockAccept.mockResolvedValue(result);
    const state = await acceptNewAccountAction(IDLE, form(NEW_FIELDS));
    expect(state).toEqual({ status: "error", code, message });
  });

  it.each(Object.keys(INVITEE_BLOCKED_COPY))("maps blocked reason %s to its plain-language copy", async (reason) => {
    mockAccept.mockResolvedValue({ kind: "blocked", reason });
    const state = await acceptNewAccountAction(IDLE, form(NEW_FIELDS));
    expect(state).toEqual({
      status: "error",
      code: "blocked",
      message: INVITEE_BLOCKED_COPY[reason as keyof typeof INVITEE_BLOCKED_COPY],
    });
  });

  it("maps field validation to the field it belongs to, distinguishing a too-short from a too-long password", async () => {
    mockAccept.mockResolvedValue({ kind: "invalid_input", field: "firstName" });
    expect(await acceptNewAccountAction(IDLE, form(NEW_FIELDS))).toMatchObject({ code: "invalid_input", field: "firstName" });
    mockAccept.mockResolvedValue({ kind: "invalid_input", field: "lastName" });
    expect(await acceptNewAccountAction(IDLE, form(NEW_FIELDS))).toMatchObject({ code: "invalid_input", field: "lastName" });
    mockAccept.mockResolvedValue({ kind: "invalid_input", field: "password" });
    const short = await acceptNewAccountAction(IDLE, form({ ...NEW_FIELDS, password: "1234567", confirm: "1234567" }));
    expect(short).toMatchObject({ code: "invalid_input", field: "password", message: "Use at least 8 characters." });
    const long = "a".repeat(73);
    const tooLong = await acceptNewAccountAction(IDLE, form({ ...NEW_FIELDS, password: long, confirm: long }));
    expect(tooLong).toMatchObject({ code: "invalid_input", field: "password" });
    expect((tooLong as { message: string }).message).toMatch(/at most 72 bytes/);
  });
});

describe("acceptSignedInAction", () => {
  const session = (overrides: Record<string, unknown> = {}) => ({
    user: { id: USER_ID, email: "me@example.invalid", twoFactorRequired: false, twoFactorVerified: false, ...overrides },
  });

  it("rate-limits by IP first", async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });
    const state = await acceptSignedInAction(IDLE, form({ token: TOKEN }));
    expect(state).toMatchObject({ code: "rate_limited" });
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await acceptSignedInAction(IDLE, form({ token: TOKEN }))).toMatchObject({ code: "not_signed_in" });
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it("G9: refuses an account that requires 2FA from a session that is not 2FA-verified", async () => {
    mockAuth.mockResolvedValue(session({ twoFactorRequired: true, twoFactorVerified: false }));
    expect(await acceptSignedInAction(IDLE, form({ token: TOKEN }))).toMatchObject({ code: "two_factor_required" });
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it("accepts a 2FA-required account whose session IS verified; the slug comes from the function's row", async () => {
    mockAuth.mockResolvedValue(session({ twoFactorRequired: true, twoFactorVerified: true }));
    mockAccept.mockResolvedValue({ kind: "accepted", mode: "existing_account", organizationSlug: "quillhaven" });
    const url = await redirectOf(acceptSignedInAction(IDLE, form({ token: TOKEN })));
    expect(url).toBe("/launch?next=%2Fo%2Fquillhaven");
    expect(url).not.toContain(TOKEN);
    expect(cookieJar.set).toHaveBeenCalledWith("invite_token", "", expect.objectContaining({ maxAge: 0 }));
  });

  it("D-3: the identity is the session's, whatever the form claims", async () => {
    mockAuth.mockResolvedValue(session());
    await redirectOf(acceptSignedInAction(IDLE, form({ token: TOKEN, userId: "c2000000-0000-4000-8000-0000000000ff", email: "forged@example.invalid" })));
    expect(mockAccept).toHaveBeenCalledWith({
      token: TOKEN,
      mode: { kind: "existing_account", userId: USER_ID, email: "me@example.invalid" },
    });
  });

  it("a malformed token is the dead bucket without calling the function", async () => {
    mockAuth.mockResolvedValue(session());
    expect(await acceptSignedInAction(IDLE, form({ token: "nope" }))).toMatchObject({ code: "dead", message: INVITATION_DEAD_LINK_COPY });
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "email_mismatch" }, "email_mismatch"],
    [{ kind: "account_inactive" }, "account_inactive"],
    [{ kind: "dead" }, "dead"],
    [{ kind: "blocked", reason: "person_elsewhere" }, "blocked"],
    [{ kind: "db_error" }, "db_error"],
  ])("maps %j", async (result, code) => {
    mockAuth.mockResolvedValue(session());
    mockAccept.mockResolvedValue(result);
    expect(await acceptSignedInAction(IDLE, form({ token: TOKEN }))).toMatchObject({ status: "error", code });
  });
});

describe("the cookie hand-off (R6)", () => {
  it("startSignInToAcceptAction stores the token in an httpOnly Path=/invite cookie and redirects without it", async () => {
    const url = await redirectOf(startSignInToAcceptAction(form({ token: TOKEN })));
    expect(url).toBe("/signin?callbackUrl=%2Finvite");
    expect(url).not.toContain(TOKEN);
    expect(cookieJar.set).toHaveBeenCalledWith("invite_token", TOKEN, {
      httpOnly: true, secure: false, sameSite: "lax", path: "/invite", maxAge: 1800,
    });
  });

  it("the cookie is Secure in production", async () => {
    const previous = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      await redirectOf(startSignInToAcceptAction(form({ token: TOKEN })));
      expect(cookieJar.set).toHaveBeenCalledWith("invite_token", TOKEN, expect.objectContaining({ secure: true }));
    } finally {
      (process.env as Record<string, string>).NODE_ENV = previous!;
    }
  });

  it("continueToVerifyAction hands off to /totp without the token in the URL", async () => {
    const url = await redirectOf(continueToVerifyAction(form({ token: TOKEN })));
    expect(url).toBe("/totp?callbackUrl=%2Finvite");
    expect(cookieJar.set).toHaveBeenCalledWith("invite_token", TOKEN, expect.any(Object));
  });

  it("switchAccountAction stores the token, then signs out back to /invite", async () => {
    await switchAccountAction(form({ token: TOKEN }));
    expect(cookieJar.set).toHaveBeenCalledWith("invite_token", TOKEN, expect.any(Object));
    expect(mockSignOut).toHaveBeenCalledWith("/invite");
  });

  it("a malformed token sets no cookie and lands on /invite (the dead page)", async () => {
    expect(await redirectOf(startSignInToAcceptAction(form({ token: "nope" })))).toBe("/invite");
    expect(await redirectOf(continueToVerifyAction(form({})))).toBe("/invite");
    expect(cookieJar.set).not.toHaveBeenCalled();
  });
});
