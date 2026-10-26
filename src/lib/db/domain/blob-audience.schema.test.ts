/**
 * U7 - static pin for drizzle/0072_presby_blob_audience.sql (F289,
 * DECISION-277; docs/work-log/2026-10-25-public-asset-allowlist.md, Phase 3
 * "Data Model" and "Test Plan" U7).
 *
 * Reads the migration TEXT (comments stripped) and the Drizzle declarations.
 * No database. What it pins:
 *
 *   - R1's step ORDER. The order is load-bearing, not cosmetic: the column
 *     default must exist before the flip; the pre-flip assertion must run
 *     before the flip (it is what guarantees the 0056 statement guard cannot
 *     fire during it); the image CHECK must come after the flip (so the flip
 *     is image-only by construction); the immutability trigger must come
 *     after the flip (or the flip itself is refused).
 *   - Each roster re-creation restates `set search_path = public, pg_temp`
 *     (create or replace REPLACES proconfig, so 0048's pin would be lost
 *     silently), the revoke and the grant, and reads hide_photo.
 *   - No top-level begin/commit: the file is applied with `psql -1`, which is
 *     what makes it atomic.
 *   - giving_statements_blob_fk keeps NO ACTION on both delete and update (F44).
 *   - The Drizzle mirrors: blob_assets.audience and its keys/CHECKs, and the
 *     asset_audience constant on ticket_messages and giving_statements.
 *
 * The behaviour behind each of these is proven on a real database in
 * src/lib/storage/blob-audience.db.test.ts, src/lib/db/domain/
 * public-roster-photo.db.test.ts, scripts/assets/test-rls-72.sql and
 * scripts/assets/test-0072-migration.sh.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
// Enter the domain cycle through the canonical entry point first (see
// giving.schema.test.ts for why).
import { permissions } from "../schema";
import { blobAssets } from "./assets";
import { ticketMessages } from "./support";
import { givingStatements } from "./giving";

void permissions;

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const RAW = read("../../../../drizzle/0072_presby_blob_audience.sql");
/** Line comments removed, so a marker quoted in a comment can never satisfy (or break) an assertion. */
const SQL = RAW.replace(/--[^\n]*/g, "");

function indexOfOrFail(marker: string): number {
  const i = SQL.indexOf(marker);
  expect(i, `0072 does not contain: ${marker}`).toBeGreaterThanOrEqual(0);
  return i;
}

/** The text of one `create or replace function <name>(` block, up to the next `create or replace function`. */
function functionBlock(name: string): string {
  const start = indexOfOrFail(`create or replace function ${name}(`);
  const next = SQL.indexOf("create or replace function", start + 10);
  return SQL.slice(start, next < 0 ? undefined : next);
}

describe("0072: R1's step order", () => {
  const ORDER = [
    "alter table blob_assets add column if not exists audience text not null default 'private'",
    "add constraint blob_assets_audience_allowed",
    "raise exception '0072: % blob(s) are both published",
    "update blob_assets b set audience = 'public_site'",
    "add constraint blob_assets_public_site_is_image",
    "add constraint blob_assets_org_audience_hash_key",
    "add constraint blob_assets_id_org_audience_key",
    "add constraint ticket_messages_attachment_fk",
    "add constraint giving_statements_blob_fk",
    "create trigger blob_assets_audience_immutable",
    "create or replace function presby_public_staff_roster(",
    "create or replace function presby_public_committee_roster(",
    "create index if not exists people_photo_key_lower_idx",
    "create or replace function presby_public_site_asset(",
  ];

  it("every step is present, in R1's order", () => {
    const positions = ORDER.map(indexOfOrFail);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i], `"${ORDER[i]}" must come after "${ORDER[i - 1]}"`).toBeGreaterThan(positions[i - 1]!);
    }
  });

  it("the immutability trigger is dropped before the flip (a re-run must be able to heal) and created only after it", () => {
    const flip = indexOfOrFail("update blob_assets b set audience = 'public_site'");
    const firstDrop = indexOfOrFail("drop trigger if exists blob_assets_audience_immutable on blob_assets");
    expect(firstDrop).toBeLessThan(flip);
    expect(SQL.lastIndexOf("create trigger blob_assets_audience_immutable")).toBeGreaterThan(flip);
  });

  it("the flip set is images only, and the pre-flip assertion checks all three private consumers", () => {
    const assertion = SQL.slice(indexOfOrFail("create temp table _blob_audience_flip"), indexOfOrFail("update blob_assets b set audience"));
    expect(assertion).toMatch(/from ticket_messages t/);
    expect(assertion).toMatch(/from giving_statements g/);
    expect(assertion).toMatch(/from people p/);
    expect(assertion.match(/content_type in \('image\/png','image\/jpeg','image\/webp'\)/g)?.length).toBe(2);
    expect(assertion).toMatch(/errcode = 'check_violation'/);
  });

  it("the temp table has no ON COMMIT clause (it must survive autocommit) and is dropped explicitly", () => {
    expect(SQL).toMatch(/create temp table _blob_audience_flip \([^;]*\);/);
    expect(SQL).not.toMatch(/_blob_audience_flip[^;]*on commit/i);
    expect(SQL).toMatch(/drop table _blob_audience_flip;/);
  });
});

describe("0072: atomicity and idempotence markers", () => {
  it("has no top-level begin;/commit; - it is applied with psql -1", () => {
    expect(SQL).not.toMatch(/^\s*(begin|commit|start transaction)\s*;/im);
  });

  it("guards every create and add", () => {
    expect(SQL).not.toMatch(/create table (?!if not exists)/i);
    expect(SQL).not.toMatch(/add column (?!if not exists)/i);
    expect(SQL).not.toMatch(/create index (?!if not exists)/i);
    // Every `add constraint X` is preceded by `drop constraint if exists X`, or sits in a pg_constraint-guarded DO block.
    for (const m of SQL.matchAll(/alter table (\w+) add constraint (\w+)/g)) {
      const [, table, name] = m;
      const guarded =
        SQL.indexOf(`alter table ${table} drop constraint if exists ${name};`) > -1 &&
        SQL.indexOf(`alter table ${table} drop constraint if exists ${name};`) < m.index!;
      const inDo = new RegExp(`if not exists \\(select 1 from pg_constraint where conname = '${name}'\\)`).test(SQL);
      expect(guarded || inDo, `${table}.${name} is not re-run safe`).toBe(true);
    }
  });

  it("blob_assets_id_org_audience_key is never dropped (the consumer FKs depend on it on a re-run)", () => {
    expect(SQL).not.toMatch(/drop constraint if exists blob_assets_id_org_audience_key/);
    expect(SQL).toMatch(/if not exists \(select 1 from pg_constraint where conname = 'blob_assets_id_org_audience_key'\)/);
  });

  it("blob_assets_id_org_key is kept (the brand and site FKs reference it)", () => {
    expect(SQL).not.toMatch(/drop constraint if exists blob_assets_id_org_key\b/);
  });
});

describe("0072: people is global (D1)", () => {
  it("never reads people.organization_id, which does not exist — regression for the Phase 3 design's people.organization_id", () => {
    // The design wrote p.organization_id / pe.organization_id in the pre-flip
    // assertion, both roster joins, the door and the index; the snapshot run
    // (D5) failed with `column p.organization_id does not exist`. A person's
    // photo is matched on the globally unique key alone, and person_privacy
    // (primary key person_id alone) on person_id alone: a hidden photo stays
    // hidden on every org's public list.
    expect(SQL).not.toMatch(/\b(p|pe)\.organization_id\b/);
    expect(SQL).not.toMatch(/on people \(organization_id/);
    expect(SQL).toMatch(/create index if not exists people_photo_key_lower_idx on people \(lower\(photo_key\)\) where photo_key is not null;/);
  });
});

describe("0072: the two private consumers", () => {
  it("ticket_messages: a constant 'private' column inside a three-column composite FK", () => {
    expect(SQL).toMatch(
      /alter table ticket_messages add column if not exists asset_audience text not null default 'private';/,
    );
    expect(SQL).toMatch(
      /add constraint ticket_messages_asset_audience_private check \(asset_audience = 'private'\)/,
    );
    expect(SQL).toMatch(
      /add constraint ticket_messages_attachment_fk\s+foreign key \(attachment_asset_key, organization_id, asset_audience\)\s+references blob_assets \(id, organization_id, audience\)/,
    );
  });

  it("giving_statements: the same, and NO ACTION on both delete and update (F44)", () => {
    expect(SQL).toMatch(
      /alter table giving_statements add column if not exists asset_audience text not null default 'private';/,
    );
    expect(SQL).toMatch(
      /add constraint giving_statements_asset_audience_private check \(asset_audience = 'private'\)/,
    );
    expect(SQL).toMatch(
      /add constraint giving_statements_blob_fk\s+foreign key \(blob_asset_id, organization_id, asset_audience\)\s+references blob_assets \(id, organization_id, audience\)\s+on delete no action on update no action/,
    );
  });
});

describe("0072: functions", () => {
  it.each(["presby_public_staff_roster", "presby_public_committee_roster"])(
    "%s restates the search_path pin, revoke and grant, and withholds a hidden photo",
    (name) => {
      const block = functionBlock(name);
      expect(block).toMatch(/security definer\s+set search_path = public, pg_temp/);
      expect(block).toMatch(new RegExp(`revoke all on function ${name}\\(text, text, boolean\\) from public;`));
      expect(block).toMatch(new RegExp(`grant execute on function ${name}\\(text, text, boolean\\) to presby_app;`));
      expect(block).toMatch(
        /left join person_privacy pp on pp\.person_id = p\.id\n/,
      );
      expect(block).toMatch(/case when coalesce\(pp\.hide_photo, false\) then null else p\.photo_key end/);
    },
  );

  it("the staff roster withholds the photo in BOTH branches of its union", () => {
    const block = functionBlock("presby_public_staff_roster");
    expect(block.match(/left join person_privacy pp/g)?.length).toBe(2);
    expect(block.match(/coalesce\(pp\.hide_photo, false\)/g)?.length).toBe(2);
  });

  it("presby_public_site_asset is a pinned SECURITY DEFINER, executable by presby_app alone", () => {
    const block = functionBlock("presby_public_site_asset");
    expect(block).toMatch(/returns table \(content_type text, bytes bytea, cache_class text\)/);
    expect(block).toMatch(/language sql stable security definer set search_path = public, pg_temp/);
    expect(block).toMatch(/revoke all on function presby_public_site_asset\(uuid, uuid\) from public;/);
    expect(block).toMatch(/grant execute on function presby_public_site_asset\(uuid, uuid\) to presby_app;/);
    expect(SQL.match(/grant execute on function presby_public_site_asset/g)?.length).toBe(1);
    // It calls the roster functions rather than restating their conditions (R3, Gap 5).
    expect(block).toMatch(/presby_public_staff_roster\(o\.slug\)/);
    expect(block).toMatch(/presby_public_committee_roster\(o\.slug\)/);
    expect(block).toMatch(/else b\.audience = 'public_site'/);
  });

  it("the immutability trigger function is executable by nobody but its owner", () => {
    expect(SQL).toMatch(
      /revoke all on function presby_blob_assets_audience_immutable\(\) from public, presby_app, presby_platform;/,
    );
    expect(SQL).toMatch(
      /create trigger blob_assets_audience_immutable before update of audience on blob_assets\s+for each row when \(old\.audience is distinct from new\.audience\)/,
    );
  });
});

describe("the Drizzle mirrors", () => {
  const names = (t: PgTable) => {
    const cfg = getTableConfig(t);
    return {
      cfg,
      checks: cfg.checks.map((c) => c.name),
      uniques: Object.fromEntries(
        cfg.uniqueConstraints.map((u) => [u.getName(), u.columns.map((c) => c.name)] as const),
      ),
    };
  };

  it("blob_assets declares audience (not null, default 'private'), its CHECKs and keys", () => {
    const { cfg, checks, uniques } = names(blobAssets);
    const audience = cfg.columns.find((c) => c.name === "audience");
    expect(audience?.notNull).toBe(true);
    expect(audience?.default).toBe("private");
    expect(checks).toEqual(expect.arrayContaining(["blob_assets_audience_allowed", "blob_assets_public_site_is_image"]));
    expect(uniques).toMatchObject({
      blob_assets_id_org_key: ["id", "organization_id"],
      blob_assets_org_audience_hash_key: ["organization_id", "audience", "content_hash"],
      blob_assets_id_org_audience_key: ["id", "organization_id", "audience"],
    });
    expect(Object.keys(uniques)).not.toContain("blob_assets_org_hash_key");
  });

  it.each([
    ["ticket_messages", ticketMessages, "ticket_messages_asset_audience_private"],
    ["giving_statements", givingStatements, "giving_statements_asset_audience_private"],
  ] as const)("%s declares asset_audience (not null, default 'private') and its CHECK", (_n, table, check) => {
    const { cfg, checks } = names(table);
    const col = cfg.columns.find((c) => c.name === "asset_audience");
    expect(col?.notNull).toBe(true);
    expect(col?.default).toBe("private");
    expect(checks).toContain(check);
  });
});
