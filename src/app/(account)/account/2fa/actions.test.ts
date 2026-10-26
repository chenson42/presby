import { vi, describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Module mocks — vi.mock() calls are hoisted by Vitest's module transformer
// to the top of the file before any imports are resolved. This prevents:
//   - @/lib/db/index.ts from throwing "DATABASE_URL is not set"
//   - next/headers, @/auth from triggering server-only runtime checks
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));

const jar = vi.hoisted(() => ({ set: vi.fn(), delete: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => jar),
}));

const mockRevalidate = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidate,
}));

const mockAuth = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({
  auth: mockAuth,
  unstable_update: mockUpdate,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

// A scripted database: every write is logged in order, tagged with the executor
// it ran on ("db" or "tx"), so a test can say "the replacement ran inside the
// transaction" and "nothing was written".
const dbh = vi.hoisted(() => {
  const state = {
    log: [] as string[],
    inserted: [] as { exec: string; table: string; values: unknown }[],
    enrolment: undefined as unknown,
    pending: undefined as unknown,
    conflictRows: [{ userId: "u" }] as unknown[],
    txCalls: 0,
  };
  function exec(name: "db" | "tx") {
    return {
      insert: (table: { _: string }) => ({
        values: (values: unknown) => {
          state.log.push(`${name}.insert:${table._}`);
          state.inserted.push({ exec: name, table: table._, values });
          const p = Promise.resolve(undefined) as Promise<undefined> & Record<string, unknown>;
          p.onConflictDoNothing = () => ({
            returning: async () => {
              state.log.push(`${name}.insert-conflict-nothing:${table._}`);
              return state.conflictRows;
            },
          });
          p.onConflictDoUpdate = () => Promise.resolve(undefined);
          return p;
        },
      }),
      delete: (table: { _: string }) => ({
        where: async () => {
          state.log.push(`${name}.delete:${table._}`);
        },
      }),
    };
  }
  return { state, exec };
});

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      userTotp: { findFirst: vi.fn(async () => dbh.state.enrolment) },
      userTotpPendingEnrollments: { findFirst: vi.fn(async () => dbh.state.pending) },
    },
    ...dbh.exec("db"),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      dbh.state.txCalls += 1;
      return cb(dbh.exec("tx"));
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  auditEvents: { _: "audit_events" },
  userTotp: { _: "user_totp", userId: "user_totp.user_id" },
  userTotpPendingEnrollments: { _: "user_totp_pending" },
  userTotpRecoveryCodes: { _: "user_totp_recovery_codes" },
}));

vi.mock("@/lib/two-factor", () => ({
  FRESH_RECOVERY_CODES_COOKIE: "claudecode_fresh_recovery_codes",
  decryptSecret: vi.fn(() => "PLAIN-SECRET"),
  encryptSecret: vi.fn(),
  generateRecoveryCodes: vi.fn(() => ["CODE-0001"]),
  hashRecoveryCode: vi.fn((c: string) => `hash(${c})`),
  verifyToken: vi.fn(() => false),
  otpauthUrl: vi.fn(() => "otpauth://"),
  generateSecret: vi.fn(() => "FAKESECRET"),
}));

const mockAudit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    TOTP_ENROLLED: "totp.enrolled",
    TOTP_RECOVERY_CODES_REGENERATED: "totp.recovery_codes.regenerated",
    TOTP_RECOVERY_CODES_REGENERATE_REFUSED: "totp.recovery_codes.regenerate_refused",
  },
  recordAudit: mockAudit,
}));

// ---------------------------------------------------------------------------
// Imports after mocks are declared (mocks are hoisted, so these resolve to
// the mock factories above).
// ---------------------------------------------------------------------------

import { cookies } from "next/headers";
import { FRESH_RECOVERY_CODES_COOKIE } from "@/lib/two-factor";
import { clearFreshCodesCookieAction, regenerateRecoveryCodes } from "./actions";

// ---------------------------------------------------------------------------
// clearFreshCodesCookieAction — regression for BUG-2
//
// Before the fix: jar.delete(FRESH_RECOVERY_CODES_COOKIE) was called inside
// consumeFreshCodesCookie() during RSC render — illegal in Next 16 and a
// silent no-op in production, causing codes to re-display on every reload.
//
// After the fix: the delete runs here (in a server action), invoked by
// the FreshRecoveryCodes client island's useEffect after mount.
//
// Critical invariant: jar.delete MUST be called with the path-qualified
// object `{ name, path: "/account/2fa" }`. Omitting the path would send
// a Set-Cookie deletion header with Path=/ (the browser default), which
// does NOT match the path-scoped cookie that was SET with path: "/account/2fa"
// — the cookie would persist and codes would continue to re-display.
// ---------------------------------------------------------------------------

describe(
  "clearFreshCodesCookieAction — regression for BUG-2: cookie not cleared in server action",
  () => {
    let mockDelete: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockDelete = vi.fn();
      vi.mocked(cookies).mockResolvedValue({
        delete: mockDelete,
      } as unknown as Awaited<ReturnType<typeof cookies>>);
    });

    it("calls jar.delete with the correct cookie name — regression for wrong name", async () => {
      // Arrange — mockDelete set in beforeEach

      // Act
      await clearFreshCodesCookieAction();

      // Assert — the name field must equal the constant; a mismatch means
      // delete would target a non-existent cookie entry.
      expect(mockDelete).toHaveBeenCalledTimes(1);
      const [arg] = mockDelete.mock.calls[0];
      expect(arg.name).toBe(FRESH_RECOVERY_CODES_COOKIE);
    });

    it("calls jar.delete with path '/account/2fa' — regression for path-unscoped deletion silently failing", async () => {
      // Arrange — mockDelete set in beforeEach

      // Act
      await clearFreshCodesCookieAction();

      // Assert — the path must match the path used at set time in
      // setFreshRecoveryCodesCookie. A missing or wrong path means the
      // browser's cookie jar would see a DELETE for a different cookie entry.
      const [arg] = mockDelete.mock.calls[0];
      expect(arg.path).toBe("/account/2fa");
    });

    it("calls jar.delete with the exact { name, path } object shape — combined regression", async () => {
      // Arrange — mockDelete set in beforeEach

      // Act
      await clearFreshCodesCookieAction();

      // Assert — full object match
      expect(mockDelete).toHaveBeenCalledWith({
        name: FRESH_RECOVERY_CODES_COOKIE,
        path: "/account/2fa",
      });
    });
  },
);

// ---------------------------------------------------------------------------
// Static assertion — (account)/account/2fa/page.tsx must not contain
// jar.delete in the RSC render path.
//
// FAIL-BEFORE evidence: before the fix, running
//   grep "jar.delete" src/app/(account)/account/2fa/page.tsx
// produced:
//   src/app/(account)/account/2fa/page.tsx:24:  jar.delete(FRESH_RECOVERY_CODES_COOKIE);
//
// This test now PASSES because the fix removed the illegal mutation.
// It will FAIL again if the mutation is re-introduced.
// ---------------------------------------------------------------------------

describe(
  "(account)/account/2fa/page.tsx static analysis — regression for RSC cookie mutation",
  () => {
    const pageSource = readFileSync(
      resolve(__dirname, "page.tsx"),
      "utf-8",
    );

    it("page.tsx does not contain jar.delete — illegal RSC cookie mutation removed", () => {
      // A match here means consumeFreshCodesCookie() was re-introduced or the
      // delete moved back into the RSC render path.
      expect(pageSource).not.toContain("jar.delete");
    });

    it("page.tsx does not define consumeFreshCodesCookie — helper that contained the illegal delete", () => {
      // The helper function itself was the source of BUG-2; its absence proves
      // the mutation path no longer exists in the RSC render.
      expect(pageSource).not.toContain("consumeFreshCodesCookie");
    });
  },
);

// ---------------------------------------------------------------------------
// regenerateRecoveryCodes — F344: minting new codes needs a verified session.
//
// Bug: the action checked only auth() and that an enrolment row existed. A
// person holding only the first factor (a password) could open /account/2fa,
// press Regenerate, read ten fresh codes and use one at /totp. The refusal is
// in the action; the page notice is UX only.
// ---------------------------------------------------------------------------

const USER_ID = "00000000-0000-4000-8000-0000000000f3";

function sessionWith(over: { twoFactorRequired?: boolean; twoFactorVerified?: boolean } = {}) {
  return {
    user: {
      id: USER_ID,
      email: "t@example.invalid",
      twoFactorRequired: true,
      twoFactorVerified: false,
      ...over,
    },
  };
}

const recoveryWrites = () =>
  dbh.state.log.filter((l) => l.endsWith(":user_totp_recovery_codes"));

beforeEach(() => {
  vi.clearAllMocks();
  dbh.state.log = [];
  dbh.state.inserted = [];
  dbh.state.txCalls = 0;
  dbh.state.enrolment = { userId: USER_ID };
  dbh.state.pending = undefined;
  dbh.state.conflictRows = [{ userId: USER_ID }];
  mockAuth.mockResolvedValue(sessionWith());
  vi.mocked(cookies).mockResolvedValue(jar as unknown as Awaited<ReturnType<typeof cookies>>);
});

describe("regenerateRecoveryCodes — F344 refuses an unverified session", () => {
  it("R1: enrolled, 2FA required, session unverified -> refused; nothing deleted or inserted; refusal audited — regression for F344 regenerate bypass", async () => {
    mockAuth.mockResolvedValue(sessionWith({ twoFactorRequired: true, twoFactorVerified: false }));
    const r = await regenerateRecoveryCodes();
    expect(r).toEqual({
      ok: false,
      error: "Confirm it's you with your authenticator app or a recovery code first. Reload this page to see how.",
    });
    expect(recoveryWrites()).toEqual([]);
    expect(dbh.state.txCalls).toBe(0);
    expect(mockRevalidate).not.toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith({
      action: "totp.recovery_codes.regenerate_refused",
      resourceType: "user",
      resourceId: USER_ID,
      metadata: { twoFactorRequired: true },
    });
  });

  it("R2: enrolled, 2FA not required, session unverified -> refused as well; audit says not required — regression for F344", async () => {
    mockAuth.mockResolvedValue(sessionWith({ twoFactorRequired: false, twoFactorVerified: false }));
    const r = await regenerateRecoveryCodes();
    expect(r.ok).toBe(false);
    expect(recoveryWrites()).toEqual([]);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "totp.recovery_codes.regenerate_refused",
        metadata: { twoFactorRequired: false },
      }),
    );
  });

  it("R3: a verified session regenerates; the regenerated audit fires and the refusal does not", async () => {
    mockAuth.mockResolvedValue(sessionWith({ twoFactorVerified: true }));
    const r = await regenerateRecoveryCodes();
    expect(r).toEqual({ ok: true, data: { recoveryCodes: ["CODE-0001"] } });
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "totp.recovery_codes.regenerated" }),
    );
  });

  it("R4: not enrolled -> the existing message and NO refusal audit (nothing to escalate)", async () => {
    dbh.state.enrolment = undefined;
    const r = await regenerateRecoveryCodes();
    expect(r).toEqual({ ok: false, error: "Enroll in 2FA before regenerating recovery codes." });
    expect(mockAudit).not.toHaveBeenCalled();
    expect(recoveryWrites()).toEqual([]);
  });

  it("R5: no session -> Unauthorized., nothing touched", async () => {
    mockAuth.mockResolvedValue(null);
    const r = await regenerateRecoveryCodes();
    expect(r).toEqual({ ok: false, error: "Unauthorized." });
    expect(dbh.state.log).toEqual([]);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("R6: the replacement runs inside one db.transaction (delete then insert on the tx, none on the pool)", async () => {
    mockAuth.mockResolvedValue(sessionWith({ twoFactorVerified: true }));
    await regenerateRecoveryCodes();
    expect(dbh.state.txCalls).toBe(1);
    expect(recoveryWrites()).toEqual([
      "tx.delete:user_totp_recovery_codes",
      "tx.insert:user_totp_recovery_codes",
    ]);
  });

  it("R6b: only hashes are stored, never the plaintext codes", async () => {
    mockAuth.mockResolvedValue(sessionWith({ twoFactorVerified: true }));
    await regenerateRecoveryCodes();
    const ins = dbh.state.inserted.find((i) => i.table === "user_totp_recovery_codes");
    expect(JSON.stringify(ins?.values)).toContain("hash(CODE-0001)");
    expect(JSON.stringify(ins?.values)).not.toContain('"CODE-0001"');
  });
});
