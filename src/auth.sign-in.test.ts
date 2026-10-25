/**
 * Sign-in wiring (F231, DECISION-246): proves the `signIn` callback in the real
 * `src/auth.ts` feeds the provider's `email_verified` claim to the gate. A
 * correct gate that auth.ts forgets to feed passes every sign-in-gate unit test
 * and fixes nothing, so this file drives the callback itself.
 *
 * Approach: `next-auth` is mocked so importing `@/auth` records the config it
 * was handed instead of building handlers. `src/lib/auth/config.ts` also calls
 * NextAuth (the edge instance), so the config with `providers` defined is the
 * one from `src/auth.ts`.
 *
 * Honest limit: nothing here drives a real Google token exchange. "The claim
 * arrives" rests on this wiring test plus the dependency tripwire at the
 * bottom, which reads the installed @auth/core source.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

type SignInArgs = {
  user: { id?: string | null; email?: string | null };
  account?: { provider: string } | null;
  profile?: Record<string, unknown>;
};
type CapturedConfig = {
  providers?: unknown[];
  callbacks: { signIn: (args: SignInArgs) => Promise<boolean | string> };
};

const captured = vi.hoisted(() => ({ configs: [] as unknown[] }));
const findFirst = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    captured.configs.push(config);
    return {
      handlers: {},
      auth: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
      unstable_update: vi.fn(),
    };
  },
}));
vi.mock("@auth/drizzle-adapter", () => ({ DrizzleAdapter: () => ({}) }));
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: { findFirst },
      userRoles: { findFirst: vi.fn() },
      roles: { findFirst: vi.fn() },
    },
    select: vi.fn(),
    selectDistinct: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}));
vi.mock("@/lib/audit", () => ({ AUDIT_ACTIONS: {}, recordAudit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn() }));
vi.mock("@/lib/auth/local-login", () => ({
  isLocalLoginEnabled: async () => true,
  computeEffectiveTwoFactor: async () => true,
}));

await import("@/auth");
const config = (captured.configs as CapturedConfig[]).find(
  (c) => c.providers !== undefined && c.providers.length > 0,
);
if (!config) throw new Error("src/auth.ts did not hand NextAuth a config");
const signIn = config.callbacks.signIn;

const EMAIL = "claimant-fixture@example.invalid";
const SUBJECT = "117483729384657382910";
const user = { id: SUBJECT, email: EMAIL };
const google = { provider: "google" };

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  findFirst.mockReset();
  findFirst.mockResolvedValue(undefined); // no row
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("signIn callback — provider email claim reaches the gate", () => {
  it("email_verified false — refuses and never reads users — regression for unverified provider email", async () => {
    const result = await signIn({
      user,
      account: google,
      profile: { email_verified: false },
    });
    expect(result).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ["absent", {}],
    ['the string "true"', { email_verified: "true" }],
    ["the number 1", { email_verified: 1 }],
    ["null", { email_verified: null }],
  ])("email_verified %s — refuses", async (_l, profile) => {
    expect(await signIn({ user, account: google, profile })).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("no profile at all — refuses", async () => {
    expect(await signIn({ user, account: google })).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("verified, no row — allowed (the adapter creates the row)", async () => {
    findFirst.mockResolvedValue(undefined);
    expect(
      await signIn({ user, account: google, profile: { email_verified: true } }),
    ).toBe(true);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it("verified, active row — allowed", async () => {
    findFirst.mockResolvedValue({ isActive: true });
    expect(
      await signIn({ user, account: google, profile: { email_verified: true } }),
    ).toBe(true);
  });

  it("verified, deactivated row — refused", async () => {
    findFirst.mockResolvedValue({ isActive: false });
    expect(
      await signIn({ user, account: google, profile: { email_verified: true } }),
    ).toBe(false);
  });

  it("an unverified claim for a linked account (DB-style id) is still refused", async () => {
    findFirst.mockResolvedValue({ isActive: true });
    expect(
      await signIn({
        user: { id: "00000000-0000-4000-8000-0000000000a1", email: EMAIL },
        account: google,
        profile: { email_verified: false },
      }),
    ).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("credentials — allowed with no profile and no lookup", async () => {
    expect(
      await signIn({ user, account: { provider: "credentials" } }),
    ).toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe("signIn callback — refusal log line", () => {
  it("a claim refusal warns once with provider and claim type, and nothing identifying", async () => {
    await signIn({ user, account: google, profile: { email_verified: false } });
    expect(warn).toHaveBeenCalledTimes(1);
    const args = warn.mock.calls[0];
    expect(args.some((a: unknown) => typeof a === "object" && a !== null && "provider" in a && "claimType" in a)).toBe(true);
    const serialized = JSON.stringify(args);
    expect(serialized).toContain("google");
    expect(serialized).toContain("boolean");
    expect(serialized).not.toContain(EMAIL);
    expect(serialized).not.toContain(SUBJECT);
  });

  it("a missing claim logs its type as undefined", async () => {
    await signIn({ user, account: google, profile: {} });
    expect(JSON.stringify(warn.mock.calls[0])).toContain("undefined");
  });

  it("verified, deactivated and credentials sign-ins do not warn", async () => {
    findFirst.mockResolvedValue({ isActive: true });
    await signIn({ user, account: google, profile: { email_verified: true } });
    findFirst.mockResolvedValue({ isActive: false });
    await signIn({ user, account: google, profile: { email_verified: true } });
    await signIn({ user, account: { provider: "credentials" } });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("dependency tripwire", () => {
  it("@auth/core's OAuth callback still passes `profile` to the signIn callback", () => {
    const require = createRequire(import.meta.url);
    // The package's exports map does not expose package.json; the root entry
    // sits beside lib/.
    const pkgRoot = dirname(require.resolve("@auth/core"));
    const src = readFileSync(join(pkgRoot, "lib/actions/callback/index.js"), "utf8");
    // If an upgrade stops passing the profile, the wiring tests above stay
    // green over a claim that never arrives.
    expect(src).toMatch(/handleAuthorized\(\{\s*user:[^}]*profile:\s*OAuthProfile/s);
  });
});
