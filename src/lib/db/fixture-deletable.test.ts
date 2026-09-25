/**
 * The fixture-leak canary for `deletable_until` (N-6 / G1).
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT IN `scripts/test-rls.sql`.
 *
 * `drizzle/0048_presby_security_b.sql` section 8 gave `people` the owner-path
 * BEFORE DELETE guard `organizations` already had, with the same
 * `deletable_until` fixture exemption. That turned a pre-existing nuisance
 * into a permanent one: a fixture row a suite forgets to tear down used to be
 * clutter, and now becomes UNDELETABLE ON EVERY CONNECTION two hours later —
 * `presby_app` holds no DELETE grant on `people`, and the owner path
 * (`getPlatformDb()`, = `neondb_owner`) hits `presby_guard_people_delete()`.
 * A grant never binds the owner; a trigger does (F44). The two-hour window is
 * the only chance to remove one.
 *
 * The first attempt at this canary shipped inside `scripts/test-rls.sql` as
 *
 *     select assert_eq(
 *       (select count(*) from people where deletable_until is not null),
 *       0, 'N-6: no person row carries a deletion window right now');
 *
 * and QA caught it on 2026-09-25 as AN ASSERTION THAT CANNOT FAIL. That suite
 * runs as `presby_app`, the block set no org context, and `people` is FORCE
 * ROW LEVEL SECURITY — so the count is 0 of 678 rows on that connection
 * whatever the table holds. It reported `pass` in a green 456-assertion run
 * while three leaked stamped rows sat in `people`. An assertion that agrees
 * with itself proves nothing; that is the whole reason F1 exists.
 *
 * The claim is an OWNER-PATH claim about rows the tenant connection is not
 * permitted to see, so it cannot honestly be made from `presby_app` at all —
 * not even with an org context, since a leak can be in any org, or (for a
 * person with no membership) in none. It belongs here, on `getPlatformDb()`.
 *
 * AND THIS CANARY PROVES IT CAN FAIL. The first test in each pair plants a
 * row shaped exactly like a leak, asserts the detector finds it, and removes
 * it again. Without that, this file would be the same vacuous check in a new
 * costume.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import {
  FIXTURE_TEARDOWN_WINDOW_MS,
  STALE_FIXTURE_STAMP_GRACE_MS,
  staleFixtureStampCutoff,
} from "./fixture-deletable";

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "deletable_until fixture-leak canary (Postgres-backed, real dev database)",
  () => {
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let people: typeof import("@/lib/db/domain/people").people;
    let organizations: typeof import("@/lib/db/domain/org").organizations;

    const stamp = Date.now();
    /** Rows this file plants, so its own probes can never be the leak. */
    const plantedPeople: string[] = [];
    const plantedOrgs: string[] = [];

    beforeAll(async () => {
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ people } = await import("@/lib/db/domain/people"));
      ({ organizations } = await import("@/lib/db/domain/org"));
    });

    afterAll(async () => {
      const platform = getPlatformDb();
      for (const id of plantedPeople) {
        await platform.delete(people).where(eq(people.id, id));
      }
      for (const id of plantedOrgs) {
        await platform.delete(organizations).where(eq(organizations.id, id));
      }
    });

    /**
     * A row is LEAKED when its window is already older than a fresh stamp by
     * more than the grace period — i.e. it has outlived whatever suite
     * created it. See `staleFixtureStampCutoff()` for the arithmetic and for
     * the blind spot this deliberately accepts.
     */
    async function leakedPeople() {
      return getPlatformDb()
        .select({
          id: people.id,
          firstName: people.firstName,
          lastName: people.lastName,
          deletableUntil: people.deletableUntil,
        })
        .from(people)
        .where(
          and(
            isNotNull(people.deletableUntil),
            lte(people.deletableUntil, staleFixtureStampCutoff()),
          ),
        );
    }

    async function leakedOrganizations() {
      return getPlatformDb()
        .select({
          id: organizations.id,
          slug: organizations.slug,
          deletableUntil: organizations.deletableUntil,
        })
        .from(organizations)
        .where(
          and(
            isNotNull(organizations.deletableUntil),
            lte(organizations.deletableUntil, staleFixtureStampCutoff()),
          ),
        );
    }

    function describeLeak(
      rows: Array<{ deletableUntil: Date | null }>,
      label: (r: never) => string,
    ): string {
      return rows
        .map((r) => {
          const until = r.deletableUntil;
          const minutesLeft = until
            ? Math.round((until.getTime() - Date.now()) / 60_000)
            : 0;
          return `${label(r as never)} (window ${
            minutesLeft > 0 ? `closes in ${minutesLeft}m` : "ALREADY CLOSED"
          }, deletable_until=${until?.toISOString()})`;
        })
        .join("\n  ");
    }

    // -----------------------------------------------------------------------
    // people
    // -----------------------------------------------------------------------

    it("the canary itself can fail: a stamped people row that has outlived its suite is detected", async () => {
      const platform = getPlatformDb();
      // Shaped exactly like a real leak: a two-hour window opened long enough
      // ago that the grace period has passed. One minute past the cutoff, so
      // the boundary itself is exercised rather than a comfortable margin.
      const agedWindow = new Date(
        Date.now() +
          FIXTURE_TEARDOWN_WINDOW_MS -
          STALE_FIXTURE_STAMP_GRACE_MS -
          60_000,
      );
      const [planted] = await platform
        .insert(people)
        .values({
          firstName: "Canary",
          lastName: `StaleStamp${stamp}`,
          deletableUntil: agedWindow,
        })
        .returning({ id: people.id });
      plantedPeople.push(planted!.id);

      const found = await leakedPeople();
      expect(found.map((r) => r.id)).toContain(planted!.id);

      // And a FRESH stamp is not flagged — otherwise this canary would fail
      // every run on its own in-flight fixtures.
      const [fresh] = await platform
        .insert(people)
        .values({
          firstName: "Canary",
          lastName: `FreshStamp${stamp}`,
          deletableUntil: new Date(Date.now() + FIXTURE_TEARDOWN_WINDOW_MS),
        })
        .returning({ id: people.id });
      plantedPeople.push(fresh!.id);

      const found2 = await leakedPeople();
      expect(found2.map((r) => r.id)).not.toContain(fresh!.id);
    });

    it("no leaked stamped people row is outstanding — regression for the tickets.test.ts fixture leak (G2)", async () => {
      const found = (await leakedPeople()).filter(
        (r) => !plantedPeople.includes(r.id),
      );
      expect(
        found.length,
        found.length === 0
          ? ""
          : `\n${found.length} leaked fixture person row(s) are outstanding. ` +
              `Once the window closes they are PERMANENT on every connection ` +
              `(presby_app has no DELETE grant; the owner path hits ` +
              `presby_guard_people_delete()). Remove them NOW, on the owner ` +
              `connection:\n` +
              `  delete from people where deletable_until is not null and deletable_until > now();\n` +
              `Then find the suite whose afterAll does not tear its fixture down.\n  ` +
              describeLeak(
                found,
                (r: { id: string; firstName: string; lastName: string }) =>
                  `${r.id} ${r.firstName} ${r.lastName}`,
              ),
      ).toBe(0);
    });

    it("no stamped people row has an EXPIRED window — an expired one is already unrecoverable", async () => {
      // Distinct from the assertion above, and strictly worse: these rows are
      // past saving. They can only be removed by dropping the trigger, which
      // is a production-grade intervention, not a test fixup. Exact, no
      // heuristic — a live fixture's window is two hours out.
      const rows = await getPlatformDb()
        .select({ id: people.id, deletableUntil: people.deletableUntil })
        .from(people)
        .where(
          and(
            isNotNull(people.deletableUntil),
            lte(people.deletableUntil, new Date()),
          ),
        );
      expect(
        rows.length,
        rows.length === 0
          ? ""
          : `\n${rows.length} stamped person row(s) have ALREADY EXPIRED and can no ` +
              `longer be deleted on any connection: ${rows
                .map((r) => r.id)
                .join(", ")}`,
      ).toBe(0);
    });

    // -----------------------------------------------------------------------
    // organizations — the same mechanism, the same helper, the same hazard
    // (D10 / drizzle/0044). Covered here so the two never drift apart.
    // -----------------------------------------------------------------------

    it("the canary covers organizations too, and can fail there as well", async () => {
      const platform = getPlatformDb();
      const agedWindow = new Date(
        Date.now() +
          FIXTURE_TEARDOWN_WINDOW_MS -
          STALE_FIXTURE_STAMP_GRACE_MS -
          60_000,
      );
      const [planted] = await platform
        .insert(organizations)
        .values({
          name: "Canary Stale Stamp Fellowship",
          slug: `canary-stale-${stamp}`,
          path: `canary_stale_${stamp}`,
          organizationType: "congregation",
          deletableUntil: agedWindow,
        })
        .returning({ id: organizations.id });
      plantedOrgs.push(planted!.id);

      const found = await leakedOrganizations();
      expect(found.map((r) => r.id)).toContain(planted!.id);
    });

    it("no leaked stamped organization row is outstanding", async () => {
      const found = (await leakedOrganizations()).filter(
        (r) => !plantedOrgs.includes(r.id),
      );
      expect(
        found.length,
        found.length === 0
          ? ""
          : `\n${found.length} leaked fixture organization row(s) are outstanding ` +
              `(presby_guard_organizations_delete(), drizzle/0044). Remove them ` +
              `on the owner connection before the window closes:\n  ` +
              describeLeak(
                found,
                (r: { id: string; slug: string }) => `${r.id} ${r.slug}`,
              ),
      ).toBe(0);
    });
  },
);
