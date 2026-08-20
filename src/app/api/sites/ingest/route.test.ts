/**
 * Integration tests for `POST /api/sites/ingest` — the OIDC-authenticated
 * ingest route handler. Closes qa's Phase 5 coverage gap #1
 * (docs/work-log/2026-08-20-public-sites.md, loop-back to Phase 4): 266
 * lines of real orchestration (OIDC verify -> sites.public_render flag check
 * -> org resolution by repo -> idempotency short-circuit -> bundle-shape
 * validation -> per-image magic-byte sniffing -> blob storage ->
 * recordSiteIngest -> audit write -> dual revalidation) were previously
 * exercised only in pieces — `sites-ingest-auth.test.ts` for the OIDC
 * primitive, `sites.test.ts` for the `sites.ts` primitives — never as a
 * whole, through the real HTTP entry point a GitHub Actions workflow
 * actually calls.
 *
 * Combines both existing harnesses, per this task's own instruction:
 *   - Real-JWT-signing + JWKS-stub, from `sites-ingest-auth.test.ts`: a real
 *     RSA keypair (node:crypto generateKeyPairSync), hand-built and
 *     genuinely-signed JWTs (manual base64url header/payload + crypto.sign),
 *     a stubbed global fetch serving the public key as a JWK in place of
 *     GitHub's real JWKS endpoint. No JWT library (DECISION-087).
 *   - Real-Postgres fixture/cleanup, from `sites.test.ts`: the `hasDb`
 *     skip-guard, dynamic imports inside `beforeAll` (a static top-level
 *     import of `./route` would reach `@/lib/sites`' -> `@/lib/db`'s
 *     module-scope pool construction before DATABASE_URL is confirmed set),
 *     self-contained fixture orgs (own slugs/repos, stamped with Date.now()),
 *     thorough `afterAll` cleanup — deliberately NOT touching
 *     `scripts/seed-dev.sql`'s committed Alder Creek fixture row.
 *
 * `POST` is imported and called directly as a plain function against a real
 * `Request` — Next.js route handlers require no server/router scaffolding to
 * exercise this way.
 *
 * `next/cache`'s `revalidatePath` is mocked (`vi.hoisted` + `vi.mock`, the
 * exact pattern `admin/organizations/[id]/actions.test.ts` already
 * establishes) — it has no effect outside a real Next.js request context, so
 * calling the real implementation here would either throw or silently no-op;
 * mocking it is also the only way to assert the route calls it with the
 * right paths.
 *
 * Run against real Postgres with:
 *   dotenv -e .env.local -- npx vitest run src/app/api/sites/ingest/route.test.ts
 * Skipped (not failed) when DATABASE_URL/PLATFORM_DATABASE_URL are unset —
 * exactly like every other Postgres-backed suite in this codebase.
 */

vi.mock("server-only", () => ({}));

// The route always calls recordAudit({ actor: null, ... }) — auth() itself is
// never invoked — but src/lib/audit.ts still imports @/auth (-> next-auth) at
// MODULE SCOPE, and next-auth's own module graph fails to resolve under
// vitest's resolver (a "next/server" vs "next/server.js" mismatch, unrelated
// to this feature). Every other test file that transitively imports
// src/lib/audit.ts for real (e.g. admin/organizations/[id]/actions.test.ts)
// mocks @/auth for exactly this reason. recordAudit(), the DB write it
// performs, and AUDIT_ACTIONS all stay REAL here — only the unused auth()
// import is stubbed.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "https://presby.example.invalid/sites-ingest-route-test";
const SITES_ORG = "presby-ingest-route-test-org";
const KID = "ingest-route-test-key-1";

const stamp = Date.now();
const orgHappyRepo = `${SITES_ORG}/site-ingest-route-happy-${stamp}`;
const orgSuspendedRepo = `${SITES_ORG}/site-ingest-route-suspended-${stamp}`;
const neverProvisionedRepo = `${SITES_ORG}/site-ingest-route-never-provisioned-${stamp}`;

// A minimal 8-byte PNG magic-number signature — enough for
// sniffTicketAttachmentContentType() to recognize "image/png"; the route
// never validates the rest of the file, only the magic bytes.
const PNG_MAGIC_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PNG_MAGIC_BYTES_BASE64 = PNG_MAGIC_BYTES.toString("base64");

describe.skipIf(!hasDb)(
  "POST /api/sites/ingest (real Postgres + real OIDC verification)",
  () => {
    let POST: typeof import("./route").POST;
    let db: typeof import("@/lib/db").db;
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let organizations: typeof import("@/lib/db/domain/org").organizations;
    let organizationSites: typeof import("@/lib/db/domain/sites").organizationSites;
    let blobAssets: typeof import("@/lib/db/domain/assets").blobAssets;
    let auditEvents: typeof import("@/lib/db/schema").auditEvents;
    let featureFlags: typeof import("@/lib/db/schema").featureFlags;
    let users: typeof import("@/lib/db/schema").users;
    let provisionSite: typeof import("@/lib/sites").provisionSite;
    let setSiteStatus: typeof import("@/lib/sites").setSiteStatus;
    let getPublishedSite: typeof import("@/lib/sites").getPublishedSite;
    let _resetJwksCacheForTests: typeof import("@/lib/sites-ingest-auth")._resetJwksCacheForTests;

    let orgHappyId: string;
    let orgHappySlug: string;
    let orgSuspendedId: string;
    let grantingUserId: string;
    let originalPublicRenderEnabled: boolean;

    let publicKey: KeyObject;
    let privateKey: KeyObject;
    let jwk: Record<string, unknown>;

    function base64url(input: Buffer | string): string {
      return Buffer.from(input).toString("base64url");
    }

    /** Mirrors sites-ingest-auth.test.ts's signToken() exactly. */
    function signToken(
      payloadOverrides: Record<string, unknown> = {},
      opts: { headerOverrides?: Record<string, unknown> } = {},
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
        repository: orgHappyRepo,
        ref: "refs/heads/main",
        event_name: "push",
        job_workflow_ref: `${SITES_ORG}/presby-site-kit/.github/workflows/ingest.yml@refs/tags/v1.0.0`,
        sha: `sha-default-${stamp}`,
        ...payloadOverrides,
      };
      const headerB64 = base64url(JSON.stringify(header));
      const payloadB64 = base64url(JSON.stringify(payload));
      const signingInput = `${headerB64}.${payloadB64}`;
      const signature = cryptoSign(
        "RSA-SHA256",
        Buffer.from(signingInput),
        privateKey,
      );
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

    function ingestRequest(
      authHeader: string | null,
      rawBody?: string,
    ): Request {
      const headers = new Headers({ "content-type": "application/json" });
      if (authHeader !== null) headers.set("authorization", authHeader);
      return new Request("http://presby.example.invalid/api/sites/ingest", {
        method: "POST",
        headers,
        body: rawBody,
      });
    }

    function validBundleBody(overrides: {
      pages?: unknown;
      images?: unknown;
      schemaVersion?: unknown;
    } = {}): string {
      return JSON.stringify({
        bundle: {
          schemaVersion: overrides.schemaVersion ?? 1,
          pages: overrides.pages ?? [
            {
              path: "/",
              frontMatter: { title: "Fixture Home" },
              mdxAst: { type: "root", children: [] },
            },
          ],
          images: overrides.images ?? [
            {
              manifestKey: "hero",
              contentType: "image/png",
              bytesBase64: PNG_MAGIC_BYTES_BASE64,
            },
          ],
        },
      });
    }

    beforeAll(async () => {
      ({ POST } = await import("./route"));
      ({ db, getPlatformDb } = await import("@/lib/db"));
      ({ organizations } = await import("@/lib/db/domain/org"));
      ({ organizationSites } = await import("@/lib/db/domain/sites"));
      ({ blobAssets } = await import("@/lib/db/domain/assets"));
      ({ auditEvents, featureFlags, users } = await import("@/lib/db/schema"));
      ({ provisionSite, setSiteStatus, getPublishedSite } = await import(
        "@/lib/sites"
      ));
      ({ _resetJwksCacheForTests } = await import("@/lib/sites-ingest-auth"));

      const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
      publicKey = pair.publicKey;
      privateKey = pair.privateKey;
      const exported = publicKey.export({ format: "jwk" }) as Record<
        string,
        unknown
      >;
      jwk = { ...exported, kid: KID, alg: "RS256", use: "sig" };

      const platform = getPlatformDb();

      // --- sites.public_render: flip on for this suite, restore after -----
      const existingFlag = await db.query.featureFlags.findFirst({
        where: eq(featureFlags.key, "sites.public_render"),
      });
      originalPublicRenderEnabled = existingFlag?.enabled ?? false;
      await db
        .insert(featureFlags)
        .values({ key: "sites.public_render", enabled: true })
        .onConflictDoUpdate({
          target: featureFlags.key,
          set: { enabled: true },
        });

      const [userRow] = await platform
        .insert(users)
        .values({
          email: `sites-ingest-route-test-granter-${stamp}@example.invalid`,
          name: "Sites Ingest Route Test Granter",
        })
        .returning({ id: users.id });
      grantingUserId = userRow!.id;

      async function makeOrg(
        label: string,
      ): Promise<{ id: string; slug: string }> {
        const slug = `sites-ingest-route-test-${label}-${stamp}`;
        const [row] = await platform
          .insert(organizations)
          .values({
            organizationType: "congregation",
            name: `Fixture Congregation ${label} for sites/ingest route.test.ts`,
            slug,
            path: `sites_ingest_route_test_${label}_${stamp}`,
            platformStatus: "unmanaged",
          })
          .returning({ id: organizations.id, slug: organizations.slug });
        return { id: row!.id, slug: row!.slug };
      }

      const happy = await makeOrg("happy");
      orgHappyId = happy.id;
      orgHappySlug = happy.slug;
      const happyProvision = await provisionSite(
        orgHappyId,
        orgHappyRepo,
        grantingUserId,
      );
      expect(happyProvision).toEqual({ kind: "ok" });

      const suspended = await makeOrg("suspended");
      orgSuspendedId = suspended.id;
      const suspendedProvision = await provisionSite(
        orgSuspendedId,
        orgSuspendedRepo,
        grantingUserId,
      );
      expect(suspendedProvision).toEqual({ kind: "ok" });
      // Suspended directly from 'provisioning', with NO prior ingest — the
      // route handler's own first-ever ingest for this org is what test 9
      // exercises below, confirming it does not resurrect the site.
      const suspendResult = await setSiteStatus(
        orgSuspendedId,
        "suspended",
        grantingUserId,
      );
      expect(suspendResult).toEqual({ kind: "ok" });

      // neverProvisionedRepo: deliberately no organization_sites row at all,
      // and no organization created for it either — the 404 case only needs
      // a repository claim resolveOrganizationByRepo() cannot resolve, which
      // an org-less repo string already is.
    }, 30_000);

    afterAll(async () => {
      const platform = getPlatformDb();

      await db
        .update(featureFlags)
        .set({ enabled: originalPublicRenderEnabled })
        .where(eq(featureFlags.key, "sites.public_render"));

      // audit_events.resourceId is plain text, not FK-linked to
      // organizations — deleting the fixture orgs does NOT cascade here, so
      // clean it up explicitly before deleting the orgs themselves.
      for (const orgId of [orgHappyId, orgSuspendedId]) {
        if (!orgId) continue;
        await platform
          .delete(auditEvents)
          .where(eq(auditEvents.resourceId, orgId));
      }

      // organizations ON DELETE CASCADEs down through organization_sites and
      // blob_assets (both organizationId FKs declared cascade) — deleting
      // the two fixture orgs is sufficient, mirroring sites.test.ts's own
      // minimal afterAll.
      for (const orgId of [orgHappyId, orgSuspendedId]) {
        if (!orgId) continue;
        await platform.delete(organizations).where(eq(organizations.id, orgId));
      }
      if (grantingUserId) {
        await platform.delete(users).where(eq(users.id, grantingUserId));
      }
    });

    beforeEach(() => {
      vi.stubEnv("SITES_INGEST_OIDC_AUDIENCE", AUDIENCE);
      vi.stubEnv("GITHUB_SITES_ORG", SITES_ORG);
      stubJwksFetch();
      mockRevalidatePath.mockClear();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      _resetJwksCacheForTests();
    });

    // -----------------------------------------------------------------------
    // 1. 401 — missing/malformed Authorization header
    // -----------------------------------------------------------------------

    describe("401 — missing/malformed Authorization header", () => {
      it("no Authorization header at all", async () => {
        const res = await POST(ingestRequest(null, validBundleBody()));
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.status).toBe("error");
      });

      it("Authorization header present but not a Bearer token", async () => {
        const res = await POST(
          ingestRequest("Basic dXNlcjpwYXNz", validBundleBody()),
        );
        expect(res.status).toBe(401);
      });

      it("Bearer token that isn't a well-formed JWT", async () => {
        const res = await POST(
          ingestRequest("Bearer not.a.jwt.at.all", validBundleBody()),
        );
        expect(res.status).toBe(401);
      });
    });

    // -----------------------------------------------------------------------
    // 2. 401 — a genuinely-signed token that fails a claim check
    // -----------------------------------------------------------------------

    describe("401 — genuinely-signed token, failed claim checks", () => {
      it("wrong issuer", async () => {
        const token = signToken({ iss: "https://not-github.example.invalid" });
        const res = await POST(
          ingestRequest(`Bearer ${token}`, validBundleBody()),
        );
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toEqual(expect.stringContaining("issuer"));
      });

      it("wrong audience", async () => {
        const token = signToken({
          aud: "https://someone-elses-app.example.invalid",
        });
        const res = await POST(
          ingestRequest(`Bearer ${token}`, validBundleBody()),
        );
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toEqual(expect.stringContaining("audience"));
      });

      it("ref not refs/heads/main (a PR build's token)", async () => {
        const token = signToken({ ref: "refs/heads/some-feature-branch" });
        const res = await POST(
          ingestRequest(`Bearer ${token}`, validBundleBody()),
        );
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toEqual(expect.stringContaining("main"));
      });

      it("job_workflow_ref outside presby-site-kit's own reusable workflow", async () => {
        const token = signToken({
          job_workflow_ref: `${SITES_ORG}/site-ingest-route-happy-${stamp}/.github/workflows/ingest.yml@refs/heads/main`,
        });
        const res = await POST(
          ingestRequest(`Bearer ${token}`, validBundleBody()),
        );
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toEqual(expect.stringContaining("presby-site-kit"));
      });
    });

    // -----------------------------------------------------------------------
    // 3. 401 — a tampered signature
    // -----------------------------------------------------------------------

    describe("401 — tampered signature", () => {
      it("payload altered after signing (repository claim swapped)", async () => {
        const token = signToken({});
        const [headerB64, payloadB64, sigB64] = token.split(".");
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
            sha: `sha-tampered-${stamp}`,
          }),
        );
        const tampered = `${headerB64}.${tamperedPayload}.${sigB64}`;

        const res = await POST(
          ingestRequest(`Bearer ${tampered}`, validBundleBody()),
        );
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toEqual(expect.stringContaining("Signature"));
      });
    });

    // -----------------------------------------------------------------------
    // 4. 404 — valid, fully-verified token whose repository matches no row
    // -----------------------------------------------------------------------

    describe("404 — verified token, no matching organization_sites row", () => {
      it("a genuinely valid token for a repository that was never provisioned", async () => {
        const token = signToken({
          repository: neverProvisionedRepo,
          sha: `sha-never-provisioned-${stamp}`,
        });
        const res = await POST(
          ingestRequest(`Bearer ${token}`, validBundleBody()),
        );
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.status).toBe("error");
      });
    });

    // -----------------------------------------------------------------------
    // 5. 422 — malformed request body
    // -----------------------------------------------------------------------

    describe("422 — malformed request body", () => {
      it("request body is not valid JSON", async () => {
        const token = signToken({ sha: `sha-malformed-json-${stamp}` });
        const res = await POST(
          ingestRequest(`Bearer ${token}`, "not-valid-json-at-all"),
        );
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toEqual(expect.stringContaining("JSON"));
      });

      it("missing bundle entirely", async () => {
        const token = signToken({ sha: `sha-missing-bundle-${stamp}` });
        const res = await POST(
          ingestRequest(`Bearer ${token}`, JSON.stringify({})),
        );
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toEqual(expect.stringContaining("bundle"));
      });

      it("unsupported bundle.schemaVersion", async () => {
        const token = signToken({ sha: `sha-bad-schema-${stamp}` });
        const res = await POST(
          ingestRequest(
            `Bearer ${token}`,
            validBundleBody({ schemaVersion: 2 }),
          ),
        );
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toEqual(expect.stringContaining("schemaVersion"));
      });

      it("bundle.pages is an empty array", async () => {
        const token = signToken({ sha: `sha-empty-pages-${stamp}` });
        const res = await POST(
          ingestRequest(`Bearer ${token}`, validBundleBody({ pages: [] })),
        );
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toEqual(expect.stringContaining("pages"));
      });

      it("malformed entry in bundle.pages (missing frontMatter)", async () => {
        const token = signToken({ sha: `sha-bad-page-${stamp}` });
        const res = await POST(
          ingestRequest(
            `Bearer ${token}`,
            validBundleBody({
              pages: [{ path: "/", mdxAst: { type: "root", children: [] } }],
            }),
          ),
        );
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toEqual(expect.stringContaining("bundle.pages"));
      });

      it("bundle.images is not an array", async () => {
        const token = signToken({ sha: `sha-bad-images-shape-${stamp}` });
        const res = await POST(
          ingestRequest(
            `Bearer ${token}`,
            validBundleBody({ images: "not-an-array" }),
          ),
        );
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toEqual(expect.stringContaining("bundle.images"));
      });

      it("malformed entry in bundle.images (unsupported contentType)", async () => {
        const token = signToken({ sha: `sha-bad-image-entry-${stamp}` });
        const res = await POST(
          ingestRequest(
            `Bearer ${token}`,
            validBundleBody({
              images: [
                {
                  manifestKey: "hero",
                  contentType: "image/gif",
                  bytesBase64: PNG_MAGIC_BYTES_BASE64,
                },
              ],
            }),
          ),
        );
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toEqual(expect.stringContaining("bundle.images"));
      });
    });

    // -----------------------------------------------------------------------
    // 6. 422 — an image that fails magic-byte sniffing
    // -----------------------------------------------------------------------

    describe("422 — image fails magic-byte sniffing", () => {
      it("declared image/png but the bytes are not a PNG (or any recognized format)", async () => {
        const token = signToken({ sha: `sha-bad-image-bytes-${stamp}` });
        const notAnImage = Buffer.from("this is definitely not an image");
        const res = await POST(
          ingestRequest(
            `Bearer ${token}`,
            validBundleBody({
              images: [
                {
                  manifestKey: "hero",
                  contentType: "image/png",
                  bytesBase64: notAnImage.toString("base64"),
                },
              ],
            }),
          ),
        );
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toEqual(
          expect.stringContaining("not a PNG, JPEG, or WEBP"),
        );

        // No writes should have happened for this rejected image.
        const platform = getPlatformDb();
        const rows = await platform
          .select({ id: blobAssets.id })
          .from(blobAssets)
          .where(eq(blobAssets.organizationId, orgHappyId));
        expect(rows).toHaveLength(0);
      });
    });

    // -----------------------------------------------------------------------
    // 7. 200 — the full happy path
    // -----------------------------------------------------------------------

    describe("200 — full happy path", () => {
      const HAPPY_SHA = `sha-happy-${stamp}`;

      it("ingests a valid bundle: response shape, DB state, blob storage, audit event, and revalidatePath", async () => {
        const token = signToken({ sha: HAPPY_SHA });
        const res = await POST(
          ingestRequest(`Bearer ${token}`, validBundleBody()),
        );

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({
          status: "ingested",
          organizationSlug: orgHappySlug,
          commitSha: HAPPY_SHA,
          pageCount: 1,
        });

        const platform = getPlatformDb();

        // organization_sites — queried directly, per this task's own
        // instruction (DECISION-030's "no direct query" rule governs
        // application code, not test-only verification).
        const [siteRow] = await platform
          .select({
            status: organizationSites.status,
            lastIngestedCommitSha: organizationSites.lastIngestedCommitSha,
            lastIngestedAt: organizationSites.lastIngestedAt,
            contentBundleKey: organizationSites.contentBundleKey,
          })
          .from(organizationSites)
          .where(eq(organizationSites.organizationId, orgHappyId));
        expect(siteRow?.status).toBe("live");
        expect(siteRow?.lastIngestedCommitSha).toBe(HAPPY_SHA);
        expect(siteRow?.lastIngestedAt).toBeInstanceOf(Date);
        expect(siteRow?.contentBundleKey).toBeTruthy();

        // blob_assets — queried directly: one image row (sniffed
        // image/png) and one composed-bundle JSON row.
        const blobRows = await platform
          .select({
            id: blobAssets.id,
            contentType: blobAssets.contentType,
          })
          .from(blobAssets)
          .where(eq(blobAssets.organizationId, orgHappyId));
        expect(blobRows).toHaveLength(2);
        expect(blobRows.map((r) => r.contentType).sort()).toEqual([
          "application/json",
          "image/png",
        ]);
        const jsonBlob = blobRows.find(
          (r) => r.contentType === "application/json",
        );
        expect(jsonBlob?.id).toBe(siteRow?.contentBundleKey);

        // audit_events — queried directly.
        const [auditRow] = await platform
          .select({
            actorUserId: auditEvents.actorUserId,
            actorEmail: auditEvents.actorEmail,
            action: auditEvents.action,
            resourceType: auditEvents.resourceType,
            resourceId: auditEvents.resourceId,
            metadata: auditEvents.metadata,
          })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.resourceId, orgHappyId),
              eq(auditEvents.action, "site.content_ingested"),
            ),
          );
        expect(auditRow).toBeDefined();
        expect(auditRow?.actorUserId).toBeNull();
        expect(auditRow?.actorEmail).toBeNull();
        expect(auditRow?.resourceType).toBe("organization");
        expect(auditRow?.metadata).toEqual({
          repo: orgHappyRepo,
          commitSha: HAPPY_SHA,
          pageCount: 1,
          imageCount: 1,
        });

        // revalidatePath — layout-level plus the one page path ("/" maps to
        // the bare slug, per the route's own path-join rule).
        expect(mockRevalidatePath).toHaveBeenCalledWith(
          `/site/${orgHappySlug}`,
          "layout",
        );
        expect(mockRevalidatePath).toHaveBeenCalledWith(
          `/site/${orgHappySlug}`,
        );
        expect(mockRevalidatePath).toHaveBeenCalledTimes(2);
      });
    });

    // -----------------------------------------------------------------------
    // 8. 200 — idempotency
    // -----------------------------------------------------------------------

    describe("200 — idempotency (repeat commit sha)", () => {
      it("a second ingest with the same commit sha returns already_current and writes nothing new", async () => {
        const platform = getPlatformDb();

        const [siteBefore] = await platform
          .select({
            lastIngestedAt: organizationSites.lastIngestedAt,
            contentBundleKey: organizationSites.contentBundleKey,
          })
          .from(organizationSites)
          .where(eq(organizationSites.organizationId, orgHappyId));

        const blobCountBefore = (
          await platform
            .select({ id: blobAssets.id })
            .from(blobAssets)
            .where(eq(blobAssets.organizationId, orgHappyId))
        ).length;
        const auditCountBefore = (
          await platform
            .select({ id: auditEvents.id })
            .from(auditEvents)
            .where(
              and(
                eq(auditEvents.resourceId, orgHappyId),
                eq(auditEvents.action, "site.content_ingested"),
              ),
            )
        ).length;

        // Same commit sha as the happy-path test above (item 7) — the
        // fixture org's own lastIngestedCommitSha is already "sha-happy-<stamp>".
        const HAPPY_SHA = `sha-happy-${stamp}`;
        const token = signToken({ sha: HAPPY_SHA });
        const res = await POST(
          ingestRequest(`Bearer ${token}`, validBundleBody()),
        );

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({
          status: "already_current",
          organizationSlug: orgHappySlug,
          commitSha: HAPPY_SHA,
        });

        const [siteAfter] = await platform
          .select({
            lastIngestedAt: organizationSites.lastIngestedAt,
            contentBundleKey: organizationSites.contentBundleKey,
          })
          .from(organizationSites)
          .where(eq(organizationSites.organizationId, orgHappyId));
        expect(siteAfter?.lastIngestedAt?.getTime()).toBe(
          siteBefore?.lastIngestedAt?.getTime(),
        );
        expect(siteAfter?.contentBundleKey).toBe(siteBefore?.contentBundleKey);

        const blobCountAfter = (
          await platform
            .select({ id: blobAssets.id })
            .from(blobAssets)
            .where(eq(blobAssets.organizationId, orgHappyId))
        ).length;
        expect(blobCountAfter).toBe(blobCountBefore);

        const auditCountAfter = (
          await platform
            .select({ id: auditEvents.id })
            .from(auditEvents)
            .where(
              and(
                eq(auditEvents.resourceId, orgHappyId),
                eq(auditEvents.action, "site.content_ingested"),
              ),
            )
        ).length;
        expect(auditCountAfter).toBe(auditCountBefore);

        expect(mockRevalidatePath).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------------
    // 9. Suspended-status interaction
    // -----------------------------------------------------------------------

    describe("suspended-status interaction", () => {
      it("a genuinely valid ingest still succeeds (200) but the org's status stays 'suspended'", async () => {
        const SUSPENDED_SHA = `sha-suspended-first-${stamp}`;
        const token = signToken({
          repository: orgSuspendedRepo,
          sha: SUSPENDED_SHA,
        });
        const res = await POST(
          ingestRequest(`Bearer ${token}`, validBundleBody()),
        );

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe("ingested");

        const platform = getPlatformDb();
        const [siteRow] = await platform
          .select({
            status: organizationSites.status,
            lastIngestedCommitSha: organizationSites.lastIngestedCommitSha,
            contentBundleKey: organizationSites.contentBundleKey,
          })
          .from(organizationSites)
          .where(eq(organizationSites.organizationId, orgSuspendedId));

        // The status the admin set BEFORE any ingest ever ran must survive
        // this — the route-level confirmation of recordSiteIngest's own
        // "never resurrects a suspended site" fix, exercised through the
        // real HTTP entry point rather than the sites.ts primitive directly.
        expect(siteRow?.status).toBe("suspended");
        // Content metadata still advances — only visibility stays
        // admin-controlled.
        expect(siteRow?.lastIngestedCommitSha).toBe(SUSPENDED_SHA);
        expect(siteRow?.contentBundleKey).toBeTruthy();

        // And the public read stays exactly as unreachable as any other
        // non-live reason.
        const published = await getPublishedSite(
          `sites-ingest-route-test-suspended-${stamp}`,
        );
        expect(published).toEqual({ kind: "not_found" });
      });
    });
  },
);
