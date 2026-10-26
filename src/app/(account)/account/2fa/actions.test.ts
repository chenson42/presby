import { vi, describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// The /account/2fa server actions, with the database and the session scripted.
//
// vi.mock() calls are hoisted above the imports. Mocks keep @/lib/db from
// throwing "DATABASE_URL is not set" and @/auth from pulling in the NextAuth
// runtime. The two-factor-grant module is the REAL one (server-only mocked):
// the update mock asks it whether a grant is active, which is how the tests
// prove the session is marked verified only inside a grant for the session user
// (the same technique as (auth)/totp/actions.test.ts).
//
// What these pin (docs/work-log/2026-10-26-recovery-codes.md):
//   F166  completeEnrollment: possession proof first, refuse-if-enrolled inside
//         the insert, one transaction, the session marked verified through the
//         grant after the commit, no cookie and no revalidatePath, and no
//         plaintext code anywhere but the return value.
//   F344  regenerateRecoveryCodes refuses an unverified session.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));

const jar = vi.hoisted(() => ({ set: vi.fn(), delete: vi.fn() }));
const mockCookies = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies: mockCookies }));

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
    verifyResult: false,
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

const CODES = vi.hoisted(() =>
  Array.from({ length: 10 }, (_, i) => `CODE-${String(i + 1).padStart(4, "0")}`),
);

vi.mock("@/lib/two-factor", () => ({
  decryptSecret: vi.fn(() => "PLAIN-SECRET"),
  encryptSecret: vi.fn(),
  generateRecoveryCodes: vi.fn(() => CODES),
  hashRecoveryCode: vi.fn((c: string) => `hash(${c})`),
  verifyToken: vi.fn(() => {
    dbh.state.log.push("verifyToken");
    return dbh.state.verifyResult;
  }),
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

import { takeTwoFactorGrant } from "@/lib/auth/two-factor-grant";
import { completeEnrollment, regenerateRecoveryCodes } from "./actions";

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

type UpdateCall = { payload: unknown; granted: boolean };
let updateCalls: UpdateCall[];

const recoveryWrites = () =>
  dbh.state.log.filter((l) => l.endsWith(":user_totp_recovery_codes"));

const FRESH_PENDING = {
  secretCiphertext: "CIPHERTEXT-OF-PENDING",
  expiresAt: new Date(Date.now() + 10 * 60_000),
};

beforeEach(() => {
  vi.clearAllMocks();
  dbh.state.log = [];
  dbh.state.inserted = [];
  dbh.state.txCalls = 0;
  dbh.state.enrolment = { userId: USER_ID };
  dbh.state.pending = undefined;
  dbh.state.conflictRows = [{ userId: USER_ID }];
  dbh.state.verifyResult = false;
  updateCalls = [];
  mockAuth.mockResolvedValue(sessionWith());
  mockCookies.mockResolvedValue(jar);
  // The real grant module: records whether a grant for the session user is active at the call.
  mockUpdate.mockImplementation(async (payload: unknown) => {
    dbh.state.log.push("unstable_update");
    updateCalls.push({ payload, granted: takeTwoFactorGrant(USER_ID) });
    return { user: { id: USER_ID, twoFactorVerified: true } };
  });
});

// ---------------------------------------------------------------------------
// completeEnrollment — F166 and DECISION-292
// ---------------------------------------------------------------------------

describe("completeEnrollment — the confirmation is a possession proof that marks the session verified", () => {
  function readyToEnrol() {
    dbh.state.enrolment = undefined;
    dbh.state.pending = FRESH_PENDING;
    dbh.state.verifyResult = true;
    mockAuth.mockResolvedValue(sessionWith({ twoFactorVerified: false }));
  }

  it("E1: a correct code returns the ten codes and sessionVerified true; the session is updated once, with no payload, inside a grant for the session user — regression for F166 second challenge", async () => {
    readyToEnrol();
    const r = await completeEnrollment({ code: "123456" });
    expect(r).toEqual({ ok: true, data: { recoveryCodes: CODES, sessionVerified: true } });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.payload).toEqual({});
    expect(updateCalls[0]!.granted).toBe(true);
  });

  it("E2: a wrong code writes nothing, opens no grant and audits nothing", async () => {
    readyToEnrol();
    dbh.state.verifyResult = false;
    const r = await completeEnrollment({ code: "000000" });
    expect(r).toEqual({ ok: false, error: "That code did not match. Try again." });
    expect(dbh.state.log).toEqual(["verifyToken"]);
    expect(dbh.state.txCalls).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("E3: the order is verifyToken, then the enrolment insert, then the recovery codes, then the session update — the grant is never reached before the proof", async () => {
    readyToEnrol();
    await completeEnrollment({ code: "123456" });
    expect(dbh.state.log).toEqual([
      "verifyToken",
      "tx.insert:user_totp",
      "tx.insert-conflict-nothing:user_totp",
      "tx.delete:user_totp_pending",
      "tx.delete:user_totp_recovery_codes",
      "tx.insert:user_totp_recovery_codes",
      "unstable_update",
    ]);
  });

  it("E4: when the enrolment insert returns no row (already enrolled) the confirmation is refused: pending row deleted, nothing replaced, no grant, no TOTP_ENROLLED — regression for the silent secret replacement", async () => {
    readyToEnrol();
    dbh.state.conflictRows = [];
    const r = await completeEnrollment({ code: "123456" });
    expect(r).toEqual({
      ok: false,
      error: "Two-factor authentication is already set up on this account, possibly in another tab. Reload this page.",
    });
    expect(dbh.state.log).toContain("tx.delete:user_totp_pending");
    expect(recoveryWrites()).toEqual([]);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("E5: a session update that throws still returns the codes with sessionVerified false; the audit says so; one PII-free console.error — fails closed", async () => {
    readyToEnrol();
    mockUpdate.mockRejectedValueOnce(new Error(`boom for ${USER_ID} PLAIN-SECRET CODE-0001`));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await completeEnrollment({ code: "123456" });
    expect(r).toEqual({ ok: true, data: { recoveryCodes: CODES, sessionVerified: false } });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "totp.enrolled", metadata: { sessionVerified: false } }),
    );
    expect(errSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).not.toContain("CODE-");
    expect(logged).not.toContain("PLAIN-SECRET");
    expect(logged).not.toContain("CIPHERTEXT");
    expect(logged).not.toContain(USER_ID);
    errSpy.mockRestore();
  });

  it("E6: an update that resolves with a session NOT carrying the claim reports sessionVerified false, never true", async () => {
    readyToEnrol();
    mockUpdate.mockImplementationOnce(async () => ({ user: { id: USER_ID, twoFactorVerified: false } }));
    const r = await completeEnrollment({ code: "123456" });
    expect(r).toEqual({ ok: true, data: { recoveryCodes: CODES, sessionVerified: false } });
    mockUpdate.mockImplementationOnce(async () => null);
    readyToEnrol();
    const r2 = await completeEnrollment({ code: "123456" });
    expect(r2.ok && r2.data?.sessionVerified).toBe(false);
  });

  it("E7: TOTP_ENROLLED carries exactly { sessionVerified }; no code, secret, ciphertext or hash reaches the audit call", async () => {
    readyToEnrol();
    await completeEnrollment({ code: "123456" });
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith({
      action: "totp.enrolled",
      resourceType: "user",
      resourceId: USER_ID,
      metadata: { sessionVerified: true },
    });
    const dumped = JSON.stringify(mockAudit.mock.calls);
    for (const secret of ["CODE-", "PLAIN-SECRET", "CIPHERTEXT", "hash("]) expect(dumped).not.toContain(secret);
  });

  it("E8: no session -> Unauthorized., nothing touched", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await completeEnrollment({ code: "123456" })).toEqual({ ok: false, error: "Unauthorized." });
    expect(dbh.state.log).toEqual([]);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("E9: no pending row -> the new 'no setup in progress' copy; an expired one -> the existing copy and the row is deleted", async () => {
    readyToEnrol();
    dbh.state.pending = undefined;
    expect(await completeEnrollment({ code: "123456" })).toEqual({
      ok: false,
      error: "No setup in progress was found. Reload this page to see where things stand.",
    });
    dbh.state.pending = { ...FRESH_PENDING, expiresAt: new Date(Date.now() - 1000) };
    dbh.state.log = [];
    expect(await completeEnrollment({ code: "123456" })).toEqual({
      ok: false,
      error: "Enrollment session expired. Reload the page to start over.",
    });
    expect(dbh.state.log).toEqual(["db.delete:user_totp_pending"]);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("E10: the enrol path never revalidates the page and never touches a cookie — regression for F166 vanishing panel", async () => {
    readyToEnrol();
    await completeEnrollment({ code: "123456" });
    expect(mockRevalidate).not.toHaveBeenCalled();
    expect(jar.set).not.toHaveBeenCalled();
    expect(jar.delete).not.toHaveBeenCalled();
  });

  it("E11: the pending row and the enrolment are written inside ONE transaction, none on the pool", async () => {
    readyToEnrol();
    await completeEnrollment({ code: "123456" });
    expect(dbh.state.txCalls).toBe(1);
    expect(dbh.state.log.filter((l) => l.startsWith("db."))).toEqual([]);
  });

  it("E12: only hashes of the codes are stored", async () => {
    readyToEnrol();
    await completeEnrollment({ code: "123456" });
    const ins = dbh.state.inserted.find((i) => i.table === "user_totp_recovery_codes");
    const stored = JSON.stringify(ins?.values);
    expect(stored).toContain("hash(CODE-0001)");
    expect(stored).not.toContain('"CODE-0001"');
  });
});

// ---------------------------------------------------------------------------
// S1 — no plaintext recovery code outside client memory (DECISION-292)
//
// The fresh-codes cookie held a 5-minute plaintext copy and made the page
// re-render on its own (any cookie write in a server action does, Next 16). It
// is gone; this keeps it gone. Neither the page nor the actions may reach
// `next/headers`, so there is no cookie to put a code in.
// ---------------------------------------------------------------------------

describe("no plaintext recovery code outside client memory — regression for the fresh-codes cookie", () => {
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const file of ["page.tsx", "actions.ts"]) {
    it(`S1: ${file} imports nothing from next/headers and never calls cookies()`, () => {
      const source = strip(readFileSync(resolve(__dirname, file), "utf-8"));
      expect(source).not.toMatch(/next\/headers/);
      expect(source).not.toMatch(/cookies\s*\(/);
      expect(source).not.toContain("FRESH_RECOVERY_CODES_COOKIE");
    });
  }

  it("S1b: actions.ts exports exactly completeEnrollment and regenerateRecoveryCodes (clearFreshCodesCookieAction is gone: a public endpoint that disappears)", async () => {
    const mod = await import("./actions");
    expect(Object.keys(mod).sort()).toEqual(["completeEnrollment", "regenerateRecoveryCodes"]);
  });
});

// ---------------------------------------------------------------------------
// regenerateRecoveryCodes — F344: minting new codes needs a verified session.
//
// Bug: the action checked only auth() and that an enrolment row existed. A
// person holding only the first factor (a password) could open /account/2fa,
// press Regenerate, read ten fresh codes and use one at /totp. The refusal is
// in the action; the page notice is UX only.
// ---------------------------------------------------------------------------

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
    expect(r).toEqual({ ok: true, data: { recoveryCodes: CODES } });
    expect(jar.set).not.toHaveBeenCalled();
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
