/**
 * Shared test harness for the site-ingest routes (site-ingest-size,
 * DECISION-279): the real-JWT-signing and JWKS-stub half that `route.test.ts`
 * used to inline, and the real-Postgres fixture half (flag flip, fixture orgs
 * with a provisioned `organization_sites` row, teardown), extracted once so the
 * four route tests and `staged-flow.test.ts` share them.
 *
 * It calls no blob-store method (audience-callsites.test.ts excludes
 * `src/lib/testing/`, and none is needed). Every import of `@/lib/db` and
 * friends is DYNAMIC, inside the functions, for the reason each DB-backed
 * suite documents: a top-level import would reach the pool's module-scope
 * construction before `hasDb` is known.
 *
 * NO REAL DATA: owner/repo strings, keys and orgs are synthetic; all fixture
 * organizations carry `deletable_until` (drizzle/0044).
 */
import { generateKeyPairSync, sign as cryptoSign, createHash, type KeyObject } from "node:crypto";
import { vi } from "vitest";
import { eq } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";

export const OIDC_ISSUER = "https://token.actions.githubusercontent.com";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export interface TokenSignerConfig {
  audience: string;
  /** The GitHub "owner" every fixture repository lives under. */
  sitesOrg: string;
  kid: string;
  /** The `repository` claim a token carries unless a test overrides it. */
  defaultRepo: string;
  defaultSha: string;
}

export interface TokenSigner {
  /** A genuinely RS256-signed GitHub-shaped OIDC token. */
  signToken(payloadOverrides?: Record<string, unknown>, opts?: { headerOverrides?: Record<string, unknown> }): string;
  /** Stub the global `fetch` so the verifier's JWKS request returns this signer's public key. */
  stubJwksFetch(keys?: Record<string, unknown>[]): void;
  /** Stub the env the verifier reads. Call from `beforeEach` (with `stubJwksFetch`). */
  stubEnv(): void;
  jwk: Record<string, unknown>;
}

/** Mirrors sites-ingest-auth.test.ts's signToken() exactly; a fresh RSA keypair per signer. */
export function createTokenSigner(cfg: TokenSignerConfig): TokenSigner {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKey: KeyObject = pair.privateKey;
  const exported = pair.publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  const jwk = { ...exported, kid: cfg.kid, alg: "RS256", use: "sig" };

  function signToken(payloadOverrides: Record<string, unknown> = {}, opts: { headerOverrides?: Record<string, unknown> } = {}): string {
    const header = { alg: "RS256", typ: "JWT", kid: cfg.kid, ...opts.headerOverrides };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: OIDC_ISSUER,
      aud: cfg.audience,
      exp: now + 300,
      iat: now,
      repository_owner: cfg.sitesOrg,
      repository: cfg.defaultRepo,
      ref: "refs/heads/main",
      event_name: "push",
      job_workflow_ref: `${cfg.sitesOrg}/presby-site-kit/.github/workflows/ingest.yml@refs/tags/v1.0.0`,
      sha: cfg.defaultSha,
      ...payloadOverrides,
    };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
    const signature = cryptoSign("RSA-SHA256", Buffer.from(signingInput), privateKey);
    return `${signingInput}.${base64url(signature)}`;
  }

  function stubJwksFetch(keys: Record<string, unknown>[] = [jwk]): void {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ keys }) }));
  }

  function stubEnv(): void {
    vi.stubEnv("SITES_INGEST_OIDC_AUDIENCE", cfg.audience);
    vi.stubEnv("GITHUB_SITES_ORG", cfg.sitesOrg);
  }

  return { signToken, stubJwksFetch, stubEnv, jwk };
}

/** A synthetic image: the magic bytes plus deterministic filler of exactly `size` bytes. */
export function syntheticImage(kind: "png" | "jpeg" | "webp", size: number, seed: string): Buffer {
  const magic =
    kind === "png"
      ? Buffer.from("89504e470d0a1a0a", "hex")
      : kind === "jpeg"
        ? Buffer.from([0xff, 0xd8, 0xff, 0xe0])
        : Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);
  if (size < magic.byteLength) throw new Error(`syntheticImage: size ${size} is smaller than the ${kind} signature`);
  const out = Buffer.alloc(size);
  magic.copy(out);
  // xorshift-ish filler, seeded from the seed string: distinct seeds give distinct bytes
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0) || 1;
  for (let i = magic.byteLength; i < size; i++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out[i] = state & 0xff;
  }
  return out;
}

export const sha256Of = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

// ---------------------------------------------------------------------------
// Real-Postgres fixtures
// ---------------------------------------------------------------------------

/** Flip `sites.public_render` on; returns the function that restores the original value. */
export async function enableSitesPublicRender(): Promise<() => Promise<void>> {
  const { db, getPlatformDb } = await import("@/lib/db");
  const { featureFlags } = await import("@/lib/db/schema");
  const existing = await db.query.featureFlags.findFirst({ where: eq(featureFlags.key, "sites.public_render") });
  const original = existing?.enabled ?? false;
  // getPlatformDb(), not db: drizzle/0048 section 2 (B-H3) revokes INSERT on
  // feature_flags from presby_app - a flag is CREATED by the seeder on the owner
  // connection, never by a tenant request.
  await getPlatformDb()
    .insert(featureFlags)
    .values({ key: "sites.public_render", enabled: true })
    .onConflictDoUpdate({ target: featureFlags.key, set: { enabled: true } });
  return async () => {
    await db.update(featureFlags).set({ enabled: original }).where(eq(featureFlags.key, "sites.public_render"));
  };
}

/** Sets the flag to an explicit value (for the 503 tests); returns nothing to restore - the suite's own restore handles it. */
export async function setSitesPublicRender(enabled: boolean): Promise<void> {
  const { getPlatformDb } = await import("@/lib/db");
  const { featureFlags } = await import("@/lib/db/schema");
  await getPlatformDb()
    .insert(featureFlags)
    .values({ key: "sites.public_render", enabled })
    .onConflictDoUpdate({ target: featureFlags.key, set: { enabled } });
}

export interface FixtureSite {
  id: string;
  slug: string;
  repo: string;
}

export interface IngestFixtures {
  granterId: string;
  /** A congregation with a provisioned (status 'provisioning') site whose repo is `repo`. */
  makeSite(label: string, repo: string, opts?: { suspended?: boolean }): Promise<FixtureSite>;
  /** Delete the fixture audit rows, orgs (cascading sites and blobs) and the granter. */
  teardown(): Promise<void>;
}

/** One granting user plus any number of fixture sites; `prefix` namespaces slugs, paths and the email. */
export async function createIngestFixtures(prefix: string, stamp: number): Promise<IngestFixtures> {
  const { getPlatformDb } = await import("@/lib/db");
  const { organizations } = await import("@/lib/db/domain/org");
  const { users } = await import("@/lib/db/schema");
  const { provisionSite, setSiteStatus } = await import("@/lib/sites");
  const platform = getPlatformDb();

  const [userRow] = await platform
    .insert(users)
    .values({ email: `${prefix}-granter-${stamp}@example.invalid`, name: `${prefix} granter` })
    .returning({ id: users.id });
  const granterId = userRow!.id;
  const orgIds: string[] = [];

  return {
    granterId,
    async makeSite(label, repo, opts = {}) {
      const slug = `${prefix}-${label}-${stamp}`;
      const [row] = await platform
        .insert(organizations)
        .values({
          // Fixture teardown window - drizzle/0044's BEFORE DELETE guard.
          deletableUntil: fixtureDeletableUntil(),
          organizationType: "congregation",
          name: `Fixture Congregation ${label} for ${prefix}`,
          slug,
          path: `${prefix.replace(/-/g, "_")}_${label}_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id, slug: organizations.slug });
      orgIds.push(row!.id);
      const provisioned = await provisionSite(row!.id, repo, granterId);
      if (provisioned.kind !== "ok") throw new Error(`fixture provisionSite failed: ${JSON.stringify(provisioned)}`);
      if (opts.suspended) {
        const suspended = await setSiteStatus(row!.id, "suspended", granterId);
        if (suspended.kind !== "ok") throw new Error(`fixture setSiteStatus failed: ${JSON.stringify(suspended)}`);
      }
      return { id: row!.id, slug: row!.slug, repo };
    },
    async teardown() {
      const { auditEvents } = await import("@/lib/db/schema");
      // audit_events.resourceId is plain text, not FK-linked to organizations -
      // deleting the fixture orgs does NOT cascade here.
      for (const id of orgIds) await platform.delete(auditEvents).where(eq(auditEvents.resourceId, id));
      // organizations ON DELETE CASCADEs down through organization_sites and blob_assets.
      for (const id of orgIds) await platform.delete(organizations).where(eq(organizations.id, id));
      await platform.delete(users).where(eq(users.id, granterId));
    },
  };
}
