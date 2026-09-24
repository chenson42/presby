/**
 * Tests for src/lib/org-provisioning.ts.
 *
 * `deriveOrgPath()` is pure but lives in the same module as
 * `createOrganization()`, which imports `@/lib/db` — and `@/lib/db`'s own
 * `db` export constructs its connection pool at MODULE SCOPE, throwing
 * immediately if `DATABASE_URL` is unset. So even the pure-function tests
 * below sit inside the same `hasDb`-gated `describe.skipIf` and dynamic
 * `beforeAll` import as the DB-backed tests, mirroring `sites.test.ts`'s
 * established harness exactly (same reasoning, same skip guard).
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is
 * SKIPPED there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run src/lib/org-provisioning.test.ts
 *
 * Fixtures are self-contained (created and torn down per file, not mutating
 * scripts/seed-dev.sql's fixture ids) — same discipline as sites.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, isNull, sql } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "org-provisioning.ts (Postgres-backed, real dev database)",
  () => {
    let deriveOrgPath: typeof import("./org-provisioning").deriveOrgPath;
    let createOrganization: typeof import("./org-provisioning").createOrganization;
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let organizations: typeof import("@/lib/db/domain/org").organizations;
    let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
    let groups: typeof import("@/lib/db/domain/groups").groups;
    let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
    let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
    let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
    let organizationAffiliations: typeof import("@/lib/db/domain/lifecycle").organizationAffiliations;
    let users: typeof import("@/lib/db/schema").users;

    const stamp = Date.now();
    const createdOrgIds: string[] = [];

    /**
     * Any real `users.id`. `organization_affiliations.recorded_by` is a real
     * FK, and the hierarchical path records the PLATFORM OPERATOR who entered
     * the row — "the presbytery organized it, the operator recorded it."
     * Which user does not matter to these assertions; that one exists does.
     */
    let cachedUserId: string | null = null;
    async function anyUserId(): Promise<string> {
      if (cachedUserId) return cachedUserId;
      const platform = getPlatformDb();
      const [row] = await platform
        .select({ id: users.id })
        .from(users)
        .limit(1);
      if (!row) {
        throw new Error(
          "[org-provisioning.test] no users rows in this database — run the e2e seed or scripts/seed-dev.sql first.",
        );
      }
      cachedUserId = row.id;
      return cachedUserId;
    }

    beforeAll(async () => {
      ({ deriveOrgPath, createOrganization } = await import(
        "./org-provisioning"
      ));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations } = await import("@/lib/db/domain/org"));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
      ({ appRoles, appRolePermissions, roleGrants } = await import(
        "@/lib/db/domain/authz"
      ));
      ({ organizationAffiliations } = await import(
        "@/lib/db/domain/lifecycle"
      ));
      ({ users } = await import("@/lib/db/schema"));

      // This test's own precondition, exercised for real rather than
      // assumed: createOrganization() fails closed with
      // provisioning_incomplete unless the platform-wide court/roster
      // group_types templates already exist. scripts/seed.ts's
      // seedGroupTypes() addition (this same work-log's Implementation
      // Order step 1) is the real fix; this suite does not create them
      // itself, matching Phase 2's explicit rejection of "find-or-create
      // inline" as a shortcut for the production code path.
      const platform = getPlatformDb();
      const templates = await platform
        .select({ key: groupTypes.key })
        .from(groupTypes)
        .where(isNull(groupTypes.organizationId));
      const keys = new Set(templates.map((t) => t.key));
      if (!keys.has("court") || !keys.has("roster")) {
        throw new Error(
          "[org-provisioning.test] court/roster group_types templates are " +
            "missing from this database. Run `npm run db:seed` (with " +
            "scripts/seed.ts's seedGroupTypes() addition) before running " +
            "this suite.",
        );
      }
    });

    /**
     * Drizzle wraps a driver error in its own `Failed query: …` and hangs the
     * real one off `.cause`, so a bare `rejects.toThrow(/…/)` matches the
     * wrapper's text and never the database's. Same chain-walking shape
     * `src/lib/people.test.ts:610` already uses for its RLS assertions.
     */
    async function expectDbError(
      run: () => Promise<unknown>,
      pattern: RegExp,
    ): Promise<void> {
      let caught: unknown;
      try {
        await run();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const chain: string[] = [];
      let current: unknown = caught;
      for (let depth = 0; depth < 5 && current; depth += 1) {
        if (current instanceof Error) chain.push(current.message);
        current = current instanceof Error ? current.cause : undefined;
      }
      expect(chain.join(" :: ")).toMatch(pattern);
    }

    afterAll(async () => {
      const platform = getPlatformDb();
      // REVERSE order: children are always pushed after their parents, and
      // organizations.parent_id has no cascade (deliberately — a council
      // should refuse to disappear while it still has member congregations).
      for (const id of [...createdOrgIds].reverse()) {
        // drizzle/0044's presby_guard_organizations_delete() refuses a DELETE
        // unless `deletable_until` is set and in the future — and it fires on
        // THIS connection, because BYPASSRLS exempts a role from policies and
        // never from triggers. These orgs come out of createOrganization(),
        // production code that (rightly) never stamps the column, so the
        // fixture window is opened here, immediately before teardown, rather
        // than at insert the way `fixtureDeletableUntil()` does for
        // hand-built fixtures elsewhere.
        await platform
          .update(organizations)
          .set({ deletableUntil: fixtureDeletableUntil() })
          .where(eq(organizations.id, id));
        // groups.organizationId cascades on organizations delete (see
        // src/lib/db/domain/groups.ts), and so does
        // organization_affiliations.subject_org_id (drizzle/0044), so this
        // alone is sufficient cleanup.
        await platform.delete(organizations).where(eq(organizations.id, id));
      }
    });

    // -------------------------------------------------------------------
    // deriveOrgPath()
    // -------------------------------------------------------------------

    describe("deriveOrgPath", () => {
      it("replaces every hyphen with an underscore", () => {
        expect(deriveOrgPath("first-pres-anytown")).toBe(
          "first_pres_anytown",
        );
      });

      it("passes a slug with no hyphens through unchanged", () => {
        expect(deriveOrgPath("fpcw")).toBe("fpcw");
      });

      it("handles a slug that is all digits/letters with a single hyphen", () => {
        expect(deriveOrgPath("st-andrews")).toBe("st_andrews");
      });
    });

    // -------------------------------------------------------------------
    // createOrganization()
    // -------------------------------------------------------------------

    describe("createOrganization", () => {
      it("creates a congregation with Session, Board of Deacons, and Active Membership", async () => {
        const slug = `org-prov-test-cong-${stamp}`;
        const result = await createOrganization({
          name: "Fixture Congregation for org-provisioning.test.ts",
          slug,
          organizationType: "congregation",
          platformStatus: "managed",
        });
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        createdOrgIds.push(result.organizationId);

        const platform = getPlatformDb();
        const [orgRow] = await platform
          .select({ path: organizations.path, slug: organizations.slug })
          .from(organizations)
          .where(eq(organizations.id, result.organizationId))
          .limit(1);
        expect(orgRow?.slug).toBe(slug);
        expect(orgRow?.path).toBe(deriveOrgPath(slug));

        const groupRows = await platform
          .select({
            id: groups.id,
            name: groups.name,
            derivedFrom: groups.derivedFrom,
            membershipSource: groups.membershipSource,
            isProtected: groups.isProtected,
          })
          .from(groups)
          .where(eq(groups.organizationId, result.organizationId));

        expect(groupRows).toHaveLength(3);
        const byDerivedFrom = new Map(
          groupRows.map((g) => [g.derivedFrom, g]),
        );
        expect(byDerivedFrom.get("session")?.name).toBe("Session");
        expect(byDerivedFrom.get("diaconate")?.name).toBe("Board of Deacons");
        expect(byDerivedFrom.get("active_membership")?.name).toBe(
          "Active Membership",
        );
        for (const g of groupRows) {
          expect(g.membershipSource).toBe("derived");
          expect(g.isProtected).toBe(true);
        }

        // Baseline role seed (DECISION-100): a constitutional, protected
        // `member` role bound to `directory.view`, granted through the
        // GROUP arm to this org's own `active_membership` group.
        const [roleRow] = await platform
          .select({
            key: appRoles.key,
            name: appRoles.name,
            roleKind: appRoles.roleKind,
            isProtected: appRoles.isProtected,
          })
          .from(appRoles)
          .where(eq(appRoles.organizationId, result.organizationId));
        expect(roleRow?.key).toBe("member");
        expect(roleRow?.name).toBe("Member");
        expect(roleRow?.roleKind).toBe("constitutional");
        expect(roleRow?.isProtected).toBe(true);

        const permissionRows = await platform
          .select({ permissionKey: appRolePermissions.permissionKey })
          .from(appRolePermissions)
          .innerJoin(appRoles, eq(appRolePermissions.roleId, appRoles.id))
          .where(eq(appRoles.organizationId, result.organizationId));
        expect(permissionRows).toHaveLength(1);
        expect(permissionRows[0].permissionKey).toBe("directory.view");

        const activeMembershipGroupId = groupRows.find(
          (g) => g.derivedFrom === "active_membership",
        )?.id;
        expect(activeMembershipGroupId).toBeDefined();

        const grantRows = await platform
          .select({
            personId: roleGrants.personId,
            groupId: roleGrants.groupId,
          })
          .from(roleGrants)
          .innerJoin(appRoles, eq(roleGrants.roleId, appRoles.id))
          .where(eq(appRoles.organizationId, result.organizationId));
        expect(grantRows).toHaveLength(1);
        expect(grantRows[0].personId).toBeNull();
        expect(grantRows[0].groupId).toBe(activeMembershipGroupId);
      });

      it("creates a presbytery with only Active Membership (no Session, no Board of Deacons)", async () => {
        const slug = `org-prov-test-presb-${stamp}`;
        const result = await createOrganization({
          name: "Fixture Presbytery for org-provisioning.test.ts",
          slug,
          organizationType: "presbytery",
          platformStatus: "unmanaged",
        });
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        createdOrgIds.push(result.organizationId);

        const platform = getPlatformDb();
        const groupRows = await platform
          .select({
            id: groups.id,
            name: groups.name,
            derivedFrom: groups.derivedFrom,
          })
          .from(groups)
          .where(eq(groups.organizationId, result.organizationId));

        expect(groupRows).toHaveLength(1);
        expect(groupRows[0].derivedFrom).toBe("active_membership");
        expect(groupRows[0].name).toBe("Active Membership");

        // Same baseline role seed as the congregation case above — the
        // non-congregation plan has a single group, but the role/permission/
        // group-arm-grant shape is identical (DECISION-100: one uniform plan
        // for every organizationType today).
        const [roleRow] = await platform
          .select({ key: appRoles.key })
          .from(appRoles)
          .where(eq(appRoles.organizationId, result.organizationId));
        expect(roleRow?.key).toBe("member");

        const grantRows = await platform
          .select({
            personId: roleGrants.personId,
            groupId: roleGrants.groupId,
          })
          .from(roleGrants)
          .innerJoin(appRoles, eq(roleGrants.roleId, appRoles.id))
          .where(eq(appRoles.organizationId, result.organizationId));
        expect(grantRows).toHaveLength(1);
        expect(grantRows[0].personId).toBeNull();
        expect(grantRows[0].groupId).toBe(groupRows[0].id);
      });

      it("does not leak one organization's baseline role/grant rows into another's (composite-key discipline, F2-style)", async () => {
        const slugA = `org-prov-test-noleak-a-${stamp}`;
        const slugB = `org-prov-test-noleak-b-${stamp}`;

        const resultA = await createOrganization({
          name: "Fixture No-Leak Org A",
          slug: slugA,
          organizationType: "congregation",
          platformStatus: "managed",
        });
        expect(resultA.kind).toBe("ok");
        if (resultA.kind !== "ok") return;
        createdOrgIds.push(resultA.organizationId);

        const resultB = await createOrganization({
          name: "Fixture No-Leak Org B",
          slug: slugB,
          organizationType: "congregation",
          platformStatus: "managed",
        });
        expect(resultB.kind).toBe("ok");
        if (resultB.kind !== "ok") return;
        createdOrgIds.push(resultB.organizationId);

        const platform = getPlatformDb();

        const rolesA = await platform
          .select({ id: appRoles.id, organizationId: appRoles.organizationId })
          .from(appRoles)
          .where(eq(appRoles.organizationId, resultA.organizationId));
        const rolesB = await platform
          .select({ id: appRoles.id, organizationId: appRoles.organizationId })
          .from(appRoles)
          .where(eq(appRoles.organizationId, resultB.organizationId));
        expect(rolesA).toHaveLength(1);
        expect(rolesB).toHaveLength(1);
        expect(rolesA[0].id).not.toBe(rolesB[0].id);
        // Each org's own query returns exactly its own row — no cross-org id
        // shows up under the other org's filter.
        expect(
          rolesA.some((r) => r.organizationId === resultB.organizationId),
        ).toBe(false);
        expect(
          rolesB.some((r) => r.organizationId === resultA.organizationId),
        ).toBe(false);

        const grantsA = await platform
          .select({ groupId: roleGrants.groupId, roleId: roleGrants.roleId })
          .from(roleGrants)
          .where(eq(roleGrants.organizationId, resultA.organizationId));
        const grantsB = await platform
          .select({ groupId: roleGrants.groupId, roleId: roleGrants.roleId })
          .from(roleGrants)
          .where(eq(roleGrants.organizationId, resultB.organizationId));
        expect(grantsA).toHaveLength(1);
        expect(grantsB).toHaveLength(1);
        // The two orgs' grants point at two different roles and two
        // different (org-scoped) active_membership groups — never the same
        // id, which would indicate a copy-paste of the wrong org's id.
        expect(grantsA[0].roleId).toBe(rolesA[0].id);
        expect(grantsB[0].roleId).toBe(rolesB[0].id);
        expect(grantsA[0].groupId).not.toBe(grantsB[0].groupId);
      });

      it("rejects a slug that is already taken", async () => {
        const slug = `org-prov-test-dup-${stamp}`;
        const first = await createOrganization({
          name: "Fixture Original",
          slug,
          organizationType: "congregation",
          platformStatus: "managed",
        });
        expect(first.kind).toBe("ok");
        if (first.kind === "ok") createdOrgIds.push(first.organizationId);

        const second = await createOrganization({
          name: "Fixture Duplicate",
          slug,
          organizationType: "congregation",
          platformStatus: "managed",
        });
        expect(second).toEqual({ kind: "slug_taken" });
      });

      // -----------------------------------------------------------------
      // Hierarchical provisioning (DECISION-136 / drizzle/0044)
      // -----------------------------------------------------------------

      it("creates a congregation UNDER a presbytery: org row and affiliation row in one commit, with parent_id/path DERIVED", async () => {
        const parentSlug = `org-prov-test-parent-${stamp}`;
        const parent = await createOrganization({
          name: "Fixture Parent Presbytery",
          slug: parentSlug,
          organizationType: "presbytery",
          platformStatus: "managed",
        });
        expect(parent.kind).toBe("ok");
        if (parent.kind !== "ok") return;
        createdOrgIds.push(parent.organizationId);

        const childSlug = `org-prov-test-child-${stamp}`;
        const child = await createOrganization({
          name: "Fixture Child Congregation",
          slug: childSlug,
          organizationType: "congregation",
          platformStatus: "managed",
          parentOrganizationId: parent.organizationId,
          relationshipType: "member_congregation",
          effectiveFrom: new Date("2026-03-01T12:00:00Z"),
          minuteReference: "Stated meeting, 2026-03-01, item 6",
          recordedByUserId: await anyUserId(),
        });
        expect(child.kind).toBe("ok");
        if (child.kind !== "ok") return;
        createdOrgIds.push(child.organizationId);

        const platform = getPlatformDb();

        // The affiliation row: owned by the PARENT council (its minute, its
        // record), naming the child as subject.
        const affiliations = await platform
          .select({
            organizationId: organizationAffiliations.organizationId,
            parentOrgId: organizationAffiliations.parentOrgId,
            relationshipType: organizationAffiliations.relationshipType,
            effectiveFrom: organizationAffiliations.effectiveFrom,
            effectiveTo: organizationAffiliations.effectiveTo,
            authority: organizationAffiliations.authority,
            minuteReference: organizationAffiliations.minuteReference,
          })
          .from(organizationAffiliations)
          .where(
            eq(organizationAffiliations.subjectOrgId, child.organizationId),
          );
        expect(affiliations).toHaveLength(1);
        expect(affiliations[0].organizationId).toBe(parent.organizationId);
        expect(affiliations[0].parentOrgId).toBe(parent.organizationId);
        expect(affiliations[0].relationshipType).toBe("member_congregation");
        expect(affiliations[0].effectiveTo).toBeNull();
        // A brand-new org's affiliation is dated, never unbounded-below —
        // null there means "predates our records" (F41), which is false for a
        // body organized today.
        expect(affiliations[0].effectiveFrom).toBe("2026-03-01");
        // authority is DERIVED from whether a minute was supplied
        // (DECISION-139), never taken as a caller-supplied enum.
        expect(affiliations[0].authority).toBe("recorded");
        expect(affiliations[0].minuteReference).toBe(
          "Stated meeting, 2026-03-01, item 6",
        );

        // parent_id and path are the DERIVED cache, written by
        // presby_apply_affiliation_to_org_tree() — not by createOrganization().
        const [childRow] = await platform
          .select({ parentId: organizations.parentId, path: organizations.path })
          .from(organizations)
          .where(eq(organizations.id, child.organizationId))
          .limit(1);
        expect(childRow?.parentId).toBe(parent.organizationId);
        expect(childRow?.path).toBe(
          `${deriveOrgPath(parentSlug)}.${deriveOrgPath(childSlug)}`,
        );
      });

      it("records authority = 'backfill' when no minute reference is supplied", async () => {
        const parentSlug = `org-prov-test-bfparent-${stamp}`;
        const parent = await createOrganization({
          name: "Fixture Backfill Parent",
          slug: parentSlug,
          organizationType: "presbytery",
          platformStatus: "managed",
        });
        expect(parent.kind).toBe("ok");
        if (parent.kind !== "ok") return;
        createdOrgIds.push(parent.organizationId);

        const child = await createOrganization({
          name: "Fixture Backfill Child",
          slug: `org-prov-test-bfchild-${stamp}`,
          organizationType: "new_worshiping_community",
          platformStatus: "unmanaged",
          parentOrganizationId: parent.organizationId,
          relationshipType: "member_nwc",
          recordedByUserId: await anyUserId(),
        });
        expect(child.kind).toBe("ok");
        if (child.kind !== "ok") return;
        createdOrgIds.push(child.organizationId);

        const platform = getPlatformDb();
        const [row] = await platform
          .select({
            authority: organizationAffiliations.authority,
            minuteReference: organizationAffiliations.minuteReference,
            relationshipType: organizationAffiliations.relationshipType,
          })
          .from(organizationAffiliations)
          .where(eq(organizationAffiliations.subjectOrgId, child.organizationId))
          .limit(1);
        // The CHECK permits a null minute ONLY on a backfill row, so an
        // inferred relationship can never be mistaken for a minuted act.
        expect(row?.authority).toBe("backfill");
        expect(row?.minuteReference).toBeNull();
        // G-3.0301(b) enumerates new church developments separately from
        // congregations, so an NWC gets its own relationship type.
        expect(row?.relationshipType).toBe("member_nwc");
      });

      it("rejects a parent whose type is not exactly one level above, and leaves NO organization row behind", async () => {
        const parentSlug = `org-prov-test-badparent-${stamp}`;
        const parent = await createOrganization({
          name: "Fixture Congregation As Parent",
          slug: parentSlug,
          organizationType: "congregation",
          platformStatus: "managed",
        });
        expect(parent.kind).toBe("ok");
        if (parent.kind !== "ok") return;
        createdOrgIds.push(parent.organizationId);

        const orphanSlug = `org-prov-test-orphan-${stamp}`;
        const result = await createOrganization({
          name: "Should Never Be Created",
          slug: orphanSlug,
          organizationType: "congregation",
          platformStatus: "managed",
          // A congregation cannot receive a congregation: G-3.0301(a) gives
          // that act to the presbytery.
          parentOrganizationId: parent.organizationId,
          relationshipType: "member_congregation",
          minuteReference: "n/a",
          recordedByUserId: await anyUserId(),
        });
        expect(result).toEqual({ kind: "invalid_parent" });

        // BOTH halves rolled back — the org row and the affiliation row are
        // one commit, so a refused affiliation must take the org with it.
        const platform = getPlatformDb();
        const leftovers = await platform
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.slug, orphanSlug));
        expect(leftovers).toHaveLength(0);
      });

      it("refuses a parent with no relationship type rather than writing a half-recorded affiliation", async () => {
        const result = await createOrganization({
          name: "Should Never Be Created",
          slug: `org-prov-test-norel-${stamp}`,
          organizationType: "congregation",
          platformStatus: "managed",
          parentOrganizationId: "00000000-0000-0000-0000-0000000000ff",
          recordedByUserId: "00000000-0000-0000-0000-0000000000fe",
        });
        expect(result.kind).toBe("invalid_input");
      });

      it("rejects a DIRECT parent_id insert on the owner connection — parent_id is derived, not written", async () => {
        const platform = getPlatformDb();
        const parent = await createOrganization({
          name: "Fixture Guard Parent",
          slug: `org-prov-test-guardparent-${stamp}`,
          organizationType: "presbytery",
          platformStatus: "managed",
        });
        expect(parent.kind).toBe("ok");
        if (parent.kind !== "ok") return;
        createdOrgIds.push(parent.organizationId);

        // The guard fires on THIS connection too: PLATFORM_DATABASE_URL is
        // BYPASSRLS, and BYPASSRLS exempts a role from RLS policies, never
        // from triggers. Auto-creating an affiliation here instead would have
        // to invent three facts it cannot know — the owning council, the
        // effective date, and the authority.
        await expectDbError(
          () =>
            platform.insert(organizations).values({
              deletableUntil: fixtureDeletableUntil(),
              organizationType: "congregation",
              parentId: parent.organizationId,
              name: "Should Never Be Created",
              slug: `org-prov-test-direct-${stamp}`,
              path: `org_prov_test_direct_${stamp}`,
              platformStatus: "unmanaged",
            }),
          /derived from organization_affiliations/,
        );
      });

      it("refuses to DELETE an organization that carries no deletable_until, and permits one that does — on the owner connection", async () => {
        const platform = getPlatformDb();
        const result = await createOrganization({
          name: "Fixture Delete Guard Org",
          slug: `org-prov-test-delguard-${stamp}`,
          organizationType: "congregation",
          platformStatus: "unmanaged",
        });
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        const id = result.organizationId;

        // createOrganization() never stamps the column, so a freshly
        // provisioned organization is permanent from the moment it exists.
        await expectDbError(
          () => platform.delete(organizations).where(eq(organizations.id, id)),
          /an organization is permanent/,
        );

        // A marker already in the past does not grant deletability either —
        // the guard is `> now()`, so a stale stamp is not a standing licence.
        await platform
          .update(organizations)
          .set({ deletableUntil: new Date(Date.now() - 60_000) })
          .where(eq(organizations.id, id));
        await expectDbError(
          () => platform.delete(organizations).where(eq(organizations.id, id)),
          /an organization is permanent/,
        );

        await platform
          .update(organizations)
          .set({ deletableUntil: fixtureDeletableUntil() })
          .where(eq(organizations.id, id));
        await platform.delete(organizations).where(eq(organizations.id, id));
        const after = await platform
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.id, id));
        expect(after).toHaveLength(0);
      });

      it("refuses a second OPEN affiliation for the same subject and relationship type (the GIST EXCLUDE, unbounded lower bound included)", async () => {
        const platform = getPlatformDb();
        const parent = await createOrganization({
          name: "Fixture Overlap Parent",
          slug: `org-prov-test-ovparent-${stamp}`,
          organizationType: "presbytery",
          platformStatus: "managed",
        });
        expect(parent.kind).toBe("ok");
        if (parent.kind !== "ok") return;
        createdOrgIds.push(parent.organizationId);

        const otherParent = await createOrganization({
          name: "Fixture Overlap Other Parent",
          slug: `org-prov-test-ovparent2-${stamp}`,
          organizationType: "presbytery",
          platformStatus: "managed",
        });
        expect(otherParent.kind).toBe("ok");
        if (otherParent.kind !== "ok") return;
        createdOrgIds.push(otherParent.organizationId);

        const child = await createOrganization({
          name: "Fixture Overlap Child",
          slug: `org-prov-test-ovchild-${stamp}`,
          organizationType: "congregation",
          platformStatus: "managed",
          parentOrganizationId: parent.organizationId,
          relationshipType: "member_congregation",
          minuteReference: "Stated meeting, fixture",
          recordedByUserId: await anyUserId(),
        });
        expect(child.kind).toBe("ok");
        if (child.kind !== "ok") return;
        createdOrgIds.push(child.organizationId);

        // An unbounded-below row (effective_from null) overlaps EVERYTHING,
        // which is exactly the property F41's backfill relies on — and the
        // reason a second one cannot be opened alongside the first.
        await expectDbError(
          () =>
            platform.insert(organizationAffiliations).values({
              organizationId: otherParent.organizationId,
              subjectOrgId: child.organizationId,
              parentOrgId: otherParent.organizationId,
              relationshipType: "member_congregation",
              effectiveFrom: null,
              authority: "backfill",
            }),
          /organization_affiliations_no_overlap/,
        );
      });

      it("keeps parent_id a pure CACHE of the open affiliation, database-wide (drizzle/0044's own completeness assertion, re-run)", async () => {
        const platform = getPlatformDb();
        // The migration's DO block proved this at migration time; this
        // re-proves it on the owner connection, which is the only one that
        // can see every council's rows (scripts/test-rls.sql can only assert
        // the tenant-scoped half). It is the invariant
        // src/lib/presbytery.ts:143 and src/lib/credentials.ts:522 depend on
        // without knowing it: they answer "is X my member congregation" from
        // parent_id, while increment 3's about-org trigger will answer it
        // from presby_org_affiliated().
        const result = await platform.execute(sql`
          select
            (select count(*) from organizations where parent_id is not null)::int as parented,
            (select count(*) from organization_affiliations where effective_to is null)::int as open_affiliations,
            (select count(*) from organizations o
               join organization_affiliations a
                 on a.subject_org_id = o.id and a.effective_to is null
              where o.parent_id is distinct from a.parent_org_id)::int as mismatched
        `);
        const counts = result.rows[0] as {
          parented: number;
          open_affiliations: number;
          mismatched: number;
        };
        expect(counts.parented).toBe(counts.open_affiliations);
        expect(counts.mismatched).toBe(0);
      });

      it("rejects a reserved slug without creating a row", async () => {
        const platform = getPlatformDb();
        const before = await platform
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.slug, "admin"))
          .limit(1);
        expect(before).toHaveLength(0);

        const result = await createOrganization({
          name: "Should Never Be Created",
          slug: "admin",
          organizationType: "congregation",
          platformStatus: "managed",
        });
        expect(result).toEqual({ kind: "reserved_slug" });

        const after = await platform
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.slug, "admin"))
          .limit(1);
        expect(after).toHaveLength(0);
      });
    });
  },
);
