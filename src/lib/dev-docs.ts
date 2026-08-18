import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
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
};

export type TableDoc = {
  name: string;
  module: string;
  tenantScoped: boolean;
  columns: ColumnDoc[];
  indexes: { name: string; columns: string[]; unique: boolean }[];
  foreignKeys: { name: string; columns: string[]; foreignTable: string }[];
  checks: string[];
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

const TABLE_NOTES: Record<string, string[]> = {
  people: [
    "Identity only, deliberately thin. It is the one surface shared across tenants, so every column here is a column one church can see because another church entered it.",
    "delete is revoked from presby_app. Invariant 7: a person row is never hard-deleted.",
  ],
  memberships: [
    "THE LINK: a person's relationship with one organization, carrying their roll status there. A transfer ends the membership at the losing church and opens one at the receiving church against the same people row.",
    "Composite-FK target for every org record ABOUT a person, which is how F2 survives people going global: a row in org B can only reference a person with a membership in org B.",
    "current_roll is a CACHE maintained by trigger from approved roll_actions. It cannot answer historical questions — reports replay via rollAsOf(). See F6.",
    "F21: creating a membership for an EXISTING person must not be a plain INSERT — it self-grants visibility of that person's identity. Goes through the claim/match flow.",
    "Partial unique index enforces ONE active-roll membership per person. An affiliate member is by definition an active member of another church (G-1.0403), so the other rolls may coexist — two active memberships cannot. Only the global people model can express this.",
  ],
  roll_actions: [
    "Pending rows are mutable working state; a trigger freezes the row on approval. Invariant 4 covers approved rows only.",
    "The pending queue IS the clerk's session agenda, and the seam the future meetings module plugs into.",
  ],
  officer_terms: [
    "MUTABLE, unlike roll_actions (F10). A term is a span, not an event; resignation sets ends_on.",
    "A trigger propagates ends_on into derived group_memberships, so session access drops the day the term does (F19).",
  ],
  group_memberships: [
    "Rows with source='derived' are owned by the officer_terms trigger and reject direct writes (invariant 5).",
    "Materialized rather than a view, because the permission resolver reads this table (F3).",
  ],
  person_notes: [
    "visibility='clergy_only' is the strictest grant in the system. The AI support worker never receives a grant on this table under any elevation.",
  ],
  person_disabilities: [
    "Staff-observed, health-adjacent data held WITHOUT consent, because the SASR instructs clerks to record it from personal knowledge. Gated behind organization_settings.trackDisabilityPerPerson.",
  ],
  sasr_reports: [
    "official_beginning_balance is immutable — it comes from the GA Minutes. Disagreement with our computed roll is pushed into Other Gains/Losses with a generated explanation, never silently corrected.",
  ],
};

function isPgTable(value: unknown): value is PgTable {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.for("drizzle:Name") in value
  );
}

export function buildSchemaDocs(): TableDoc[] {
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
      notes: [
        ...(BESPOKE_POLICIES[config.name]
          ? [`ISOLATION: ${BESPOKE_POLICIES[config.name]}`]
          : []),
        ...(TABLE_NOTES[config.name] ?? []),
      ],
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
