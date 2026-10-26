/**
 * Orchestration tests for `/no-organization`'s actions (Community Increment 2b,
 * Batch B2, T-9/T-12; amendment 2 section 7.3; edge cases E-12, E-13, E-17,
 * E-22, E-30, E-39). Mocked at the `connect`, `accept`, `auth` and rate-limit
 * boundaries: who may connect and who may accept is SQL's, proven in
 * `connect.db.test.ts` and `accept-in-place.db.test.ts`; the audit rows are
 * written by the library (`connect.db.test.ts`, `accept-in-place.lib.db.test.ts`).
 * What this file pins is what these actions own:
 *
 *   1. identity and the second-factor flag come from `auth()` ONLY; the only
 *      thing a form supplies is an invitation id;
 *   2. the rate limits (30 an hour to check, 20 an hour to accept) are per
 *      user and come before any work;
 *   3. the G9 parity pre-check answers `needs_second_factor` BEFORE the database;
 *   4. a connection or an acceptance re-signs the cookie with an EMPTY payload
 *      (DECISION-230), best effort, and redirects to /launch with a slug taken
 *      from the definer's row;
 *   5. every state is distinct (nothing new / needs a second factor / error) and
 *      every string is the operator-read Copy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockAuth = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth, unstable_update: mockUpdate }));

const mockRedirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

const mockSignOutAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/sign-out-action", () => ({ signOutAction: mockSignOutAction }));

const mockRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockRateLimit }));

const mockConnect = vi.hoisted(() => vi.fn());
vi.mock("@/lib/onboarding/connect", () => ({ connectSignedInAccount: mockConnect }));

const mockAcceptInPlace = vi.hoisted(() => vi.fn());
vi.mock("@/lib/onboarding/accept", () => ({ acceptInvitationInPlace: mockAcceptInPlace }));

import {
  acceptInPlaceAction,
  checkAgainAction,
  switchAccountAction,
  type NoOrgActionState,
} from "./actions";

const IDLE: NoOrgActionState = { status: "idle" };
const USER_ID = "c1000000-0000-4000-8000-000000000001";
const INVITATION = "d2000000-0000-4000-8000-000000000002";

const session = (over: Record<string, unknown> = {}) => ({
  user: { id: USER_ID, email: "w@example.invalid", twoFactorRequired: false, twoFactorVerified: false, ...over },
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

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
  mockAuth.mockResolvedValue(session());
  mockRateLimit.mockResolvedValue({ allowed: true });
  mockUpdate.mockResolvedValue(null);
  mockConnect.mockResolvedValue({ kind: "declined" });
  mockAcceptInPlace.mockResolvedValue({ kind: "accepted", mode: "existing_account", organizationSlug: "quillhaven" });
});

// ===========================================================================
describe("checkAgainAction", () => {
  it("a lapsed session goes back to sign-in rather than inventing a sentence", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await redirectOf(checkAgainAction(IDLE, form({})))).toBe("/signin?callbackUrl=%2Fno-organization");
    expect(mockConnect).not.toHaveBeenCalled();
    mockAuth.mockResolvedValue({ user: {} });
    expect(await redirectOf(checkAgainAction(IDLE, form({})))).toBe("/signin?callbackUrl=%2Fno-organization");
  });

  it("is rate limited per user, 30 an hour, and the limited state names minutes (E-22)", async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 610 });
    expect(await checkAgainAction(IDLE, form({}))).toEqual({
      status: "error",
      code: "rate_limited",
      message: "Too many attempts. Try again in 11 minutes.",
    });
    expect(mockRateLimit).toHaveBeenCalledWith(
      `no_org_check:${USER_ID}`,
      { max: 30, windowSeconds: 3600 },
      expect.objectContaining({ userId: USER_ID }),
    );
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("the rate-limit context carries the user id, never the address", async () => {
    await checkAgainAction(IDLE, form({}));
    expect(JSON.stringify(mockRateLimit.mock.calls[0]![2])).not.toContain("@");
  });

  it("connects with the user id and the factor flag from auth() ONLY, whatever the form says (E-30)", async () => {
    mockAuth.mockResolvedValue(session({ twoFactorVerified: true }));
    await checkAgainAction(
      IDLE,
      form({ userId: "someone-else", secondFactorVerified: "true", twoFactorVerified: "true", email: "x@example.invalid", via: "sign_in" }),
    );
    expect(mockConnect).toHaveBeenCalledWith({
      userId: USER_ID,
      via: "check_again",
      secondFactorVerified: true,
      actorEmail: "w@example.invalid",
    });
  });

  it("the factor flag is the boolean true or nothing: a session with the claim false, missing or truthy-but-not-true passes false", async () => {
    for (const claim of [false, undefined, "true", 1]) {
      mockConnect.mockClear();
      mockAuth.mockResolvedValue(session({ twoFactorVerified: claim }));
      await checkAgainAction(IDLE, form({}));
      expect(mockConnect.mock.calls[0]![0]).toMatchObject({ secondFactorVerified: false });
    }
  });

  it("connected redirects to /launch after an EMPTY session update (the cookie's claims are recomputed, nothing is read from a payload)", async () => {
    mockConnect.mockResolvedValue({ kind: "connected", organizationSlug: "quillhaven" });
    expect(await redirectOf(checkAgainAction(IDLE, form({})))).toBe("/launch");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({});
  });

  it("already_connected (a second tab, a double submit) is the same redirect", async () => {
    mockConnect.mockResolvedValue({ kind: "already_connected" });
    expect(await redirectOf(checkAgainAction(IDLE, form({})))).toBe("/launch");
    expect(mockUpdate).toHaveBeenCalledWith({});
  });

  it("a failed cookie refresh never turns a committed connection into an error", async () => {
    mockConnect.mockResolvedValue({ kind: "connected", organizationSlug: "quillhaven" });
    mockUpdate.mockRejectedValue(new Error("refresh failed"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await redirectOf(checkAgainAction(IDLE, form({})))).toBe("/launch");
    expect(spy).toHaveBeenCalledWith("[no-organization] session refresh failed");
    spy.mockRestore();
  });

  it("the redirect is the fixed /launch: no target is read from the request, and the slug is not echoed", async () => {
    mockConnect.mockResolvedValue({ kind: "connected", organizationSlug: "quillhaven" });
    const url = await redirectOf(checkAgainAction(IDLE, form({ next: "https://evil.example", callbackUrl: "//evil.example" })));
    expect(url).toBe("/launch");
  });

  it("declined is 'nothing new' (the collapse of every decline, so it claims nothing more)", async () => {
    expect(await checkAgainAction(IDLE, form({}))).toEqual({ status: "nothing_new" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("needs_second_factor is its own state, distinct from nothing-new and from an error", async () => {
    mockConnect.mockResolvedValue({ kind: "needs_second_factor" });
    expect(await checkAgainAction(IDLE, form({}))).toEqual({ status: "needs_second_factor" });
  });

  it("an error is a db_error state with Check again's own sentence, never a raw message or the sender table's", async () => {
    mockConnect.mockResolvedValue({ kind: "error" });
    expect(await checkAgainAction(IDLE, form({}))).toEqual({
      status: "error",
      code: "db_error",
      message: "We couldn't check just now. Try again.",
    });
  });
});

// ===========================================================================
describe("acceptInPlaceAction", () => {
  const fields = { invitationId: INVITATION };

  it("a signed-out caller reads the signed-out sentence and nothing runs", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await acceptInPlaceAction(IDLE, form(fields))).toEqual({
      status: "error",
      code: "not_signed_in",
      message: "Sign in to accept this invitation.",
    });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockAcceptInPlace).not.toHaveBeenCalled();
  });

  it("is rate limited per user, 20 an hour, before any work", async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 61 });
    expect(await acceptInPlaceAction(IDLE, form(fields))).toEqual({
      status: "error",
      code: "rate_limited",
      message: "Too many attempts. Try again in 2 minutes.",
    });
    expect(mockRateLimit).toHaveBeenCalledWith(
      `no_org_accept:${USER_ID}`,
      { max: 20, windowSeconds: 3600 },
      expect.objectContaining({ userId: USER_ID }),
    );
    expect(mockAcceptInPlace).not.toHaveBeenCalled();
  });

  it("a missing, empty or malformed invitation id is the dead bucket, with no database call", async () => {
    for (const bad of [{} as Record<string, string>, { invitationId: "" }, { invitationId: "nope" }, { invitationId: "' or 1=1 --" }]) {
      expect(await acceptInPlaceAction(IDLE, form(bad))).toEqual({
        status: "error",
        code: "dead",
        message: "This invitation is no longer active. Reload the page to see what is current, or ask whoever invited you to send a new one.",
      });
    }
    expect(mockAcceptInPlace).not.toHaveBeenCalled();
  });

  it("G9 parity: an account that must use two-factor sign-in and has not been verified this session is needs_second_factor BEFORE the database (E-17)", async () => {
    mockAuth.mockResolvedValue(session({ twoFactorRequired: true, twoFactorVerified: false }));
    expect(await acceptInPlaceAction(IDLE, form(fields))).toEqual({ status: "needs_second_factor" });
    expect(mockAcceptInPlace).not.toHaveBeenCalled();
  });

  it("a verified session, or one that does not require two-factor, goes on to the library", async () => {
    mockAuth.mockResolvedValue(session({ twoFactorRequired: true, twoFactorVerified: true }));
    await redirectOf(acceptInPlaceAction(IDLE, form(fields)));
    expect(mockAcceptInPlace).toHaveBeenCalledTimes(1);
    mockAcceptInPlace.mockClear();
    mockAuth.mockResolvedValue(session({ twoFactorRequired: false, twoFactorVerified: false }));
    await redirectOf(acceptInPlaceAction(IDLE, form(fields)));
    expect(mockAcceptInPlace).toHaveBeenCalledTimes(1);
  });

  it("identity and the factor flag come from auth() ONLY, whatever the form says (E-30)", async () => {
    mockAuth.mockResolvedValue(session({ twoFactorVerified: true }));
    await redirectOf(
      acceptInPlaceAction(IDLE, form({ ...fields, userId: "someone-else", email: "x@example.invalid", secondFactorVerified: "true", token: "t".repeat(43) })),
    );
    expect(mockAcceptInPlace).toHaveBeenCalledWith({
      invitationId: INVITATION,
      userId: USER_ID,
      email: "w@example.invalid",
      secondFactorVerified: true,
    });
  });

  it("the factor flag passed to the library is false for anything but the boolean true", async () => {
    mockAuth.mockResolvedValue(session({ twoFactorVerified: "true" }));
    await redirectOf(acceptInPlaceAction(IDLE, form(fields)));
    expect(mockAcceptInPlace.mock.calls[0]![0]).toMatchObject({ secondFactorVerified: false });
  });

  it("accepted re-signs the cookie with an EMPTY payload and redirects to /launch?next=/o/<slug>, the slug from the definer's row", async () => {
    mockAcceptInPlace.mockResolvedValue({ kind: "accepted", mode: "existing_account", organizationSlug: "quill haven/x" });
    const url = await redirectOf(acceptInPlaceAction(IDLE, form({ ...fields, slug: "evil", next: "https://evil.example" })));
    expect(url).toBe(`/launch?next=${encodeURIComponent("/o/quill haven/x")}`);
    expect(url).not.toContain("evil");
    expect(mockUpdate).toHaveBeenCalledWith({});
  });

  it("a failed cookie refresh never turns a committed acceptance into an error", async () => {
    mockUpdate.mockRejectedValue(new Error("refresh failed"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await redirectOf(acceptInPlaceAction(IDLE, form(fields)))).toBe("/launch?next=%2Fo%2Fquillhaven");
    spy.mockRestore();
  });

  it("needs_second_factor from the definer (an authority-bearing sign-in, a designation) is its own non-terminal state", async () => {
    mockAcceptInPlace.mockResolvedValue({ kind: "needs_second_factor" });
    expect(await acceptInPlaceAction(IDLE, form(fields))).toEqual({ status: "needs_second_factor" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("blocked reads the neutral sentence for the purpose, naming the congregation's office for a sign_in (N3, G6)", async () => {
    mockAcceptInPlace.mockResolvedValue({ kind: "blocked", reason: "membership_ended", purpose: "sign_in", organizationName: "Quillhaven Fellowship" });
    expect(await acceptInPlaceAction(IDLE, form(fields))).toEqual({
      status: "error",
      code: "blocked",
      message: "This invitation can't be completed. Contact Quillhaven Fellowship's office.",
    });
    mockAcceptInPlace.mockResolvedValue({ kind: "blocked", reason: "person_elsewhere", purpose: "treasurer", organizationName: "Quillhaven Fellowship" });
    expect(await acceptInPlaceAction(IDLE, form(fields))).toMatchObject({
      code: "blocked",
      message: "This account is already linked to a person at another congregation, so this invitation can't be completed. Contact the person who invited you.",
    });
  });

  it("dead (and every identity miss the definer folds into it) is the in-place dead sentence", async () => {
    for (const kind of ["dead", "account_exists", "email_mismatch", "account_inactive", "invalid_input"]) {
      mockAcceptInPlace.mockResolvedValue({ kind });
      expect(await acceptInPlaceAction(IDLE, form(fields))).toMatchObject({
        code: "dead",
        message: "This invitation is no longer active. Reload the page to see what is current, or ask whoever invited you to send a new one.",
      });
    }
  });

  it("a database error says the invitation is still good (true: the transaction rolled back)", async () => {
    mockAcceptInPlace.mockResolvedValue({ kind: "db_error" });
    expect(await acceptInPlaceAction(IDLE, form(fields))).toEqual({
      status: "error",
      code: "db_error",
      message: "Your invitation is still good. Try again.",
    });
  });
});

// ===========================================================================
describe("switchAccountAction", () => {
  it("signs out and returns to the sign-in page, which sends the next sign-in to /launch", async () => {
    await switchAccountAction();
    expect(mockSignOutAction).toHaveBeenCalledWith("/signin?callbackUrl=%2Flaunch");
  });
});
