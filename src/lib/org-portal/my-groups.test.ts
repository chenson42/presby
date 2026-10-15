/**
 * Integration tests for getViewerGroups() — REAL Postgres, not mocked. The
 * architect's four conditions (docs/work-log/2026-10-14-portal-home-alignment.md,
 * Phase 2 "Groups self-read") exist because RLS on `groups` /
 * `group_memberships` is tenancy-only: the viewer's own-row scope is an
 * application predicate, so a DB test is what holds it. SKIPPED (not failed)
 * when DATABASE_URL/PLATFORM_DATABASE_URL are unset. Run for real with
 * `dotenv -e .env.local -- vitest run --no-file-parallelism
 * src/lib/org-portal/my-groups.test.ts`.
 *
 * THE CLOCK. Every test runs under a fake `Date` set to 2026-03-02T03:00:00Z,
 * where America/New_York is still 2026-03-01 22:00 while UTC is already
 * 03-02. That disagreement is what makes the org zone observable: the
 * "Ends/Starts Tomorrow Local" rows flip when the zone flips. Only `Date` is
 * faked — the database driver keeps its real timers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

const NOW = new Date("2026-03-02T03:00:00Z");

describe.skipIf(!hasDb)(
  "getViewerGroups (Postgres-backed, real dev database)",
  () => {
    let getViewerGroups: typeof import("./my-groups").getViewerGroups;
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let organizations: typeof import("@/lib/db/domain/org").organizations;
    let organizationSettings: typeof import("@/lib/db/domain/org").organizationSettings;
    let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
    let groups: typeof import("@/lib/db/domain/groups").groups;
    let groupMemberships: typeof import("@/lib/db/domain/groups").groupMemberships;
    let people: typeof import("@/lib/db/domain/people").people;
    let memberships: typeof import("@/lib/db/domain/people").memberships;
    let officerTerms: typeof import("@/lib/db/domain/officers").officerTerms;

    let orgA: string;
    let orgB: string;
    let viewer: string; // member of A and B
    let other: string; // member of A only
    let outsider: string; // member of nothing here (OrgAccessError)

    beforeAll(async () => {
      ({ getViewerGroups } = await import("./my-groups"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations, organizationSettings } = await import("@/lib/db/domain/org"));
      ({ groupTypes, groups, groupMemberships } = await import(
        "@/lib/db/domain/groups"
      ));
      ({ people, memberships } = await import("@/lib/db/domain/people"));
      ({ officerTerms } = await import("@/lib/db/domain/officers"));

      const platform = getPlatformDb();
      const stamp = Date.now();

      async function org(label: string) {
        const [o] = await platform
          .insert(organizations)
          .values({
            deletableUntil: fixtureDeletableUntil(),
            organizationType: "congregation",
            name: `Fixture Congregation ${label} for my-groups.test.ts`,
            slug: `my-groups-test-${label.toLowerCase()}-${stamp}`,
            path: `my_groups_test_${label.toLowerCase()}_${stamp}`,
            platformStatus: "unmanaged",
          })
          .returning({ id: organizations.id });
        return o!.id;
      }
      orgA = await org("A");
      orgB = await org("B");

      const [gt] = await platform
        .insert(groupTypes)
        .values({ key: "roster", name: "Roster" })
        .onConflictDoNothing()
        .returning({ id: groupTypes.id });
      let rosterId = gt?.id;
      if (!rosterId) {
        const [existing] = await platform
          .select({ id: groupTypes.id })
          .from(groupTypes)
          .where(eq(groupTypes.key, "roster"))
          .limit(1);
        rosterId = existing!.id;
      }

      // Derived groups FIRST: the memberships trigger needs active_membership
      // (drizzle/0017) and the officer-term trigger needs session/diaconate
      // (F16), or they fail loudly.
      async function derived(
        organizationId: string,
        name: string,
        derivedFrom: string,
      ) {
        const [g] = await platform
          .insert(groups)
          .values({
            organizationId,
            groupTypeId: rosterId!,
            name,
            membershipSource: "derived",
            derivedFrom,
            isProtected: true,
          })
          .returning({ id: groups.id });
        return g!.id;
      }
      await derived(orgA, "Active Membership", "active_membership");
      await derived(orgB, "Active Membership", "active_membership");
      await derived(orgA, "Session", "session");
      await derived(orgA, "Board of Deacons", "diaconate");

      async function person(first: string, last: string) {
        const [p] = await platform
          .insert(people)
          .values({
            firstName: first,
            lastName: last,
            deletableUntil: fixtureDeletableUntil(),
          })
          .returning({ id: people.id });
        return p!.id;
      }
      viewer = await person("Marguerite", "Tallowby");
      other = await person("Ignatius", "Corrow");
      outsider = await person("Drusilla", "Venn");

      await platform.insert(memberships).values([
        { organizationId: orgA, personId: viewer, engagementStatus: "regular", currentRoll: "active" },
        { organizationId: orgA, personId: other, engagementStatus: "regular", currentRoll: "active" },
      ]);
      // The viewer's second relationship, at org B: linking an existing person
      // needs the F21 authorization set in the same transaction.
      await platform.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.person_claim_authorized', ${viewer}, true)`,
        );
        await tx.insert(memberships).values({
          organizationId: orgB,
          personId: viewer,
          engagementStatus: "regular",
          currentRoll: null,
        });
      });

      // Org A runs on New York time (the calendar's default, set explicitly).
      await platform
        .insert(organizationSettings)
        .values({ organizationId: orgA, timeZone: "America/New_York" })
        .onConflictDoUpdate({
          target: organizationSettings.organizationId,
          set: { timeZone: "America/New_York" },
        });

      async function managed(
        organizationId: string,
        name: string,
        members: Array<{
          personId: string;
          startsOn: string;
          endsOn?: string | null;
        }>,
      ) {
        const [g] = await platform
          .insert(groups)
          .values({ organizationId, groupTypeId: rosterId!, name })
          .returning({ id: groups.id });
        for (const m of members) {
          await platform.insert(groupMemberships).values({
            organizationId,
            groupId: g!.id,
            personId: m.personId,
            startsOn: m.startsOn,
            endsOn: m.endsOn ?? null,
          });
        }
        return g!.id;
      }

      await managed(orgA, "Altar Guild", [
        { personId: viewer, startsOn: "2020-01-01" },
        { personId: other, startsOn: "2020-01-01" },
      ]);
      await managed(orgA, "choir", [{ personId: viewer, startsOn: "2020-01-01" }]);
      await managed(orgA, "Book Club", [
        { personId: viewer, startsOn: "2020-01-01", endsOn: "2025-12-31" },
      ]);
      await managed(orgA, "Future Study", [
        { personId: viewer, startsOn: "2999-01-01" },
      ]);
      await managed(orgA, "Ends Tomorrow Local", [
        { personId: viewer, startsOn: "2020-01-01", endsOn: "2026-03-02" },
      ]);
      await managed(orgA, "Starts Tomorrow Local", [
        { personId: viewer, startsOn: "2026-03-02" },
      ]);
      await managed(orgA, "Ended Today Local", [
        { personId: viewer, startsOn: "2020-01-01", endsOn: "2026-03-01" },
      ]);
      await managed(orgA, "Garden Team", [
        { personId: other, startsOn: "2020-01-01" },
      ]);
      // The data anomaly the schema allows: two overlapping current rows.
      await managed(orgA, "Dual Row", [
        { personId: viewer, startsOn: "2020-01-01" },
        { personId: viewer, startsOn: "2021-01-01" },
      ]);
      // A managed group that is LEGALLY named like the derived one: the filter
      // is on derived_from, never on the name.
      await managed(orgA, "Active Membership", [
        { personId: viewer, startsOn: "2020-01-01" },
      ]);
      await managed(orgB, "Bell Ringers", [
        { personId: viewer, startsOn: "2020-01-01" },
      ]);

      // Session / Board of Deacons: the trigger materializes the roster rows
      // from officer_terms (group_memberships_reject_derived forbids direct
      // writes).
      await platform.insert(officerTerms).values([
        {
          organizationId: orgA,
          personId: viewer,
          office: "ruling_elder",
          startsOn: "2020-01-01",
          endsOn: null,
        },
        {
          organizationId: orgA,
          personId: viewer,
          office: "deacon",
          startsOn: "2015-01-01",
          endsOn: "2019-12-31",
          endReason: "completed",
        },
      ]);
    });

    afterAll(async () => {
      const platform = getPlatformDb();
      await platform.execute(
        sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
      );
      try {
        await platform.delete(organizations).where(eq(organizations.id, orgA));
        await platform.delete(organizations).where(eq(organizations.id, orgB));
      } finally {
        await platform.execute(
          sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
        );
      }
      for (const id of [viewer, other, outsider].filter(Boolean)) {
        await platform.delete(people).where(eq(people.id, id));
      }
    });

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name);

    it("returns exactly the viewer's current groups, case-insensitively alphabetical", async () => {
      const result = await getViewerGroups(viewer, orgA);
      expect(names(result)).toEqual([
        "Active Membership", // the MANAGED group of that name — see below
        "Altar Guild",
        "choir",
        "Dual Row",
        "Ends Tomorrow Local",
        "Session",
      ]);
    });

    it("excludes the derived active_membership group by derived_from, not by name", async () => {
      // Non-vacuity: the viewer really does hold the derived row.
      const platform = getPlatformDb();
      const derivedRow = await platform.execute(sql`
        select 1 from group_memberships gm
          join groups g on g.id = gm.group_id
         where gm.person_id = ${viewer}::uuid
           and g.organization_id = ${orgA}::uuid
           and g.derived_from = 'active_membership'
      `);
      expect(derivedRow.rows.length).toBe(1);

      const result = await getViewerGroups(viewer, orgA);
      const derivedId = (
        await platform.execute(sql`
          select id from groups
           where organization_id = ${orgA}::uuid and derived_from = 'active_membership'
        `)
      ).rows[0].id;
      expect(result.map((g) => g.groupId)).not.toContain(derivedId);
      // ...while the MANAGED group named "Active Membership" is included.
      expect(names(result).filter((n) => n === "Active Membership")).toHaveLength(1);
    });

    it("includes the derived session group (via an active officer term) and excludes an ended diaconate term", async () => {
      const result = names(await getViewerGroups(viewer, orgA));
      expect(result).toContain("Session");
      expect(result).not.toContain("Board of Deacons");
    });

    it("excludes ended, not-yet-started and boundary-ended memberships", async () => {
      const result = names(await getViewerGroups(viewer, orgA));
      for (const gone of [
        "Book Club",
        "Future Study",
        "Starts Tomorrow Local",
        "Ended Today Local",
      ]) {
        expect(result).not.toContain(gone);
      }
      // ends_on = tomorrow (local) is still current today.
      expect(result).toContain("Ends Tomorrow Local");
    });

    it("never returns another member's groups", async () => {
      const result = names(await getViewerGroups(viewer, orgA));
      expect(result).not.toContain("Garden Team");
      // And the other member's own call returns theirs, once each.
      expect(names(await getViewerGroups(other, orgA))).toEqual([
        "Altar Guild",
        "Garden Team",
      ]);
    });

    it("lists a group shared with another member once, carrying nothing about them", async () => {
      const result = await getViewerGroups(viewer, orgA);
      expect(result.filter((g) => g.name === "Altar Guild")).toHaveLength(1);
    });

    it("returns a group held through two overlapping rows once", async () => {
      const result = await getViewerGroups(viewer, orgA);
      expect(result.filter((g) => g.name === "Dual Row")).toHaveLength(1);
    });

    it("never crosses organizations (the viewer belongs to both)", async () => {
      const a = names(await getViewerGroups(viewer, orgA));
      const b = names(await getViewerGroups(viewer, orgB));
      expect(a).not.toContain("Bell Ringers");
      expect(b).toEqual(["Bell Ringers"]);
    });

    it("projects exactly { groupId, name }", async () => {
      const result = await getViewerGroups(viewer, orgA);
      expect(result.length).toBeGreaterThan(0);
      for (const row of result) {
        expect(Object.keys(row).sort()).toEqual(["groupId", "name"]);
      }
    });

    it("takes exactly two parameters — there is no target-person argument", () => {
      expect(getViewerGroups.length).toBe(2);
    });

    it("decides 'today' by the ORG's zone, not the server's or the database's", async () => {
      const platform = getPlatformDb();
      await platform
        .update(organizationSettings)
        .set({ timeZone: "Pacific/Auckland" })
        .where(eq(organizationSettings.organizationId, orgA));
      try {
        // Auckland (UTC+13) says it is already 03-02 afternoon, while New York
        // is still on 03-01: "Ends Tomorrow Local" has ended and "Starts
        // Tomorrow Local" has begun.
        const result = names(await getViewerGroups(viewer, orgA));
        expect(result).not.toContain("Ends Tomorrow Local");
        expect(result).toContain("Starts Tomorrow Local");
      } finally {
        await platform
          .update(organizationSettings)
          .set({ timeZone: "America/New_York" })
          .where(eq(organizationSettings.organizationId, orgA));
      }
    });

    it("falls back to the default zone (New York) when the org has no settings row", async () => {
      const platform = getPlatformDb();
      await platform
        .delete(organizationSettings)
        .where(eq(organizationSettings.organizationId, orgA));
      try {
        const result = names(await getViewerGroups(viewer, orgA));
        expect(result).toContain("Ends Tomorrow Local");
        expect(result).not.toContain("Starts Tomorrow Local");
      } finally {
        await platform
          .insert(organizationSettings)
          .values({ organizationId: orgA, timeZone: "America/New_York" });
      }
    });

    it("returns [] when no membership is current", async () => {
      // Before every fixture membership started, nothing is current.
      vi.setSystemTime(new Date("1999-01-01T12:00:00Z"));
      expect(await getViewerGroups(viewer, orgA)).toEqual([]);
    });

    it("rejects with OrgAccessError for a person with no relationship to the org", async () => {
      await expect(getViewerGroups(outsider, orgA)).rejects.toMatchObject({
        name: "OrgAccessError",
      });
    });

    it("lets a genuine DB failure propagate rather than swallowing it", async () => {
      await expect(getViewerGroups("not-a-uuid", orgA)).rejects.toThrow();
    });
  },
);
