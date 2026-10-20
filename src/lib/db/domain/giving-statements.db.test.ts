/**
 * drizzle/0056_presby_giving_statements.sql on REAL Postgres connections -
 * Batch 5a's DB-backed list (docs/work-log/2026-10-15-online-giving.md,
 * "Batch 5 - Statements"), and the proofs scripts/giving/test-rls-46.sql
 * cannot make because it runs as presby_app:
 *
 *   - issue idempotency under CONCURRENCY: two parallel issues for one donor
 *     and year - one wins, the other is the unique violation the app maps to
 *     `already_issued`; two parallel re-issues - one wins;
 *   - staleness, through the ONE shared fragment (src/lib/giving/
 *     statement-staleness.ts): a late-dated gift, a pending gift that later
 *     succeeds, a later refund and a later merge make a statement stale; a
 *     later Stripe TEST-MODE gift does not;
 *   - the re-issue chain (supersedes, original retained, no fork);
 *   - the insert guard (unidentified and merged donors, an issuer without
 *     giving.manage AND giving.view) and the deferred consistency trigger (a
 *     tampered total, a covered-fee policy the lines do not follow) refused
 *     AT COMMIT on the application connection;
 *   - frozen rows: UPDATE and DELETE raise on the OWNER connection
 *     (getPlatformDb() is neondb_owner, which no grant binds - F44);
 *     deletable_until permits; the organization-teardown cascade removes
 *     statements, lines, deliveries and the PDF (P3-8);
 *   - the PDF: the composite NO ACTION FK refuses deleting a referenced blob
 *     on the owner path, and blob_assets_giving_statement_guard refuses
 *     changing its bytes; an unreferenced blob is untouched by both;
 *   - a statement issued to a donor later merged into another appears under
 *     the ROOT in the member self-read shape (Batch 6's self.ts).
 *
 * Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/giving-statements.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { GivingFixture, IssueStatementParams } from "@/lib/testing/giving-fixture";
import { STATEMENT_IS_LATEST, STATEMENT_IS_STALE } from "@/lib/giving/statement-staleness";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;

const YEAR = new Date().getUTCFullYear() - 1;
const inYear = (monthDay: string) => `${YEAR}-${monthDay}`;

describe.skipIf(!hasDb)("drizzle/0056 statements (Postgres-backed)", () => {
  let fx: GivingFixture;
  let appDb: typeof import("@/lib/db").db;
  let issueStatement: typeof import("@/lib/testing/giving-fixture").issueStatement;
  let armGivingWrite: typeof import("@/lib/testing/giving-fixture").armGivingWrite;

  let org: string;
  let orgB: string;
  let conn: string;
  let fund: string;
  let treasurer: string; // users.id - giving.manage + giving.view + giving.record
  let manageOnly: string;
  let viewOnly: string;

  async function q(query: ReturnType<typeof sql>): Promise<Row[]> {
    return fx.rowsOf(await fx.platform.execute(query));
  }

  type AppTx = Parameters<Parameters<typeof appDb.transaction>[0]>[0];

  /** The application path: presby_app, `org` as the verified context, one transaction. */
  async function asTenant<T>(orgId: string, fn: (tx: AppTx) => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
      return fn(tx);
    });
  }

  /** Issue on the application connection; the deferred checks run at COMMIT. */
  function issue(donorId: string, extra: Partial<IssueStatementParams> = {}) {
    return asTenant(org, (tx) =>
      issueStatement(tx, { organizationId: org, donorId, taxYear: YEAR, issuedBy: treasurer, ...extra }),
    );
  }

  /** Drizzle wraps the Postgres error ("Failed query: ...") - match the whole cause chain. */
  function chain(err: unknown): string {
    const messages: string[] = [];
    for (let e = err as { message?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
      messages.push(String(e.message ?? e));
    }
    return messages.join(" | ");
  }
  async function expectRaise(p: Promise<unknown>, pattern: RegExp) {
    let caught: unknown = null;
    try {
      await p;
    } catch (err) {
      caught = err;
    }
    expect(caught, `expected a raise matching ${pattern}`).not.toBeNull();
    expect(chain(caught)).toMatch(pattern);
  }

  async function stale(statementId: string): Promise<boolean> {
    const rows = await asTenant(org, async (tx) =>
      fx.rowsOf(
        await tx.execute(
          sql`select (${sql.raw(STATEMENT_IS_STALE)}) as stale from giving_statements s where s.id = ${statementId}`,
        ),
      ),
    );
    return rows[0]!.stale === true;
  }

  async function latest(statementId: string): Promise<boolean> {
    const rows = await asTenant(org, async (tx) =>
      fx.rowsOf(
        await tx.execute(
          sql`select (${sql.raw(STATEMENT_IS_LATEST)}) as latest from giving_statements s where s.id = ${statementId}`,
        ),
      ),
    );
    return rows[0]!.latest === true;
  }

  async function donorWithGift(name: string, cents = 5000, monthDay = "03-15"): Promise<string> {
    const donor = await fx.makeDonor(org, name);
    await fx.makeOfflineGift(org, donor, fund, cents, { occurredOn: inYear(monthDay) });
    return donor;
  }

  beforeAll(async () => {
    ({ db: appDb } = await import("@/lib/db"));
    const mod = await import("@/lib/testing/giving-fixture");
    issueStatement = mod.issueStatement;
    armGivingWrite = mod.armGivingWrite;
    fx = await mod.createGivingFixture("giving-stmt-test");

    org = await fx.makeOrg("a", { givingToggle: true });
    orgB = await fx.makeOrg("b", { givingToggle: true });
    await fx.makeGivingSettings(org);
    conn = await fx.makeConnection(org, { livemode: true });
    fund = await fx.makeFund(org, "General Fund");
    treasurer = (await fx.makeActor(org, "Imogen", "Ledgerwood", ["giving.manage", "giving.view", "giving.record"]))
      .userId;
    manageOnly = (await fx.makeActor(org, "Corwin", "Hollis", ["giving.manage"])).userId;
    viewOnly = (await fx.makeActor(org, "Delphine", "Arkwright", ["giving.view"])).userId;
  }, 90_000);

  afterAll(async () => {
    if (fx) await fx.cleanup();
  }, 90_000);

  // -------------------------------------------------------------------------
  describe("issuing on the application connection", () => {
    it("issues for the donor ROOT: own gifts and a merged donor's, live succeeded only, stock as non-cash", async () => {
      const root = await fx.makeDonor(org, "Rosalind Penhallow");
      const dup = await fx.makeDonor(org, "R. Penhallow");
      await fx.makeOfflineGift(org, root, fund, 4000, { occurredOn: inYear("02-01") });
      await fx.makeOfflineGift(org, dup, fund, 2500, { occurredOn: inYear("05-01") });
      const online = await fx.makeOnlineGift(org, conn, root, fund, 5181, {
        occurredOn: inYear("06-01"),
        donorCoveredFeeCents: 181,
      });
      await fx.makeOnlineGift(org, conn, root, fund, 9900, { occurredOn: inYear("07-01"), livemode: false });
      await fx.makeOnlineGift(org, conn, root, fund, 7700, { occurredOn: inYear("08-01"), status: "pending" });
      await fx.makeOfflineGift(org, root, fund, 1234, { occurredOn: `${YEAR + 1}-01-02` });
      await fx.platform.transaction(async (tx) => {
        await armGivingWrite(tx);
        await tx.execute(sql`
          insert into giving_gifts (organization_id, donor_id, fund_id, source, method, stock_description, amount_cents,
                 status, occurred_on, livemode, recorded_by)
          values (${org}, ${root}, ${fund}, 'offline', 'stock', '5 shares of a fixture fund', 80000, 'succeeded',
                  ${inYear("09-01")}, true, ${fx.actingUserId})`);
      });
      await q(sql`update giving_donors set merged_into_id = ${root}, merged_at = now() where id = ${dup}`);

      const { statementId } = await issue(root);
      const [s] = await q(sql`
        select gift_count, non_cash_count, cash_total_cents::int as cash, version, issued_at::text as issued_at
          from giving_statements where id = ${statementId}`);
      expect(s).toMatchObject({ gift_count: 4, non_cash_count: 1, cash: 4000 + 2500 + 5181, version: 1 });
      const lines = await q(sql`
        select kind, amount_cents, covered_fee_cents, gift_id::text as gift_id
          from giving_statement_lines where statement_id = ${statementId} order by line_no`);
      expect(lines.map((l) => l.kind)).toEqual(["cash", "cash", "cash", "non_cash"]);
      expect(lines.find((l) => l.gift_id === online)).toMatchObject({ amount_cents: 5181, covered_fee_cents: 181 });
      expect(lines.find((l) => l.kind === "non_cash")).toMatchObject({ amount_cents: null });
    });

    it("stamps issued_at itself - a supplied value is overwritten (0056 S2)", async () => {
      const donor = await donorWithGift("Ambrose Quill");
      // A forward-dated issued_at would make a statement that never goes stale.
      const { statementId } = await issue(donor, { issuedAt: "2099-01-01T00:00:00Z" });
      await expectRaise(
        q(sql`update giving_statements set issued_at = now() + interval '10 years' where id = ${statementId}`),
        /frozen/,
      );
      const [row] = await q(sql`
        select (issued_at > now() - interval '5 minutes' and issued_at <= now()) as fresh
          from giving_statements where id = ${statementId}`);
      expect(row!.fresh).toBe(true);
    });

    it("issuing needs giving.manage AND giving.view (0056 S1) - neither alone", async () => {
      const donor = await donorWithGift("Benedict Sallow");
      await expectRaise(issue(donor, { issuedBy: manageOnly }), /giving_statement: not permitted/);
      await expectRaise(issue(donor, { issuedBy: viewOnly }), /giving_statement: not permitted/);
      expect(await q(sql`select 1 from giving_statements where donor_id = ${donor}`)).toHaveLength(0);
    });

    it("refuses the unidentified (plate cash) donor and a merged donor", async () => {
      const plate = await fx.makeDonor(org, "Plate offering", { kind: "unidentified" });
      await fx.makeOfflineGift(org, plate, fund, 1500, { occurredOn: inYear("04-04") });
      await expectRaise(issue(plate), /giving_statement: donor_unidentified/);

      const root = await fx.makeDonor(org, "Cordelia Wren");
      const merged = await donorWithGift("C. Wren");
      await q(sql`update giving_donors set merged_into_id = ${root}, merged_at = now() where id = ${merged}`);
      await expectRaise(issue(merged), /giving_statement: donor_unavailable/);
    });

    it("a TAMPERED total is refused at COMMIT, and nothing of the statement remains", async () => {
      const donor = await donorWithGift("Fenwick Ashdown", 6200);
      await expectRaise(issue(donor, { totalDelta: 1 }), /inconsistent: totals_mismatch/);
      expect(await q(sql`select 1 from giving_statements where donor_id = ${donor}`)).toHaveLength(0);
    });

    it("lines must follow the header's covered-fee policy (counted vs not)", async () => {
      const donor = await fx.makeDonor(org, "Marisol Teague");
      await fx.makeOnlineGift(org, conn, donor, fund, 10330, { occurredOn: inYear("10-10"), donorCoveredFeeCents: 330 });
      // The header says "not counted" but the lines count the fee: refused.
      await expectRaise(
        issue(donor, { coveredFeeCounted: false, composeCoveredFeeCounted: true }),
        /inconsistent: line_mismatch/,
      );
      // Consistently "not counted": the line is the gift alone.
      const { statementId } = await issue(donor, { coveredFeeCounted: false });
      const [line] = await q(sql`select amount_cents, gross_cents from giving_statement_lines where statement_id = ${statementId}`);
      expect(line).toMatchObject({ amount_cents: 10000, gross_cents: 10330 });
    });
  });

  // -------------------------------------------------------------------------
  describe("idempotency under concurrency", () => {
    it("two parallel issues for one donor and year: one wins, one is already_issued (giving_statements_version_key)", async () => {
      const donor = await donorWithGift("Thaddeus Marlow", 7000);
      const results = await Promise.allSettled([issue(donor), issue(donor)]);
      const won = results.filter((r) => r.status === "fulfilled");
      const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(chain(lost[0]!.reason)).toMatch(/giving_statements_version_key/);
      expect(await q(sql`select 1 from giving_statements where donor_id = ${donor}`)).toHaveLength(1);
    });

    it("two parallel re-issues of one statement: one version 2 wins, the chain does not fork", async () => {
      const donor = await donorWithGift("Ottoline Breck", 3100);
      const { statementId: v1 } = await issue(donor);
      const reissue = () => issue(donor, { version: 2, supersedesId: v1 });
      const results = await Promise.allSettled([reissue(), reissue()]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const lost = results.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
      // Which refusal depends on timing: blocked on the unique index until the winner
      // commits (version_key / supersedes_once_idx), or - if the winner had already
      // committed when the loser's guard ran - the guard's already_superseded.
      expect(chain(lost.reason)).toMatch(
        /giving_statements_version_key|giving_statements_supersedes_once_idx|already_superseded/,
      );
      expect(await q(sql`select 1 from giving_statements where supersedes_id = ${v1}`)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("the re-issue chain", () => {
    it("v2 supersedes v1; the original is retained and is no longer the latest; a fork is refused", async () => {
      const donor = await donorWithGift("Peregrine Vale", 4400);
      const { statementId: v1 } = await issue(donor);
      expect(await latest(v1)).toBe(true);
      const { statementId: v2 } = await issue(donor, { version: 2, supersedesId: v1 });
      expect(await latest(v1)).toBe(false);
      expect(await latest(v2)).toBe(true);
      expect(await q(sql`select 1 from giving_statements where id in (${v1}, ${v2})`)).toHaveLength(2);
      await expectRaise(issue(donor, { version: 2, supersedesId: v1 }), /already_superseded/);
      await expectRaise(issue(donor, { version: 3, supersedesId: v1 }), /supersedes_invalid/);
      const other = await donorWithGift("Lucan Fairweather");
      await expectRaise(issue(other, { version: 2, supersedesId: v2 }), /supersedes_invalid/);
    });
  });

  // -------------------------------------------------------------------------
  describe("staleness is derived (src/lib/giving/statement-staleness.ts)", () => {
    it("a fresh statement is not stale", async () => {
      const donor = await donorWithGift("Isolde Harrow");
      const { statementId } = await issue(donor);
      expect(await stale(statementId)).toBe(false);
    });

    it("a LATE-DATED gift (entered after issue, dated inside the year) makes it stale", async () => {
      const donor = await donorWithGift("Gideon Thorne");
      const { statementId } = await issue(donor);
      await fx.makeOfflineGift(org, donor, fund, 900, { occurredOn: inYear("12-30") });
      expect(await stale(statementId)).toBe(true);
    });

    it("a gift dated OUTSIDE the year does not", async () => {
      const donor = await donorWithGift("Winifred Cole");
      const { statementId } = await issue(donor);
      await fx.makeOfflineGift(org, donor, fund, 900, { occurredOn: `${YEAR + 1}-01-03` });
      expect(await stale(statementId)).toBe(false);
    });

    it("a pending gift that SUCCEEDS after issue makes it stale (status_changed_at)", async () => {
      const donor = await donorWithGift("Ansel Brightwater");
      const pending = await fx.makeOnlineGift(org, conn, donor, fund, 2500, {
        occurredOn: inYear("11-20"),
        status: "pending",
      });
      const { statementId } = await issue(donor);
      expect(await stale(statementId)).toBe(false);
      await fx.platform.transaction(async (tx) => {
        await armGivingWrite(tx);
        await tx.execute(sql`update giving_gifts set status = 'succeeded' where id = ${pending}`);
      });
      expect(await stale(statementId)).toBe(true);
    });

    it("a pending gift that FAILS after issue does not (it changes nothing on the statement)", async () => {
      const donor = await donorWithGift("Clementine Royce");
      const pending = await fx.makeOnlineGift(org, conn, donor, fund, 2500, {
        occurredOn: inYear("11-21"),
        status: "pending",
      });
      const { statementId } = await issue(donor);
      await fx.platform.transaction(async (tx) => {
        await armGivingWrite(tx);
        await tx.execute(sql`update giving_gifts set status = 'failed', failure_code = 'insufficient_funds' where id = ${pending}`);
      });
      expect(await stale(statementId)).toBe(false);
    });

    it("a REFUND recorded after issue makes it stale", async () => {
      const donor = await fx.makeDonor(org, "Lysander Crewe");
      const gift = await fx.makeOnlineGift(org, conn, donor, fund, 6000, { occurredOn: inYear("09-09") });
      const { statementId } = await issue(donor);
      await fx.makeReversal(org, conn, gift, "refund", 1000);
      expect(await stale(statementId)).toBe(true);
    });

    it("a Stripe TEST-MODE gift created after issue does NOT make it stale (P3-17)", async () => {
      const donor = await donorWithGift("Rhiannon Asterley");
      const { statementId } = await issue(donor);
      await fx.makeOnlineGift(org, conn, donor, fund, 4200, { occurredOn: inYear("10-01"), livemode: false });
      expect(await stale(statementId)).toBe(false);
    });

    it("a donor MERGED into the statement's donor after issue makes it stale (their gifts joined the group)", async () => {
      const root = await donorWithGift("Evander Locke");
      const { statementId } = await issue(root);
      const dup = await donorWithGift("E. Locke", 1500, "06-06");
      expect(await stale(statementId)).toBe(false);
      await q(sql`update giving_donors set merged_into_id = ${root}, merged_at = now() where id = ${dup}`);
      expect(await stale(statementId)).toBe(true);
      // ...and the corrected version counts the merged donor's gift.
      const { statementId: v2 } = await issue(root, { version: 2, supersedesId: statementId });
      expect(await stale(v2)).toBe(false);
      const [s] = await q(sql`select cash_total_cents::int as cash from giving_statements where id = ${v2}`);
      expect(s!.cash).toBe(5000 + 1500);
    });
  });

  // -------------------------------------------------------------------------
  describe("frozen rows on the OWNER connection (F44)", () => {
    it("UPDATE raises on the statement, its lines and its deliveries; DELETE raises", async () => {
      const donor = await donorWithGift("Sabine Holloway");
      const { statementId } = await issue(donor);
      await asTenant(org, (tx) =>
        tx.execute(sql`
          insert into giving_statement_deliveries (organization_id, statement_id, channel, recorded_by)
          values (${org}, ${statementId}, 'print_mailed', ${treasurer})`),
      );
      await expectRaise(q(sql`update giving_statements set donor_name = 'Changed' where id = ${statementId}`), /frozen/);
      await expectRaise(
        q(sql`update giving_statement_lines set amount_cents = amount_cents + 1 where statement_id = ${statementId}`),
        /frozen/,
      );
      await expectRaise(
        q(sql`update giving_statement_deliveries set channel = 'print_mailed' where statement_id = ${statementId}`),
        /frozen/,
      );
      await expectRaise(q(sql`delete from giving_statement_deliveries where statement_id = ${statementId}`), /permanent/);
      await expectRaise(q(sql`delete from giving_statement_lines where statement_id = ${statementId}`), /permanent/);
      await expectRaise(q(sql`delete from giving_statements where id = ${statementId}`), /permanent/);
      expect(await q(sql`select 1 from giving_statements where id = ${statementId}`)).toHaveLength(1);
    });

    it("deletable_until in the future permits the delete (lines, deliveries, then the statement, then its PDF)", async () => {
      const donor = await donorWithGift("Tamsin Calloway");
      const { statementId, blobId } = await issue(donor, { deletableUntil: new Date(Date.now() + 3_600_000) });
      await asTenant(org, (tx) =>
        tx.execute(sql`
          insert into giving_statement_deliveries (organization_id, statement_id, channel, recorded_by)
          values (${org}, ${statementId}, 'print_mailed', ${treasurer})`),
      );
      await expectRaise(q(sql`update giving_statements set donor_name = 'Changed' where id = ${statementId}`), /frozen/);
      await q(sql`delete from giving_statement_deliveries where statement_id = ${statementId}`);
      await q(sql`delete from giving_statement_lines where statement_id = ${statementId}`);
      await q(sql`delete from giving_statements where id = ${statementId}`);
      await q(sql`delete from blob_assets where id = ${blobId}`);
      expect(await q(sql`select 1 from blob_assets where id = ${blobId}`)).toHaveLength(0);
    });

    it("one `delete from organizations` of a deletable fixture org removes statements, lines, deliveries and the PDF (P3-8)", async () => {
      const tOrg = await fx.makeOrg("stmt-teardown", { givingToggle: true });
      await fx.makeGivingSettings(tOrg);
      const tFund = await fx.makeFund(tOrg, "Teardown Fund");
      const tDonor = await fx.makeDonor(tOrg, "Teardown Donor");
      await fx.makeOfflineGift(tOrg, tDonor, tFund, 2200, { occurredOn: inYear("01-15") });
      const tUser = (await fx.makeActor(tOrg, "Quentin", "Teardown", ["giving.manage", "giving.view"])).userId;
      const { statementId, blobId } = await appDb.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_org_id', ${tOrg}, true)`);
        const out = await issueStatement(tx, { organizationId: tOrg, donorId: tDonor, taxYear: YEAR, issuedBy: tUser });
        await tx.execute(sql`
          insert into giving_statement_deliveries (organization_id, statement_id, channel, recorded_by)
          values (${tOrg}, ${out.statementId}, 'print_mailed', ${tUser})`);
        return out;
      });
      await expectRaise(q(sql`delete from giving_statements where id = ${statementId}`), /permanent/);
      await expectRaise(q(sql`delete from blob_assets where id = ${blobId}`), /giving_statements_blob_fk/);

      // drizzle/0033's group_memberships_reject_derived refuses the cascade into the
      // derived Active Membership rows (the issuer is a member) - disabled around
      // the delete exactly as createCalendarFixture().cleanup() does.
      await q(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
      try {
        await q(sql`delete from organizations where id = ${tOrg}`);
      } finally {
        await q(sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
      }
      expect(
        await q(sql`
          select 1 from giving_statements where organization_id = ${tOrg}
          union all select 1 from giving_statement_lines where organization_id = ${tOrg}
          union all select 1 from giving_statement_deliveries where organization_id = ${tOrg}
          union all select 1 from blob_assets where id = ${blobId}`),
      ).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("the PDF is undeletable and unchangeable while referenced", () => {
    it("the composite FK refuses deleting it on the owner path; the blob guard refuses changing it", async () => {
      const donor = await donorWithGift("Wilhelmina Strand");
      const { blobId } = await issue(donor);
      await expectRaise(q(sql`delete from blob_assets where id = ${blobId}`), /giving_statements_blob_fk/);
      await expectRaise(
        q(sql`update blob_assets set bytes = convert_to('%PDF-1.7 forged', 'UTF8') where id = ${blobId}`),
        /immutable/,
      );
      await expectRaise(q(sql`update blob_assets set content_type = 'image/png' where id = ${blobId}`), /immutable/);
    });

    it("an UNREFERENCED blob is untouched by both (the guard is statement-scoped)", async () => {
      const [b] = await q(sql`
        insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes)
        values (${org}, encode(sha256(convert_to('unreferenced fixture', 'UTF8')), 'hex'), 'application/pdf', 20,
                convert_to('unreferenced fixture', 'UTF8'))
        returning id`);
      await q(sql`update blob_assets set byte_size = 20 where id = ${String(b!.id)}`);
      await q(sql`delete from blob_assets where id = ${String(b!.id)}`);
      expect(await q(sql`select 1 from blob_assets where id = ${String(b!.id)}`)).toHaveLength(0);
    });

    it("the insert guard refuses a blob whose hash is not the statement's pdf_sha256, and a non-PDF blob", async () => {
      const donor = await donorWithGift("Augustin Pell");
      const attempt = (contentType: string, hash: "own" | "other") =>
        asTenant(org, async (tx) => {
          const [blob] = fx.rowsOf(
            await tx.execute(sql`
              with b as (select convert_to('fixture ' || gen_random_uuid()::text, 'UTF8') as bytes)
              insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes)
              select ${org}, encode(sha256(b.bytes), 'hex'), ${contentType}, octet_length(b.bytes), b.bytes from b
              returning id, content_hash`),
          );
          await tx.execute(sql`
            insert into giving_statements (organization_id, donor_id, tax_year, donee_legal_name, donee_address_line1,
                   donee_city, donee_region, donee_postal_code, greeting_text, closing_text, wording_version, donor_name,
                   period_start, period_end, cash_total_cents, gift_count, covered_fee_counted, blob_asset_id,
                   pdf_sha256, issued_by)
            values (${org}, ${donor}, ${YEAR}, 'X', 'X', 'X', 'OH', '00000', 'X', 'X', 1, 'X',
                    make_date(${YEAR}::int, 1, 1), make_date(${YEAR}::int, 12, 31), 5000, 1, true, ${String(blob!.id)},
                    ${hash === "own" ? String(blob!.content_hash) : "a".repeat(64)}, ${treasurer})`);
        });
      await expectRaise(attempt("application/pdf", "other"), /blob_invalid/);
      await expectRaise(attempt("application/json", "own"), /blob_invalid/);
    });
  });

  // -------------------------------------------------------------------------
  describe("tenancy and the member self-read shape", () => {
    it("another organization sees nothing, and a cross-org line is refused by the composite FK", async () => {
      const donor = await donorWithGift("Hesper Moorcroft");
      const { statementId } = await issue(donor);
      const seen = await asTenant(orgB, async (tx) =>
        fx.rowsOf(await tx.execute(sql`select 1 from giving_statements where id = ${statementId}`)),
      );
      expect(seen).toHaveLength(0);
      const fundB = await fx.makeFund(orgB, "Other Fund");
      const donorB = await fx.makeDonor(orgB, "Other Donor");
      const giftB = await fx.makeOfflineGift(orgB, donorB, fundB, 1000, { occurredOn: inYear("03-03") });
      await expectRaise(
        q(sql`
          insert into giving_statement_lines (organization_id, statement_id, gift_id, line_no, occurred_on, fund_label,
                 description, kind, amount_cents, gross_cents)
          values (${org}, ${statementId}, ${giftB}, 9, ${inYear("03-03")}, 'X', 'X', 'cash', 1000, 1000)`),
        /giving_statement_lines_gift_fk/,
      );
    });

    it("a statement issued to a donor later merged into the member's linked donor appears under the ROOT", async () => {
      const person = await fx.makePerson("Leocadia", "Fennimore");
      await fx.enroll(org, person, []);
      const membership = await fx.membershipOf(org, person);
      const root = await fx.makeDonor(org, "Leocadia Fennimore", { linkedMembershipId: membership });
      const dup = await donorWithGift("L. Fennimore", 2750, "04-20");
      const { statementId } = await issue(dup);
      await q(sql`update giving_donors set merged_into_id = ${root}, merged_at = now() where id = ${dup}`);

      // The self-read shape (Batch 6, self.ts): statements whose donor is the
      // member's linked donor, or was merged into it (merges are flat).
      const mine = (membershipId: string) =>
        asTenant(org, async (tx) =>
          fx.rowsOf(
            await tx.execute(sql`
              select s.id::text as id
                from giving_statements s
                join giving_donors d on d.id = s.donor_id and d.organization_id = s.organization_id
                left join giving_donors root on root.id = d.merged_into_id and root.organization_id = d.organization_id
               where coalesce(root.linked_membership_id, d.linked_membership_id) = ${membershipId}`),
          ),
        );
      expect((await mine(membership)).map((r) => r.id)).toEqual([statementId]);

      const stranger = await fx.makePerson("Ignatius", "Pole");
      await fx.enroll(org, stranger, []);
      expect(await mine(await fx.membershipOf(org, stranger))).toHaveLength(0);
    });
  });
});
