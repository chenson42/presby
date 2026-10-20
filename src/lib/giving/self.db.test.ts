/**
 * self.ts against a REAL Postgres connection - the member self-read
 * (docs/work-log/2026-10-15-online-giving.md, Batch 6; DECISION-162's four
 * conditions). RLS on the giving tables is tenancy-only, so "these are MY rows"
 * is an application predicate and this file is what holds it:
 *
 *   - another member's rows, another organization's rows, a spouse in the same
 *     household, a Session member and a giving.view holder see NOTHING of mine
 *     (and I see nothing of theirs);
 *   - a directory-hidden member still sees their own history;
 *   - the rows of a donor merged into mine are mine, as a merge SOURCE, and a
 *     stale link on that source never shows a third member those rows;
 *   - test-mode gifts are not history, pending and failed gifts are shown with
 *     their status, reversals are netted;
 *   - toggle off / not applicable are answers, a database failure THROWS;
 *   - the download lookup re-derives the same ownership and answers "not found"
 *     identically for absent, malformed, someone else's, another org's and
 *     "giving is off".
 * Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/giving/self.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { GivingFixture } from "@/lib/testing/giving-fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({ AUDIT_ACTIONS: {}, recordAudit: vi.fn() }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const YEAR = new Date().getUTCFullYear() - 1;
const inYear = (monthDay: string) => `${YEAR}-${monthDay}`;

type Member = { personId: string; membershipId: string };

describe.skipIf(!hasDb)("self.ts (Postgres-backed)", () => {
  let fx: GivingFixture;
  let appDb: typeof import("@/lib/db").db;
  let self: typeof import("./self");
  let issueStatement: typeof import("@/lib/testing/giving-fixture").issueStatement;
  let OrgAccessError: typeof import("@/lib/authz").OrgAccessError;

  let org: string;
  let orgB: string;
  let fund: string;
  let fundB: string;
  let conn: string;
  let treasurerUser: string;

  async function q(query: ReturnType<typeof sql>) {
    return fx.rowsOf(await fx.platform.execute(query));
  }

  async function member(organizationId: string, first: string, last: string, keys: readonly string[] = []): Promise<Member> {
    const personId = await fx.makePerson(first, last);
    await fx.enroll(organizationId, personId, keys);
    return { personId, membershipId: await fx.membershipOf(organizationId, personId) };
  }

  type AppTx = Parameters<Parameters<typeof appDb.transaction>[0]>[0];
  async function asTenant<T>(orgId: string, fn: (tx: AppTx) => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
      return fn(tx);
    });
  }

  function issue(organizationId: string, donorId: string, extra: { version?: number; supersedesId?: string | null } = {}) {
    return asTenant(organizationId, (tx) =>
      issueStatement(tx, { organizationId, donorId, taxYear: YEAR, issuedBy: treasurerUser, ...extra }),
    );
  }

  async function ok(personId: string, organizationId = org) {
    const result = await self.getMyGiving(personId, organizationId);
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    return result;
  }

  beforeAll(async () => {
    ({ db: appDb } = await import("@/lib/db"));
    ({ OrgAccessError } = await import("@/lib/authz"));
    const mod = await import("@/lib/testing/giving-fixture");
    issueStatement = mod.issueStatement;
    fx = await mod.createGivingFixture("giving-self-test");
    self = await import("./self");

    org = await fx.makeOrg("a", { givingToggle: true });
    orgB = await fx.makeOrg("b", { givingToggle: true });
    await fx.makeGivingSettings(org);
    await fx.makeGivingSettings(orgB);
    conn = await fx.makeConnection(org, { livemode: true });
    fund = await fx.makeFund(org, "General Fund");
    fundB = await fx.makeFund(orgB, "Other Church Fund");
    treasurerUser = (await fx.makeActor(org, "Imogen", "Ledgerwood", ["giving.manage", "giving.view", "giving.record"])).userId;
    await fx.makeActor(orgB, "Orla", "Bookkeeper", ["giving.manage", "giving.view", "giving.record"]);
  }, 120_000);

  afterAll(async () => {
    await fx?.cleanup();
  });

  // -----------------------------------------------------------------------
  describe("what a member sees of their own giving", () => {
    let alma: Member;
    let donor: string;
    let cash: string;
    let online: string;
    let pending: string;

    beforeAll(async () => {
      alma = await member(org, "Alma", "Pennywhistle");
      donor = await fx.makeDonor(org, "Alma Pennywhistle", { email: "alma@example.invalid", linkedMembershipId: alma.membershipId });
      cash = await fx.makeOfflineGift(org, donor, fund, 5000, { occurredOn: inYear("03-03") });
      online = await fx.makeOnlineGift(org, conn, donor, fund, 7500, { occurredOn: inYear("06-01") });
      pending = await fx.makeOnlineGift(org, conn, donor, fund, 2500, { status: "pending", occurredOn: inYear("07-01") });
      await fx.makeReversal(org, conn, online, "refund", 2000);
    });

    it("lists their gifts newest first with the donor-facing fields and reversals netted", async () => {
      const result = await ok(alma.personId);
      expect(result.giftsTruncated).toBe(false);
      expect(result.gifts).toEqual([
        { id: pending, occurredOn: inYear("07-01"), fundName: "General Fund", amountCents: 2500, status: "pending", reversedCents: 0 },
        { id: online, occurredOn: inYear("06-01"), fundName: "General Fund", amountCents: 7500, status: "succeeded", reversedCents: 2000 },
        { id: cash, occurredOn: inYear("03-03"), fundName: "General Fund", amountCents: 5000, status: "succeeded", reversedCents: 0 },
      ]);
    });

    it("projects ONLY the display fields - no donor, recorder, memo, method, fee or net", async () => {
      const result = await ok(alma.personId);
      expect(Object.keys(result.gifts[0]!).sort()).toEqual(["amountCents", "fundName", "id", "occurredOn", "reversedCents", "status"]);
      expect(JSON.stringify(result)).not.toMatch(/alma@example|Pennywhistle/);
    });

    it("a test-mode gift is practice, not history", async () => {
      const testGift = await fx.makeOnlineGift(org, conn, donor, fund, 1900, { livemode: false, occurredOn: inYear("08-08") });
      const result = await ok(alma.personId);
      expect(result.gifts.map((g) => g.id)).not.toContain(testGift);
      expect(result.gifts).toHaveLength(3);
    });

    it("a failed gift is shown with its status, never hidden", async () => {
      const failed = await fx.makeOnlineGift(org, conn, donor, fund, 1200, { status: "failed", occurredOn: inYear("09-09") });
      const result = await ok(alma.personId);
      expect(result.gifts.find((g) => g.id === failed)).toMatchObject({ status: "failed", amountCents: 1200 });
    });

    it("lists their statements, flags superseded versions, and exposes only the display fields", async () => {
      const v1 = await issue(org, donor);
      const v2 = await issue(org, donor, { version: 2, supersedesId: v1.statementId });
      const result = await ok(alma.personId);
      expect(result.statements.map((s) => ({ id: s.id, version: s.version, superseded: s.superseded, mergedSource: s.mergedSource }))).toEqual([
        { id: v2.statementId, version: 2, superseded: false, mergedSource: false },
        { id: v1.statementId, version: 1, superseded: true, mergedSource: false },
      ]);
      expect(Object.keys(result.statements[0]!).sort()).toEqual(["id", "issuedAt", "mergedSource", "superseded", "taxYear", "version"]);
      expect(result.statements[0]!.taxYear).toBe(YEAR);
      expect(result.statements[0]!.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    it("a gift past the page limit is reported as truncated, not silently dropped", async () => {
      const heavy = await member(org, "Hester", "Overflow");
      const heavyDonor = await fx.makeDonor(org, "Hester Overflow", { linkedMembershipId: heavy.membershipId });
      await q(sql`
        with armed as (select set_config('presby.giving_write_active', 'true', true))
        insert into giving_gifts (organization_id, donor_id, fund_id, source, method, amount_cents, status, occurred_on, livemode, recorded_by)
        select ${org}::uuid, ${heavyDonor}::uuid, ${fund}::uuid, 'offline', 'cash', 100, 'succeeded', date '2020-01-01' + n, true, ${treasurerUser}::uuid
          from armed, generate_series(1, ${self.MY_GIFTS_LIMIT + 5}) as n`);
      const result = await ok(heavy.personId);
      expect(result.gifts).toHaveLength(self.MY_GIFTS_LIMIT);
      expect(result.giftsTruncated).toBe(true);
      // newest first: the oldest 5 are the ones cut
      expect(result.gifts[0]!.occurredOn > result.gifts.at(-1)!.occurredOn).toBe(true);
    }, 60_000);
  });

  // -----------------------------------------------------------------------
  describe("nobody else's rows, and nobody else sees mine", () => {
    let alma: Member;
    let basil: Member;
    let almaGift: string;
    let basilGift: string;
    let almaStatement: string;
    let basilStatement: string;

    beforeAll(async () => {
      alma = await member(org, "Alma", "Vantongeren");
      basil = await member(org, "Basil", "Quillfeather");
      const almaDonor = await fx.makeDonor(org, "Alma Vantongeren", { linkedMembershipId: alma.membershipId });
      const basilDonor = await fx.makeDonor(org, "Basil Quillfeather", { linkedMembershipId: basil.membershipId });
      almaGift = await fx.makeOfflineGift(org, almaDonor, fund, 4100, { occurredOn: inYear("02-02") });
      basilGift = await fx.makeOfflineGift(org, basilDonor, fund, 6200, { occurredOn: inYear("04-04") });
      almaStatement = (await issue(org, almaDonor)).statementId;
      basilStatement = (await issue(org, basilDonor)).statementId;
    });

    it("another member's gifts and statements are not returned - in either direction", async () => {
      const a = await ok(alma.personId);
      const b = await ok(basil.personId);
      expect(a.gifts.map((g) => g.id)).toEqual([almaGift]);
      expect(b.gifts.map((g) => g.id)).toEqual([basilGift]);
      expect(a.statements.map((s) => s.id)).toEqual([almaStatement]);
      expect(b.statements.map((s) => s.id)).toEqual([basilStatement]);
    });

    it("a member with no linked donor sees nothing (an empty list, not an error)", async () => {
      const stranger = await member(org, "Cornelius", "Nobody");
      const result = await ok(stranger.personId);
      expect(result).toMatchObject({ gifts: [], statements: [], giftsTruncated: false });
    });

    it("an unlinked donor with the member's NAME and EMAIL confers nothing", async () => {
      const doppel = await member(org, "Dorothea", "Lookalike");
      await q(sql`insert into person_identifiers (person_id, kind, value_normalized) values (${doppel.personId}, 'email', 'dorothea@example.invalid')`);
      const unlinked = await fx.makeDonor(org, "Dorothea Lookalike", { email: "dorothea@example.invalid" });
      await fx.makeOfflineGift(org, unlinked, fund, 999, { occurredOn: inYear("05-05") });
      expect((await ok(doppel.personId)).gifts).toEqual([]);
    });

    it("another organization's rows are never returned, and the other organization cannot be asked for at all", async () => {
      const inA = await member(org, "Evander", "Churchone");
      const inB = await member(orgB, "Fenwick", "Churchtwo");
      const donorA = await fx.makeDonor(org, "Evander Churchone", { linkedMembershipId: inA.membershipId });
      const donorB = await fx.makeDonor(orgB, "Fenwick Churchtwo", { linkedMembershipId: inB.membershipId });
      const giftA = await fx.makeOfflineGift(org, donorA, fund, 1100, { occurredOn: inYear("01-01") });
      const giftB = await fx.makeOfflineGift(orgB, donorB, fundB, 2200, { occurredOn: inYear("01-02") });
      expect((await ok(inA.personId, org)).gifts.map((g) => g.id)).toEqual([giftA]);
      expect((await ok(inB.personId, orgB)).gifts.map((g) => g.id)).toEqual([giftB]);
      // A member of A asking for B's giving is refused: no membership there.
      await expect(self.getMyGiving(inA.personId, orgB)).rejects.toBeInstanceOf(OrgAccessError);

      // A donor in B linked to A's membership id is refused by the composite FK - the row cannot exist.
      await expect(
        q(sql`insert into giving_donors (organization_id, display_name, linked_membership_id, link_source, linked_at)
              values (${orgB}, 'Cross Link', ${inA.membershipId}, 'recorder_confirmed', now())`),
      ).rejects.toThrow();
    });

    it("a person who is not a member of the organization is refused, not shown an empty list", async () => {
      const outsider = await fx.makePerson("Oswin", "Outsider");
      await expect(self.getMyGiving(outsider, org)).rejects.toBeInstanceOf(OrgAccessError);
      await expect(self.findMyStatementForDownload(outsider, org, almaStatement)).rejects.toBeInstanceOf(OrgAccessError);
    });

    it("an ended membership is refused too", async () => {
      const leaver = await member(org, "Lysander", "Gone");
      await q(sql`update memberships set ended_on = current_date - 1 where id = ${leaver.membershipId}`);
      await expect(self.getMyGiving(leaver.personId, org)).rejects.toBeInstanceOf(OrgAccessError);
    });
  });

  // -----------------------------------------------------------------------
  describe("household, Session and giving-key holders confer nothing", () => {
    it("a spouse in the same household sees nothing of the linked member's giving, and the reverse", async () => {
      const husband = await member(org, "Horatio", "Marchbanks");
      const wife = await member(org, "Hortensia", "Marchbanks");
      const [household] = await q(sql`insert into households (organization_id, name) values (${org}, 'The Marchbanks Household') returning id`);
      await q(sql`update memberships set household_id = ${household!.id}, household_role = 'head' where id = ${husband.membershipId}`);
      await q(sql`update memberships set household_id = ${household!.id}, household_role = 'spouse' where id = ${wife.membershipId}`);
      const donor = await fx.makeDonor(org, "Horatio Marchbanks", { linkedMembershipId: husband.membershipId });
      const gift = await fx.makeOfflineGift(org, donor, fund, 8800, { occurredOn: inYear("10-10") });
      const { statementId } = await issue(org, donor);

      expect((await ok(husband.personId)).gifts.map((g) => g.id)).toEqual([gift]);
      expect(await ok(wife.personId)).toMatchObject({ gifts: [], statements: [] });
      expect(await self.findMyStatementForDownload(wife.personId, org, statementId)).toEqual({ kind: "not_found" });
      expect((await self.findMyStatementForDownload(husband.personId, org, statementId)).kind).toBe("ok");

      // ...and a donor linked to the wife is hers alone.
      const wifeDonor = await fx.makeDonor(org, "Hortensia Marchbanks", { linkedMembershipId: wife.membershipId });
      const wifeGift = await fx.makeOfflineGift(org, wifeDonor, fund, 300, { occurredOn: inYear("11-11") });
      expect((await ok(wife.personId)).gifts.map((g) => g.id)).toEqual([wifeGift]);
      expect((await ok(husband.personId)).gifts.map((g) => g.id)).toEqual([gift]);
    });

    it("a Session member - and a giving.view / giving.manage holder - sees only their own, which may be nothing", async () => {
      const elder = await member(org, "Ptolemy", "Sessionman", ["giving.view", "giving.manage"]);
      const [type] = await q(sql`select id from group_types where key = 'roster'`);
      const [group] = await q(sql`
        insert into groups (organization_id, group_type_id, name, membership_source)
        values (${org}, ${type!.id}, 'Session (fixture)', 'managed') returning id`);
      await q(sql`
        insert into group_memberships (organization_id, group_id, person_id, group_role, source)
        values (${org}, ${group!.id}, ${elder.personId}, 'chair', 'managed')`);
      const other = await member(org, "Quentin", "Pewsitter");
      const otherDonor = await fx.makeDonor(org, "Quentin Pewsitter", { linkedMembershipId: other.membershipId });
      await fx.makeOfflineGift(org, otherDonor, fund, 7700, { occurredOn: inYear("12-01") });
      await issue(org, otherDonor);

      expect(await ok(elder.personId)).toMatchObject({ gifts: [], statements: [] });
      // the treasurer holds every giving key and is not a donor: also nothing
      const treasurerPerson = (await q(sql`select id from people where user_id = ${treasurerUser}`))[0]!.id as string;
      expect(await ok(treasurerPerson)).toMatchObject({ gifts: [], statements: [] });
    });

    it("a directory-hidden member still sees their own history", async () => {
      const hidden = await member(org, "Hildegard", "Unlisted");
      await q(sql`insert into person_privacy (person_id, organization_id, directory_hidden) values (${hidden.personId}, ${org}, true)`);
      const donor = await fx.makeDonor(org, "Hildegard Unlisted", { linkedMembershipId: hidden.membershipId });
      const gift = await fx.makeOfflineGift(org, donor, fund, 3300, { occurredOn: inYear("09-09") });
      const { statementId } = await issue(org, donor);
      const result = await ok(hidden.personId);
      expect(result.gifts.map((g) => g.id)).toEqual([gift]);
      expect(result.statements.map((s) => s.id)).toEqual([statementId]);
    });
  });

  // -----------------------------------------------------------------------
  describe("merged donors", () => {
    it("the rows of a donor merged into mine appear as mine - a merge-source statement is flagged", async () => {
      const iris = await member(org, "Iris", "Mergewell");
      const root = await fx.makeDonor(org, "Iris Mergewell", { linkedMembershipId: iris.membershipId });
      const dup = await fx.makeDonor(org, "I. Mergewell");
      const rootGift = await fx.makeOfflineGift(org, root, fund, 1000, { occurredOn: inYear("01-15") });
      const dupGift = await fx.makeOfflineGift(org, dup, fund, 2000, { occurredOn: inYear("02-15") });
      const rootStatement = (await issue(org, root)).statementId;
      const dupStatement = (await issue(org, dup)).statementId;
      await q(sql`update giving_donors set merged_into_id = ${root}, merged_at = now() where id = ${dup}`);

      const result = await ok(iris.personId);
      expect(result.gifts.map((g) => g.id).sort()).toEqual([rootGift, dupGift].sort());
      const byId = Object.fromEntries(result.statements.map((s) => [s.id, s]));
      expect(byId[rootStatement]).toMatchObject({ mergedSource: false, superseded: false });
      expect(byId[dupStatement]).toMatchObject({ mergedSource: true, superseded: false });
      expect((await self.findMyStatementForDownload(iris.personId, org, dupStatement)).kind).toBe("ok");
    });

    it("a stale link on a merge SOURCE never shows its rows to the source's old member", async () => {
      const keeper = await member(org, "Kestrel", "Keepsake");
      const oldLink = await member(org, "Lorcan", "Oldlink");
      const root = await fx.makeDonor(org, "Kestrel Keepsake", { linkedMembershipId: keeper.membershipId });
      const source = await fx.makeDonor(org, "K. Keepsake", { linkedMembershipId: oldLink.membershipId });
      const sourceGift = await fx.makeOfflineGift(org, source, fund, 1500, { occurredOn: inYear("03-03") });
      const { statementId } = await issue(org, source);
      await q(sql`update giving_donors set merged_into_id = ${root}, merged_at = now() where id = ${source}`);

      expect((await ok(keeper.personId)).gifts.map((g) => g.id)).toEqual([sourceGift]);
      expect(await ok(oldLink.personId)).toMatchObject({ gifts: [], statements: [] });
      expect(await self.findMyStatementForDownload(oldLink.personId, org, statementId)).toEqual({ kind: "not_found" });
    });
  });

  // -----------------------------------------------------------------------
  describe("the download lookup", () => {
    let alma: Member;
    let basil: Member;
    let almaStatement: string;
    let basilStatement: string;
    let orgBStatement: string;

    beforeAll(async () => {
      alma = await member(org, "Almeric", "Downloader");
      basil = await member(org, "Bertrand", "Otherdoc");
      const almaDonor = await fx.makeDonor(org, "Almeric Downloader", { linkedMembershipId: alma.membershipId });
      const basilDonor = await fx.makeDonor(org, "Bertrand Otherdoc", { linkedMembershipId: basil.membershipId });
      await fx.makeOfflineGift(org, almaDonor, fund, 4000, { occurredOn: inYear("04-04") });
      await fx.makeOfflineGift(org, basilDonor, fund, 5000, { occurredOn: inYear("05-05") });
      almaStatement = (await issue(org, almaDonor)).statementId;
      basilStatement = (await issue(org, basilDonor)).statementId;
      const bDonor = await fx.makeDonor(orgB, "Cross Org Donor");
      await fx.makeOfflineGift(orgB, bDonor, fundB, 4000, { occurredOn: inYear("04-04") });
      const bIssuer = (await q(sql`select u.id from users u join people p on p.user_id = u.id join memberships m on m.person_id = p.id where m.organization_id = ${orgB} limit 1`))[0]!.id as string;
      orgBStatement = (
        await asTenant(orgB, (tx) =>
          issueStatement(tx, { organizationId: orgB, donorId: bDonor, taxYear: YEAR, issuedBy: bIssuer }),
        )
      ).statementId;
    });

    it("hands back the blob id of the member's own statement", async () => {
      const found = await self.findMyStatementForDownload(alma.personId, org, almaStatement);
      expect(found.kind).toBe("ok");
      if (found.kind !== "ok") return;
      expect(found.statement).toMatchObject({ id: almaStatement, taxYear: YEAR, version: 1 });
      expect(found.statement.blobAssetId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("someone else's, another organization's, an absent id and a malformed id are ONE answer", async () => {
      const answers = [
        await self.findMyStatementForDownload(alma.personId, org, basilStatement),
        await self.findMyStatementForDownload(alma.personId, org, orgBStatement),
        await self.findMyStatementForDownload(alma.personId, org, "00000000-0000-4000-8000-0000000000ee"),
        await self.findMyStatementForDownload(alma.personId, org, "not-a-uuid"),
        await self.findMyStatementForDownload(alma.personId, org, "../../etc/passwd"),
      ];
      for (const answer of answers) expect(answer).toEqual({ kind: "not_found" });
    });

    it("turning Giving off closes the download, with the same answer", async () => {
      await q(sql`update organization_feature_toggles set enabled = false where organization_id = ${org} and feature_key = 'org_portal.giving'`);
      try {
        expect(await self.findMyStatementForDownload(alma.personId, org, almaStatement)).toEqual({ kind: "not_found" });
      } finally {
        await q(sql`update organization_feature_toggles set enabled = true where organization_id = ${org} and feature_key = 'org_portal.giving'`);
      }
    });
  });

  // -----------------------------------------------------------------------
  describe("the gate", () => {
    it("toggle off is an answer carrying no data; the row exists but is not read", async () => {
      const off = await fx.makeOrg("off");
      const person = await fx.makePerson("Octavian", "Offsite");
      await fx.enroll(off, person, []);
      const donor = await fx.makeDonor(off, "Octavian Offsite", { linkedMembershipId: await fx.membershipOf(off, person) });
      await fx.makeOfflineGift(off, donor, await fx.makeFund(off, "General"), 500, { occurredOn: inYear("06-06") });
      expect(await self.getMyGiving(person, off)).toEqual({ kind: "toggle_off" });
    });

    it("an organization type outside the allow-list is 'not applicable', even with a stray toggle row", async () => {
      const presbytery = await fx.makeOrg("presbytery", { organizationType: "presbytery", givingToggle: true });
      const person = await fx.makePerson("Presley", "Presbyter");
      await fx.enroll(presbytery, person, []);
      expect(await self.getMyGiving(person, presbytery)).toEqual({ kind: "not_applicable" });
    });

    it("a database failure THROWS - the page must not turn it into an empty list", async () => {
      const person = await fx.makePerson("Fenella", "Failing");
      await fx.enroll(org, person, []);
      await expect(self.getMyGiving(person, "not-a-uuid")).rejects.toThrow();
    });
  });
});
