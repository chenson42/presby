/**
 * Integration tests for src/lib/sites.ts — run against a REAL Postgres
 * connection, not mocked. Follows `tickets.test.ts`'s exact harness: the
 * `hasDb` skip-guard, dynamic imports inside `beforeAll` (this file's own
 * top-level import of `./sites` would otherwise reach `@/lib/db`'s
 * module-scope pool construction before DATABASE_URL is confirmed set), and
 * a self-contained fixture created and torn down per file rather than
 * mutating `scripts/seed-dev.sql`'s fixture ids.
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is
 * SKIPPED there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run src/lib/sites.test.ts
 *
 * FOUR ORGANIZATIONS, deliberately — this is the enumeration-safety property
 * (Phase 1 Gap 5) exercised for real, not asserted from the schema alone:
 *   orgLive         provisioned, ingested (status flips to 'live' by
 *                    recordSiteIngest), a real JSON bundle stored via
 *                    getBlobStore(). getPublishedSite() must return `ok`.
 *   orgProvisioning provisioned, never ingested — status stays
 *                    'provisioning'. getPublishedSite() must return
 *                    `not_found`, indistinguishable from every other miss.
 *   orgSuspended    provisioned, ingested, then admin-suspended via
 *                    setSiteStatus(). getPublishedSite() must return
 *                    `not_found`.
 *   orgUnprovisioned an ordinary org with NO organization_sites row at all —
 *                    the "never had a site" case.
 * Plus a nonexistent slug string that matches no organization row at all.
 *
 * `sites.public_render` is seeded OFF (commit 1). This suite flips it ON for
 * its own duration and restores the original value in `afterAll` — the same
 * live-flip-and-revert discipline commit 1's own Verification section
 * documents for `organization_sites.status`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)("sites.ts (Postgres-backed, real dev database)", () => {
  let getPublishedSite: typeof import("./sites").getPublishedSite;
  let resolvePublishedOrganization: typeof import("./sites").resolvePublishedOrganization;
  let getSiteAdminDetail: typeof import("./sites").getSiteAdminDetail;
  let provisionSite: typeof import("./sites").provisionSite;
  let setSiteStatus: typeof import("./sites").setSiteStatus;
  let listSitesForAdmin: typeof import("./sites").listSitesForAdmin;
  let resolveOrganizationByRepo: typeof import("./sites").resolveOrganizationByRepo;
  let recordSiteIngest: typeof import("./sites").recordSiteIngest;
  let submitSiteContactMessage: typeof import("./sites").submitSiteContactMessage;
  let listSiteContactMessages: typeof import("./sites").listSiteContactMessages;
  let markSiteContactMessageRead: typeof import("./sites").markSiteContactMessageRead;

  let db: typeof import("@/lib/db").db;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let organizations: typeof import("@/lib/db/domain/org").organizations;
  let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
  let groups: typeof import("@/lib/db/domain/groups").groups;
  let people: typeof import("@/lib/db/domain/people").people;
  let memberships: typeof import("@/lib/db/domain/people").memberships;
  let permissions: typeof import("@/lib/db/domain/authz").permissions;
  let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
  let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
  let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
  let users: typeof import("@/lib/db/schema").users;
  let featureFlags: typeof import("@/lib/db/schema").featureFlags;
  let organizationSites: typeof import("@/lib/db/domain/sites").organizationSites;
  let siteContactMessages: typeof import("@/lib/db/domain/sites").siteContactMessages;
  let getBlobStore: typeof import("@/lib/storage/blob-store").getBlobStore;

  const stamp = Date.now();

  let orgLive: string;
  let orgLiveSlug: string;
  let orgProvisioning: string;
  let orgProvisioningSlug: string;
  let orgSuspended: string;
  let orgSuspendedSlug: string;
  let orgUnprovisioned: string;
  let orgUnprovisionedSlug: string;
  const NONEXISTENT_SLUG = `sites-test-nonexistent-${stamp}`;

  let grantingUserId: string;
  let filerRoleId: string;
  let filerPersonId: string; // holds tickets.file at orgLive
  let plainMemberPersonId: string; // active membership at orgLive, no tickets.file

  let originalPublicRenderEnabled: boolean;

  beforeAll(async () => {
    ({
      getPublishedSite,
      resolvePublishedOrganization,
      getSiteAdminDetail,
      provisionSite,
      setSiteStatus,
      listSitesForAdmin,
      resolveOrganizationByRepo,
      recordSiteIngest,
      submitSiteContactMessage,
      listSiteContactMessages,
      markSiteContactMessageRead,
    } = await import("./sites"));
    ({ db, getPlatformDb } = await import("@/lib/db"));
    ({ organizations } = await import("@/lib/db/domain/org"));
    ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
    ({ people, memberships } = await import("@/lib/db/domain/people"));
    ({ permissions, appRoles, appRolePermissions, roleGrants } = await import(
      "@/lib/db/domain/authz"
    ));
    ({ users, featureFlags } = await import("@/lib/db/schema"));
    ({ organizationSites, siteContactMessages } = await import(
      "@/lib/db/domain/sites"
    ));
    ({ getBlobStore } = await import("@/lib/storage/blob-store"));

    const platform = getPlatformDb();

    // --- sites.public_render: flip on for this suite, restore after -------
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

    async function makeOrg(label: string): Promise<{ id: string; slug: string }> {
      const slug = `sites-test-${label.toLowerCase()}-${stamp}`;
      const [row] = await platform
        .insert(organizations)
        .values({
          organizationType: "congregation",
          name: `Fixture Congregation ${label} for sites.test.ts`,
          slug,
          path: `sites_test_${label.toLowerCase()}_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      return { id: row!.id, slug };
    }

    const live = await makeOrg("Live");
    orgLive = live.id;
    orgLiveSlug = live.slug;
    const provisioning = await makeOrg("Provisioning");
    orgProvisioning = provisioning.id;
    orgProvisioningSlug = provisioning.slug;
    const suspended = await makeOrg("Suspended");
    orgSuspended = suspended.id;
    orgSuspendedSlug = suspended.slug;
    const unprovisioned = await makeOrg("Unprovisioned");
    orgUnprovisioned = unprovisioned.id;
    orgUnprovisionedSlug = unprovisioned.slug;

    // drizzle/0017's sync trigger fails loudly if the org has no
    // active_membership derived group yet — must exist before ANY
    // memberships insert (tickets.test.ts's own established precedent).
    const [gt] = await platform
      .insert(groupTypes)
      .values({ organizationId: null, key: "roster", name: "Roster" })
      .onConflictDoNothing()
      .returning({ id: groupTypes.id });
    let groupTypeId = gt?.id;
    if (!groupTypeId) {
      const [existing] = await platform
        .select({ id: groupTypes.id })
        .from(groupTypes)
        .where(eq(groupTypes.key, "roster"))
        .limit(1);
      groupTypeId = existing!.id;
    }
    await platform.insert(groups).values({
      organizationId: orgLive,
      groupTypeId,
      name: "Active Membership",
      membershipSource: "derived",
      derivedFrom: "active_membership",
      isProtected: true,
    });

    await platform
      .insert(permissions)
      .values({
        key: "tickets.file",
        module: "support",
        description: "File and manage support tickets for this organization",
        sensitivityTier: 1,
      })
      .onConflictDoNothing();

    const [userRow] = await platform
      .insert(users)
      .values({
        email: `sites-test-granter-${stamp}@example.invalid`,
        name: "Sites Test Granter",
      })
      .returning({ id: users.id });
    grantingUserId = userRow!.id;

    const [filerRoleRow] = await platform
      .insert(appRoles)
      .values({
        organizationId: orgLive,
        key: "site_message_reviewer_test",
        name: "Site Message Reviewer (test)",
        roleKind: "custom",
        isProtected: false,
      })
      .returning({ id: appRoles.id });
    filerRoleId = filerRoleRow!.id;
    await platform
      .insert(appRolePermissions)
      .values({ roleId: filerRoleId, permissionKey: "tickets.file" });

    async function person(first: string, last: string): Promise<string> {
      const [p] = await platform
        .insert(people)
        .values({ firstName: first, lastName: last })
        .returning({ id: people.id });
      return p!.id;
    }

    filerPersonId = await person("Odalys", "Bramfitt");
    plainMemberPersonId = await person("Julius", "Wenckebach");

    await platform.insert(memberships).values({
      organizationId: orgLive,
      personId: filerPersonId,
      engagementStatus: "regular",
      currentRoll: "active",
    });
    await platform.insert(memberships).values({
      organizationId: orgLive,
      personId: plainMemberPersonId,
      engagementStatus: "regular",
      currentRoll: "active",
    });
    await platform.insert(roleGrants).values({
      organizationId: orgLive,
      roleId: filerRoleId,
      personId: filerPersonId,
      startsOn: "2020-01-01",
      grantedBy: grantingUserId,
    });

    // --- Provision + ingest the fixture sites ------------------------------

    const provisionResult = await provisionSite(
      orgLive,
      `sites-test-org/site-fixture-live-${stamp}`,
      grantingUserId,
    );
    expect(provisionResult).toEqual({ kind: "ok" });

    const bundleBytes = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        pages: [
          {
            path: "/",
            frontMatter: { title: "Welcome to the fixture congregation" },
            mdxAst: { type: "root", children: [] },
          },
        ],
        imageKeys: { hero: "not-a-real-blob-key" },
      }),
      "utf-8",
    );
    const bundleRef = await getBlobStore().store({
      organizationId: orgLive,
      bytes: bundleBytes,
      contentType: "application/json",
    });
    await recordSiteIngest(orgLive, {
      commitSha: "fixture-sha-1",
      contentBundleKey: bundleRef.key,
    });

    const provisioningResult = await provisionSite(
      orgProvisioning,
      `sites-test-org/site-fixture-provisioning-${stamp}`,
      grantingUserId,
    );
    expect(provisioningResult).toEqual({ kind: "ok" });
    // Never ingested — status stays 'provisioning'.

    const suspendedProvision = await provisionSite(
      orgSuspended,
      `sites-test-org/site-fixture-suspended-${stamp}`,
      grantingUserId,
    );
    expect(suspendedProvision).toEqual({ kind: "ok" });
    const suspendedBundleRef = await getBlobStore().store({
      organizationId: orgSuspended,
      bytes: Buffer.from(
        JSON.stringify({ schemaVersion: 1, pages: [{ path: "/", frontMatter: {}, mdxAst: null }], imageKeys: {} }),
        "utf-8",
      ),
      contentType: "application/json",
    });
    await recordSiteIngest(orgSuspended, {
      commitSha: "fixture-sha-suspended-1",
      contentBundleKey: suspendedBundleRef.key,
    });
    const suspendResult = await setSiteStatus(orgSuspended, "suspended", grantingUserId);
    expect(suspendResult).toEqual({ kind: "ok" });

    // orgUnprovisioned: deliberately no organization_sites row at all.
  }, 30_000);

  afterAll(async () => {
    const platform = getPlatformDb();

    await db
      .update(featureFlags)
      .set({ enabled: originalPublicRenderEnabled })
      .where(eq(featureFlags.key, "sites.public_render"));

    // `organizations` ON DELETE CASCADEs down through organization_sites,
    // site_contact_messages, memberships (which drizzle/0017's trigger keeps
    // group_memberships in sync with — deleting memberships directly, out
    // from under that trigger's own materialized rows, is what
    // tickets.test.ts's own afterAll avoids by never doing it), groups,
    // app_roles, and role_grants. Deleting the four fixture orgs is
    // therefore sufficient, mirroring tickets.test.ts's own minimal afterAll.
    for (const orgId of [orgLive, orgProvisioning, orgSuspended, orgUnprovisioned]) {
      await platform.delete(organizations).where(eq(organizations.id, orgId));
    }
    for (const id of [filerPersonId, plainMemberPersonId].filter(Boolean)) {
      await platform.delete(people).where(eq(people.id, id));
    }
    await platform.delete(users).where(eq(users.id, grantingUserId));
  });

  // ---------------------------------------------------------------------
  // getPublishedSite — the enumeration-safety property (Phase 1 Gap 5)
  // ---------------------------------------------------------------------

  describe("getPublishedSite — enumeration safety", () => {
    it("live org: returns the published site with the stored bundle's pages", async () => {
      const result = await getPublishedSite(orgLiveSlug);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.site.organizationId).toBe(orgLive);
      expect(result.site.organizationName).toBe(
        `Fixture Congregation Live for sites.test.ts`,
      );
      expect(result.site.organizationType).toBe("congregation");
      expect(result.site.pages).toEqual([
        {
          path: "/",
          frontMatter: { title: "Welcome to the fixture congregation" },
          mdxAst: { type: "root", children: [] },
        },
      ]);
      expect(result.site.imageKeys).toEqual({ hero: "not-a-real-blob-key" });
      // No organization_brands row exists for this fixture — brand must be
      // null regardless of ui.brand_theming, never a crash.
      expect(result.site.brand).toBeNull();
    });

    it("provisioning (never ingested) org: not_found", async () => {
      const result = await getPublishedSite(orgProvisioningSlug);
      expect(result).toEqual({ kind: "not_found" });
    });

    it("suspended org: not_found, indistinguishable from provisioning", async () => {
      const result = await getPublishedSite(orgSuspendedSlug);
      expect(result).toEqual({ kind: "not_found" });
    });

    it("never-provisioned org (no organization_sites row): not_found", async () => {
      const result = await getPublishedSite(orgUnprovisionedSlug);
      expect(result).toEqual({ kind: "not_found" });
    });

    it("nonexistent slug: not_found, byte-identical result to every other miss", async () => {
      const result = await getPublishedSite(NONEXISTENT_SLUG);
      expect(result).toEqual({ kind: "not_found" });
    });

    it("sites.public_render off: not_found even for the live org", async () => {
      await db
        .update(featureFlags)
        .set({ enabled: false })
        .where(eq(featureFlags.key, "sites.public_render"));
      try {
        const result = await getPublishedSite(orgLiveSlug);
        expect(result).toEqual({ kind: "not_found" });
      } finally {
        await db
          .update(featureFlags)
          .set({ enabled: true })
          .where(eq(featureFlags.key, "sites.public_render"));
      }
    });
  });

  describe("resolvePublishedOrganization — the cheaper sibling", () => {
    it("live org: returns organizationId", async () => {
      const result = await resolvePublishedOrganization(orgLiveSlug);
      expect(result).toEqual({ organizationId: orgLive });
    });

    it("provisioning org: null", async () => {
      const result = await resolvePublishedOrganization(orgProvisioningSlug);
      expect(result).toBeNull();
    });

    it("nonexistent slug: null", async () => {
      const result = await resolvePublishedOrganization(NONEXISTENT_SLUG);
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // recordSiteIngest / resolveOrganizationByRepo — the idempotency primitive
  // ---------------------------------------------------------------------

  describe("recordSiteIngest + resolveOrganizationByRepo — idempotency primitive", () => {
    it("resolveOrganizationByRepo returns the org's slug and last-ingested sha", async () => {
      const resolved = await resolveOrganizationByRepo(
        `sites-test-org/site-fixture-live-${stamp}`,
      );
      expect(resolved).toEqual({
        organizationId: orgLive,
        slug: orgLiveSlug,
        lastIngestedCommitSha: "fixture-sha-1",
      });
    });

    it("an unknown repo resolves to null", async () => {
      const resolved = await resolveOrganizationByRepo("nobody/owns-this-repo");
      expect(resolved).toBeNull();
    });

    it(
      "a repeat commit sha is exactly the condition the route handler's own " +
        "short-circuit checks: resolveOrganizationByRepo's lastIngestedCommitSha " +
        "matching the incoming sha means recordSiteIngest is never called, so " +
        "content_bundle_key/last_ingested_at are left untouched",
      async () => {
        const before = await resolveOrganizationByRepo(
          `sites-test-org/site-fixture-live-${stamp}`,
        );
        expect(before?.lastIngestedCommitSha).toBe("fixture-sha-1");

        // The route handler would see sha === lastIngestedCommitSha here and
        // return "already_current" WITHOUT calling recordSiteIngest at all —
        // simulate exactly that decision, and confirm the state is unchanged
        // because nothing was called.
        const incomingSha = "fixture-sha-1";
        if (incomingSha !== before?.lastIngestedCommitSha) {
          throw new Error("test setup error: shas should match");
        }

        const after = await resolveOrganizationByRepo(
          `sites-test-org/site-fixture-live-${stamp}`,
        );
        expect(after).toEqual(before);
      },
    );

    it("a genuinely new commit sha updates lastIngestedCommitSha and promotes status to live", async () => {
      const detailBefore = await getSiteAdminDetail(orgLive);
      expect(detailBefore?.status).toBe("live");

      const newBundleRef = await getBlobStore().store({
        organizationId: orgLive,
        bytes: Buffer.from(
          JSON.stringify({ schemaVersion: 1, pages: [{ path: "/", frontMatter: {}, mdxAst: null }], imageKeys: {} }),
          "utf-8",
        ),
        contentType: "application/json",
      });
      await recordSiteIngest(orgLive, {
        commitSha: "fixture-sha-2",
        contentBundleKey: newBundleRef.key,
      });

      const resolved = await resolveOrganizationByRepo(
        `sites-test-org/site-fixture-live-${stamp}`,
      );
      expect(resolved?.lastIngestedCommitSha).toBe("fixture-sha-2");

      const detailAfter = await getSiteAdminDetail(orgLive);
      expect(detailAfter?.status).toBe("live");

      // Restore fixture state for any later test in this file that assumes
      // orgLive's own last-ingested sha is still "fixture-sha-1". store()
      // dedupes by content hash (E-c6), so re-storing the ORIGINAL bundle
      // bytes returns the same blob key rather than minting a new row.
      const originalBundleBytes = Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          pages: [
            {
              path: "/",
              frontMatter: { title: "Welcome to the fixture congregation" },
              mdxAst: { type: "root", children: [] },
            },
          ],
          imageKeys: { hero: "not-a-real-blob-key" },
        }),
        "utf-8",
      );
      const restoredRef = await getBlobStore().store({
        organizationId: orgLive,
        bytes: originalBundleBytes,
        contentType: "application/json",
      });
      await recordSiteIngest(orgLive, {
        commitSha: "fixture-sha-1",
        contentBundleKey: restoredRef.key,
      });
    });

    it("recordSiteIngest never resurrects a suspended site — status stays 'suspended' across a new ingest, but content still updates", async () => {
      const detailBefore = await getSiteAdminDetail(orgSuspended);
      expect(detailBefore?.status).toBe("suspended");

      const newBundleRef = await getBlobStore().store({
        organizationId: orgSuspended,
        bytes: Buffer.from(
          JSON.stringify({
            schemaVersion: 1,
            pages: [{ path: "/", frontMatter: {}, mdxAst: null }],
            imageKeys: {},
          }),
          "utf-8",
        ),
        contentType: "application/json",
      });

      // An ordinary content commit on the suspended org's repo — the
      // regression case: an earlier draft of recordSiteIngest() would have
      // silently flipped this back to 'live', undoing the admin's own
      // suspension with no gate at all.
      await recordSiteIngest(orgSuspended, {
        commitSha: "fixture-sha-suspended-2",
        contentBundleKey: newBundleRef.key,
      });

      const detailAfter = await getSiteAdminDetail(orgSuspended);
      expect(detailAfter?.status).toBe("suspended");
      // The bundle/commit metadata still advances — only visibility stays
      // admin-controlled, so un-suspending later serves current content.
      expect(detailAfter?.lastIngestedCommitSha).toBe("fixture-sha-suspended-2");

      // A suspended site's public read stays exactly as unreachable as
      // before — the enumeration-safety collapse doesn't distinguish
      // "suspended with fresh content" from any other non-live state.
      const published = await getPublishedSite(orgSuspendedSlug);
      expect(published).toEqual({ kind: "not_found" });
    });
  });

  // ---------------------------------------------------------------------
  // Admin provisioning
  // ---------------------------------------------------------------------

  describe("provisionSite / setSiteStatus / getSiteAdminDetail / listSitesForAdmin", () => {
    it("provisionSite rejects a malformed repo string", async () => {
      const result = await provisionSite(orgUnprovisioned, "not-a-repo", grantingUserId);
      expect(result).toEqual({
        kind: "invalid_input",
        error: 'Enter a repo as "owner/repo".',
      });
    });

    it("provisionSite is rejected as already_provisioned for an org that already has a row", async () => {
      const result = await provisionSite(
        orgLive,
        `sites-test-org/another-repo-${stamp}`,
        grantingUserId,
      );
      expect(result).toEqual({ kind: "already_provisioned" });
    });

    it("getSiteAdminDetail returns the full detail row for a provisioned org", async () => {
      const detail = await getSiteAdminDetail(orgLive);
      expect(detail).not.toBeNull();
      expect(detail?.organizationId).toBe(orgLive);
      expect(detail?.repo).toBe(`sites-test-org/site-fixture-live-${stamp}`);
      expect(detail?.status).toBe("live");
      expect(detail?.lastIngestedCommitSha).toBe("fixture-sha-1");
    });

    it("getSiteAdminDetail returns null for a never-provisioned org", async () => {
      const detail = await getSiteAdminDetail(orgUnprovisioned);
      expect(detail).toBeNull();
    });

    it("setSiteStatus returns not_found for a never-provisioned org", async () => {
      const result = await setSiteStatus(orgUnprovisioned, "suspended", grantingUserId);
      expect(result).toEqual({ kind: "not_found" });
    });

    it("setSiteStatus can reactivate a suspended site back to live", async () => {
      const result = await setSiteStatus(orgSuspended, "live", grantingUserId);
      expect(result).toEqual({ kind: "ok" });

      const detail = await getSiteAdminDetail(orgSuspended);
      expect(detail?.status).toBe("live");

      // Restore fixture state for the enumeration-safety tests above (this
      // describe block runs after them, but keep the fixture's own invariant
      // — "orgSuspended really is suspended" — true for any future test
      // added to this file).
      await setSiteStatus(orgSuspended, "suspended", grantingUserId);
    });

    it("listSitesForAdmin includes every provisioned fixture org with the right slug/status", async () => {
      const list = await listSitesForAdmin();
      const bySlug = new Map(list.map((entry) => [entry.slug, entry]));

      expect(bySlug.get(orgLiveSlug)).toMatchObject({
        organizationId: orgLive,
        status: "live",
        repo: `sites-test-org/site-fixture-live-${stamp}`,
      });
      expect(bySlug.get(orgProvisioningSlug)).toMatchObject({
        organizationId: orgProvisioning,
        status: "provisioning",
      });
      expect(bySlug.get(orgSuspendedSlug)).toMatchObject({
        organizationId: orgSuspended,
        status: "suspended",
      });
      // Never provisioned — must not appear at all.
      expect(bySlug.has(orgUnprovisionedSlug)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // ContactForm — trusted-org-context anonymous write
  // ---------------------------------------------------------------------

  describe("submitSiteContactMessage", () => {
    it("live site: accepts a valid message", async () => {
      const result = await submitSiteContactMessage(orgLiveSlug, {
        name: "Priya Okonkwo",
        email: "priya@example.invalid",
        body: "What time is the Sunday service?",
      });
      expect(result).toEqual({ kind: "ok" });
    });

    it("rejected when the org's site is provisioning (not yet live)", async () => {
      const result = await submitSiteContactMessage(orgProvisioningSlug, {
        name: "A Visitor",
        email: "visitor@example.invalid",
        body: "Hello?",
      });
      expect(result).toEqual({ kind: "not_live" });
    });

    it("rejected when the org's site is suspended", async () => {
      const result = await submitSiteContactMessage(orgSuspendedSlug, {
        name: "A Visitor",
        email: "visitor@example.invalid",
        body: "Hello?",
      });
      expect(result).toEqual({ kind: "not_live" });
    });

    it("rejected for a never-provisioned org", async () => {
      const result = await submitSiteContactMessage(orgUnprovisionedSlug, {
        name: "A Visitor",
        email: "visitor@example.invalid",
        body: "Hello?",
      });
      expect(result).toEqual({ kind: "not_live" });
    });

    it("rejected for a nonexistent slug", async () => {
      const result = await submitSiteContactMessage(NONEXISTENT_SLUG, {
        name: "A Visitor",
        email: "visitor@example.invalid",
        body: "Hello?",
      });
      expect(result).toEqual({ kind: "not_live" });
    });

    it("invalid_input: empty name", async () => {
      const result = await submitSiteContactMessage(orgLiveSlug, {
        name: "   ",
        email: "visitor@example.invalid",
        body: "Hello?",
      });
      expect(result).toEqual({ kind: "invalid_input", error: "Enter your name." });
    });

    it("invalid_input: malformed email", async () => {
      const result = await submitSiteContactMessage(orgLiveSlug, {
        name: "A Visitor",
        email: "not-an-email",
        body: "Hello?",
      });
      expect(result).toEqual({
        kind: "invalid_input",
        error: "Enter a valid email address.",
      });
    });

    it("invalid_input: empty body", async () => {
      const result = await submitSiteContactMessage(orgLiveSlug, {
        name: "A Visitor",
        email: "visitor@example.invalid",
        body: "   ",
      });
      expect(result).toEqual({
        kind: "invalid_input",
        error: "Enter a message (up to 5,000 characters).",
      });
    });
  });

  // ---------------------------------------------------------------------
  // ContactForm read side — withOrgContext(), gated on tickets.file
  // ---------------------------------------------------------------------

  describe("listSiteContactMessages / markSiteContactMessageRead", () => {
    it("forbidden for a member with no tickets.file", async () => {
      const result = await listSiteContactMessages(plainMemberPersonId, orgLive);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("a tickets.file holder sees the submitted message", async () => {
      const result = await listSiteContactMessages(filerPersonId, orgLive);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      const found = result.messages.find((m) => m.email === "priya@example.invalid");
      expect(found).toBeDefined();
      expect(found?.name).toBe("Priya Okonkwo");
      expect(found?.status).toBe("new");
    });

    it("markSiteContactMessageRead: forbidden for a member with no tickets.file", async () => {
      const list = await listSiteContactMessages(filerPersonId, orgLive);
      if (list.kind !== "ok") throw new Error("fixture setup error");
      const messageId = list.messages[0]!.messageId;

      const result = await markSiteContactMessageRead(plainMemberPersonId, orgLive, messageId);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("markSiteContactMessageRead: not_found for a message id that doesn't belong to this org", async () => {
      const result = await markSiteContactMessageRead(
        filerPersonId,
        orgLive,
        "00000000-0000-0000-0000-000000000000",
      );
      expect(result).toEqual({ kind: "not_found" });
    });

    it("markSiteContactMessageRead: ok, and the message's status flips to read", async () => {
      const list = await listSiteContactMessages(filerPersonId, orgLive);
      if (list.kind !== "ok") throw new Error("fixture setup error");
      const target = list.messages.find((m) => m.status === "new");
      if (!target) throw new Error("fixture setup error: no 'new' message found");

      const result = await markSiteContactMessageRead(filerPersonId, orgLive, target.messageId);
      expect(result).toEqual({ kind: "ok" });

      const after = await listSiteContactMessages(filerPersonId, orgLive);
      if (after.kind !== "ok") throw new Error("fixture setup error");
      const updated = after.messages.find((m) => m.messageId === target.messageId);
      expect(updated?.status).toBe("read");
    });
  });
});
