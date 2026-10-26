/**
 * D2 - drizzle/0072_presby_blob_audience.sql on REAL Postgres connections
 * (F289, DECISION-277; docs/work-log/2026-10-25-public-asset-allowlist.md,
 * Phase 3 "Test Plan" D2). The database half of the audience contract:
 *
 *   - the column (not null, default 'private', fail-closed) and its keys;
 *   - F298 at the database: identical bytes may exist once per audience, and
 *     dedup still holds within an audience;
 *   - the CHECKs: closed vocabulary; public_site implies an image;
 *   - immutability on EVERY connection: the owner (getPlatformDb() is
 *     neondb_owner, which no grant binds - F44) is refused; presby_platform
 *     (BYPASSRLS, holds UPDATE, but NOLOGIN today, so no session can be it)
 *     is pinned structurally - the trigger is its only barrier and it cannot
 *     get around it; presby_app holds no UPDATE at all;
 *   - the two private consumers cannot reference a public_site row (the
 *     three-column composite FK, as a database property), and the statement
 *     PDF stays undeletable and byte-immutable (F44 preserved);
 *   - the catalog rule: every FK into blob_assets is on the public-reference
 *     allowlist or pins asset_audience = 'private'. A new private consumer
 *     (treasury's 0073 receipts) that forgets the constant fails here.
 *
 * The ADAPTER half of D2 (store()'s audience-scoped dedup, resolve()/
 * resolveMeta() refusing the other audience, BlobValidationError for a
 * public_site non-image) is Batch 2's: it tests code Batch 2 writes.
 *
 * Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/storage/blob-audience.db.test.ts
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { GivingFixture } from "@/lib/testing/giving-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;

/** Drizzle wraps the Postgres error ("Failed query: ...") - match the whole cause chain. */
function chain(err: unknown): string {
  const parts: string[] = [];
  for (let e = err as { message?: string; code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    parts.push(`${e.code ?? ""} ${String(e.message ?? e)}`);
  }
  return parts.join(" | ");
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

const PNG = (seed: string) => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from(`f289 ${seed} ${randomUUID()}`)]);

/** Rolled back on purpose: the thrown sentinel aborts the transaction after `fn` has run. */
class Rollback extends Error {}

describe.skipIf(!hasDb)("drizzle/0072 blob_assets.audience (Postgres-backed)", () => {
  let fx: GivingFixture;
  let appDb: typeof import("@/lib/db").db;
  let org: string;
  let otherOrg: string;
  let person: string;

  const q = async (query: SQL): Promise<Row[]> => fx.rowsOf(await fx.platform.execute(query));

  async function insertBlob(o: {
    org?: string;
    bytes: Buffer;
    contentType?: string;
    audience?: string | null; // null = omit the column (what pre-0072 code does)
  }): Promise<string> {
    const orgId = o.org ?? org;
    const hash = createHash("sha256").update(o.bytes).digest("hex");
    const ct = o.contentType ?? "image/png";
    const hex = o.bytes.toString("hex");
    const rows =
      o.audience === null || o.audience === undefined
        ? await q(sql`insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes)
                      values (${orgId}, ${hash}, ${ct}, ${o.bytes.byteLength}, decode(${hex}, 'hex')) returning id`)
        : await q(sql`insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes, audience)
                      values (${orgId}, ${hash}, ${ct}, ${o.bytes.byteLength}, decode(${hex}, 'hex'), ${o.audience}) returning id`);
    return String(rows[0]!.id);
  }

  /** Runs `fn` in an owner transaction that is always rolled back. */
  async function inRolledBack(fn: (tx: Parameters<Parameters<typeof fx.platform.transaction>[0]>[0]) => Promise<void>) {
    try {
      await fx.platform.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  let ticket: string;

  beforeAll(async () => {
    ({ db: appDb } = await import("@/lib/db"));
    const mod = await import("@/lib/testing/giving-fixture");
    fx = await mod.createGivingFixture("blob-audience");
    org = await fx.makeOrg("a");
    otherOrg = await fx.makeOrg("b");
    person = await fx.makePerson("Wren", "Halloway");
    await fx.addMember(org, person);
    const [t] = await q(sql`
      insert into tickets (organization_id, submitter_person_id, subject, change_class, area)
      values (${org}, ${person}, 'F289 fixture ticket', 'bug', 'website') returning id`);
    ticket = String(t!.id);
  }, 90_000);

  afterAll(async () => {
    if (!fx) return;
    for (const o of [org, otherOrg]) {
      await q(sql`delete from ticket_messages where organization_id = ${o}`);
      await q(sql`delete from tickets where organization_id = ${o}`);
    }
    await fx.cleanup();
  }, 90_000);

  // -------------------------------------------------------------------------
  describe("the column and its keys", () => {
    it("audience is NOT NULL with the permanent fail-closed default 'private' (R5)", async () => {
      const [c] = await q(sql`
        select is_nullable, column_default from information_schema.columns
         where table_schema = 'public' and table_name = 'blob_assets' and column_name = 'audience'`);
      expect(c).toMatchObject({ is_nullable: "NO", column_default: "'private'::text" });
    });

    it("an insert that omits audience (what pre-0072 code does) lands 'private'", async () => {
      const id = await insertBlob({ bytes: PNG("omit"), audience: null });
      const [r] = await q(sql`select audience from blob_assets where id = ${id}`);
      expect(r!.audience).toBe("private");
    });

    it("the unique keys: dedup per audience, the three-column FK target, and the two-column key kept", async () => {
      const rows = await q(sql`
        select c.conname,
               (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
                  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
          from pg_constraint c where c.conrelid = 'blob_assets'::regclass and c.contype = 'u' order by c.conname`);
      expect(Object.fromEntries(rows.map((r) => [r.conname, r.cols]))).toEqual({
        blob_assets_id_org_audience_key: ["id", "organization_id", "audience"],
        blob_assets_id_org_key: ["id", "organization_id"],
        blob_assets_org_audience_hash_key: ["organization_id", "audience", "content_hash"],
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("F298 at the database", () => {
    it("identical bytes are two rows, one per audience - a private upload never resolves to the public row", async () => {
      const bytes = PNG("twin");
      const pub = await insertBlob({ bytes, audience: "public_site" });
      const priv = await insertBlob({ bytes, audience: "private" });
      expect(pub).not.toBe(priv);
    });

    it("and dedup still holds WITHIN an audience", async () => {
      const bytes = PNG("dedup");
      await insertBlob({ bytes, audience: "public_site" });
      await expectRaise(insertBlob({ bytes, audience: "public_site" }), /blob_assets_org_audience_hash_key/);
      await insertBlob({ bytes, audience: "private" });
      await expectRaise(insertBlob({ bytes, audience: "private" }), /blob_assets_org_audience_hash_key/);
    });
  });

  // -------------------------------------------------------------------------
  describe("the CHECKs", () => {
    it("public_site is an image: JSON and PDF are refused as public_site", async () => {
      await expectRaise(
        insertBlob({ bytes: Buffer.from(`{"f289":"${randomUUID()}"}`), contentType: "application/json", audience: "public_site" }),
        /blob_assets_public_site_is_image/,
      );
      await expectRaise(
        insertBlob({ bytes: Buffer.from(`%PDF-1.7 ${randomUUID()}`), contentType: "application/pdf", audience: "public_site" }),
        /blob_assets_public_site_is_image/,
      );
    });

    it("...and the same bytes are fine as private", async () => {
      await insertBlob({ bytes: Buffer.from(`%PDF-1.7 ${randomUUID()}`), contentType: "application/pdf", audience: "private" });
    });

    it("the vocabulary is closed", async () => {
      await expectRaise(insertBlob({ bytes: PNG("vocab"), audience: "other" }), /blob_assets_audience_allowed/);
      await expectRaise(insertBlob({ bytes: PNG("vocab-case"), audience: "Public_Site" }), /blob_assets_audience_allowed/);
    });
  });

  // -------------------------------------------------------------------------
  describe("audience is immutable on every connection", () => {
    it("the OWNER (getPlatformDb(), neondb_owner) is refused, in both directions", async () => {
      const pub = await insertBlob({ bytes: PNG("own-pub"), audience: "public_site" });
      const priv = await insertBlob({ bytes: PNG("own-priv"), audience: "private" });
      await expectRaise(q(sql`update blob_assets set audience = 'private' where id = ${pub}`), /23514.*audience is immutable/);
      await expectRaise(q(sql`update blob_assets set audience = 'public_site' where id = ${priv}`), /23514.*audience is immutable/);
      const rows = await q(sql`select id::text, audience from blob_assets where id in (${pub}, ${priv}) order by audience`);
      expect(rows.map((r) => r.audience)).toEqual(["private", "public_site"]);
    });

    // presby_platform is NOLOGIN today and the owner's membership carries no
    // SET option, so NO session can act as it: the case cannot be exercised,
    // only pinned. What makes the trigger bind it the day a real login exists:
    // it holds UPDATE (so the trigger is the only barrier), the trigger fires
    // in origin mode for every role (tgenabled 'O', a plain BEFORE trigger that
    // reads no role), and presby_platform can neither disable it (not the
    // table owner) nor skip it (no SET on session_replication_role).
    it("presby_platform (BYPASSRLS, holds UPDATE) has nothing between it and a flip but the trigger, and cannot get around it", async () => {
      const [r] = await q(sql`
        select has_table_privilege('presby_platform', 'blob_assets', 'UPDATE') as can_update,
               pg_get_userbyid(c.relowner) <> 'presby_platform'
                 and not pg_has_role('presby_platform', c.relowner, 'MEMBER') as not_owner,
               has_parameter_privilege('presby_platform', 'session_replication_role', 'SET') as can_skip_triggers,
               (select t.tgenabled from pg_trigger t
                 where t.tgrelid = c.oid and t.tgname = 'blob_assets_audience_immutable') as tgenabled
          from pg_class c where c.oid = 'blob_assets'::regclass`);
      expect(r).toEqual({ can_update: true, not_owner: true, can_skip_triggers: false, tgenabled: "O" });
    });

    it("an UPDATE that does not change audience is not this trigger's business", async () => {
      const id = await insertBlob({ bytes: PNG("same"), audience: "public_site" });
      await inRolledBack(async (tx) => {
        await tx.execute(sql`update blob_assets set audience = 'public_site' where id = ${id}`);
        await tx.execute(sql`update blob_assets set created_at = created_at where id = ${id}`);
      });
    });

    it("presby_app holds no UPDATE on blob_assets at all, and cannot execute the trigger function", async () => {
      const id = await insertBlob({ bytes: PNG("app"), audience: "private" });
      await expectRaise(
        appDb.transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.current_org_id', ${org}, true)`);
          await tx.execute(sql`update blob_assets set audience = 'public_site' where id = ${id}`);
        }),
        /42501|permission denied for table blob_assets/,
      );
      const [r] = await q(sql`
        select has_function_privilege('presby_app', 'presby_blob_assets_audience_immutable()', 'execute') as app,
               has_function_privilege('presby_platform', 'presby_blob_assets_audience_immutable()', 'execute') as platform`);
      expect(r).toEqual({ app: false, platform: false });
    });
  });

  // -------------------------------------------------------------------------
  describe("ticket_messages pins 'private' (the composite FK, as a database property)", () => {
    async function message(attachment: string | null, assetAudience?: string) {
      return assetAudience === undefined
        ? q(sql`insert into ticket_messages (organization_id, ticket_id, author_kind, author_person_id, body, attachment_asset_key)
                values (${org}, ${ticket}, 'submitter', ${person}, 'F289 fixture message', ${attachment}::uuid) returning id`)
        : q(sql`insert into ticket_messages (organization_id, ticket_id, author_kind, author_person_id, body, attachment_asset_key, asset_audience)
                values (${org}, ${ticket}, 'submitter', ${person}, 'F289 fixture message', ${attachment}::uuid, ${assetAudience}) returning id`);
    }

    it("an attachment pointing at a public_site row is refused by ticket_messages_attachment_fk", async () => {
      const pub = await insertBlob({ bytes: PNG("tm-pub"), audience: "public_site" });
      await expectRaise(message(pub), /23503.*ticket_messages_attachment_fk/);
    });

    it("an attachment pointing at a private row is accepted; a null attachment stays unchecked (MATCH SIMPLE)", async () => {
      const priv = await insertBlob({ bytes: PNG("tm-priv"), audience: "private" });
      expect(await message(priv)).toHaveLength(1);
      expect(await message(null)).toHaveLength(1);
    });

    it("the constant cannot be set to anything but 'private'", async () => {
      const pub = await insertBlob({ bytes: PNG("tm-const"), audience: "public_site" });
      await expectRaise(message(pub, "public_site"), /ticket_messages_asset_audience_private/);
    });

    it("a foreign org's private row is still refused (the tenant column stays in the key)", async () => {
      const foreign = await insertBlob({ org: otherOrg, bytes: PNG("tm-foreign"), audience: "private" });
      await expectRaise(message(foreign), /23503.*ticket_messages_attachment_fk/);
    });
  });

  // -------------------------------------------------------------------------
  describe("giving_statements pins 'private', and F44 is preserved", () => {
    let statement: string;
    let pdf: string;

    beforeAll(async () => {
      const { issueStatement } = await import("@/lib/testing/giving-fixture");
      const gOrg = await fx.makeOrg("giving", { givingToggle: true });
      await fx.makeGivingSettings(gOrg);
      const fund = await fx.makeFund(gOrg, "General Fund");
      const issuer = (await fx.makeActor(gOrg, "Odile", "Fenwright", ["giving.manage", "giving.view", "giving.record"])).userId;
      const donor = await fx.makeDonor(gOrg, "Barnaby Tillinghast");
      const year = new Date().getUTCFullYear() - 1;
      await fx.makeOfflineGift(gOrg, donor, fund, 2500, { occurredOn: `${year}-04-01` });
      const issued = await appDb.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_org_id', ${gOrg}, true)`);
        return issueStatement(tx, { organizationId: gOrg, donorId: donor, taxYear: year, issuedBy: issuer });
      });
      statement = issued.statementId;
      pdf = issued.blobId;
    }, 90_000);

    it("the issued statement's PDF is private and carries the constant", async () => {
      const [r] = await q(sql`
        select b.audience, s.asset_audience from giving_statements s
          join blob_assets b on b.id = s.blob_asset_id and b.organization_id = s.organization_id
         where s.id = ${statement}`);
      expect(r).toEqual({ audience: "private", asset_audience: "private" });
    });

    it("DELETE of the referenced PDF is refused on the owner path by giving_statements_blob_fk (NO ACTION)", async () => {
      await expectRaise(q(sql`delete from blob_assets where id = ${pdf}`), /23503.*giving_statements_blob_fk/);
    });

    it("its bytes stay immutable (blob_assets_giving_statement_guard) and so does its audience", async () => {
      await expectRaise(q(sql`update blob_assets set bytes = bytes || '\\x00'::bytea where id = ${pdf}`), /immutable/);
      await expectRaise(q(sql`update blob_assets set audience = 'public_site' where id = ${pdf}`), /audience is immutable/);
    });

    it("pointing a statement at a public_site row is refused by the FK itself (freeze lifted inside a rolled-back transaction)", async () => {
      const [s] = await q(sql`select organization_id from giving_statements where id = ${statement}`);
      const sOrg = String(s!.organization_id);
      const pubInOrg = await insertBlob({ org: sOrg, bytes: PNG("gs-pub-org"), audience: "public_site" });
      const privInOrg = await insertBlob({ org: sOrg, bytes: Buffer.from(`%PDF-1.7 ${randomUUID()}`), contentType: "application/pdf", audience: "private" });
      // Positive control: a private row of the same org is accepted by the FK.
      await inRolledBack(async (tx) => {
        await tx.execute(sql`alter table giving_statements disable trigger giving_statements_freeze`);
        await tx.execute(sql`update giving_statements set blob_asset_id = ${privInOrg} where id = ${statement}`);
      });
      let caught: unknown = null;
      try {
        await fx.platform.transaction(async (tx) => {
          await tx.execute(sql`alter table giving_statements disable trigger giving_statements_freeze`);
          await tx.execute(sql`update giving_statements set blob_asset_id = ${pubInOrg} where id = ${statement}`);
        });
      } catch (err) {
        caught = err;
      }
      expect(chain(caught)).toMatch(/23503.*giving_statements_blob_fk/);
      const [t] = await q(sql`select tgenabled from pg_trigger where tgname = 'giving_statements_freeze'`);
      expect(t!.tgenabled).toBe("O");
    });

    it("the FK is three columns, NO ACTION on delete and update, validated", async () => {
      const [c] = await q(sql`
        select c.confdeltype, c.confupdtype, c.convalidated,
               (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
                  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols,
               (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
                  join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as fcols
          from pg_constraint c where c.conname = 'giving_statements_blob_fk'`);
      expect(c).toEqual({
        confdeltype: "a",
        confupdtype: "a",
        convalidated: true,
        cols: ["blob_asset_id", "organization_id", "asset_audience"],
        fcols: ["id", "organization_id", "audience"],
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("the catalog rule (R6): every FK into blob_assets is public-allowlisted or pins 'private'", () => {
    const PUBLIC_REFERENCE_ALLOWLIST = [
      "organization_brands_mark_asset_fk",
      "organization_brands_wordmark_asset_fk",
      "organization_sites_content_bundle_fk",
    ];

    it("holds for every FK in the catalog", async () => {
      const fks = await q(sql`
        select c.conname, c.conrelid::regclass::text as tbl,
               exists (
                 select 1 from unnest(c.conkey) k(attnum)
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
                  where a.attname = 'asset_audience'
                    and exists (select 1 from pg_constraint ck
                                 where ck.conrelid = c.conrelid and ck.contype = 'c' and ck.convalidated
                                   and pg_get_constraintdef(ck.oid) = 'CHECK ((asset_audience = ''private''::text))')
               ) as pins_private
          from pg_constraint c
         where c.contype = 'f' and c.confrelid = 'blob_assets'::regclass
         order by c.conname`);
      const offenders = fks.filter((f) => !PUBLIC_REFERENCE_ALLOWLIST.includes(String(f.conname)) && f.pins_private !== true);
      expect(offenders, "an FK into blob_assets that is neither public-allowlisted nor pinned to 'private'").toEqual([]);
      // Not vacuous: the two private consumers exist and pin; the allowlist names real constraints.
      const byName = Object.fromEntries(fks.map((f) => [f.conname, f.pins_private]));
      expect(byName).toMatchObject({ ticket_messages_attachment_fk: true, giving_statements_blob_fk: true });
      for (const n of PUBLIC_REFERENCE_ALLOWLIST) expect(Object.keys(byName), n).toContain(n);
    });
  });
});
