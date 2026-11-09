/**
 * Schema pin for drizzle/0085_presby_worship.sql (DECISION-317, F2, R5).
 *
 * `npm run check:schema-parity` compares columns, nullability and foreign keys
 * between the Drizzle domain model and the live catalog; it does NOT compare
 * CHECK constraints or indexes. This file is the complement: every
 * constraint, primary-key and index name 0085 creates on a worship table must
 * be declared on the matching Drizzle table (worship.ts), and nothing else, so
 * a reader sees the shape the database enforces. Names are READ FROM THE
 * MIGRATION; the table list is literal.
 *
 * Pure: no database. Policies, grants, FORCE RLS and triggers are not
 * expressible in the table builder; scripts/worship/test-rls-85.sql and
 * worship.db.test.ts prove those.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
// Enter the domain cycle through the canonical entry point first (the reason
// giving.schema.test.ts gives); ./worship is re-exported from ./index.ts only
// at integration (Rule 16).
import { permissions } from "../schema";
import * as worship from "./worship";

const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../../drizzle/0085_presby_worship.sql", import.meta.url)),
  "utf8",
);

/** Line comments removed, so a marker quoted in a comment can never satisfy an assertion. */
const SQL_NO_COMMENTS = MIGRATION.replace(/--[^\n]*/g, "");

const TABLES: PgTable[] = [
  worship.worshipTeams,
  worship.worshipPositions,
  worship.worshipPositionQualifications,
  worship.worshipServiceTypes,
  worship.worshipServiceTypeTeams,
  worship.worshipServices,
  worship.worshipServiceTeams,
  worship.worshipAssignments,
  worship.worshipBlockouts,
];

/** Every tenant FK: composite, ending in organization_id; its target columns. */
const COMPOSITE_FKS: Record<string, { target: string; columns: string[] }> = {
  worship_teams_group_fk: { target: "groups", columns: ["id", "organization_id"] },
  worship_positions_team_fk: { target: "worship_teams", columns: ["group_id", "organization_id"] },
  worship_position_qualifications_position_fk: {
    target: "worship_positions",
    columns: ["id", "group_id", "organization_id"],
  },
  worship_position_qualifications_person_fk: { target: "memberships", columns: ["person_id", "organization_id"] },
  worship_service_type_teams_type_fk: { target: "worship_service_types", columns: ["id", "organization_id"] },
  worship_service_type_teams_team_fk: { target: "worship_teams", columns: ["group_id", "organization_id"] },
  worship_services_event_fk: { target: "events", columns: ["id", "organization_id"] },
  worship_services_type_fk: { target: "worship_service_types", columns: ["id", "organization_id"] },
  worship_service_teams_service_fk: { target: "worship_services", columns: ["event_id", "organization_id"] },
  worship_service_teams_team_fk: { target: "worship_teams", columns: ["group_id", "organization_id"] },
  worship_assignments_service_team_fk: {
    target: "worship_service_teams",
    columns: ["event_id", "group_id", "organization_id"],
  },
  worship_assignments_position_fk: { target: "worship_positions", columns: ["id", "group_id", "organization_id"] },
  worship_assignments_person_fk: { target: "memberships", columns: ["person_id", "organization_id"] },
  worship_assignments_assigned_by_fk: { target: "memberships", columns: ["person_id", "organization_id"] },
  worship_assignments_sent_by_fk: { target: "memberships", columns: ["person_id", "organization_id"] },
  worship_assignments_responded_by_fk: { target: "memberships", columns: ["person_id", "organization_id"] },
  worship_assignments_withdrawn_by_fk: { target: "memberships", columns: ["person_id", "organization_id"] },
  worship_blockouts_person_fk: { target: "memberships", columns: ["person_id", "organization_id"] },
};

function namesCreatedByMigration(): Map<string, Set<string>> {
  const byTable = new Map<string, Set<string>>();
  const add = (table: string, name: string) => {
    if (!table.startsWith("worship_")) return;
    if (!byTable.has(table)) byTable.set(table, new Set());
    byTable.get(table)!.add(name);
  };
  for (const m of SQL_NO_COMMENTS.matchAll(/alter table (\w+) add constraint (\w+)/g)) add(m[1]!, m[2]!);
  for (const m of SQL_NO_COMMENTS.matchAll(/create (?:unique )?index if not exists (\w+)\s+on (\w+)/g)) add(m[2]!, m[1]!);
  for (const m of SQL_NO_COMMENTS.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
    for (const c of m[2]!.matchAll(/constraint (\w+)/g)) add(m[1]!, c[1]!);
  }
  return byTable;
}

function namesDeclaredByDrizzle(table: PgTable): Set<string> {
  const cfg = getTableConfig(table);
  return new Set<string>([
    ...cfg.checks.map((c) => c.name),
    ...cfg.indexes.map((i) => i.config.name).filter((n): n is string => Boolean(n)),
    ...cfg.uniqueConstraints.map((u) => u.getName()).filter((n): n is string => Boolean(n)),
    ...cfg.foreignKeys.map((fk) => fk.getName()),
    ...cfg.primaryKeys.map((pk) => pk.getName()),
  ]);
}

describe("drizzle/0085 constraint and index names are mirrored in worship.ts", () => {
  const created = namesCreatedByMigration();

  it("the import entry point resolves (domain cycle order)", () => {
    expect(getTableName(permissions)).toBe("permissions");
  });

  it("0085 creates exactly the nine tables the domain file declares", () => {
    expect([...created.keys()].sort()).toEqual(TABLES.map((t) => getTableName(t)).sort());
  });

  it("the parser is not vacuous: it finds every composite FK, both three-column keys and the partial indexes", () => {
    const all = new Set([...created.values()].flatMap((s) => [...s]));
    for (const fk of Object.keys(COMPOSITE_FKS)) expect(all.has(fk), fk).toBe(true);
    for (const n of [
      "worship_positions_id_team_org_key",
      "worship_service_teams_event_team_org_key",
      "worship_positions_live_name_idx",
      "worship_service_types_live_name_idx",
      "worship_position_qualifications_live_idx",
      "worship_assignments_live_person_idx",
      "worship_assignments_open_ix",
      "worship_service_type_teams_pkey",
      "worship_service_teams_pkey",
    ]) {
      expect(all.has(n), n).toBe(true);
    }
  });

  it.each(TABLES.map((t) => [getTableName(t), t] as const))(
    "%s declares every name 0085 creates on it, and nothing it does not",
    (name, table) => {
      const declared = namesDeclaredByDrizzle(table);
      const expected = created.get(name) ?? new Set<string>();
      for (const n of expected) expect(declared.has(n), `${name} does not declare ${n}`).toBe(true);
      for (const n of declared) {
        // Drizzle auto-names single-column .references() FKs (organizations, users).
        if (/_(organizations|users)_id_fk$/.test(n)) continue;
        expect(expected.has(n), `${name} declares ${n}, which 0085 does not create`).toBe(true);
      }
    },
  );
});

describe("the shapes behind the names (F2, R2, R5, R12)", () => {
  const allFks = TABLES.flatMap((t) => getTableConfig(t).foreignKeys);

  it("every tenant FK is composite, ends in organization_id, targets the right key, and is NO ACTION", () => {
    const fks = allFks.filter((fk) => fk.getName() in COMPOSITE_FKS);
    expect(fks).toHaveLength(Object.keys(COMPOSITE_FKS).length);
    for (const fk of fks) {
      const ref = fk.reference();
      const spec = COMPOSITE_FKS[fk.getName()]!;
      expect(ref.columns.map((c) => c.name).at(-1), fk.getName()).toBe("organization_id");
      expect(getTableName(ref.foreignTable), fk.getName()).toBe(spec.target);
      expect(ref.foreignColumns.map((c) => c.name), fk.getName()).toEqual(spec.columns);
      expect(fk.onDelete ?? "no action", fk.getName()).toBe("no action");
    }
  });

  it("the only single-column FKs go to organizations (cascade, one per table) and users (actors)", () => {
    for (const t of TABLES) {
      const single = getTableConfig(t).foreignKeys.filter((fk) => !(fk.getName() in COMPOSITE_FKS));
      for (const fk of single) {
        const target = getTableName(fk.reference().foreignTable);
        expect(["organizations", "users"], `${getTableName(t)}.${fk.getName()}`).toContain(target);
        if (target === "organizations") expect(fk.onDelete).toBe("cascade");
        if (target === "users") expect(fk.onDelete ?? "no action").toBe("no action");
      }
      expect(single.filter((fk) => getTableName(fk.reference().foreignTable) === "organizations")).toHaveLength(1);
    }
  });

  it("FKs to events and groups exist only as the two NO ACTION extension keys (R2, R5)", () => {
    const toCore = allFks.filter((fk) => ["events", "groups"].includes(getTableName(fk.reference().foreignTable)));
    expect(toCore.map((fk) => fk.getName()).sort()).toEqual(["worship_services_event_fk", "worship_teams_group_fk"]);
  });

  it("blockouts carry no free-text column (R12): exactly these columns", () => {
    expect(getTableConfig(worship.worshipBlockouts).columns.map((c) => c.name).sort()).toEqual(
      ["created_at", "ended_at", "ends_on", "id", "organization_id", "person_id", "reason", "starts_on"],
    );
  });

  it("an assignment carries no contact column and no free text beyond a guest's name", () => {
    const cols = getTableConfig(worship.worshipAssignments).columns.map((c) => c.name);
    expect(cols.filter((c) => /email|phone|address|note|comment|message/.test(c))).toEqual([]);
    const text = getTableConfig(worship.worshipAssignments)
      .columns.filter((c) => c.getSQLType() === "text")
      .map((c) => c.name)
      .sort();
    // Every text column but guest_name is a closed vocabulary (CHECK-pinned below).
    expect(text).toEqual([
      "decline_reason",
      "guest_name",
      "notice_outcome",
      "response_source",
      "status",
      "withdrawn_reason",
    ]);
  });

  it("the vocabularies in worship.ts are the migration's CHECK lists", () => {
    const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
    expect(SQL_NO_COMMENTS).toContain(`status in (${list(worship.WORSHIP_ASSIGNMENT_STATUSES)})`);
    expect(SQL_NO_COMMENTS).toContain(`decline_reason in (${list(worship.WORSHIP_REASONS)})`);
    expect(SQL_NO_COMMENTS).toContain(`reason in (${list(worship.WORSHIP_REASONS)})`);
    expect(SQL_NO_COMMENTS).toContain(`response_source in (${list(worship.WORSHIP_RESPONSE_SOURCES)})`);
    expect(SQL_NO_COMMENTS).toContain(`notice_outcome in (${list(worship.WORSHIP_NOTICE_OUTCOMES)})`);
    expect(SQL_NO_COMMENTS).toContain(`withdrawn_reason in (${list(worship.WORSHIP_WITHDRAWN_REASONS)})`);
  });

  it("trigger-owned columns carry no Drizzle $onUpdate (it would put them in the SET list)", () => {
    for (const t of TABLES) {
      for (const c of getTableConfig(t).columns) {
        expect((c as unknown as { onUpdateFn?: unknown }).onUpdateFn, `${getTableName(t)}.${c.name}`).toBeUndefined();
      }
    }
  });

  it("no table has a deletable_until column (the delete guard admits only the org-teardown cascade)", () => {
    for (const t of TABLES) {
      expect(getTableConfig(t).columns.map((c) => c.name), getTableName(t)).not.toContain("deletable_until");
    }
  });
});

describe("the migration text", () => {
  it("every CHECK is drop-then-add, so an in-place correction changes it", () => {
    const adds = [...SQL_NO_COMMENTS.matchAll(/alter table (\w+) add constraint (\w+)\s+check/g)];
    expect(adds.length).toBeGreaterThan(20);
    for (const m of adds) {
      const drop = SQL_NO_COMMENTS.indexOf(`alter table ${m[1]} drop constraint if exists ${m[2]};`);
      expect(drop, m[2]).toBeGreaterThan(-1);
      expect(drop, m[2]).toBeLessThan(m.index!);
    }
  });

  it("no worship function has a defaulted parameter, bar the in-effect day's p_now test seam", () => {
    for (const m of SQL_NO_COMMENTS.matchAll(/create or replace function (presby_worship_\w+)\(([^)]*)\)/g)) {
      // F434: presby_worship_in_effect_day(p_org, p_now default now()) - p_now exists so a test can fix the instant.
      const params = m[1] === "presby_worship_in_effect_day" ? m[2]!.replace(/,\s*p_now timestamptz default now\(/i, "") /* the capture stops at now( */ : m[2]!;
      expect(params.toLowerCase(), m[1]).not.toMatch(/\bdefault\b|=/);
    }
    const seam = SQL_NO_COMMENTS.match(/create or replace function presby_worship_in_effect_day\(([^)]*)\)/);
    expect(seam?.[1]).toMatch(/p_now timestamptz default now\(/i);
  });

  it("the founding bundle keeps the live base array verbatim and adds worship for the two types only", () => {
    const start = SQL_NO_COMMENTS.indexOf("create or replace function presby_founding_administrator_permission_keys(");
    const body = SQL_NO_COMMENTS.slice(start, SQL_NO_COMMENTS.indexOf("$function$;", start));
    expect(body).toContain(
      "array['people.manage', 'roles.manage', 'role_grants.manage', 'groups.manage',\n" +
        "               'officers.manage', 'org_features.manage', 'tickets.file', 'staff.manage',\n" +
        "               'domains.manage', 'careers.manage', 'careers.applicants']::text[]",
    );
    expect(body).toMatch(
      /when p_org_type in \('congregation', 'new_worshiping_community'\)\s+then array\['worship\.manage', 'worship\.plan', 'worship\.schedule'\]::text\[\]/,
    );
    // Order: base, worship, oversight.
    expect(body.indexOf("worship.schedule")).toBeLessThan(body.indexOf("congregation_oversight.manage"));
    expect(body).toMatch(/immutable\s+security definer\s+set search_path = public, pg_temp/);
  });

  it("the sections run in dependency order and the closing assertions come last", () => {
    const at = (marker: string) => {
      const i = MIGRATION.indexOf(marker);
      expect(i, marker).toBeGreaterThan(-1);
      return i;
    };
    const order = [
      at("-- 1. permission catalog"),
      at("-- 2. the founding-administrator bundle"),
      at("-- 3. backfill"),
      at("-- 4. the worship_leader template"),
      at("-- 5. the global flag row"),
      at("-- 6. the nine tables"),
      at("-- 7. functions and triggers"),
      at("-- 8. RLS + grants"),
      at("-- 9. comments, then the closing assertions"),
      at("worship 0085: closing assertions passed"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(SQL_NO_COMMENTS).toContain("delete from feature_flags where key = 'org_portal.worship';");
  });
});
