/**
 * statements.ts against a REAL Postgres connection (docs/work-log/
 * 2026-10-15-online-giving.md, Batch 5b "Tests"): the issue run through the
 * real library path (compose -> render -> store() -> header + lines -> deferred
 * checks at COMMIT), idempotency under concurrency, staleness through the one
 * shared fragment, the re-issue chain, delivery logging, the notice email, the
 * print run and the download lookup. Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/giving/statements.db.test.ts
 *
 * The drizzle/0056 mechanisms themselves (frozen rows, the insert guard, the
 * blob FK) are proven in src/lib/db/domain/giving-statements.db.test.ts and
 * scripts/giving/test-rls-46.sql; this file proves the APPLICATION uses them
 * correctly. Fixture organizations carry `deletable_until`, so cleanup is one
 * organization delete (P3-8); the only rows outside them are the notice test's
 * `email_queue` rows, removed in afterAll.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { extractPdfText } from "@/lib/testing/pdf-text";
import type { GivingFixture } from "@/lib/testing/giving-fixture";

vi.mock("server-only", () => ({}));

// `@/lib/email` pulls the auth stack (next-auth) in through the audit module, which Vitest cannot load. The
// stand-in does what the real `enqueueEmail` does that matters here - writes the platform `email_queue` row and
// returns its id - so the delivery's `email_queue_id` and the bounce join are exercised against a real row.
vi.mock("@/lib/email", () => ({
  enqueueEmail: async (input: { to: string; message: { subject: string; html: string; text: string }; templateKey: string }) => {
    const { getPlatformDb } = await import("@/lib/db");
    const { sql: dsql } = await import("drizzle-orm");
    const result = (await getPlatformDb().execute(dsql`
      insert into email_queue (to_email, subject, html_body, text_body, template_key, status, sent_at)
      values (${input.to}, ${input.message.subject}, ${input.message.html}, ${input.message.text}, ${input.templateKey}, 'sent', now())
      returning id`)) as unknown as { rows?: Array<{ id: string }> } | Array<{ id: string }>;
    const rows = Array.isArray(result) ? result : (result.rows ?? []);
    return { id: rows[0]!.id, sentInline: true };
  },
}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Actor = { personId: string; userId: string };
type Row = Record<string, unknown>;

const YEAR = new Date().getUTCFullYear() - 1;
const inYear = (monthDay: string) => `${YEAR}-${monthDay}`;
const flat = (text: string) => text.replace(/\s+/g, " ");

describe.skipIf(!hasDb)("statements.ts (Postgres-backed)", () => {
  let fx: GivingFixture;
  let st: typeof import("./statements");
  let render: typeof import("./statements/render-pdf");
  let armGivingWrite: typeof import("@/lib/testing/giving-fixture").armGivingWrite;

  let org: string;
  let orgNoSettings: string;
  let otherOrg: string;
  let conn: string;
  let fund: string;
  let fund2: string;
  let treasurer: Actor; // view + record + manage
  let manageOnly: Actor;
  let viewOnly: Actor;
  let recorderOnly: Actor;
  let otherTreasurer: Actor;
  const queueIds: string[] = [];

  async function q(query: ReturnType<typeof sql>): Promise<Row[]> {
    return fx.rowsOf(await fx.platform.execute(query));
  }

  async function donorWithGift(name: string, cents = 5000, monthDay = "03-15", extra: { email?: string | null } = {}): Promise<string> {
    const donor = await fx.makeDonor(org, name, { email: extra.email ?? null });
    await fx.makeOfflineGift(org, donor, fund, cents, { occurredOn: inYear(monthDay) });
    return donor;
  }

  const issue = (donorIds: string[], over: { actor?: Actor; cursor?: string | null; organization?: string } = {}) => {
    const actor = over.actor ?? treasurer;
    return st.issueStatementBatch(actor.personId, over.organization ?? org, actor.userId, { year: YEAR, donorIds, cursor: over.cursor });
  };

  async function issueOne(donorId: string): Promise<string> {
    const result = await issue([donorId]);
    expect(result).toMatchObject({ kind: "ok", issued: 1 });
    if (result.kind !== "ok") throw new Error("not ok");
    return result.issuedStatements[0]!.statementId;
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/giving-fixture");
    armGivingWrite = mod.armGivingWrite;
    fx = await mod.createGivingFixture("stmt-lib-test");
    st = await import("./statements");
    render = await import("./statements/render-pdf");

    org = await fx.makeOrg("a", { givingToggle: true });
    orgNoSettings = await fx.makeOrg("n", { givingToggle: true });
    otherOrg = await fx.makeOrg("b", { givingToggle: true });
    await fx.makeGivingSettings(org);
    await fx.makeGivingSettings(otherOrg);
    conn = await fx.makeConnection(org, { livemode: true });
    fund = await fx.makeFund(org, "General Fund");
    fund2 = await fx.makeFund(org, "Building Fund");

    treasurer = await fx.makeActor(org, "Imogen", "Ledgerwood", ["giving.view", "giving.record", "giving.manage"]);
    manageOnly = await fx.makeActor(org, "Corwin", "Hollis", ["giving.manage"]);
    viewOnly = await fx.makeActor(org, "Delphine", "Arkwright", ["giving.view"]);
    recorderOnly = await fx.makeActor(org, "Rex", "Recorder", ["giving.record"]);
    otherTreasurer = await fx.makeActor(otherOrg, "Olwen", "Otherwise", ["giving.view", "giving.record", "giving.manage"]);
    // The no-settings org needs an issuer too.
    await fx.makeActor(orgNoSettings, "Nia", "Nosettings", ["giving.view", "giving.record", "giving.manage"]);
  }, 90_000);

  afterAll(async () => {
    if (queueIds.length > 0) {
      await fx.platform.execute(sql`delete from email_queue where id in (${sql.join(queueIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
    }
    if (fx) await fx.cleanup();
  }, 90_000);

  // -----------------------------------------------------------------------
  describe("issueStatementBatch", () => {
    it("issues for the donor ROOT through the real path: snapshot, lines, the stored PDF's hash, and a re-render that reproduces the bytes", async () => {
      const root = await fx.makeDonor(org, "Rosalind Penhallow", { email: "rosalind@example.invalid" });
      const dup = await fx.makeDonor(org, "R. Penhallow");
      await fx.makeOfflineGift(org, root, fund, 4000, { occurredOn: inYear("02-01") });
      await fx.makeOfflineGift(org, dup, fund2, 2500, { occurredOn: inYear("05-01") });
      const online = await fx.makeOnlineGift(org, conn, root, fund, 5181, { occurredOn: inYear("06-01"), donorCoveredFeeCents: 181 });
      await fx.makeOnlineGift(org, conn, root, fund, 9900, { occurredOn: inYear("07-01"), livemode: false });
      await fx.makeOnlineGift(org, conn, root, fund, 7700, { occurredOn: inYear("08-01"), status: "pending" });
      await fx.makeOfflineGift(org, root, fund, 1234, { occurredOn: `${YEAR + 1}-01-02` });
      await fx.platform.transaction(async (tx) => {
        await armGivingWrite(tx);
        await tx.execute(sql`
          insert into giving_gifts (organization_id, donor_id, fund_id, source, method, stock_description, stock_quantity, amount_cents,
                 status, occurred_on, livemode, recorded_by)
          values (${org}, ${root}, ${fund}, 'offline', 'stock', 'Example Corp common', 5, 80000, 'succeeded', ${inYear("09-01")}, true, ${fx.actingUserId})`);
      });
      await q(sql`update giving_donors set merged_into_id = ${root}, merged_at = now() where id = ${dup}`);

      const result = await issue([root]);
      expect(result).toMatchObject({ kind: "ok", issued: 1, skipped: 0, failed: [], nextCursor: null });
      if (result.kind !== "ok") return;
      const statementId = result.issuedStatements[0]!.statementId;

      const [s] = await q(sql`
        select gift_count, non_cash_count, cash_total_cents::int as cash, version, donor_name, delivery_email, issued_by::text as issued_by,
               donee_legal_name, wording_version, covered_fee_counted, pdf_sha256, blob_asset_id::text as blob_id, supersedes_id
          from giving_statements where id = ${statementId}`);
      expect(s).toMatchObject({
        gift_count: 4, non_cash_count: 1, cash: 4000 + 2500 + 5181, version: 1, donor_name: "Rosalind Penhallow",
        delivery_email: "rosalind@example.invalid", issued_by: treasurer.userId, donee_legal_name: "Fixture Presbyterian Church",
        wording_version: 1, covered_fee_counted: true, supersedes_id: null,
      });
      const lines = await q(sql`
        select kind, amount_cents, covered_fee_cents, gift_id::text as gift_id, description, fund_label
          from giving_statement_lines where statement_id = ${statementId} order by line_no`);
      expect(lines.map((l) => l.kind)).toEqual(["cash", "cash", "cash", "non_cash"]);
      expect(lines.find((l) => l.gift_id === online)).toMatchObject({ amount_cents: 5181, covered_fee_cents: 181, description: "Online gift (card)" });
      expect(lines.find((l) => l.kind === "non_cash")).toMatchObject({ amount_cents: null, description: "Stock: Example Corp common (5 shares)" });

      // The stored bytes: a PDF whose sha256 is what the row says (the insert guard compared it with content_hash).
      const [blob] = await q(sql`select encode(bytes, 'hex') as hex, content_hash, content_type from blob_assets where id = ${String(s!.blob_id)}`);
      const stored = Buffer.from(String(blob!.hex), "hex");
      expect(stored.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(createHash("sha256").update(stored).digest("hex")).toBe(s!.pdf_sha256);
      expect(blob!.content_type).toBe("application/pdf");
      expect(flat(extractPdfText(stored))).toContain("Rosalind Penhallow");

      // DECISION-174: the renderer is deterministic, so re-rendering the FROZEN snapshot reproduces the stored bytes.
      const snapshot = await st.loadStatementSnapshot(treasurer.personId, org, statementId);
      expect(snapshot).not.toBeNull();
      const again = await render.renderStatementPdf([snapshot!]);
      expect(again.equals(stored)).toBe(true);
    }, 90_000);

    it("skips a donor whose gifts are all pending, test-mode or next year; a plate (unidentified) donor is never a candidate", async () => {
      const donor = await fx.makeDonor(org, "Pending Pruitt");
      await fx.makeOnlineGift(org, conn, donor, fund, 5000, { occurredOn: inYear("04-04"), status: "pending" });
      await fx.makeOnlineGift(org, conn, donor, fund, 5000, { occurredOn: inYear("04-05"), livemode: false });
      await fx.makeOfflineGift(org, donor, fund, 5000, { occurredOn: `${YEAR + 1}-01-01` });
      const plate = await fx.makeDonor(org, "Plate offering", { kind: "unidentified" });
      await fx.makeOfflineGift(org, plate, fund, 1500, { occurredOn: inYear("04-04") });
      const result = await issue([donor, plate]);
      expect(result).toMatchObject({ kind: "ok", issued: 0, skipped: 0, failed: [] });
      expect(await q(sql`select 1 from giving_statements where donor_id in (${donor}, ${plate})`)).toHaveLength(0);
    });

    it("a fully refunded gift is not on the statement and a donor with nothing left is not issued", async () => {
      const donor = await fx.makeDonor(org, "Refunda Rowe");
      const refunded = await fx.makeOnlineGift(org, conn, donor, fund, 5000, { occurredOn: inYear("04-04") });
      await fx.makeReversal(org, conn, refunded, "refund", 5000);
      expect(await issue([donor])).toMatchObject({ kind: "ok", issued: 0 });

      const partial = await fx.makeOnlineGift(org, conn, donor, fund, 8000, { occurredOn: inYear("05-05") });
      await fx.makeReversal(org, conn, partial, "refund", 3000);
      const id = await issueOne(donor);
      const lines = await q(sql`select amount_cents, reversed_cents from giving_statement_lines where statement_id = ${id}`);
      expect(lines).toEqual([{ amount_cents: 5000, reversed_cents: 3000 }]);
    });

    it("is idempotent: a second run issues nothing and leaves one statement", async () => {
      const donor = await donorWithGift("Idem Potent");
      await issueOne(donor);
      expect(await issue([donor])).toMatchObject({ kind: "ok", issued: 0, skipped: 0 });
      expect(await q(sql`select 1 from giving_statements where donor_id = ${donor}`)).toHaveLength(1);
    });

    it("two parallel issues for one donor and year: one wins, the other is skipped as already issued", async () => {
      const donor = await donorWithGift("Thaddeus Marlow", 7000);
      const [a, b] = await Promise.all([issue([donor]), issue([donor])]);
      expect(a.kind === "ok" && b.kind === "ok").toBe(true);
      const issued = (a.kind === "ok" ? a.issued : 0) + (b.kind === "ok" ? b.issued : 0);
      const skipped = (a.kind === "ok" ? a.skipped : 0) + (b.kind === "ok" ? b.skipped : 0);
      const failed = (a.kind === "ok" ? a.failed.length : 0) + (b.kind === "ok" ? b.failed.length : 0);
      expect({ issued, skipped, failed }).toEqual({ issued: 1, skipped: 1, failed: 0 });
      expect(await q(sql`select 1 from giving_statements where donor_id = ${donor}`)).toHaveLength(1);
    }, 90_000);

    it("pages in 25s: the first call returns a cursor, the second finishes, nobody is issued twice", async () => {
      const bulkOrg = await fx.makeOrg("bulk", { givingToggle: true });
      await fx.makeGivingSettings(bulkOrg);
      const bulkFund = await fx.makeFund(bulkOrg, "Bulk Fund");
      const actor = await fx.makeActor(bulkOrg, "Bea", "Bulkley", ["giving.view", "giving.record", "giving.manage"]);
      await fx.platform.transaction(async (tx) => {
        await armGivingWrite(tx);
        await tx.execute(sql`
          insert into giving_donors (organization_id, display_name)
          select ${bulkOrg}::uuid, 'Bulk Donor ' || lpad(n::text, 3, '0') from generate_series(1, 27) n`);
        await tx.execute(sql`
          insert into giving_gifts (organization_id, donor_id, fund_id, source, method, amount_cents, status, occurred_on, livemode, recorded_by)
          select ${bulkOrg}::uuid, d.id, ${bulkFund}::uuid, 'offline', 'cash', 2500, 'succeeded', ${inYear("03-03")}::date, true, ${fx.actingUserId}::uuid
            from giving_donors d where d.organization_id = ${bulkOrg}::uuid and d.display_name like 'Bulk Donor %'`);
      });
      const first = await st.issueStatementBatch(actor.personId, bulkOrg, actor.userId, { year: YEAR });
      expect(first).toMatchObject({ kind: "ok", issued: 25, failed: [] });
      if (first.kind !== "ok") return;
      expect(first.nextCursor).not.toBeNull();
      const second = await st.issueStatementBatch(actor.personId, bulkOrg, actor.userId, { year: YEAR, cursor: first.nextCursor });
      expect(second).toMatchObject({ kind: "ok", issued: 2, nextCursor: null });
      const [{ n, distinct }] = (await q(sql`select count(*)::int as n, count(distinct donor_id)::int as distinct from giving_statements where organization_id = ${bulkOrg}`)) as Array<{ n: number; distinct: number }>;
      expect({ n, distinct }).toEqual({ n: 27, distinct: 27 });
      expect(await st.issueStatementBatch(actor.personId, bulkOrg, actor.userId, { year: YEAR })).toMatchObject({ kind: "ok", issued: 0, nextCursor: null });
    }, 180_000);

    it("needs giving.manage AND giving.view; refuses a recorder, a view-only and a manage-only holder, and another organization's", async () => {
      const donor = await donorWithGift("Benedict Sallow");
      for (const actor of [manageOnly, viewOnly, recorderOnly]) {
        expect(await issue([donor], { actor })).toEqual({ kind: "forbidden" });
      }
      // A treasurer of ANOTHER organization has no membership here: the context itself refuses.
      await expect(issue([donor], { actor: otherTreasurer })).rejects.toThrow();
      expect(await q(sql`select 1 from giving_statements where donor_id = ${donor}`)).toHaveLength(0);
    });

    it("is blocked, naming what is missing, until the donee name and address are set", async () => {
      const actor = await fx.makeActor(orgNoSettings, "Ned", "Settingless", ["giving.view", "giving.record", "giving.manage"]);
      expect(await st.issueStatementBatch(actor.personId, orgNoSettings, actor.userId, { year: YEAR })).toEqual({
        kind: "blocked",
        blockers: ["donee_name", "donee_address"],
      });
      await fx.platform.execute(sql`insert into giving_settings (organization_id, donee_legal_name) values (${orgNoSettings}, 'Named Only Church')`);
      expect(await st.issueStatementBatch(actor.personId, orgNoSettings, actor.userId, { year: YEAR })).toEqual({
        kind: "blocked",
        blockers: ["donee_address"],
      });
    });

    it("refuses an impossible year", async () => {
      expect(await st.issueStatementBatch(treasurer.personId, org, treasurer.userId, { year: 1999 })).toEqual({ kind: "invalid_year" });
      expect(await st.issueStatementBatch(treasurer.personId, org, treasurer.userId, { year: YEAR + 5 })).toEqual({ kind: "invalid_year" });
    });

    it("in production it refuses to issue or re-issue until GIVING_STATEMENTS_ENABLED=1 (Operator Q6)", async () => {
      const donor = await donorWithGift("Gated Gwen");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("GIVING_STATEMENTS_ENABLED", "");
      try {
        expect(await issue([donor])).toEqual({ kind: "disabled" });
        expect(await st.reissueStatement(treasurer.personId, org, treasurer.userId, "00000000-0000-4000-8000-000000000001")).toEqual({ kind: "disabled" });
        expect(await q(sql`select 1 from giving_statements where donor_id = ${donor}`)).toHaveLength(0);
        vi.stubEnv("GIVING_STATEMENTS_ENABLED", "1");
        expect(await issue([donor])).toMatchObject({ kind: "ok", issued: 1 });
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  // -----------------------------------------------------------------------
  describe("previewStatementRun", () => {
    it("counts the run and names every exception", async () => {
      const previewOrg = await fx.makeOrg("preview", { givingToggle: true });
      await fx.makeGivingSettings(previewOrg);
      const previewFund = await fx.makeFund(previewOrg, "General");
      const previewConn = await fx.makeConnection(previewOrg, { livemode: true });
      const actor = await fx.makeActor(previewOrg, "Pia", "Previewer", ["giving.view", "giving.record", "giving.manage"]);
      const withEmail = await fx.makeDonor(previewOrg, "Emailed Ember", { email: "ember@example.invalid" });
      const noContact = await fx.makeDonor(previewOrg, "Nowhere Noor");
      const issuedAlready = await fx.makeDonor(previewOrg, "Already Alder", { email: "alder@example.invalid" });
      const stockDonor = await fx.makeDonor(previewOrg, "Stocky Stella", { email: "stella@example.invalid" });
      const plate = await fx.makeDonor(previewOrg, "Plate offering", { kind: "unidentified" });
      const pendingOnly = await fx.makeDonor(previewOrg, "Pending Paz");
      for (const d of [withEmail, noContact, issuedAlready]) await fx.makeOfflineGift(previewOrg, d, previewFund, 3000, { occurredOn: inYear("03-03") });
      await fx.makeOfflineGift(previewOrg, plate, previewFund, 900, { occurredOn: inYear("03-03") });
      await fx.makeOnlineGift(previewOrg, previewConn, pendingOnly, previewFund, 4000, { occurredOn: inYear("03-04"), status: "pending" });
      await fx.platform.transaction(async (tx) => {
        await armGivingWrite(tx);
        await tx.execute(sql`
          insert into giving_gifts (organization_id, donor_id, fund_id, source, method, stock_description, amount_cents, status, occurred_on, livemode, recorded_by)
          values (${previewOrg}, ${stockDonor}, ${previewFund}, 'offline', 'stock', 'Example Corp', 50000, 'succeeded', ${inYear("09-09")}, true, ${fx.actingUserId})`);
      });
      await st.issueStatementBatch(actor.personId, previewOrg, actor.userId, { year: YEAR, donorIds: [issuedAlready] });

      const result = await st.previewStatementRun(actor.personId, previewOrg, YEAR);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.preview).toMatchObject({
        year: YEAR,
        eligibleDonors: 4,
        alreadyIssued: 1,
        toIssue: 3,
        excludedPending: 1,
        undeliverable: 1,
        undeliverableDonors: [{ id: noContact, name: "Nowhere Noor" }],
        nonCash: 1,
        plateCashExcluded: 1,
        stale: 0,
        blockers: [],
        issuingEnabled: true,
      });
    }, 90_000);

    it("reports a recorder as forbidden and a missing donee identity as blockers", async () => {
      expect(await st.previewStatementRun(recorderOnly.personId, org, YEAR)).toEqual({ kind: "forbidden" });
      const bareOrg = await fx.makeOrg("bare", { givingToggle: true });
      const actor = await fx.makeActor(bareOrg, "Pru", "Preview", ["giving.view"]);
      const out = await st.previewStatementRun(actor.personId, bareOrg, YEAR);
      expect(out).toMatchObject({ kind: "ok", preview: { blockers: ["donee_name", "donee_address"], eligibleDonors: 0 } });
    });
  });

  // -----------------------------------------------------------------------
  describe("staleness, the list, and re-issue", () => {
    it("a late-dated gift and a later refund make the latest statement stale; a later test-mode gift does not", async () => {
      const donor = await donorWithGift("Stale Stanton", 6000, "03-03", { email: "stanton@example.invalid" });
      const online = await fx.makeOnlineGift(org, conn, donor, fund, 2000, { occurredOn: inYear("04-04") });
      const id = await issueOne(donor);
      const staleNow = async () =>
        (await st.listStatements(treasurer.personId, org, { year: YEAR, filter: "all" })) as Extract<Awaited<ReturnType<typeof st.listStatements>>, { kind: "ok" }>;
      const row = async () => (await staleNow()).statements.find((s) => s.id === id)!;

      expect((await row()).isStale).toBe(false);
      await fx.makeOnlineGift(org, conn, donor, fund, 9900, { occurredOn: inYear("07-07"), livemode: false });
      expect((await row()).isStale).toBe(false);
      await fx.makeReversal(org, conn, online, "refund", 500);
      expect((await row()).isStale).toBe(true);
      const stale = await st.getStale(treasurer.personId, org);
      expect(stale.kind === "ok" && stale.statements.some((s) => s.id === id)).toBe(true);
      const filtered = await st.listStatements(treasurer.personId, org, { year: YEAR, filter: "stale" });
      expect(filtered.kind === "ok" && filtered.statements.map((s) => s.id)).toContain(id);
    }, 90_000);

    it("re-issue makes version n+1 titled 'Corrected statement…', keeps the original, flips 'latest', and refuses a second correction", async () => {
      const donor = await donorWithGift("Corrie Marsh", 6000, "03-03", { email: "corrie@example.invalid" });
      const v1 = await issueOne(donor);
      // Not stale yet: refused.
      expect(await st.reissueStatement(treasurer.personId, org, treasurer.userId, v1)).toEqual({ kind: "not_stale" });
      await fx.makeOfflineGift(org, donor, fund2, 1500, { occurredOn: inYear("11-11") });

      const out = await st.reissueStatement(treasurer.personId, org, treasurer.userId, v1);
      expect(out).toMatchObject({ kind: "ok", version: 2 });
      if (out.kind !== "ok") return;

      const [v2] = await q(sql`select version, supersedes_id::text as supersedes_id, gift_count, cash_total_cents::int as cash, blob_asset_id::text as blob_id from giving_statements where id = ${out.statementId}`);
      expect(v2).toMatchObject({ version: 2, supersedes_id: v1, gift_count: 2, cash: 7500 });
      expect(await q(sql`select 1 from giving_statements where id = ${v1}`)).toHaveLength(1); // retained
      const text = flat(extractPdfText(Buffer.from(String((await q(sql`select encode(bytes, 'hex') as hex from blob_assets where id = ${String(v2!.blob_id)}`))[0]!.hex), "hex")));
      expect(text).toContain("Corrected statement, replaces statement dated");

      const latest = await st.listStatements(treasurer.personId, org, { year: YEAR, filter: "all" });
      const earlier = await st.listStatements(treasurer.personId, org, { year: YEAR, filter: "earlier" });
      expect(latest.kind === "ok" && latest.statements.filter((s) => s.donorId === donor).map((s) => s.version)).toEqual([2]);
      expect(earlier.kind === "ok" && earlier.statements.filter((s) => s.donorId === donor).map((s) => s.version)).toEqual([1]);
      // v1 is no longer the latest: refused. v2 is fresh: refused.
      expect(await st.reissueStatement(treasurer.personId, org, treasurer.userId, v1)).toEqual({ kind: "not_latest" });
      expect(await st.reissueStatement(treasurer.personId, org, treasurer.userId, out.statementId)).toEqual({ kind: "not_stale" });
    }, 90_000);

    it("two parallel re-issues: one version 2, the other refused; the chain does not fork", async () => {
      const donor = await donorWithGift("Ottoline Breck", 3100);
      const v1 = await issueOne(donor);
      await fx.makeOfflineGift(org, donor, fund, 100, { occurredOn: inYear("12-12") });
      const results = await Promise.all([
        st.reissueStatement(treasurer.personId, org, treasurer.userId, v1),
        st.reissueStatement(treasurer.personId, org, treasurer.userId, v1),
      ]);
      expect(results.filter((r) => r.kind === "ok")).toHaveLength(1);
      expect(results.filter((r) => r.kind === "already_reissued" || r.kind === "not_latest")).toHaveLength(1);
      expect(await q(sql`select 1 from giving_statements where donor_id = ${donor}`)).toHaveLength(2);
    }, 90_000);

    it("re-issue says so plainly when every gift on the statement has since been refunded", async () => {
      const donor = await fx.makeDonor(org, "Voida Vale");
      const gift = await fx.makeOnlineGift(org, conn, donor, fund, 5000, { occurredOn: inYear("04-04") });
      const v1 = await issueOne(donor);
      await fx.makeReversal(org, conn, gift, "refund", 5000);
      expect(await st.reissueStatement(treasurer.personId, org, treasurer.userId, v1)).toEqual({ kind: "nothing_to_count" });
    }, 90_000);

    it("re-issue is gated: a recorder and a manage-only holder are refused, a foreign or malformed id is not_found", async () => {
      const donor = await donorWithGift("Gate Gideon");
      const v1 = await issueOne(donor);
      expect(await st.reissueStatement(recorderOnly.personId, org, recorderOnly.userId, v1)).toEqual({ kind: "forbidden" });
      expect(await st.reissueStatement(manageOnly.personId, org, manageOnly.userId, v1)).toEqual({ kind: "forbidden" });
      expect(await st.reissueStatement(treasurer.personId, org, treasurer.userId, "not-a-uuid")).toEqual({ kind: "not_found" });
      expect(await st.reissueStatement(treasurer.personId, org, treasurer.userId, "00000000-0000-4000-8000-0000000000ff")).toEqual({ kind: "not_found" });
    }, 90_000);

    it("the list needs giving.view and pages by donor name", async () => {
      expect(await st.listStatements(recorderOnly.personId, org, { year: YEAR, filter: "all" })).toEqual({ kind: "forbidden" });
      expect(await st.listStatements(treasurer.personId, org, { year: 1980, filter: "all" })).toEqual({ kind: "invalid_year" });
      const page = await st.listStatements(treasurer.personId, org, { year: YEAR, filter: "all" });
      expect(page.kind).toBe("ok");
      if (page.kind !== "ok") return;
      const names = page.statements.map((s) => s.donorName.toLowerCase());
      expect(names).toEqual([...names].sort());
    });
  });

  // -----------------------------------------------------------------------
  describe("recordDelivery", () => {
    it("logs print_mailed once, shows on the list, and is gated to giving.manage", async () => {
      const donor = await donorWithGift("Mailed Maud");
      const id = await issueOne(donor);
      expect(await st.recordDelivery(recorderOnly.personId, org, recorderOnly.userId, id)).toEqual({ kind: "forbidden" });
      expect(await st.recordDelivery(viewOnly.personId, org, viewOnly.userId, id)).toEqual({ kind: "forbidden" });
      expect(await st.recordDelivery(treasurer.personId, org, treasurer.userId, id)).toEqual({ kind: "ok", alreadyRecorded: false });
      expect(await st.recordDelivery(treasurer.personId, org, treasurer.userId, id)).toEqual({ kind: "ok", alreadyRecorded: true });
      expect(await q(sql`select channel, email_queue_id, recorded_by::text as by from giving_statement_deliveries where statement_id = ${id}`)).toEqual([
        { channel: "print_mailed", email_queue_id: null, by: treasurer.userId },
      ]);
      const list = await st.listStatements(treasurer.personId, org, { year: YEAR, filter: "all" });
      expect(list.kind === "ok" && list.statements.find((s) => s.id === id)?.printMailedAt).toBeTruthy();
      const undelivered = await st.listStatements(treasurer.personId, org, { year: YEAR, filter: "not_delivered" });
      expect(undelivered.kind === "ok" && undelivered.statements.some((s) => s.id === id)).toBe(false);
    }, 90_000);

    it("answers not_found for another organization's statement and a malformed id", async () => {
      const otherDonor = await fx.makeDonor(otherOrg, "Otherly Orla");
      await fx.makeOfflineGift(otherOrg, otherDonor, await fx.makeFund(otherOrg, "Their Fund"), 4000, { occurredOn: inYear("03-03") });
      const result = await st.issueStatementBatch(otherTreasurer.personId, otherOrg, otherTreasurer.userId, { year: YEAR });
      expect(result).toMatchObject({ kind: "ok", issued: 1 });
      if (result.kind !== "ok") return;
      const foreign = result.issuedStatements[0]!.statementId;
      expect(await st.recordDelivery(treasurer.personId, org, treasurer.userId, foreign)).toEqual({ kind: "not_found" });
      expect(await st.recordDelivery(treasurer.personId, org, treasurer.userId, "nope")).toEqual({ kind: "not_found" });
      expect(await st.findStatementForDownload(treasurer.personId, org, foreign)).toEqual({ kind: "not_found" });
    }, 90_000);
  });

  // -----------------------------------------------------------------------
  describe("sendStatementNotices", () => {
    it("emails a notice with no amounts to a linked member, logs the delivery with the queue id, and never sends twice", async () => {
      try {
        const noticeOrg = await fx.makeOrg("notice", { givingToggle: true });
        await fx.makeGivingSettings(noticeOrg);
        const noticeFund = await fx.makeFund(noticeOrg, "General");
        const actor = await fx.makeActor(noticeOrg, "Nell", "Noticer", ["giving.view", "giving.record", "giving.manage"]);
        const member = await fx.makeActor(noticeOrg, "Linus", "Linked", []);
        const membership = await fx.membershipOf(noticeOrg, member.personId);
        const linked = await fx.makeDonor(noticeOrg, "Linus Linked", { email: "linus@example.invalid", linkedMembershipId: membership });
        const unlinked = await fx.makeDonor(noticeOrg, "Unlinked Una", { email: "una@example.invalid" });
        const linkedNoEmail = await fx.makeDonor(noticeOrg, "Linked Noemail", { linkedMembershipId: await fx.membershipOf(noticeOrg, (await fx.makeActor(noticeOrg, "Lena", "Linked", [])).personId) });
        for (const d of [linked, unlinked, linkedNoEmail]) await fx.makeOfflineGift(noticeOrg, d, noticeFund, 12345, { occurredOn: inYear("03-03") });
        await st.issueStatementBatch(actor.personId, noticeOrg, actor.userId, { year: YEAR });

        expect(await st.sendStatementNotices(recorderOnly.personId, org, recorderOnly.userId, { year: YEAR })).toEqual({ kind: "forbidden" });
        const result = await st.sendStatementNotices(actor.personId, noticeOrg, actor.userId, { year: YEAR });
        expect(result).toMatchObject({ kind: "ok", sent: 1, skipped: 0, failed: 0, nextCursor: null });

        const deliveries = await q(sql`
          select d.channel, d.email_queue_id::text as qid, s.donor_id::text as donor
            from giving_statement_deliveries d join giving_statements s on s.id = d.statement_id
           where d.organization_id = ${noticeOrg}`);
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0]).toMatchObject({ channel: "email_notice", donor: linked });
        const qid = String(deliveries[0]!.qid);
        queueIds.push(qid);
        const [mail] = await q(sql`select to_email, subject, html_body, text_body, template_key, status from email_queue where id = ${qid}::uuid`);
        expect(mail).toMatchObject({ to_email: "linus@example.invalid", template_key: "giving.statement.notice", status: "sent" });
        for (const part of [mail!.subject, mail!.html_body, mail!.text_body]) {
          expect(String(part)).not.toContain("$");
          expect(String(part)).not.toMatch(/\d+\.\d{2}/);
          expect(String(part)).not.toContain("123");
        }
        expect(String(mail!.subject)).toContain(String(YEAR));
        expect(String(mail!.text_body)).toMatch(/\/o\/.+\/giving/);

        // A second run finds nothing to send.
        expect(await st.sendStatementNotices(actor.personId, noticeOrg, actor.userId, { year: YEAR })).toMatchObject({ kind: "ok", sent: 0, nextCursor: null });
        const preview = await st.previewStatementRun(actor.personId, noticeOrg, YEAR);
        expect(preview.kind === "ok" && preview.preview.noticeCandidates).toBe(0);
        const list = await st.listStatements(actor.personId, noticeOrg, { year: YEAR, filter: "all" });
        expect(list.kind === "ok" && list.statements.find((s) => s.donorId === linked)?.noticeSentAt).toBeTruthy();
        expect(list.kind === "ok" && list.statements.find((s) => s.donorId === linked)?.noticeBounced).toBe(false);

        // A bounce on the queue row surfaces on the list (joined on email_queue_id).
        await q(sql`update email_queue set bounced_at = now() where id = ${qid}::uuid`);
        const bounced = await st.listStatements(actor.personId, noticeOrg, { year: YEAR, filter: "all" });
        expect(bounced.kind === "ok" && bounced.statements.find((s) => s.donorId === linked)?.noticeBounced).toBe(true);
      } finally {
        vi.unstubAllEnvs();
      }
    }, 120_000);

    it("refuses to send in production when there is no safe https origin to link to", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
      try {
        expect(await st.sendStatementNotices(treasurer.personId, org, treasurer.userId, { year: YEAR })).toEqual({ kind: "origin_unconfigured" });
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  // -----------------------------------------------------------------------
  describe("the print run and the download lookup", () => {
    it("the print run is every LATEST statement of the year in donor-name order; the batch prints each statement's own text", async () => {
      const printOrg = await fx.makeOrg("print", { givingToggle: true });
      await fx.makeGivingSettings(printOrg);
      const printFund = await fx.makeFund(printOrg, "General");
      const actor = await fx.makeActor(printOrg, "Pat", "Printer", ["giving.view", "giving.record", "giving.manage"]);
      const zed = await fx.makeDonor(printOrg, "Zed Zimmer");
      const abe = await fx.makeDonor(printOrg, "Abe Aldous");
      for (const d of [zed, abe]) await fx.makeOfflineGift(printOrg, d, printFund, 4200, { occurredOn: inYear("03-03") });
      await st.issueStatementBatch(actor.personId, printOrg, actor.userId, { year: YEAR });
      // Correct Abe's statement: the run holds version 2 only.
      await fx.makeOfflineGift(printOrg, abe, printFund, 800, { occurredOn: inYear("04-04") });
      const abeV1 = (await q(sql`select id::text as id from giving_statements where donor_id = ${abe}`))[0]!.id as string;
      expect(await st.reissueStatement(actor.personId, printOrg, actor.userId, abeV1)).toMatchObject({ kind: "ok", version: 2 });

      const run = await st.loadPrintRun(actor.personId, printOrg, YEAR);
      expect(run.kind).toBe("ok");
      if (run.kind !== "ok") return;
      expect(run.statements.map((s) => [s.snapshot.donorName, s.snapshot.version])).toEqual([["Abe Aldous", 2], ["Zed Zimmer", 1]]);
      expect(run.statements[0]!.snapshot.replacesDate).not.toBeNull();
      expect(run.statements[1]!.snapshot.replacesDate).toBeNull();

      const batch = await render.renderStatementPdf(run.statements.map((s) => s.snapshot));
      const pages = flat(extractPdfText(batch));
      expect(pages).toContain("Abe Aldous");
      expect(pages).toContain("Zed Zimmer");
      expect(pages).toContain("Corrected statement, replaces statement dated");
      expect(extractPdfText(batch).split("\f")).toHaveLength(2);

      expect(await st.loadPrintRun(recorderOnly.personId, org, YEAR)).toEqual({ kind: "forbidden" });
      expect(await st.loadPrintRun(actor.personId, printOrg, YEAR - 3)).toEqual({ kind: "empty" });
      expect(await st.loadPrintRun(actor.personId, printOrg, 1980)).toEqual({ kind: "invalid_year" });
    }, 120_000);

    it("findStatementForDownload: view or manage may; a recorder may not; absent, malformed and foreign ids are ONE answer", async () => {
      const donor = await donorWithGift("Download Dacey");
      const id = await issueOne(donor);
      expect(await st.findStatementForDownload(viewOnly.personId, org, id)).toMatchObject({ kind: "ok", statement: { id, donorId: donor, taxYear: YEAR, version: 1 } });
      expect(await st.findStatementForDownload(manageOnly.personId, org, id)).toMatchObject({ kind: "ok" });
      expect(await st.findStatementForDownload(recorderOnly.personId, org, id)).toEqual({ kind: "forbidden" });
      const absent = await st.findStatementForDownload(treasurer.personId, org, "00000000-0000-4000-8000-0000000000ee");
      const malformed = await st.findStatementForDownload(treasurer.personId, org, "../../etc/passwd");
      expect(absent).toEqual({ kind: "not_found" });
      expect(malformed).toEqual(absent);
    }, 90_000);
  });
});
