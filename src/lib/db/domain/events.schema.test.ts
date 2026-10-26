/**
 * Schema pin for drizzle/0054_presby_calendar_event_types.sql (DECISION-161).
 *
 * `npm run check:schema-parity` compares columns, nullability and foreign keys
 * between the Drizzle domain model and the live catalog; it deliberately does
 * NOT compare CHECK constraints or indexes. This file is the complement for
 * the parts it skips: every constraint and index name the migration creates on
 * `event_types`, `events` and `organization_settings` must be declared on the
 * matching Drizzle table, so a reader of `src/lib/db/domain/` sees the shape the
 * database actually enforces.
 *
 * The expected names are READ FROM THE MIGRATION (so a constraint added to
 * 0054 without a mirror fails here) and also listed literally below (so a
 * constraint silently dropped from 0054 fails here too).
 *
 * Pure: no database. Policies, grants and FORCE RLS are not expressible in the
 * table builder; those are proven by scripts/test-rls.sql section 45.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
// Through the canonical entry point (schema.ts re-exports ./domain), not
// "./events" directly: entering the domain cycle at events.ts -> ../schema
// reaches authz.ts before org.ts has initialised `organizationType`.
import { eventTypes, events, organizationSettings } from "../schema";

// dev-docs.ts imports the RLS connection; this file needs only its constants.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

const MIGRATION = readFileSync(
  fileURLToPath(
    new URL("../../../../drizzle/0054_presby_calendar_event_types.sql", import.meta.url),
  ),
  "utf8",
);

/** Every constraint/index name the migration creates, keyed by table. */
function namesCreatedByMigration(): Map<string, Set<string>> {
  const byTable = new Map<string, Set<string>>();
  const add = (table: string, name: string) => {
    if (!byTable.has(table)) byTable.set(table, new Set());
    byTable.get(table)!.add(name);
  };
  for (const m of MIGRATION.matchAll(/alter table (\w+) add constraint (\w+)/g)) {
    add(m[1], m[2]);
  }
  for (const m of MIGRATION.matchAll(
    /create (?:unique )?index if not exists (\w+)\s+on (\w+)/g,
  )) {
    add(m[2], m[1]);
  }
  // Inline table constraints inside `create table ... ( ... )`.
  for (const m of MIGRATION.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
    for (const c of m[2].matchAll(/constraint (\w+)/g)) add(m[1], c[1]);
  }
  return byTable;
}

/** Every constraint/index name a Drizzle table declares. */
function namesDeclaredByDrizzle(table: PgTable): Set<string> {
  const cfg = getTableConfig(table);
  return new Set<string>([
    ...cfg.checks.map((c) => c.name),
    ...cfg.indexes.map((i) => i.config.name).filter((n): n is string => Boolean(n)),
    ...cfg.uniqueConstraints.map((u) => u.getName()).filter((n): n is string => Boolean(n)),
    ...cfg.foreignKeys.map((fk) => fk.getName()),
  ]);
}

const TABLES: PgTable[] = [eventTypes, events, organizationSettings];

describe("drizzle/0054 constraint and index names are mirrored in the domain model", () => {
  const created = namesCreatedByMigration();

  it("finds the names the design lists, so the parser itself is not vacuous", () => {
    expect([...(created.get("event_types") ?? [])].sort()).toEqual(
      [
        "event_types_color_allowed",
        "event_types_fallback_active",
        "event_types_icon_allowed",
        "event_types_id_org_key",
        "event_types_name_shape",
        "event_types_neutral_is_fallback",
        "event_types_one_fallback_idx",
        "event_types_org_lower_name_idx",
      ].sort(),
    );
    expect([...(created.get("events") ?? [])].sort()).toEqual(
      ["events_event_type_fk", "events_org_type_idx"].sort(),
    );
    expect([...(created.get("organization_settings") ?? [])]).toEqual([
      "organization_settings_time_zone_valid",
    ]);
    expect([...created.keys()].sort()).toEqual(
      ["event_types", "events", "organization_settings"].sort(),
    );
  });

  it.each(TABLES.map((t) => [getTableName(t), t] as const))(
    "%s declares every name 0054 creates on it",
    (name, table) => {
      const declared = namesDeclaredByDrizzle(table);
      for (const expected of created.get(name) ?? []) {
        expect(declared.has(expected), `${name} does not declare ${expected}`).toBe(true);
      }
    },
  );
});

describe("the shapes behind the names", () => {
  it("event_types_one_fallback_idx is a PARTIAL unique index on organization_id", () => {
    const idx = getTableConfig(eventTypes).indexes.find(
      (i) => i.config.name === "event_types_one_fallback_idx",
    );
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.where).toBeDefined();
    expect(idx?.config.columns.map((c) => ("name" in c ? c.name : "?"))).toEqual([
      "organization_id",
    ]);
  });

  it("event_types_org_lower_name_idx is unique and has NO where clause (retired names stay reserved)", () => {
    const idx = getTableConfig(eventTypes).indexes.find(
      (i) => i.config.name === "event_types_org_lower_name_idx",
    );
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.where).toBeUndefined();
  });

  it("event_types_id_org_key is unique (id, organization_id) - the composite FK target", () => {
    const u = getTableConfig(eventTypes).uniqueConstraints.find(
      (c) => c.getName() === "event_types_id_org_key",
    );
    expect(u?.columns.map((c) => c.name)).toEqual(["id", "organization_id"]);
  });

  it("events_event_type_fk is composite (event_type_id, organization_id) -> event_types(id, organization_id), NO ACTION", () => {
    const fk = getTableConfig(events).foreignKeys.find(
      (f) => f.getName() === "events_event_type_fk",
    );
    expect(fk).toBeDefined();
    const ref = fk!.reference();
    expect(getTableName(ref.foreignTable)).toBe("event_types");
    expect(ref.columns.map((c) => c.name)).toEqual(["event_type_id", "organization_id"]);
    expect(ref.foreignColumns.map((c) => c.name)).toEqual(["id", "organization_id"]);
    // DECISION-161: the default NO ACTION, never set null / restrict / cascade.
    expect(fk!.onDelete ?? "no action").toBe("no action");
    expect(MIGRATION).toMatch(
      /add constraint events_event_type_fk\s+foreign key \(event_type_id, organization_id\) references event_types \(id, organization_id\);/,
    );
  });

  it("events.event_type_id is nullable (an untyped event is legal) and time_zone is NOT NULL with its default", () => {
    const col = getTableConfig(events).columns.find((c) => c.name === "event_type_id");
    expect(col?.notNull).toBe(false);
    const tz = getTableConfig(organizationSettings).columns.find((c) => c.name === "time_zone");
    expect(tz?.notNull).toBe(true);
    expect(tz?.default).toBe("America/New_York");
  });

  it("event_types declares no delete-shaped escape hatch: is_active is how a type is retired", () => {
    const cols = getTableConfig(eventTypes).columns.map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining(["is_active", "is_fallback", "updated_by", "organization_id"]),
    );
    expect(cols).not.toContain("deleted_at");
  });
});

describe("/developer marks 'at least one fallback' as paper", () => {
  it("INVARIANTS carries the event-type fallback entry with enforcement 'paper'", async () => {
    const { INVARIANTS } = await import("@/lib/dev-docs");
    const entry = INVARIANTS.find((i) => i.title.startsWith("A congregation's event types"));
    expect(entry?.enforcement).toBe("paper");
    expect(entry?.detail).toContain("drizzle/0054");
  });
});
