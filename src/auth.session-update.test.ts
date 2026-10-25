/**
 * Session claim integrity: drives the real `handlers` from `@/auth` (the real
 * NextAuth request path, real CSRF check, real jwt callback) and asserts on the
 * decoded cookie it returns. It deliberately skips the route wrapper in
 * `src/app/api/auth/[...nextauth]/route.ts` so the callback layer is proven
 * without leaning on the route's own refusal (DECISION-230).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TEST_SECRET = vi.hoisted(() => {
  process.env.AUTH_SECRET = "test-secret-for-session-claim-integrity-0123456789";
  return process.env.AUTH_SECRET;
});

const USER_ID = "00000000-0000-4000-8000-0000000000a1";
const OTHER_ID = "00000000-0000-4000-8000-0000000000b2";

const DB_ROLES = ["Fixture Role"];
const DB_FEATURES = ["fixture.feature"];

// A chain that is awaitable at any depth and resolves to `rows`.
function chain(rows: unknown[]): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => unknown) => resolve(rows);
      }
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

vi.mock("server-only", () => ({}));
vi.mock("@auth/drizzle-adapter", () => ({ DrizzleAdapter: () => ({}) }));
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: {
        findFirst: async () => ({
          isActive: true,
          twoFactorRequired: true,
          email: "claim-fixture@example.invalid",
        }),
      },
      userRoles: { findFirst: async () => ({ userId: "x" }) },
      roles: { findFirst: async () => null },
    },
    select: () => chain(DB_ROLES.map((name) => ({ name }))),
    selectDistinct: () => chain(DB_FEATURES.map((key) => ({ key }))),
    update: () => chain([]),
    insert: () => chain([]),
  },
}));
vi.mock("@/lib/audit", () => ({ AUDIT_ACTIONS: {}, recordAudit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn() }));
vi.mock("@/lib/auth/local-login", () => ({
  isLocalLoginEnabled: async () => true,
  computeEffectiveTwoFactor: async () => true,
}));

const { handlers } = await import("@/auth");
const { withTwoFactorGrant } = await import("@/lib/auth/two-factor-grant");
const { encode, decode } = await import("next-auth/jwt");

const SESSION_COOKIE = "authjs.session-token";
const CSRF_COOKIE = "authjs.csrf-token";
const ORIGIN = "http://localhost:3460";

let csrfToken = "";
let csrfCookieValue = "";

beforeAll(async () => {
  const res = await handlers.GET(new NextRequest(`${ORIGIN}/api/auth/csrf`));
  csrfToken = ((await res.json()) as { csrfToken: string }).csrfToken;
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = setCookie.match(new RegExp(`${CSRF_COOKIE}=([^;]+)`));
  csrfCookieValue = m?.[1] ?? "";
  expect(csrfToken).not.toBe("");
  expect(csrfCookieValue).not.toBe("");
});

function mintCookie(claims: Record<string, unknown>): Promise<string> {
  return encode({
    token: { sub: USER_ID, twoFactorRequired: true, ...claims },
    secret: TEST_SECRET,
    salt: SESSION_COOKIE,
  });
}

async function postUpdate(
  sessionJwt: string,
  data: unknown,
): Promise<Record<string, unknown>> {
  const req = new NextRequest(`${ORIGIN}/api/auth/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${sessionJwt}; ${CSRF_COOKIE}=${csrfCookieValue}`,
    },
    body: JSON.stringify({ csrfToken, data }),
  });
  return resultingToken(await handlers.POST(req));
}

async function resultingToken(res: Response) {
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  expect(m, "the session cookie is re-issued").not.toBeNull();
  const token = await decode({
    token: m![1],
    secret: TEST_SECRET,
    salt: SESSION_COOKIE,
  });
  expect(token).not.toBeNull();
  return token as Record<string, unknown>;
}

describe("session update — claim integrity", () => {
  it("(a) a payload asserting the 2FA claim, with no grant, leaves it false", async () => {
    const jwt = await mintCookie({ twoFactorVerified: false });
    const token = await postUpdate(jwt, { user: { twoFactorVerified: true } });
    expect(token.twoFactorVerified).toBe(false);
  });

  it("(b) the payload is ignored in both directions: false never un-verifies a verified token", async () => {
    const jwt = await mintCookie({ twoFactorVerified: true });
    const token = await postUpdate(jwt, { user: { twoFactorVerified: false } });
    expect(token.twoFactorVerified).toBe(true);
  });

  it("(c) payload roles and features never reach the token; the database values do", async () => {
    const jwt = await mintCookie({ twoFactorVerified: false });
    const token = await postUpdate(jwt, {
      user: { roles: ["Administrator"], features: ["admin.users"] },
    });
    expect(token.roles).toEqual(DB_ROLES);
    expect(token.features).toEqual(DB_FEATURES);
  });

  it("(d) inside a verification grant for the same user, the claim is set", async () => {
    const jwt = await mintCookie({ twoFactorVerified: false });
    const token = await withTwoFactorGrant(USER_ID, "totp", () =>
      postUpdate(jwt, {}),
    );
    expect(token.twoFactorVerified).toBe(true);
  });

  it("(e) a grant for a different user does not set the claim", async () => {
    const jwt = await mintCookie({ twoFactorVerified: false });
    const token = await withTwoFactorGrant(OTHER_ID, "totp", () =>
      postUpdate(jwt, {}),
    );
    expect(token.twoFactorVerified).toBe(false);
  });

  it("(f) a grant is single-use within its scope", async () => {
    const jwt = await mintCookie({ twoFactorVerified: false });
    const [first, second] = await withTwoFactorGrant(USER_ID, "recovery", async () => {
      const a = await postUpdate(jwt, {});
      const b = await postUpdate(jwt, {});
      return [a, b] as const;
    });
    expect(first.twoFactorVerified).toBe(true);
    expect(second.twoFactorVerified).toBe(false);
  });
});
