/**
 * Integration tests for src/lib/filings.ts — run against a REAL Postgres
 * connection, not mocked. Same harness as `src/lib/presbytery.test.ts` /
 * `src/lib/statistics-grants.test.ts`: the `hasDb` skip-guard, dynamic
 * imports inside `beforeAll` (this file's own top-level import of
 * `./filings` would otherwise reach `@/lib/db`'s module-scope pool
 * construction before `DATABASE_URL` is confirmed set).
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is
 * SKIPPED there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/filings.test.ts
 *
 * FIXTURE: `scripts/seed-dev.sql`'s Alder Creek (managed congregation,
 * `22222222-...`) — the ONE congregation in the dev fixture whose
 * `stated_clerk` (Tobias Renwick, `c...0002` / user `e...f3`) holds
 * `statistics.publish` (`drizzle/0052`'s own template-role reasoning: the
 * permission has zero real default-role bindings outside this fixture and
 * the new congregation_stated_clerk template, which nothing here has
 * adopted). Marguerite Ashcombe (`c...0001`) is an Alder Creek member who
 * does NOT hold `statistics.publish` — the `forbidden` fixture.
 *
 * REPORT YEARS 2071-2079 are this file's OWN exclusive range: never the
 * SEEDED Alder Creek publication (`a9000000-...-1`, report year 2025 —
 * pinned by literal id in `scripts/test-rls.sql` and
 * `src/lib/db/domain/publication.test.ts`) and never that file's own
 * rolled-back 2091/2094/2097-2099 probes.
 *
 * NOTHING FROM THIS FILE PERSISTS, but unlike `publication.test.ts`'s
 * rolled-back probes, `withdrawFiling()` runs through `withOrgContext()` —
 * a REAL `db.transaction()` that COMMITS on success — so every fixture row
 * this file builds is torn down in `afterAll` the same way
 * `presbytery.test.ts`/`statistics-grants.test.ts` tear down their own
 * `published_by_congregation` rows: the three freeze triggers
 * (`statistical_returns_freeze`/`publications_freeze`/
 * `congregation_statistics_freeze`) are disabled around the cascade, then
 * re-enabled.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

/** scripts/seed-dev.sql fixtures. */
const NORTHERN_REACH = "11111111-1111-1111-1111-111111111111";
const ALDER_CREEK = "22222222-2222-2222-2222-222222222222"; // managed
const RENWICK_PERSON = "c0000000-0000-0000-0000-000000000002"; // holds statistics.publish (stated_clerk)
const RENWICK_USER = "e0000000-0000-0000-0000-0000000000f3";
const ASHCOMBE_PERSON = "c0000000-0000-0000-0000-000000000001"; // Alder Creek member, no statistics.publish

describe.skipIf(!hasDb)("filings.ts (Postgres-backed, real dev database)", () => {
  let listOwnFilings: typeof import("./filings").listOwnFilings;
  let withdrawFiling: typeof import("./filings").withdrawFiling;
  let MINUTE_REFERENCE_MAX: typeof import("./filings").MINUTE_REFERENCE_MAX;

  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let publications: typeof import("@/lib/db/domain/publication").publications;
  let statisticalReturns: typeof import("@/lib/db/domain/returns").statisticalReturns;
  let congregationStatistics: typeof import("@/lib/db/domain/presbytery").congregationStatistics;

  const createdReturnIds: string[] = [];
  const createdPublicationIds: string[] = [];
  const createdStatsIds: string[] = [];

  beforeAll(async () => {
    ({ listOwnFilings, withdrawFiling, MINUTE_REFERENCE_MAX } = await import("./filings"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ publications } = await import("@/lib/db/domain/publication"));
    ({ statisticalReturns } = await import("@/lib/db/domain/returns"));
    ({ congregationStatistics } = await import("@/lib/db/domain/presbytery"));
  });

  afterAll(async () => {
    const platform = getPlatformDb();
    await platform.execute(
      sql`alter table congregation_statistics disable trigger congregation_statistics_freeze`,
    );
    await platform.execute(
      sql`alter table publications disable trigger publications_freeze`,
    );
    await platform.execute(
      sql`alter table statistical_returns disable trigger statistical_returns_freeze`,
    );
    try {
      if (createdStatsIds.length) {
        await platform
          .delete(congregationStatistics)
          .where(inArray(congregationStatistics.id, createdStatsIds));
      }
      if (createdPublicationIds.length) {
        await platform
          .delete(publications)
          .where(inArray(publications.id, createdPublicationIds));
      }
      if (createdReturnIds.length) {
        await platform
          .delete(statisticalReturns)
          .where(inArray(statisticalReturns.id, createdReturnIds));
      }
    } finally {
      await platform.execute(
        sql`alter table statistical_returns enable trigger statistical_returns_freeze`,
      );
      await platform.execute(
        sql`alter table publications enable trigger publications_freeze`,
      );
      await platform.execute(
        sql`alter table congregation_statistics enable trigger congregation_statistics_freeze`,
      );
    }
  });

  /**
   * Mints a full statistical_returns -> publications -> congregation_
   * statistics TRIPLE for Alder Creek, addressed to Northern Reach — the
   * shape `presby_withdraw_publication()`'s "exactly one projection row"
   * assertion requires (drizzle/0052 step 6/architect's structural
   * requirement 7). Same convention as `presbytery.test.ts`'s
   * `armedPublicationWrite()` + `makePublication()`, duplicated here per
   * this file's own per-module-duplication note rather than imported —
   * every hand-written row in this chain is guarded on every connection
   * (F55/DECISION-141), owner included, so the GUC is armed for the whole
   * triple in one transaction.
   */
  async function publishFixture(reportYear: number, publishedAt: Date): Promise<string> {
    const platform = getPlatformDb();
    return platform.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('presby.publication_write_active', 'true', true)`,
      );
      const [artifact] = await tx
        .insert(statisticalReturns)
        .values({
          organizationId: ALDER_CREEK,
          aboutOrgId: ALDER_CREEK,
          reportYear,
          formVersionKey: "2024",
          provenance: "submitted",
          payload: { ending_active: 100 },
          reconciled: true,
          attestedAt: publishedAt,
        })
        .returning({ id: statisticalReturns.id });
      createdReturnIds.push(artifact!.id);

      const [publication] = await tx
        .insert(publications)
        .values({
          organizationId: ALDER_CREEK,
          recipientOrgId: NORTHERN_REACH,
          recordClass: "statistical_return",
          artifactId: artifact!.id,
          publishedAt,
          minuteReference: "Fixture session minute, filings.test.ts",
        })
        .returning({ id: publications.id });
      createdPublicationIds.push(publication!.id);

      const [stats] = await tx
        .insert(congregationStatistics)
        .values({
          organizationId: NORTHERN_REACH,
          aboutOrgId: ALDER_CREEK,
          year: reportYear,
          provenance: "published_by_congregation",
          publicationId: publication!.id,
          publishedAt,
          minuteReference: "Fixture session minute, filings.test.ts",
          endingActive: 100,
        })
        .returning({ id: congregationStatistics.id });
      createdStatsIds.push(stats!.id);

      return publication!.id;
    });
  }

  /**
   * Supersedes `predecessorId` with a fresh publication for the SAME report
   * year — `publications_supersession`'s own requirement
   * (`drizzle/0047` section 2b: same organization_id, recipient_org_id,
   * record_class, and (for a statistical_return) the artifact's report
   * year). Deliberately does NOT insert a matching congregation_statistics
   * row for the successor — nothing in this file withdraws it, only the
   * PREDECESSOR, to prove the "superseded" refusal.
   */
  async function supersedeFixture(
    predecessorId: string,
    reportYear: number,
    publishedAt: Date,
  ): Promise<string> {
    const platform = getPlatformDb();
    return platform.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('presby.publication_write_active', 'true', true)`,
      );
      const [artifact] = await tx
        .insert(statisticalReturns)
        .values({
          organizationId: ALDER_CREEK,
          aboutOrgId: ALDER_CREEK,
          reportYear,
          formVersionKey: "2024",
          provenance: "submitted",
          payload: { ending_active: 101 },
          reconciled: true,
          attestedAt: publishedAt,
        })
        .returning({ id: statisticalReturns.id });
      createdReturnIds.push(artifact!.id);

      const [publication] = await tx
        .insert(publications)
        .values({
          organizationId: ALDER_CREEK,
          recipientOrgId: NORTHERN_REACH,
          recordClass: "statistical_return",
          artifactId: artifact!.id,
          publishedAt,
          supersedesId: predecessorId,
          minuteReference: "Fixture correction, filings.test.ts",
        })
        .returning({ id: publications.id });
      createdPublicationIds.push(publication!.id);

      return publication!.id;
    });
  }

  // ---------------------------------------------------------------------
  // listOwnFilings
  // ---------------------------------------------------------------------

  describe("listOwnFilings", () => {
    it("forbidden without statistics.publish", async () => {
      const result = await listOwnFilings(ASHCOMBE_PERSON, ALDER_CREEK);
      expect(result.kind).toBe("forbidden");
    });

    it("returns the congregation's own publication, filtered by year, carrying the whole withdrawal triple (null when not withdrawn)", async () => {
      const publishedAt = new Date("2071-02-01T00:00:00Z");
      const id = await publishFixture(2071, publishedAt);

      const result = await listOwnFilings(RENWICK_PERSON, ALDER_CREEK, 2071);
      if (result.kind !== "ok") throw new Error("expected ok");
      const row = result.data.find((r) => r.publicationId === id);
      expect(row).toBeDefined();
      expect(row?.reportYear).toBe(2071);
      expect(row?.supersedesId).toBeNull();
      expect(row?.withdrawnAt).toBeNull();
      expect(row?.withdrawnBy).toBeNull();
      expect(row?.withdrawnMinuteReference).toBeNull();
      expect(row?.minuteReference).toBe("Fixture session minute, filings.test.ts");
    });

    it("a year with no filings returns an empty ok list, not forbidden or invalid_target", async () => {
      const result = await listOwnFilings(RENWICK_PERSON, ALDER_CREEK, 1901);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.data).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------
  // withdrawFiling
  // ---------------------------------------------------------------------

  describe("withdrawFiling", () => {
    it("the happy path: withdraws the current filing, returns its id, and the read-back carries the attributed triple", async () => {
      const publishedAt = new Date("2072-02-01T00:00:00Z");
      const id = await publishFixture(2072, publishedAt);

      const result = await withdrawFiling(
        RENWICK_PERSON,
        ALDER_CREEK,
        RENWICK_USER,
        id,
        "Session stated meeting, 2072-02-15, item 3",
      );
      expect(result).toEqual({
        kind: "ok",
        data: { id, recipientOrgId: NORTHERN_REACH, reportYear: 2072 },
      });

      const after = await listOwnFilings(RENWICK_PERSON, ALDER_CREEK, 2072);
      if (after.kind !== "ok") throw new Error("expected ok");
      const row = after.data.find((r) => r.publicationId === id);
      expect(row?.withdrawnAt).not.toBeNull();
      expect(row?.withdrawnBy).toBe(RENWICK_USER);
      expect(row?.withdrawnMinuteReference).toBe(
        "Session stated meeting, 2072-02-15, item 3",
      );
    });

    it("forbidden without statistics.publish — the DB is never reached", async () => {
      const publishedAt = new Date("2073-02-01T00:00:00Z");
      const id = await publishFixture(2073, publishedAt);

      const result = await withdrawFiling(
        ASHCOMBE_PERSON,
        ALDER_CREEK,
        RENWICK_USER,
        id,
        "irrelevant",
      );
      expect(result.kind).toBe("forbidden");

      // Still withdrawable afterward — the forbidden attempt did nothing.
      const stillLive = await listOwnFilings(RENWICK_PERSON, ALDER_CREEK, 2073);
      if (stillLive.kind !== "ok") throw new Error("expected ok");
      expect(stillLive.data.find((r) => r.publicationId === id)?.withdrawnAt).toBeNull();
    });

    it("invalid_input for a blank minute reference — never reaches the database", async () => {
      const publishedAt = new Date("2074-02-01T00:00:00Z");
      const id = await publishFixture(2074, publishedAt);

      const result = await withdrawFiling(RENWICK_PERSON, ALDER_CREEK, RENWICK_USER, id, "   ");
      expect(result.kind).toBe("invalid_input");

      const stillLive = await listOwnFilings(RENWICK_PERSON, ALDER_CREEK, 2074);
      if (stillLive.kind !== "ok") throw new Error("expected ok");
      expect(stillLive.data.find((r) => r.publicationId === id)?.withdrawnAt).toBeNull();
    });

    it("invalid_input for a minute reference over MINUTE_REFERENCE_MAX characters", async () => {
      const publishedAt = new Date("2075-02-01T00:00:00Z");
      const id = await publishFixture(2075, publishedAt);

      const result = await withdrawFiling(
        RENWICK_PERSON,
        ALDER_CREEK,
        RENWICK_USER,
        id,
        "x".repeat(MINUTE_REFERENCE_MAX + 1),
      );
      expect(result.kind).toBe("invalid_input");
    });

    it("invalid_target — the uniform literal — for a publication id that does not exist", async () => {
      const result = await withdrawFiling(
        RENWICK_PERSON,
        ALDER_CREEK,
        RENWICK_USER,
        randomUUID(),
        "irrelevant",
      );
      expect(result.kind).toBe("invalid_target");
    });

    it("invalid_target — the SAME uniform literal — when the acting user is not an active member of the acting congregation", async () => {
      // F91 (Batch A): presby_withdraw_publication()'s step 3 binds
      // p_withdrawn_by to an ACTIVE MEMBER of the acting org via
      // presby_membership_is_active(), not a bare organization_id column on
      // people (which does not exist). A random uuid matches no person's
      // user_id at all, which is the same "that identity claim does not
      // stand up" shape as a bad publication id — and per DECISION-152 both
      // collapse to the identical FilingsResult kind.
      const publishedAt = new Date("2076-02-01T00:00:00Z");
      const id = await publishFixture(2076, publishedAt);

      const result = await withdrawFiling(
        RENWICK_PERSON,
        ALDER_CREEK,
        randomUUID(),
        id,
        "irrelevant",
      );
      expect(result.kind).toBe("invalid_target");

      // Untouched — the refused call did not half-apply anything.
      const stillLive = await listOwnFilings(RENWICK_PERSON, ALDER_CREEK, 2076);
      if (stillLive.kind !== "ok") throw new Error("expected ok");
      expect(stillLive.data.find((r) => r.publicationId === id)?.withdrawnAt).toBeNull();
    });

    it("already_withdrawn on a second attempt against the same publication", async () => {
      const publishedAt = new Date("2077-02-01T00:00:00Z");
      const id = await publishFixture(2077, publishedAt);

      const first = await withdrawFiling(
        RENWICK_PERSON,
        ALDER_CREEK,
        RENWICK_USER,
        id,
        "First withdrawal",
      );
      expect(first.kind).toBe("ok");

      const second = await withdrawFiling(
        RENWICK_PERSON,
        ALDER_CREEK,
        RENWICK_USER,
        id,
        "Second attempt",
      );
      expect(second.kind).toBe("already_withdrawn");
    });

    it("superseded — a publication with a later correction may not be withdrawn", async () => {
      const firstAt = new Date("2078-02-01T00:00:00Z");
      const secondAt = new Date("2078-06-01T00:00:00Z");
      const predecessorId = await publishFixture(2078, firstAt);
      await supersedeFixture(predecessorId, 2078, secondAt);

      const result = await withdrawFiling(
        RENWICK_PERSON,
        ALDER_CREEK,
        RENWICK_USER,
        predecessorId,
        "Attempted withdrawal of a superseded filing",
      );
      expect(result.kind).toBe("superseded");
    });

    it("already_withdrawn and superseded are DISTINCT from each other and from invalid_target — the three refusal kinds never collapse into one another", async () => {
      const firstAt = new Date("2079-02-01T00:00:00Z");
      const secondAt = new Date("2079-06-01T00:00:00Z");
      const withdrawnId = await publishFixture(2079, firstAt);
      const withdrawnResult = await withdrawFiling(
        RENWICK_PERSON,
        ALDER_CREEK,
        RENWICK_USER,
        withdrawnId,
        "Withdrawal",
      );
      expect(withdrawnResult.kind).toBe("ok");
      const alreadyWithdrawn = await withdrawFiling(
        RENWICK_PERSON,
        ALDER_CREEK,
        RENWICK_USER,
        withdrawnId,
        "Second attempt",
      );

      // A second, INDEPENDENT published_by_congregation row for the same
      // (organizationId, aboutOrgId, year) is legal — congregation_
      // statistics_entered_unique_idx is partial and deliberately EXCLUDES
      // 'published_by_congregation' rows (presbytery.ts's own "a republish
      // is a new frozen row, never an UPDATE" fixture proves the same
      // property) — so this predecessor/successor chain can share year 2079
      // with the already-withdrawn one above without colliding.
      const predecessorId = await publishFixture(2079, secondAt);
      await supersedeFixture(predecessorId, 2079, new Date("2079-09-01T00:00:00Z"));
      const superseded = await withdrawFiling(
        RENWICK_PERSON,
        ALDER_CREEK,
        RENWICK_USER,
        predecessorId,
        "Attempted withdrawal of a superseded filing",
      );

      const badId = await withdrawFiling(
        RENWICK_PERSON,
        ALDER_CREEK,
        RENWICK_USER,
        randomUUID(),
        "irrelevant",
      );

      expect(alreadyWithdrawn.kind).toBe("already_withdrawn");
      expect(superseded.kind).toBe("superseded");
      expect(badId.kind).toBe("invalid_target");
      const kinds = new Set([alreadyWithdrawn.kind, superseded.kind, badId.kind]);
      expect(kinds.size).toBe(3);
    });
  });
});
