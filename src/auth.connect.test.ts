/**
 * The sign-in branch of the real `jwt` callback in `src/auth.ts` (Community
 * Increment 2b, R38/R39/R41, DECISION-225/226). A correct connect definer that
 * `auth.ts` forgets to call, calls at the wrong time, or lets break sign-in
 * passes every other test, so this file drives the callback itself:
 *
 *   - proof is recorded ONLY for a Google sign-in whose `email_verified` claim
 *     is the boolean true and which carries an address (F231's gate refuses the
 *     rest first; this is the post-condition);
 *   - connect is ALWAYS attempted at sign-in, whatever the provider;
 *   - a throw in either never fails sign-in and logs an error class only (no
 *     address, no id);
 *   - both run AFTER the default role and BEFORE `twoFactorRequired` is
 *     computed, so a congregation's two-factor policy applies to the new link in
 *     the same cookie (E-12);
 *   - an update (no `user`) runs neither, and a connect never touches the
 *     two-factor claim.
 *
 * Approach: as `src/auth.sign-in.test.ts`: `next-auth` is mocked so importing
 * `@/auth` records the config it was handed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type JwtArgs = {
  token: Record<string, unknown>;
  user?: { id?: string; email?: string | null };
  account?: { provider: string } | null;
  profile?: Record<string, unknown>;
  trigger?: string;
  session?: unknown;
};
type CapturedConfig = {
  providers?: unknown[];
  callbacks: { jwt: (args: JwtArgs) => Promise<Record<string, unknown>> };
};

const captured = vi.hoisted(() => ({ configs: [] as unknown[] }));
const calls = vi.hoisted(() => ({ order: [] as string[] }));
const recordProof = vi.hoisted(() => vi.fn());
const connect = vi.hoisted(() => vi.fn());

// A chain that is awaitable at any depth and resolves to `rows`.
function chain(rows: unknown[]): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(rows);
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    captured.configs.push(config);
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), unstable_update: vi.fn() };
  },
}));
vi.mock("@auth/drizzle-adapter", () => ({ DrizzleAdapter: () => ({}) }));
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: {
        findFirst: async () => ({ isActive: true, twoFactorRequired: false, email: "jwt-fixture@example.invalid" }),
      },
      userRoles: {
        findFirst: async () => {
          calls.order.push("ensureDefaultRole");
          return { userId: "x" };
        },
      },
      roles: { findFirst: vi.fn() },
    },
    select: () => chain([{ name: "Member" }]),
    selectDistinct: () => chain([]),
    update: () => {
      calls.order.push("lastLoginAt");
      return chain([]);
    },
    insert: () => chain([]),
  },
}));
vi.mock("@/lib/audit", () => ({ AUDIT_ACTIONS: {}, recordAudit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn() }));
vi.mock("@/lib/auth/local-login", () => ({
  isLocalLoginEnabled: async () => true,
  computeEffectiveTwoFactor: async () => {
    calls.order.push("computeEffectiveTwoFactor");
    return false;
  },
}));
vi.mock("@/lib/auth/email-proof", () => ({ recordGoogleEmailProof: recordProof }));
vi.mock("@/lib/onboarding/connect", () => ({ connectSignedInAccount: connect }));

await import("@/auth");
const config = (captured.configs as CapturedConfig[]).find(
  (c) => c.providers !== undefined && c.providers.length > 0,
);
if (!config) throw new Error("src/auth.ts did not hand NextAuth a config");
const jwt = config.callbacks.jwt;

const USER_ID = "77777777-7777-4777-8777-777777777777";
const EMAIL = "jwt-fixture@example.invalid";
const user = { id: USER_ID, email: EMAIL };

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  calls.order.length = 0;
  recordProof.mockReset().mockImplementation(async () => {
    calls.order.push("recordGoogleEmailProof");
    return true;
  });
  connect.mockReset().mockImplementation(async () => {
    calls.order.push("connectSignedInAccount");
    return { kind: "declined" };
  });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe("proof: only a Google sign-in with a true claim and an address", () => {
  it("records proof for Google with email_verified === true, and connect is told proof was 'google'", async () => {
    await jwt({ token: {}, user, account: { provider: "google" }, profile: { email_verified: true, email: EMAIL }, trigger: "signIn" });
    expect(recordProof).toHaveBeenCalledTimes(1);
    expect(recordProof).toHaveBeenCalledWith({ userId: USER_ID, address: EMAIL });
    expect(connect).toHaveBeenCalledWith({ userId: USER_ID, via: "sign_in", proof: "google", actorEmail: EMAIL });
  });

  it("the address is the PROVIDER's, not the session user's", async () => {
    await jwt({
      token: {}, user, account: { provider: "google" },
      profile: { email_verified: true, email: "provider-address@example.invalid" },
    });
    expect(recordProof).toHaveBeenCalledWith({ userId: USER_ID, address: "provider-address@example.invalid" });
  });

  it("when the definer stamps nothing, connect is told proof is held by the account ('account')", async () => {
    recordProof.mockResolvedValue(false);
    await jwt({ token: {}, user, account: { provider: "google" }, profile: { email_verified: true, email: EMAIL } });
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ proof: "account" }));
  });

  it.each([
    ["false", false],
    ["missing", undefined],
    ["the string 'true'", "true"],
    ["1", 1],
    ["null", null],
  ])("no proof for a Google claim that is %s (only the boolean true)", async (_label, claim) => {
    await jwt({ token: {}, user, account: { provider: "google" }, profile: { email_verified: claim, email: EMAIL } });
    expect(recordProof).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ proof: "account" }));
  });

  it("no proof when Google supplies no address", async () => {
    await jwt({ token: {}, user, account: { provider: "google" }, profile: { email_verified: true } });
    expect(recordProof).not.toHaveBeenCalled();
  });

  it("no proof for a Credentials sign-in, and none from a missing account/profile", async () => {
    await jwt({ token: {}, user, account: { provider: "credentials" }, profile: { email_verified: true, email: EMAIL } });
    await jwt({ token: {}, user });
    expect(recordProof).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(2);
  });
});

describe("connect: always attempted at sign-in, never with a factor", () => {
  it("is attempted for Credentials and for Google alike", async () => {
    await jwt({ token: {}, user, account: { provider: "credentials" } });
    await jwt({ token: {}, user, account: { provider: "google" }, profile: { email_verified: true, email: EMAIL } });
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("is called with via 'sign_in' and NO second-factor flag", async () => {
    await jwt({ token: {}, user, account: { provider: "credentials" } });
    const input = connect.mock.calls[0]![0];
    expect(input.via).toBe("sign_in");
    expect(input).not.toHaveProperty("secondFactorVerified");
  });

  it("an update (no `user`) runs neither proof nor connect", async () => {
    await jwt({ token: { sub: USER_ID }, trigger: "update", session: { user: { email: "x@example.invalid" } } });
    expect(recordProof).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("sign-in leaves the two-factor claim false whatever connect reports", async () => {
    connect.mockResolvedValue({ kind: "connected", organizationSlug: "fixture" });
    const token = await jwt({ token: {}, user, account: { provider: "credentials" } });
    expect(token.twoFactorVerified).toBe(false);
  });
});

describe("a failure never fails sign-in", () => {
  it("a throw from the proof writer still signs in, still attempts connect, and logs no address and no id", async () => {
    recordProof.mockRejectedValue(new Error(`boom for ${EMAIL} ${USER_ID}`));
    const token = await jwt({ token: {}, user, account: { provider: "google" }, profile: { email_verified: true, email: EMAIL } });
    expect(token.sub).toBe(USER_ID);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ proof: "account" }));
    expect(errorSpy).toHaveBeenCalledWith("[auth] email proof failed");
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toMatch(/@/);
    expect(logged).not.toContain(USER_ID);
  });

  it("a throw from connect still signs in and logs no address and no id", async () => {
    connect.mockRejectedValue(new Error(`boom for ${EMAIL} ${USER_ID}`));
    const token = await jwt({ token: {}, user, account: { provider: "credentials" } });
    expect(token.sub).toBe(USER_ID);
    expect(token.roles).toEqual(["Member"]);
    expect(errorSpy).toHaveBeenCalledWith("[auth] connect failed");
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toMatch(/@/);
    expect(logged).not.toContain(USER_ID);
  });

  it("both throwing is still a normal sign-in", async () => {
    recordProof.mockRejectedValue(new Error("a"));
    connect.mockRejectedValue(new Error("b"));
    const token = await jwt({ token: {}, user, account: { provider: "google" }, profile: { email_verified: true, email: EMAIL } });
    expect(token.sub).toBe(USER_ID);
    expect(token.isActive).toBe(true);
  });
});

describe("ordering (E-12): after the default role, before the two-factor requirement is computed", () => {
  it("runs ensureDefaultRole, then proof, then connect, then lastLoginAt, then computeEffectiveTwoFactor", async () => {
    await jwt({ token: {}, user, account: { provider: "google" }, profile: { email_verified: true, email: EMAIL } });
    expect(calls.order).toEqual([
      "ensureDefaultRole",
      "recordGoogleEmailProof",
      "connectSignedInAccount",
      "lastLoginAt",
      "computeEffectiveTwoFactor",
    ]);
  });

  it("holds when proof fails too (connect still precedes the requirement)", async () => {
    recordProof.mockImplementation(async () => {
      calls.order.push("recordGoogleEmailProof");
      throw new Error("x");
    });
    await jwt({ token: {}, user, account: { provider: "google" }, profile: { email_verified: true, email: EMAIL } });
    expect(calls.order.indexOf("connectSignedInAccount")).toBeGreaterThan(calls.order.indexOf("recordGoogleEmailProof"));
    expect(calls.order.indexOf("connectSignedInAccount")).toBeLessThan(calls.order.indexOf("computeEffectiveTwoFactor"));
  });
});
