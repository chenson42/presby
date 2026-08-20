/**
 * Tests for src/lib/sites-ingest-auth.ts — GitHub Actions OIDC verification
 * for POST /api/sites/ingest (DECISION-087). Security-critical: an auth
 * bypass here is a real vulnerability, not a minor gap, so this file is
 * tested directly rather than only through the route handler.
 *
 * POSITIVE CASE: a real RSA keypair is generated once (node:crypto,
 * generateKeyPairSync) and used to hand-construct a genuinely-signed JWT —
 * base64url-encode header+payload, sign with the private key, base64url-
 * encode the signature — mirroring exactly what this module itself does in
 * reverse. No JWT library, matching DECISION-087's own "no new dependency"
 * ruling. The public key is exported as a JWK (`KeyObject.export({format:
 * "jwk"})`) and served from a stubbed `fetch` standing in for GitHub's real
 * JWKS endpoint.
 *
 * NEGATIVE PATHS get their own dedicated coverage, not just "flip one field
 * and confirm rejection once": wrong issuer, wrong audience, expired token,
 * tampered signature, wrong ref, wrong job_workflow_ref, wrong repository
 * owner, non-push event, missing/malformed claims, wrong signing algorithm
 * declared in the header (confirming the hardcoded RSA-SHA256 verification
 * path — not the header's own declared alg — is what actually runs).
 */

vi.mock("server-only", () => ({}));

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "https://presby.example.invalid/sites-ingest";
const SITES_ORG = "presby-churches";
const KID = "test-key-1";

let publicKey: KeyObject;
let privateKey: KeyObject;
let jwk: Record<string, unknown>;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function signToken(
  payloadOverrides: Record<string, unknown>,
  opts: { headerOverrides?: Record<string, unknown>; badSignature?: boolean } = {},
): string {
  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: KID,
    ...opts.headerOverrides,
  };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: ISSUER,
    aud: AUDIENCE,
    exp: now + 300,
    iat: now,
    repository_owner: SITES_ORG,
    repository: `${SITES_ORG}/site-alder-creek`,
    ref: "refs/heads/main",
    event_name: "push",
    job_workflow_ref: `${SITES_ORG}/presby-site-kit/.github/workflows/ingest.yml@refs/tags/v1.0.0`,
    sha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    ...payloadOverrides,
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = opts.badSignature
    ? Buffer.from("not-a-real-signature")
    : cryptoSign("RSA-SHA256", Buffer.from(signingInput), privateKey);

  return `${signingInput}.${base64url(signature)}`;
}

function stubJwksFetch(keys: Record<string, unknown>[] = [jwk]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ keys }),
    }),
  );
}

beforeAll(() => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  publicKey = pair.publicKey;
  privateKey = pair.privateKey;
  const exported = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  jwk = { ...exported, kid: KID, alg: "RS256", use: "sig" };
});

beforeEach(() => {
  vi.stubEnv("SITES_INGEST_OIDC_AUDIENCE", AUDIENCE);
  vi.stubEnv("GITHUB_SITES_ORG", SITES_ORG);
  stubJwksFetch();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  const { _resetJwksCacheForTests } = await import("./sites-ingest-auth");
  _resetJwksCacheForTests();
});

// ---------------------------------------------------------------------------
// Positive case — a genuinely-signed, fully-valid token
// ---------------------------------------------------------------------------

describe("verifyGithubActionsOidcToken — positive case", () => {
  it("verifies a well-formed, correctly-signed token and returns repository/sha", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const token = signToken({});

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);

    expect(result).toEqual({
      ok: true,
      claims: {
        repository: `${SITES_ORG}/site-alder-creek`,
        sha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      },
    });
  });

  it("accepts a token with no event_name claim (checked only when present)", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const payload: Record<string, unknown> = {
      iss: ISSUER,
      aud: AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 300,
      repository_owner: SITES_ORG,
      repository: `${SITES_ORG}/site-alder-creek`,
      ref: "refs/heads/main",
      job_workflow_ref: `${SITES_ORG}/presby-site-kit/.github/workflows/ingest.yml@refs/tags/v1.0.0`,
      sha: "deadbeef",
    };
    const header = { alg: "RS256", typ: "JWT", kid: KID };
    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(payload));
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = cryptoSign("RSA-SHA256", Buffer.from(signingInput), privateKey);
    const token = `${signingInput}.${base64url(signature)}`;

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result.ok).toBe(true);
  });

  it("accepts a job_workflow_ref with a different site-kit tag (prefix match, not exact pin)", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const token = signToken({
      job_workflow_ref: `${SITES_ORG}/presby-site-kit/.github/workflows/ingest.yml@refs/tags/v2.3.1`,
    });

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Negative paths
// ---------------------------------------------------------------------------

describe("verifyGithubActionsOidcToken — negative paths", () => {
  it("rejects a missing Authorization header", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const result = await verifyGithubActionsOidcToken(null);
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: expect.stringContaining("Authorization"),
    });
  });

  it("rejects a header that isn't a Bearer token", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const result = await verifyGithubActionsOidcToken("Basic dXNlcjpwYXNz");
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed token (not three dot-separated segments)", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const result = await verifyGithubActionsOidcToken("Bearer not.a.jwt.at.all");
    expect(result.ok).toBe(false);
  });

  it("rejects a token whose header/payload segments aren't valid JSON", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const result = await verifyGithubActionsOidcToken(
      `Bearer ${base64url("not-json")}.${base64url("also-not-json")}.sig`,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a tampered signature (payload altered after signing)", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const token = signToken({});
    const [headerB64, payloadB64, sigB64] = token.split(".");
    // Flip the repository claim post-signing — the signature no longer
    // covers this payload.
    const tamperedPayload = base64url(
      JSON.stringify({
        iss: ISSUER,
        aud: AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 300,
        repository_owner: SITES_ORG,
        repository: `${SITES_ORG}/a-different-repo`,
        ref: "refs/heads/main",
        event_name: "push",
        job_workflow_ref: `${SITES_ORG}/presby-site-kit/.github/workflows/ingest.yml@refs/tags/v1.0.0`,
        sha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      }),
    );
    const tampered = `${headerB64}.${tamperedPayload}.${sigB64}`;

    const result = await verifyGithubActionsOidcToken(`Bearer ${tampered}`);
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: expect.stringContaining("Signature"),
    });
  });

  it("rejects a token signed with a key that never appears in the JWKS", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const otherPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = { alg: "RS256", typ: "JWT", kid: KID };
    const payload = {
      iss: ISSUER,
      aud: AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 300,
      repository_owner: SITES_ORG,
      repository: `${SITES_ORG}/site-alder-creek`,
      ref: "refs/heads/main",
      event_name: "push",
      job_workflow_ref: `${SITES_ORG}/presby-site-kit/.github/workflows/ingest.yml@refs/tags/v1.0.0`,
      sha: "deadbeef",
    };
    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(payload));
    const signingInput = `${headerB64}.${payloadB64}`;
    // Signed by a DIFFERENT private key than the one whose public JWK is
    // being served — same kid, wrong key, so signature verification must
    // fail even though key lookup by kid succeeds.
    const signature = cryptoSign("RSA-SHA256", Buffer.from(signingInput), otherPair.privateKey);
    const token = `${signingInput}.${base64url(signature)}`;

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown kid (no matching JWKS entry)", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const token = signToken({}, { headerOverrides: { kid: "no-such-key" } });

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: expect.stringContaining("signing key"),
    });
  });

  it("IGNORES the header's declared alg — verification is always hardcoded RSA-SHA256", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    // A real RS256-signed token whose header LIES and claims "none" — if
    // this module ever trusted header.alg it would try to verify with a
    // "none" algorithm rather than RSA-SHA256, but it never reads alg at
    // all, so a genuinely RS256-signed token still verifies correctly
    // regardless of what the header claims.
    const token = signToken({}, { headerOverrides: { alg: "none" } });

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result.ok).toBe(true);
  });

  it("rejects an expired token", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const token = signToken({ exp: Math.floor(Date.now() / 1000) - 60 });

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: expect.stringContaining("expired"),
    });
  });

  it("rejects a token missing exp entirely", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT", kid: KID };
    const payload = {
      iss: ISSUER,
      aud: AUDIENCE,
      iat: now,
      repository_owner: SITES_ORG,
      repository: `${SITES_ORG}/site-alder-creek`,
      ref: "refs/heads/main",
      event_name: "push",
      job_workflow_ref: `${SITES_ORG}/presby-site-kit/.github/workflows/ingest.yml@refs/tags/v1.0.0`,
      sha: "deadbeef",
    };
    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(payload));
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = cryptoSign("RSA-SHA256", Buffer.from(signingInput), privateKey);
    const token = `${signingInput}.${base64url(signature)}`;

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result.ok).toBe(false);
  });

  it("rejects the wrong issuer", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const token = signToken({ iss: "https://not-github.example.invalid" });

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: expect.stringContaining("issuer"),
    });
  });

  it("rejects the wrong audience", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const token = signToken({ aud: "https://someone-elses-app.example.invalid" });

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: expect.stringContaining("audience"),
    });
  });

  it("rejects when SITES_INGEST_OIDC_AUDIENCE is unset server-side, even for an otherwise-valid token", async () => {
    vi.stubEnv("SITES_INGEST_OIDC_AUDIENCE", "");
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const token = signToken({});

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result.ok).toBe(false);
  });

  it("rejects the wrong repository_owner", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const token = signToken({ repository_owner: "some-other-org" });

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: expect.stringContaining("repository owner"),
    });
  });

  it("rejects a ref that isn't refs/heads/main", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const token = signToken({ ref: "refs/heads/feature-branch" });

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: expect.stringContaining("main"),
    });
  });

  it("rejects a pull_request event_name even with ref=refs/heads/main", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const token = signToken({ event_name: "pull_request" });

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: expect.stringContaining("push event"),
    });
  });

  it("rejects a job_workflow_ref outside presby-site-kit's own reusable workflow", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const token = signToken({
      job_workflow_ref: `${SITES_ORG}/site-alder-creek/.github/workflows/ingest.yml@refs/heads/main`,
    });

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: expect.stringContaining("presby-site-kit"),
    });
  });

  it("rejects a job_workflow_ref from a DIFFERENT org's presby-site-kit fork", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const token = signToken({
      job_workflow_ref: "some-other-org/presby-site-kit/.github/workflows/ingest.yml@refs/tags/v1.0.0",
    });

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result.ok).toBe(false);
  });

  it("rejects a token missing the repository claim", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const token = signToken({ repository: undefined });

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: expect.stringContaining("repository claim"),
    });
  });

  it("rejects a token missing the sha claim", async () => {
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const token = signToken({ sha: undefined });

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: expect.stringContaining("commit sha"),
    });
  });

  it("rejects when the JWKS fetch itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const token = signToken({});

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: expect.stringContaining("key discovery failed"),
    });
  });

  it("rejects when the JWKS endpoint returns a non-OK status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) }),
    );
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");
    const token = signToken({});

    const result = await verifyGithubActionsOidcToken(`Bearer ${token}`);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// JWKS caching
// ---------------------------------------------------------------------------

describe("verifyGithubActionsOidcToken — JWKS caching", () => {
  it("does not re-fetch the JWKS on a second verification within the cache TTL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ keys: [jwk] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { verifyGithubActionsOidcToken } = await import("./sites-ingest-auth");

    await verifyGithubActionsOidcToken(`Bearer ${signToken({})}`);
    await verifyGithubActionsOidcToken(`Bearer ${signToken({ sha: "another-sha" })}`);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
