import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { db } from "@/lib/db";
import { FEATURE_CATALOG } from "@/lib/permissions";

/**
 * Self-documenting technical reference for the developer page.
 *
 * Everything here is DERIVED from the Drizzle schema at request time. Nothing
 * is hand-maintained, so it cannot drift the way docs/database-schema.md does
 * in the sibling projects — which is the whole reason those repos carry
 * workflow rules whose only job is keeping documentation in step.
 *
 * Two consumers, one source:
 *   - HTML at /developer, for humans
 *   - JSON at /developer/schema.json, for the AI support worker
 *
 * STRUCTURE ONLY. Never render data, not even per-tenant row counts. A schema
 * browser plus a permission catalog is a map of the application, so it is
 * gated and it stays structural.
 *
 * Deliberately NOT marked `server-only`: this module reads schema definitions,
 * never a connection or a secret, so `scripts/generate-erd.ts` can import it to
 * refresh the diagrams in docs/schema-design.md from the same source the page
 * renders. Two generators would drift; one cannot.
 */

export type ColumnDoc = {
  name: string;
  type: string;
  notNull: boolean;
  hasDefault: boolean;
  primaryKey: boolean;
  description?: string;
};

/**
 * Descriptions come from Postgres COMMENT ON, not from a map in this file.
 *
 * A registry here would rot exactly the way docs/database-schema.md rots in the
 * sibling projects — which is why those repos carry workflow rules whose only
 * job is keeping documentation in step. Comments live with the schema, survive
 * dump/restore, show up in psql's \d+ and every GUI, and are readable by the AI
 * support worker without a bespoke endpoint.
 */
export async function loadDescriptions() {
  const result = await db.execute(sql`
    select c.relname            as table_name,
           coalesce(a.attname, '') as column_name,
           d.description
      from pg_description d
      join pg_class c on c.oid = d.objoid
      left join pg_attribute a
        on a.attrelid = c.oid and a.attnum = d.objsubid and d.objsubid > 0
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
  `);
  const rows =
    (result as unknown as { rows?: Array<Record<string, string>> }).rows ?? [];

  const tables = new Map<string, string>();
  const columns = new Map<string, string>();
  for (const r of rows) {
    if (r.column_name) {
      columns.set(`${r.table_name}.${r.column_name}`, r.description);
    } else {
      tables.set(r.table_name, r.description);
    }
  }
  return { tables, columns };
}

export type TableDoc = {
  name: string;
  module: string;
  tenantScoped: boolean;
  columns: ColumnDoc[];
  indexes: { name: string; columns: string[]; unique: boolean }[];
  foreignKeys: { name: string; columns: string[]; foreignTable: string }[];
  checks: string[];
  description?: string;
  isolationNote?: string;
  notes: string[];
};

/**
 * Which design-doc section each table belongs to. Tables absent from this map
 * are inherited from the starter and grouped under "platform".
 */
const MODULES: Record<string, string> = {
  organizations: "A. Organizations",
  organization_settings: "A. Organizations",
  org_units: "A. Organizations",
  households: "B. People",
  people: "B. People",
  addresses: "B. People",
  contact_methods: "B. People",
  person_relationships: "B. People",
  memberships: "B. People",
  person_identifiers: "B. People",
  tags: "C. Person extensions",
  person_tags: "C. Person extensions",
  person_milestones: "C. Person extensions",
  person_notes: "C. Person extensions",
  follow_ups: "C. Person extensions",
  talent_types: "C. Person extensions",
  person_talents: "C. Person extensions",
  background_checks: "C. Person extensions",
  person_medical: "C. Person extensions",
  roll_actions: "D. Rolls",
  transfer_certificates: "D. Rolls",
  ordinations: "E. Officers",
  officer_terms: "E. Officers",
  group_types: "F. Groups",
  groups: "F. Groups",
  group_memberships: "F. Groups",
  permissions: "G. Authorization",
  app_roles: "G. Authorization",
  app_role_permissions: "G. Authorization",
  role_grants: "G. Authorization",
  administrative_commissions: "G. Authorization",
  org_delegations: "G. Authorization",
  person_privacy: "H. Privacy",
  consents: "H. Privacy",
  person_demographics: "H. Privacy",
  person_disabilities: "H. Privacy",
  sasr_reports: "J. Reporting",
};

/**
 * Tables whose isolation is deliberately NOT the standard org predicate. Every
 * one of these is a decision recorded in docs/schema-design.md, not an
 * oversight — the developer page says so out loud so a future reader does not
 * "fix" one of them.
 */
const BESPOKE_POLICIES: Record<string, string> = {
  organizations:
    "Not tenant-isolated. The org tree is public information; PC(USA) publishes congregation and presbytery lists. Sensitive data lives in organization_settings.",
  people:
    "GLOBAL, no organization_id (D1). Holds the person's own data. Ministers of Word and Sacrament are members of the presbytery while ruling elders are members of the congregation, so one human's roll and service routinely sit at different orgs. Visible when the current org holds a membership for them.",
  transfer_certificates:
    "Spans two orgs by design (F9). The losing church issues; the receiving church claims by token.",
  administrative_commissions:
    "Visible to both parties so a congregation can always see who has been granted access to it.",
  org_delegations:
    "Visible to both parties. Granted by the session, never inherited.",
  permissions: "Global catalog. Readable by all, written only by migrations.",
  addresses:
    "GLOBAL. An address is the person's, not a congregation's record of it. Visible when the current org holds a membership for that person.",
  contact_methods:
    "GLOBAL, same rule as addresses. Not duplicated per org, so an installed pastor's phone cannot diverge between presbytery and congregation.",
  person_relationships:
    "GLOBAL. A parent is a parent regardless of which church is looking.",
  person_identifiers:
    "GLOBAL. Unique only where uniqueness is safe: the partial index covers verified, non-shared identifiers. Shared household emails and unverified entries are matching signals, not keys.",
};

/**
 * Design notes that are NOT in the Postgres comments.
 *
 * Deliberately empty: descriptions live in COMMENT ON now, and duplicating them
 * here produced two near-identical paragraphs per table, which made the register
 * harder to read rather than more thorough. Anything worth saying about a table
 * belongs in its comment, where psql and the AI worker can see it too.
 */
const TABLE_NOTES: Record<string, string[]> = {};

function isPgTable(value: unknown): value is PgTable {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.for("drizzle:Name") in value
  );
}

export function buildSchemaDocs(
  descriptions?: { tables: Map<string, string>; columns: Map<string, string> },
): TableDoc[] {
  const docs: TableDoc[] = [];

  for (const exported of Object.values(schema)) {
    if (!isPgTable(exported)) continue;

    const config = getTableConfig(exported);
    const columns = config.columns.map((c) => ({
      name: c.name,
      type: c.getSQLType(),
      notNull: c.notNull,
      hasDefault: c.hasDefault,
      primaryKey: c.primary,
      description: descriptions?.columns.get(`${config.name}.${c.name}`),
    }));

    docs.push({
      name: config.name,
      module: MODULES[config.name] ?? "platform (from starter)",
      tenantScoped: columns.some((c) => c.name === "organization_id"),
      columns,
      indexes: config.indexes.map((i) => ({
        name: i.config.name ?? "(unnamed)",
        columns: i.config.columns.map((c) =>
          "name" in c ? String(c.name) : "(expression)",
        ),
        unique: i.config.unique,
      })),
      foreignKeys: config.foreignKeys.map((fk) => {
        const ref = fk.reference();
        return {
          name: fk.getName(),
          columns: ref.columns.map((c) => c.name),
          foreignTable: getTableConfig(ref.foreignTable).name,
        };
      }),
      checks: config.checks.map((c) => c.name),
      description: descriptions?.tables.get(config.name),
      isolationNote: BESPOKE_POLICIES[config.name],
      notes: TABLE_NOTES[config.name] ?? [],
    });
  }

  return docs.sort(
    (a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name),
  );
}

/**
 * Mermaid ER diagram, generated from the same table docs the page renders.
 *
 * Emitted per module rather than as one 33-table graph, because a single
 * diagram at this size is a hairball nobody reads. Edges leaving the module are
 * kept (so the spine stays visible) but their far side is not expanded.
 *
 * Composite tenant foreign keys (F2) all include organization_id, which would
 * double every edge — they are collapsed to one edge per table pair.
 */
export function buildErd(tables: TableDoc[], module?: string): string {
  const inScope = module
    ? tables.filter((t) => t.module === module)
    : tables.filter((t) => t.module !== "platform (from starter)");
  const names = new Set(inScope.map((t) => t.name));

  const lines = ["erDiagram"];
  const seen = new Set<string>();

  for (const t of inScope) {
    for (const fk of t.foreignKeys) {
      // Self-references render as a loop and add nothing here.
      if (fk.foreignTable === t.name) continue;

      // Composite tenant keys (F2) all carry organization_id, so the label is
      // the discriminating column. When that is all there is, the edge IS the
      // tenant link and says so.
      const cols = fk.columns.filter((c) => c !== "organization_id");
      const label = cols.length ? cols.join(", ") : "organization_id";

      // Dedupe on the pair AND the label: person_relationships points at people
      // twice (person_id, related_person_id) and both edges are real.
      const edge = `${fk.foreignTable}->${t.name}:${label}`;
      if (seen.has(edge)) continue;
      seen.add(edge);

      // A not-null FK is a mandatory parent; nullable is optional.
      const required = t.columns.some(
        (c) => c.name === (cols[0] ?? fk.columns[0]) && c.notNull,
      );

      lines.push(
        `  ${fk.foreignTable} ${required ? "||--o{" : "|o--o{"} ${t.name} : "${label}"`,
      );

      // Pull in out-of-module parents so the reader can see where an edge goes.
      if (!names.has(fk.foreignTable)) names.add(fk.foreignTable);
    }
  }

  // Isolated tables would vanish from the diagram entirely.
  for (const t of inScope) {
    if (![...seen].some((e) => e.split(":")[0].includes(t.name)))
      lines.push(`  ${t.name}`);
  }

  return lines.join("\n");
}

export function buildPermissionDocs() {
  return FEATURE_CATALOG.map((f) => ({
    key: f.key,
    name: f.name,
    description: f.description,
    category: f.category,
  }));
}

/**
 * The invariants from docs/schema-design.md section 1, with how each is
 * enforced. "Documented" means the schema permits a violation and only review
 * catches it — worth stating plainly rather than implying everything is
 * machine-checked.
 */
export const INVARIANTS: {
  title: string;
  detail: string;
  enforcement: "database" | "trigger" | "documented";
}[] = [
  {
    title: "Two hierarchies intersect nowhere",
    detail:
      "Ecclesiastical (congregation, presbytery, synod, GA) and platform (tenant user, tenant admin, platform admin) are different axes. A platform admin is not above a national admin.",
    enforcement: "documented",
  },
  {
    title: "Access flows up by publication, never down by inheritance",
    detail:
      "A presbytery admin has no read access inside a member congregation. The only downward paths are an administrative commission and a congregation-granted delegation, both time-boxed and audited.",
    enforcement: "database",
  },
  {
    title: "Tenant isolation is a database property",
    detail:
      "presby_app is created NOBYPASSRLS and every tenant table is FORCE ROW LEVEL SECURITY. Without FORCE, the table owner bypasses every policy and RLS is silently inert (F1).",
    enforcement: "database",
  },
  {
    title: "An approved roll action is immutable",
    detail:
      "Corrections are recorded as voiding actions. Pending rows stay mutable so the approval workflow can edit them.",
    enforcement: "trigger",
  },
  {
    title: "Session and diaconate membership is derived, never edited",
    detail:
      "The session is a court, not a group of people. Its roster projects from active ruling elder terms; direct writes are rejected.",
    enforcement: "trigger",
  },
  {
    title: "No role carries a wildcard",
    detail:
      "Not even administrator roles. A Church Administrator does not read tier 2 or tier 3 by default. NOTE: the starter's ADMIN_ROLE is still a wildcard and must be removed before ship.",
    enforcement: "documented",
  },
  {
    title: "Nothing about a person is ever hard-deleted",
    detail:
      "PC(USA) records are permanent. delete is revoked on people; use merged_into_id.",
    enforcement: "database",
  },
  {
    title: "The SASR is a projection, never a data-entry screen",
    detail:
      "If a report field cannot be derived, the gap is in the operational model, not in the report.",
    enforcement: "documented",
  },
];
