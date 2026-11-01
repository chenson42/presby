/**
 * Schema pin for drizzle/0078_presby_person_photos.sql (person photos,
 * Increment 1; DECISION-285, 286, 289; docs/work-log/
 * 2026-10-26-person-photos-inc1.md, Phase 3 "Data Model").
 *
 * `npm run check:schema-parity` compares columns, nullability and foreign keys
 * between the Drizzle domain model and the live catalog; it deliberately does
 * NOT compare CHECK constraints or indexes. This file is the complement, in
 * the invitations.schema.test.ts shape:
 *
 *   - every constraint and index name 0078 creates on the two new tables is
 *     declared in ./person-photos, except the two blob FKs, which are DDL-only
 *     (DECISION-058: assets.ts is imported by the storage adapter alone) and
 *     allowlisted in scripts/check-schema-parity.ts;
 *   - PERSON_PHOTO_PURPOSES equals the list the purpose CHECK spells;
 *   - the structural promises the migration's prose makes: the 0072 guard is
 *     the first statement, no begin/commit of its own (apply with -1), the
 *     grant shape (no DELETE, presby_platform nothing), the five functions'
 *     definer/invoker split and EXECUTE list, the roster functions' restated
 *     hardening, and that no stored body reads people.photo_key any more.
 *
 * Pure: no database. Behaviour is proven by scripts/person-photos/
 * test-rls-78.sql (presby_app), src/lib/db/domain/public-roster-photo.db.test.ts
 * (roster and door, owner-seeded, asked as presby_app) and
 * scripts/person-photos/test-0078-migration.sh (D4).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
// The canonical entry point first, so the domain module cycle initialises
// from schema.ts; ./person-photos is not yet re-exported from ./index (that
// line is added at integration, Rule 16).
import "../schema";
import { people } from "./people";
import {
  personPhotos,
  personPhotoDesignations,
  PERSON_PHOTO_PURPOSES,
} from "./person-photos";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../../drizzle/0078_presby_person_photos.sql", import.meta.url)),
  "utf8",
);
/** The migration with `--` comments removed, so prose cannot satisfy a code assertion. */
const CODE = MIGRATION.replace(/--[^\n]*/g, "");

const TABLES = {
  person_photos: personPhotos,
  person_photo_designations: personPhotoDesignations,
} as const;

/** FKs 0078 creates that the Drizzle model deliberately does not declare. */
const DDL_ONLY = new Set(["person_photos_image_fk", "person_photos_thumb_fk"]);

function namesCreatedByMigration(table: string): Set<string> {
  const names = new Set<string>();
  for (const m of CODE.matchAll(new RegExp(`alter table ${table} add constraint (\\w+)`, "g"))) names.add(m[1]!);
  for (const m of CODE.matchAll(new RegExp(`create (?:unique )?index if not exists (\\w+)\\s+on ${table}\\s`, "g"))) names.add(m[1]!);
  const create = CODE.match(new RegExp(`create table if not exists ${table} \\(([\\s\\S]*?)\\n\\);`));
  for (const c of create?.[1]!.matchAll(/constraint (\w+)/g) ?? []) names.add(c[1]!);
  return names;
}

function namesDeclaredByDrizzle(table: keyof typeof TABLES): Set<string> {
  const cfg = getTableConfig(TABLES[table]);
  return new Set<string>([
    ...cfg.checks.map((c) => c.name),
    ...cfg.indexes.map((i) => i.config.name).filter((n): n is string => Boolean(n)),
    ...cfg.uniqueConstraints.map((u) => u.getName()).filter((n): n is string => Boolean(n)),
    // Only the explicitly named composite FKs: the single-column inline
    // `.references()` are unnamed in 0078 too, and check:schema-parity
    // compares FK shape.
    ...cfg.foreignKeys.filter((f) => f.reference().columns.length > 1).map((f) => f.getName()),
  ]);
}

/** The text of one `create or replace function <name>(` ... `$$;` block. */
function functionBlock(name: string): string {
  const start = CODE.indexOf(`create or replace function ${name}(`);
  if (start < 0) throw new Error(`0078 does not create ${name}`);
  const bodyOpen = CODE.indexOf("$$", start);
  const bodyClose = CODE.indexOf("$$;", bodyOpen + 2);
  return CODE.slice(start, bodyClose + 3);
}

describe("drizzle/0078 constraint and index names are mirrored in the domain model", () => {
  it("finds the names the design lists, so the parser itself is not vacuous", () => {
    expect([...namesCreatedByMigration("person_photos")].sort()).toEqual(
      [
        "person_photos_active_image_idx",
        "person_photos_audience_private",
        "person_photos_dimensions",
        "person_photos_distinct_assets",
        "person_photos_id_org_key",
        "person_photos_id_org_person_key",
        "person_photos_image_fk",
        "person_photos_image_key_idx",
        "person_photos_person_fk",
        "person_photos_removal_pair",
        "person_photos_thumb_fk",
        "person_photos_thumb_key_idx",
      ].sort(),
    );
    expect([...namesCreatedByMigration("person_photo_designations")].sort()).toEqual(
      [
        "person_photo_designations_active_idx",
        "person_photo_designations_attest_pair",
        "person_photo_designations_end_pair",
        "person_photo_designations_id_org_key",
        "person_photo_designations_photo_fk",
        "person_photo_designations_photo_idx",
        "person_photo_designations_purpose",
        "person_photo_designations_website_attested",
      ].sort(),
    );
  });

  it.each(Object.keys(TABLES) as Array<keyof typeof TABLES>)("%s", (table) => {
    const created = namesCreatedByMigration(table);
    const declared = namesDeclaredByDrizzle(table);
    const missing = [...created].filter((n) => !declared.has(n) && !DDL_ONLY.has(n));
    const extra = [...declared].filter((n) => !created.has(n));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("the two DDL-only blob FKs are real in 0078 and absent from the model (DECISION-058)", () => {
    const created = namesCreatedByMigration("person_photos");
    for (const fk of DDL_ONLY) expect(created.has(fk), fk).toBe(true);
    const declared = getTableConfig(personPhotos).foreignKeys.map((f) => f.getName());
    for (const fk of DDL_ONLY) expect(declared).not.toContain(fk);
    // Both reference the three-column audience key, pinned 'private'.
    for (const col of ["image_asset_key", "thumb_asset_key"]) {
      expect(CODE).toMatch(
        new RegExp(`foreign key \\(${col}, organization_id, asset_audience\\)\\s+references blob_assets \\(id, organization_id, audience\\)`),
      );
    }
    expect(CODE).toMatch(/constraint person_photos_audience_private\s+check \(asset_audience = 'private'\)/);
  });

  it("PERSON_PHOTO_PURPOSES is exactly the purpose CHECK's list", () => {
    const m = CODE.match(/constraint person_photo_designations_purpose\s+check \(purpose in \(([^)]*)\)\)/);
    expect(m, "the purpose CHECK exists").not.toBeNull();
    expect([...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual([...PERSON_PHOTO_PURPOSES]);
  });

  it("the retired people.photo_key columns stay declared until 0079 (F334: check:schema-parity compares both ways)", () => {
    const cols = getTableConfig(people).columns.map((c) => c.name);
    expect(cols).toContain("photo_key");
    expect(cols).toContain("photo_updated_at");
    expect(CODE).toMatch(/add constraint people_photo_key_retired\s+check \(photo_key is null and photo_updated_at is null\) not valid;/);
    expect(CODE).toMatch(/validate constraint people_photo_key_retired;/);
  });
});

describe("drizzle/0078 structural promises", () => {
  it("the first statement refuses to run without 0072", () => {
    const first = CODE.trim().split(/;\s*\n/)[0]!;
    expect(first).toMatch(/^do \$\$/);
    expect(first).toContain("blob_assets_id_org_audience_key");
    expect(first).toContain("0078 requires 0072");
  });

  it("has no transaction of its own (apply with psql -1) and says so", () => {
    expect(CODE).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(MIGRATION).toMatch(/psql "\$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle\/0078_presby_person_photos\.sql/);
  });

  it("warns that re-applying 0072 after 0078 restores the old bodies (F335)", () => {
    expect(MIGRATION).toMatch(/F335/);
    expect(MIGRATION).toMatch(/re-apply(ing)? 0072/i);
  });

  it.each(Object.keys(TABLES))("%s: FORCE RLS, tenant_isolation, no DELETE, presby_platform gets nothing", (table) => {
    expect(CODE).toMatch(new RegExp(`alter table ${table} enable row level security;`));
    expect(CODE).toMatch(new RegExp(`alter table ${table} force row level security;`));
    expect(CODE).toMatch(
      new RegExp(
        `create policy tenant_isolation on ${table}\\s+using \\(organization_id = presby_current_org\\(\\)\\)\\s+with check \\(organization_id = presby_current_org\\(\\)\\);`,
      ),
    );
    expect(CODE).toMatch(new RegExp(`revoke all on ${table} from presby_app, presby_platform;`));
    expect(CODE).toMatch(new RegExp(`grant select, insert on ${table} to presby_app;`));
    const grants = [...CODE.matchAll(new RegExp(`grant ([^;]*?) on ${table} to (\\w+);`, "g"))];
    expect(grants.every((g) => g[2] === "presby_app"), "nothing is granted to any other role").toBe(true);
    expect(grants.some((g) => /delete/i.test(g[1]!)), "no DELETE grant").toBe(false);
  });

  it("the column UPDATE grants are exactly the one-way pairs", () => {
    expect(CODE).toMatch(/grant update \(removed_at, removed_by\) on person_photos to presby_app;/);
    expect(CODE).toMatch(/grant update \(ended_at, ended_by\) on person_photo_designations to presby_app;/);
  });

  it("five functions: search_path pinned; the core is the only owner-only definer; presby_app executes the other four", () => {
    const fns = {
      presby_person_photos_enabled: { definer: false, app: true },
      presby_photo_subject_is_minor: { definer: false, app: true },
      presby_person_public_photo: { definer: true, app: false },
      presby_person_public_photo_status: { definer: true, app: true },
      presby_person_directory_photo: { definer: false, app: true },
    } as const;
    for (const [name, want] of Object.entries(fns)) {
      const block = functionBlock(name);
      expect(block, name).toMatch(/set search_path = public, pg_temp/);
      expect(/security definer/.test(block), `${name} definer`).toBe(want.definer);
      expect(CODE, `${name} revoke`).toMatch(
        new RegExp(`revoke all on function ${name}\\([^)]*\\) from public, presby_app, presby_platform;`),
      );
      expect(new RegExp(`grant execute on function ${name}\\([^)]*\\) to presby_app;`).test(CODE), `${name} grant`).toBe(want.app);
    }
  });

  it("the two guard trigger functions are invokers executable by their owner alone", () => {
    for (const name of ["presby_person_photos_guard_write", "presby_person_photo_designations_guard_write"]) {
      const block = functionBlock(name);
      expect(block).toMatch(/returns trigger/);
      expect(block).toMatch(/set search_path = public, pg_temp/);
      expect(block).not.toMatch(/security definer/);
      expect(CODE).toMatch(new RegExp(`revoke all on function ${name}\\(\\) from public, presby_app, presby_platform;`));
      expect(CODE).not.toMatch(new RegExp(`grant execute on function ${name}`));
    }
  });

  it.each([
    ["presby_public_staff_roster", "text, text, boolean"],
    ["presby_public_committee_roster", "text, text, boolean"],
    ["presby_public_site_asset", "uuid, uuid"],
  ])("%s: hardening restated through create or replace", (name, args) => {
    const block = functionBlock(name);
    expect(block).toMatch(/security definer/);
    expect(block).toMatch(/set search_path = public, pg_temp/);
    expect(CODE).toMatch(new RegExp(`revoke all on function ${name}\\(${args}\\) from public;`));
    expect(CODE).toMatch(new RegExp(`grant execute on function ${name}\\(${args}\\) to presby_app;`));
  });

  it("no stored body 0078 writes reads people.photo_key, and the roster no longer joins person_privacy (Phase 3 correction 3)", () => {
    for (const name of ["presby_public_staff_roster", "presby_public_committee_roster", "presby_public_site_asset"]) {
      const block = functionBlock(name);
      expect(block, name).not.toMatch(/\b(p|pe)\.photo_key\b/);
      expect(block, name).not.toMatch(/\bperson_privacy\b/);
    }
    for (const name of ["presby_public_staff_roster", "presby_public_committee_roster"]) {
      expect(functionBlock(name)).toMatch(/left join lateral presby_person_public_photo\(o\.id, p\.id\) ph on true/);
      expect(functionBlock(name)).toMatch(/ph\.image_key::text as photo_key/);
    }
    // The door: any person_photos key of the org (image or thumbnail, removed or not) is a photo.
    expect(functionBlock("presby_public_site_asset")).toMatch(
      /exists \(select 1 from person_photos pph\s+where pph\.organization_id = p_org\s+and p_key in \(pph\.image_asset_key, pph\.thumb_asset_key\)\)/,
    );
  });

  it("hide_photo: the public core joins person_privacy on person_id ALONE; the directory function scopes it to the org", () => {
    expect(functionBlock("presby_person_public_photo")).toMatch(
      /from person_privacy pp where pp\.person_id = p_person and pp\.hide_photo\)/,
    );
    expect(functionBlock("presby_person_directory_photo")).toMatch(
      /from person_privacy pp\s+where pp\.person_id = p_person and pp\.organization_id = p_org and pp\.hide_photo\)/,
    );
  });

  it("the toggle composition pins the catalog literals (key, category 'people', the axis flag)", () => {
    const block = functionBlock("presby_person_photos_enabled");
    expect(block).toContain("t.feature_key = 'org_portal.person_photos'");
    expect(block).toContain("c.category = 'people'");
    expect(block).toContain("f.key = 'org_portal.feature_categories'");
    // orgTypes is null in the catalog entry: no organization-type allow-list.
    expect(block).not.toMatch(/organizations|\.type\b/);
  });
});
