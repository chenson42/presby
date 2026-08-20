import "server-only";
import { createPublicKey, verify as cryptoVerify } from "node:crypto";

/**
 * GitHub Actions OIDC verification for `POST /api/sites/ingest`
 * (DECISION-087, `docs/work-log/2026-08-20-public-sites.md` Phase 3 "API
 * Contract"). No JWT/JWKS dependency — verified inline with `node:crypto`
 * against GitHub's own published JWKS, the same "small, auditable, and no
 * second consumer anywhere in the tree" reasoning DECISION-057 already
 * established for the inline OKLCH transcription in this codebase.
 *
 * THE ALGORITHM IS HARDCODED TO `"RSA-SHA256"` (RS256) AND NEVER READ FROM
 * THE TOKEN'S OWN `alg` HEADER. Trusting a caller-declared algorithm is the
 * textbook "alg: none" / algorithm-confusion class of JWT vulnerability — an
 * attacker who could get this endpoint to verify against an algorithm of
 * their own choosing (or none at all) could forge a token that never came
 * from `token.actions.githubusercontent.com`. GitHub's OIDC tokens are
 * always RS256; there is nothing this endpoint legitimately negotiates.
 *
 * JWKS CACHE: a plain module-level object with a ~1h TTL, mirroring
 * `src/lib/rate-limit.ts`'s own plain-`Map` in-memory pattern (same
 * documented limitation: resets on cold start, fine for a low-QPS
 * verification key that rotates on GitHub's own schedule, not an attacker's).
 */

const JWKS_URL =
  "https://token.actions.githubusercontent.com/.well-known/jwks";
const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // ~1h

interface GithubJwk {
  kty: string;
  kid: string;
  n: string;
  e: string;
  [key: string]: unknown;
}

interface JwksResponse {
  keys: GithubJwk[];
}

interface JwksCacheEntry {
  keys: GithubJwk[];
  fetchedAt: number;
}

let jwksCache: JwksCacheEntry | null = null;

async function getJwks(): Promise<GithubJwk[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(JWKS_URL);
  if (!res.ok) {
    throw new Error(`sites-ingest-auth: JWKS fetch failed (${res.status})`);
  }
  const body = (await res.json()) as JwksResponse;
  jwksCache = { keys: body.keys ?? [], fetchedAt: now };
  return jwksCache.keys;
}

/** Test-only escape hatch — clears the module-level JWKS cache between cases. */
export function _resetJwksCacheForTests(): void {
  jwksCache = null;
}

export interface VerifiedOidcClaims {
  repository: string;
  sha: string;
}

export type VerifyIngestTokenResult =
  | { ok: true; claims: VerifiedOidcClaims }
  | { ok: false; status: 401; error: string };

interface OidcTokenPayload {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  repository?: unknown;
  repository_owner?: unknown;
  ref?: unknown;
  event_name?: unknown;
  job_workflow_ref?: unknown;
  sha?: unknown;
}

function base64UrlDecode(segment: string): Buffer {
  return Buffer.from(segment, "base64url");
}

function reject(error: string): VerifyIngestTokenResult {
  return { ok: false, status: 401, error };
}

/**
 * Verifies the `Authorization: Bearer <token>` header on an ingest request
 * against GitHub Actions OIDC. Returns the two claims the ingest route
 * actually needs (`repository`, `sha`) or a rejection with a human-readable
 * reason (safe to log; this is GitHub's own trusted CI on the other end, not
 * a public prober, so specificity here is not an enumeration concern the way
 * `(public)/site/[slug]`'s own responses are).
 *
 * Steps, in order, per Phase 3's API Contract:
 *   1. Split and base64url-decode the JWT's three segments.
 *   2. Look up the signing key by the header's `kid` against GitHub's JWKS.
 *   3. Verify the signature — hardcoded RSA-SHA256, see module header.
 *   4. Check `exp`, `iss`, `aud` (against `SITES_INGEST_OIDC_AUDIENCE`),
 *      `repository_owner` (against `GITHUB_SITES_ORG`), `ref ===
 *      "refs/heads/main"`, `event_name` (only if present — some OIDC claim
 *      sets omit it), and `job_workflow_ref` (prefix match against
 *      site-kit's own reusable workflow path, not an exact pin, so a new
 *      tagged site-kit release's workflow is accepted with no ingest
 *      redeploy).
 *   5. Return `repository`/`sha` straight from the VERIFIED payload — the
 *      commit sha is never taken from the request body (DECISION-087).
 */
export async function verifyGithubActionsOidcToken(
  authorizationHeader: string | null,
): Promise<VerifyIngestTokenResult> {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return reject("Missing or malformed Authorization header.");
  }
  const token = authorizationHeader.slice("Bearer ".length).trim();
  const parts = token.split(".");
  if (parts.length !== 3) {
    return reject("Malformed token.");
  }
  const [headerB64, payloadB64, signatureB64] = parts as [
    string,
    string,
    string,
  ];

  let header: { kid?: unknown };
  let payload: OidcTokenPayload;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf-8"));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf-8"));
  } catch {
    return reject("Malformed token.");
  }

  if (typeof header.kid !== "string" || header.kid.length === 0) {
    return reject("Token header is missing a key id.");
  }

  let keys: GithubJwk[];
  try {
    keys = await getJwks();
  } catch {
    return reject("Could not verify token — key discovery failed.");
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    return reject("Unknown signing key.");
  }

  let publicKey;
  try {
    publicKey = createPublicKey({
      key: jwk as unknown as Record<string, unknown>,
      format: "jwk",
    });
  } catch {
    return reject("Could not construct a verification key from the JWKS entry.");
  }

  let signatureValid = false;
  try {
    // ALWAYS "RSA-SHA256" — see the module header. Never read from
    // header.alg or payload.alg.
    signatureValid = cryptoVerify(
      "RSA-SHA256",
      Buffer.from(`${headerB64}.${payloadB64}`),
      publicKey,
      base64UrlDecode(signatureB64),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return reject("Signature verification failed.");
  }

  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) {
    return reject("Token has expired.");
  }
  if (payload.iss !== ISSUER) {
    return reject("Unexpected issuer.");
  }

  const audience = process.env.SITES_INGEST_OIDC_AUDIENCE;
  if (!audience || payload.aud !== audience) {
    return reject("Unexpected audience.");
  }

  const sitesOrg = process.env.GITHUB_SITES_ORG;
  if (!sitesOrg || payload.repository_owner !== sitesOrg) {
    return reject("Unexpected repository owner.");
  }

  if (payload.ref !== "refs/heads/main") {
    return reject("Token was not minted for a push to main.");
  }
  // event_name is checked only when present — some OIDC claim sets omit it,
  // per Phase 3's own "and, where present, event_name === 'push'" wording.
  if (payload.event_name !== undefined && payload.event_name !== "push") {
    return reject("Token was not minted for a push event.");
  }

  const expectedWorkflowPrefix = `${sitesOrg}/presby-site-kit/.github/workflows/`;
  if (
    typeof payload.job_workflow_ref !== "string" ||
    !payload.job_workflow_ref.startsWith(expectedWorkflowPrefix)
  ) {
    return reject(
      "Token was not minted by presby-site-kit's own reusable workflow.",
    );
  }

  if (typeof payload.repository !== "string" || payload.repository.length === 0) {
    return reject("Token is missing a repository claim.");
  }
  if (typeof payload.sha !== "string" || payload.sha.length === 0) {
    return reject("Token is missing a commit sha claim.");
  }

  return {
    ok: true,
    claims: { repository: payload.repository, sha: payload.sha },
  };
}
