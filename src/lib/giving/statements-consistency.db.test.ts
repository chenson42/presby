/**
 * The deferred consistency check as the APPLICATION meets it (docs/work-log/
 * 2026-10-15-online-giving.md, Batch 5a "What 5b must know" item 1): when the
 * composer disagrees with the rows, drizzle/0056 refuses AT COMMIT - the
 * rejection of the donor's transaction promise, not of any INSERT - and
 * `issueStatementBatch` reports that donor as failed (reason `consistency`),
 * leaves no statement behind, and does not wedge the run: the donor can be
 * issued once the disagreement is gone. A separate file because the composer is
 * mocked to be wrong for the whole file. Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/giving/statements-consistency.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { GivingFixture } from "@/lib/testing/giving-fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/email", () => ({ enqueueEmail: async () => ({ id: "00000000-0000-4000-8000-000000000000", sentInline: true }) }));

const tamper = { cents: 0, dropLine: false };
vi.mock("./statements/compose", async () => {
  const actual = await vi.importActual<typeof import("./statements/compose")>("./statements/compose");
  return {
    ...actual,
    composeLines: (...args: Parameters<typeof actual.composeLines>) => {
      const out = actual.composeLines(...args);
      if (tamper.dropLine && out.lines.length > 1) {
        const lines = out.lines.slice(0, -1).map((l, i) => ({ ...l, lineNo: i + 1 }));
        return {
          lines,
          giftCount: lines.length,
          nonCashCount: lines.filter((l) => l.kind === "non_cash").length,
          cashTotalCents: lines.reduce((s, l) => s + (l.amountCents ?? 0), 0),
        };
      }
      return { ...out, cashTotalCents: out.cashTotalCents + tamper.cents };
    },
  };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
const YEAR = new Date().getUTCFullYear() - 1;

describe.skipIf(!hasDb)("issueStatementBatch meets the deferred consistency check at COMMIT (Postgres-backed)", () => {
  let fx: GivingFixture;
  let st: typeof import("./statements");
  let org: string;
  let fund: string;
  let actor: { personId: string; userId: string };

  const rows = async (query: ReturnType<typeof sql>) => fx.rowsOf(await fx.platform.execute(query));

  beforeAll(async () => {
    const mod = await import("@/lib/testing/giving-fixture");
    fx = await mod.createGivingFixture("stmt-consistency-test");
    st = await import("./statements");
    org = await fx.makeOrg("a", { givingToggle: true });
    await fx.makeGivingSettings(org);
    fund = await fx.makeFund(org, "General");
    actor = await fx.makeActor(org, "Cora", "Checker", ["giving.view", "giving.record", "giving.manage"]);
  }, 90_000);

  afterAll(async () => {
    tamper.cents = 0;
    tamper.dropLine = false;
    if (fx) await fx.cleanup();
  }, 90_000);

  it("a composer total that disagrees with the lines is a failed donor with reason 'consistency', nothing left behind, and the donor issues once it is right", async () => {
    const donor = await fx.makeDonor(org, "Tamper Tobias");
    await fx.makeOfflineGift(org, donor, fund, 6200, { occurredOn: `${YEAR}-03-03` });

    tamper.cents = 1;
    const bad = await st.issueStatementBatch(actor.personId, org, actor.userId, { year: YEAR, donorIds: [donor] });
    expect(bad).toMatchObject({ kind: "ok", issued: 0, failed: [{ donorId: donor, donorName: "Tamper Tobias", reason: "consistency" }] });
    expect(await rows(sql`select 1 from giving_statements where donor_id = ${donor}`)).toHaveLength(0);
    expect(await rows(sql`select 1 from giving_statement_lines l join giving_statements s on s.id = l.statement_id where s.donor_id = ${donor}`)).toHaveLength(0);

    tamper.cents = 0;
    const good = await st.issueStatementBatch(actor.personId, org, actor.userId, { year: YEAR, donorIds: [donor] });
    expect(good).toMatchObject({ kind: "ok", issued: 1, failed: [] });
  }, 90_000);

  it("a composer that OMITS a counting gift is refused at COMMIT too (0056 S4: complete, not only consistent)", async () => {
    const donor = await fx.makeDonor(org, "Omitting Odalys");
    await fx.makeOfflineGift(org, donor, fund, 1000, { occurredOn: `${YEAR}-03-03` });
    await fx.makeOfflineGift(org, donor, fund, 2000, { occurredOn: `${YEAR}-04-04` });
    tamper.dropLine = true;
    try {
      const out = await st.issueStatementBatch(actor.personId, org, actor.userId, { year: YEAR, donorIds: [donor] });
      expect(out).toMatchObject({ kind: "ok", issued: 0, failed: [{ donorId: donor, reason: "consistency" }] });
    } finally {
      tamper.dropLine = false;
    }
    expect(await rows(sql`select 1 from giving_statements where donor_id = ${donor}`)).toHaveLength(0);
  }, 90_000);
});
