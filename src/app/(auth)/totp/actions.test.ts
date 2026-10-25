/**
 * The /totp verification action: what it must do to the session on success, and
 * that it never touches the session on any refusal. The session update is made
 * inside a server-side verification grant (DECISION-230) and carries no payload,
 * so the jwt callback has nothing to be influenced by.
 */
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

const mockTotpRow = vi.hoisted(() => vi.fn());
const mockRecoveryRow = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      userTotp: { findFirst: mockTotpRow },
      userTotpRecoveryCodes: { findFirst: mockRecoveryRow },
    },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));

vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    TOTP_VERIFY_FAILED: "totp.verify.failed",
    TOTP_VERIFY_SUCCEEDED: "totp.verify.succeeded",
    TOTP_RECOVERY_FAILED: "totp.recovery.failed",
    TOTP_RECOVERY_SUCCEEDED: "totp.recovery.succeeded",
  },
  recordAudit: vi.fn(),
}));

const mockRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockRateLimit }));

const mockVerifyToken = vi.hoisted(() => vi.fn());
vi.mock("@/lib/two-factor", () => ({
  decryptSecret: () => "secret",
  hashRecoveryCode: (c: string) => `hash:${c}`,
  normalizeRecoveryCode: (s: string) => (/^[a-z0-9-]{8,}$/i.test(s) ? s : null),
  verifyToken: mockVerifyToken,
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { takeTwoFactorGrant } from "@/lib/auth/two-factor-grant";
import { verifyTotpAction } from "./actions";

const USER_ID = "00000000-0000-4000-8000-0000000000c3";

type UpdateCall = { payload: unknown; granted: boolean };
let updateCalls: UpdateCall[];

function form(token: string): FormData {
  const f = new FormData();
  f.set("token", token);
  f.set("callbackUrl", "/admin");
  return f;
}

async function run(token: string): Promise<string> {
  try {
    await verifyTotpAction(form(token));
  } catch (e) {
    return (e as Error).message;
  }
  return "returned";
}

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls = [];
  mockAuth.mockResolvedValue({ user: { id: USER_ID, email: "t@example.invalid" } });
  mockTotpRow.mockResolvedValue({ userId: USER_ID, secretCiphertext: "c" });
  mockRecoveryRow.mockResolvedValue(undefined);
  mockRateLimit.mockResolvedValue({ allowed: true });
  mockVerifyToken.mockReturnValue(false);
  mockUpdate.mockImplementation(async (payload: unknown) => {
    updateCalls.push({ payload, granted: takeTwoFactorGrant(USER_ID) });
  });
});

describe("verifyTotpAction — session claim integrity", () => {
  it("a valid TOTP code updates the session inside a grant for the session user, with no payload", async () => {
    mockVerifyToken.mockReturnValue(true);
    expect(await run("123456")).toBe("REDIRECT:/admin");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].granted).toBe(true);
    expect(updateCalls[0].payload).toEqual({});
  });

  it("a valid recovery code updates the session inside a grant for the session user, with no payload", async () => {
    mockRecoveryRow.mockResolvedValue({ id: "code-1" });
    expect(await run("abcd-efgh-ijkl")).toBe("REDIRECT:/admin");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].granted).toBe(true);
    expect(updateCalls[0].payload).toEqual({});
  });

  it("a wrong six-digit code never updates the session", async () => {
    expect(await run("000000")).toMatch(/REDIRECT:\/totp\?.*error=invalid/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("an unknown recovery code never updates the session", async () => {
    expect(await run("abcd-efgh-ijkl")).toMatch(/error=invalid/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("malformed input never updates the session", async () => {
    expect(await run("!!")).toMatch(/error=invalid/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("a rate-limited attempt never updates the session, even with a valid code", async () => {
    mockRateLimit.mockResolvedValue({ allowed: false });
    mockVerifyToken.mockReturnValue(true);
    expect(await run("123456")).toMatch(/error=rate_limited/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("no session means no update", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await run("123456")).toBe("REDIRECT:/signin");
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
