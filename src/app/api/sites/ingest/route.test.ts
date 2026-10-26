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
import {
  createIngestFixtures,
  createTokenSigner,
  enableSitesPublicRender,
  OIDC_ISSUER,
  type IngestFixtures,
  type TokenSigner,
} from "@/lib/testing/site-ingest-harness";

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

const ISSUER = OIDC_ISSUER;
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
    let organizationSites: typeof import("@/lib/db/domain/sites").organizationSites;
    let blobAssets: typeof import("@/lib/db/domain/assets").blobAssets;
    let auditEvents: typeof import("@/lib/db/schema").auditEvents;
    let getPublishedSite: typeof import("@/lib/sites").getPublishedSite;
    let _resetJwksCacheForTests: typeof import("@/lib/sites-ingest-auth")._resetJwksCacheForTests;

    let orgHappyId: string;
    let orgHappySlug: string;
    let orgSuspendedId: string;
    let restorePublicRender: () => Promise<void>;
    let fixtures: IngestFixtures;
    let signer: TokenSigner;

    function base64url(input: Buffer | string): string {
      return Buffer.from(input).toString("base64url");
    }

    // The signing and JWKS-stub plumbing lives in the shared harness
    // (src/lib/testing/site-ingest-harness.ts), used by all four ingest route tests.
    const signToken: TokenSigner["signToken"] = (overrides, opts) => signer.signToken(overrides, opts);
    const stubJwksFetch = (keys?: Record<string, unknown>[]) => signer.stubJwksFetch(keys);

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
      ({ organizationSites } = await import("@/lib/db/domain/sites"));
      ({ blobAssets } = await import("@/lib/db/domain/assets"));
      ({ auditEvents } = await import("@/lib/db/schema"));
      ({ getPublishedSite } = await import("@/lib/sites"));
      ({ _resetJwksCacheForTests } = await import("@/lib/sites-ingest-auth"));

      signer = createTokenSigner({
        audience: AUDIENCE,
        sitesOrg: SITES_ORG,
        kid: KID,
        defaultRepo: orgHappyRepo,
        defaultSha: `sha-default-${stamp}`,
      });

      // sites.public_render: on for this suite, restored after.
      restorePublicRender = await enableSitesPublicRender();
      fixtures = await createIngestFixtures("sites-ingest-route-test", stamp);

      const happy = await fixtures.makeSite("happy", orgHappyRepo);
      orgHappyId = happy.id;
      orgHappySlug = happy.slug;

      // Suspended directly from 'provisioning', with NO prior ingest - the
      // route handler's own first-ever ingest for this org is what test 9
      // exercises below, confirming it does not resurrect the site.
      const suspended = await fixtures.makeSite("suspended", orgSuspendedRepo, { suspended: true });
      orgSuspendedId = suspended.id;

      // neverProvisionedRepo: deliberately no organization_sites row at all,
      // and no organization created for it either - the 404 case only needs
      // a repository claim resolveOrganizationByRepo() cannot resolve, which
      // an org-less repo string already is.
    }, 30_000);

    afterAll(async () => {
      await restorePublicRender?.();
      await fixtures?.teardown();
    });

    beforeEach(() => {
      signer.stubEnv();
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

      // Online giving (Batch 4): PresbyPortal serves its own /give and /give/return,
      // and a static segment beats the catch-all that renders bundle pages - a bundle
      // page there would be stored and never shown. Refused by name instead.
      it.each(["/give", "/give/return", "/Give/", "/give/anything/deeper"])(
        "a bundle page at %s is refused as reserved, naming the page, and nothing is stored",
        async (reservedPath) => {
          const token = signToken({ sha: `sha-reserved-${reservedPath.replace(/\W/g, "")}-${stamp}` });
          const res = await POST(
            ingestRequest(
              `Bearer ${token}`,
              validBundleBody({
                pages: [
                  { path: "/", frontMatter: { title: "Home" }, mdxAst: { type: "root", children: [] } },
                  { path: reservedPath, frontMatter: { title: "Give" }, mdxAst: { type: "root", children: [] } },
                ],
              }),
            ),
          );
          expect(res.status).toBe(422);
          const body = await res.json();
          expect(body.status).toBe("error");
          expect(body.error).toEqual(expect.stringContaining("reserved"));
          expect(body.error).toEqual(expect.stringContaining(reservedPath));
          expect(body.error).toEqual(expect.stringContaining("/give"));
          expect(mockRevalidatePath).not.toHaveBeenCalled();
        },
      );

      // Track F (T15): a church's own domain serves the asset route, robots.txt and
      // sitemap.xml at the ROOT, where each is a static route that shadows a bundle page.
      it.each([
        ["/assets/hero", "assets"],
        ["/robots.txt", "robots.txt"],
        ["/sitemap.xml", "sitemap.xml"],
      ])(
        "a bundle page at %s is refused as reserved (/%s), and nothing is stored",
        async (reservedPath, segment) => {
          const token = signToken({ sha: `sha-reserved-t15-${segment.replace(/\W/g, "")}-${stamp}` });
          const res = await POST(
            ingestRequest(
              `Bearer ${token}`,
              validBundleBody({
                pages: [
                  { path: "/", frontMatter: { title: "Home" }, mdxAst: { type: "root", children: [] } },
                  { path: reservedPath, frontMatter: { title: "X" }, mdxAst: { type: "root", children: [] } },
                ],
              }),
            ),
          );
          expect(res.status).toBe(422);
          const body = await res.json();
          expect(body.error).toEqual(expect.stringContaining("reserved"));
          expect(body.error).toEqual(expect.stringContaining(`/${segment}`));
          expect(mockRevalidatePath).not.toHaveBeenCalled();
        },
      );
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
            audience: blobAssets.audience,
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

        // F289 (DECISION-277): the published IMAGE is public_site; the bundle
        // JSON (read only server-side) is private.
        expect(jsonBlob?.audience).toBe("private");
        expect(blobRows.find((r) => r.contentType === "image/png")?.audience).toBe("public_site");

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
          transport: "legacy",
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

    // -----------------------------------------------------------------------
    // 10. site-ingest-size (DECISION-279): the 4,000,000-byte request limit, the
    //     image-count bound, the `code` on every error, and byte-identical images
    // -----------------------------------------------------------------------

    describe("site-ingest-size - the request limit and the shared gate (LG-2..LG-8)", () => {
      /** A JSON object body of EXACTLY `total` bytes: {"pad":"aaaa..."} (ASCII only). */
      function paddedBody(total: number): string {
        const frame = '{"pad":""}'.length;
        return `{"pad":"${"a".repeat(total - frame)}"}`;
      }

      function rawRequest(authHeader: string | null, body: string, extra: Record<string, string> = {}): Request {
        const headers = new Headers({ "content-type": "application/json", ...extra });
        if (authHeader !== null) headers.set("authorization", authHeader);
        return new Request("http://presby.example.invalid/api/sites/ingest", { method: "POST", headers, body });
      }

      it("LG-2: a body of 4,000,001 bytes with a valid token is 413 request_too_large (counted, no declared length)", async () => {
        const token = signToken({ sha: `sha-lg2-${stamp}` });
        const res = await POST(rawRequest(`Bearer ${token}`, paddedBody(4_000_001)));
        expect(res.status).toBe(413);
        expect(await res.json()).toEqual({
          status: "error",
          code: "request_too_large",
          error: "Request body is larger than 4,000,000 bytes.",
        });
      });

      it("LG-2: a declared Content-Length over the limit is refused the same way", async () => {
        const token = signToken({ sha: `sha-lg2b-${stamp}` });
        const res = await POST(rawRequest(`Bearer ${token}`, paddedBody(4_000_001), { "content-length": "4000001" }));
        expect(res.status).toBe(413);
        expect((await res.json()).code).toBe("request_too_large");
      });

      it("LG-3: the same oversize body with no token, or a bad one, is 401 - not 413", async () => {
        const big = paddedBody(4_000_001);
        const none = await POST(rawRequest(null, big, { "content-length": "4000001" }));
        expect(none.status).toBe(401);
        const bad = await POST(rawRequest("Bearer not.a.jwt.at.all", big));
        expect(bad.status).toBe(401);
      });

      it("LG-4: a body of exactly 4,000,000 bytes passes the size gate (and fails validation, not size)", async () => {
        const token = signToken({ sha: `sha-lg4-${stamp}` });
        const body = paddedBody(4_000_000);
        expect(Buffer.byteLength(body)).toBe(4_000_000);
        const res = await POST(rawRequest(`Bearer ${token}`, body));
        expect(res.status).toBe(422);
        expect(await res.json()).toMatchObject({ code: "invalid_request", error: "Missing bundle." });
      });

      it("LG-5: 2,001 images are refused 422 invalid_request before anything is stored", async () => {
        const platform = getPlatformDb();
        const countBlobs = async () =>
          (await platform.select({ id: blobAssets.id }).from(blobAssets).where(eq(blobAssets.organizationId, orgHappyId))).length;
        const before = await countBlobs();

        const images = (n: number) =>
          Array.from({ length: n }, (_, i) => ({ manifestKey: `k${i}`, contentType: "image/png", bytesBase64: PNG_MAGIC_BYTES_BASE64 }));
        const token = signToken({ sha: `sha-lg5-${stamp}` });
        const res = await POST(ingestRequest(`Bearer ${token}`, validBundleBody({ images: images(2001) })));
        expect(res.status).toBe(422);
        expect(await res.json()).toEqual({
          status: "error",
          code: "invalid_request",
          error: "bundle.images has more than 2000 entries.",
        });
        expect(await countBlobs()).toBe(before);
        expect(mockRevalidatePath).not.toHaveBeenCalled();
      });

      it("LG-6: every error body carries { status, code, error } with the right code", async () => {
        const cases: Array<[string, Request, number, string]> = [
          ["unauthorized", ingestRequest(null, validBundleBody()), 401, "unauthorized"],
          [
            "site_not_provisioned",
            ingestRequest(`Bearer ${signToken({ repository: neverProvisionedRepo, sha: `sha-lg6a-${stamp}` })}`, validBundleBody()),
            404,
            "site_not_provisioned",
          ],
          ["invalid_json", ingestRequest(`Bearer ${signToken({ sha: `sha-lg6b-${stamp}` })}`, "{nope"), 422, "invalid_json"],
          [
            "invalid_request",
            ingestRequest(`Bearer ${signToken({ sha: `sha-lg6c-${stamp}` })}`, JSON.stringify({})),
            422,
            "invalid_request",
          ],
          [
            "reserved_page",
            ingestRequest(
              `Bearer ${signToken({ sha: `sha-lg6d-${stamp}` })}`,
              validBundleBody({ pages: [{ path: "/give", frontMatter: {}, mdxAst: {} }] }),
            ),
            422,
            "reserved_page",
          ],
          [
            "not_an_image",
            ingestRequest(
              `Bearer ${signToken({ sha: `sha-lg6e-${stamp}` })}`,
              validBundleBody({
                images: [{ manifestKey: "x", contentType: "image/png", bytesBase64: Buffer.from("not an image").toString("base64") }],
              }),
            ),
            422,
            "not_an_image",
          ],
        ];
        for (const [name, request, status, code] of cases) {
          const res = await POST(request);
          expect(res.status, name).toBe(status);
          const body = await res.json();
          expect(Object.keys(body).sort(), name).toEqual(["code", "error", "status"]);
          expect(body.status).toBe("error");
          expect(body.code, name).toBe(code);
          expect(typeof body.error).toBe("string");
        }
      });

      it("LG-6: sites.public_render off is 503 ingest_disabled on the legacy route too", async () => {
        const { setSitesPublicRender } = await import("@/lib/testing/site-ingest-harness");
        await setSitesPublicRender(false);
        try {
          const res = await POST(ingestRequest(`Bearer ${signToken({ sha: `sha-lg6f-${stamp}` })}`, validBundleBody()));
          expect(res.status).toBe(503);
          expect(await res.json()).toEqual({ status: "error", code: "ingest_disabled", error: "Site ingest is currently disabled." });
        } finally {
          await setSitesPublicRender(true);
        }
      });

      it("LG-7: two manifest keys with identical bytes make one image row and two imageKeys that share it", async () => {
        const site = await fixtures.makeSite("lg7", `${SITES_ORG}/site-ingest-route-lg7-${stamp}`);
        const bytes = Buffer.concat([PNG_MAGIC_BYTES, Buffer.from(`lg7 ${stamp}`)]);
        const b64 = bytes.toString("base64");
        const token = signToken({ repository: site.repo, sha: `sha-lg7-${stamp}` });
        const res = await POST(
          ingestRequest(
            `Bearer ${token}`,
            validBundleBody({
              images: [
                { manifestKey: "first", contentType: "image/png", bytesBase64: b64 },
                { manifestKey: "second", contentType: "image/png", bytesBase64: b64 },
              ],
            }),
          ),
        );
        expect(res.status).toBe(200);

        const rows = await getPlatformDb()
          .select({ id: blobAssets.id, contentType: blobAssets.contentType, audience: blobAssets.audience, bytes: blobAssets.bytes })
          .from(blobAssets)
          .where(eq(blobAssets.organizationId, site.id));
        const images = rows.filter((r) => r.contentType === "image/png");
        const json = rows.filter((r) => r.contentType === "application/json");
        expect(images).toHaveLength(1);
        expect(images[0]!.audience).toBe("public_site");
        expect(json).toHaveLength(1);
        const stored = JSON.parse(Buffer.from(json[0]!.bytes).toString("utf8")) as { imageKeys: Record<string, string> };
        expect(stored.imageKeys).toEqual({ first: images[0]!.id, second: images[0]!.id });

        const audit = await getPlatformDb()
          .select({ metadata: auditEvents.metadata })
          .from(auditEvents)
          .where(and(eq(auditEvents.resourceId, site.id), eq(auditEvents.action, "site.content_ingested")));
        expect(audit[0]?.metadata).toMatchObject({ imageCount: 2, transport: "legacy" });
      });

      it("LG-8: a manifest key of __proto__ is data, not a prototype assignment", async () => {
        const site = await fixtures.makeSite("lg8", `${SITES_ORG}/site-ingest-route-lg8-${stamp}`);
        const bytes = Buffer.concat([PNG_MAGIC_BYTES, Buffer.from(`lg8 ${stamp}`)]);
        const token = signToken({ repository: site.repo, sha: `sha-lg8-${stamp}` });
        const res = await POST(
          ingestRequest(
            `Bearer ${token}`,
            validBundleBody({ images: [{ manifestKey: "__proto__", contentType: "image/png", bytesBase64: bytes.toString("base64") }] }),
          ),
        );
        expect(res.status).toBe(200);
        const rows = await getPlatformDb()
          .select({ contentType: blobAssets.contentType, bytes: blobAssets.bytes })
          .from(blobAssets)
          .where(eq(blobAssets.organizationId, site.id));
        const json = rows.find((r) => r.contentType === "application/json")!;
        const text = Buffer.from(json.bytes).toString("utf8");
        expect(text).toContain('"__proto__":"');
        const parsed = JSON.parse(text) as { imageKeys: Record<string, string> };
        expect(Object.prototype.hasOwnProperty.call(parsed.imageKeys, "__proto__")).toBe(true);
      });
    });
  },
);
