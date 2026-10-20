/**
 * Schema pin for drizzle/0057_presby_org_domains.sql (DECISION-180).
 *
 * `npm run check:schema-parity` compares columns, nullability and foreign keys
 * between the Drizzle domain model and the live catalog; it deliberately does
 * NOT compare CHECK constraints or indexes. This file is the complement, in
 * the events.schema.test.ts shape: every constraint and index name 0057
 * creates on `organization_domains` must be declared on `organizationDomains`,
 * and the TypeScript enumerations in ./domains must equal the lists the
 * migration's CHECKs and partial-index predicates actually spell.
 *
 * It also parses the trigger's LEGAL EDGES block, so the edge table has a
 * reader before src/lib/domains/state.ts exists (Batch 1a-ii pins state.ts to
 * the same parse).
 *
 * Pure: no database. Policies, grants, FORCE RLS and the triggers' behaviour
 * are proven by scripts/domains/test-rls-47.sql (presby_app) and
 * src/lib/db/domain/domains.db.test.ts (owner path).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
// The canonical entry point first, so the domain module cycle initialises
// from schema.ts (see events.schema.test.ts); ./domains is not yet re-exported
// from ./index (that line is added at integration, Rule 16).
import "../schema";
import {
  organizationDomains,
  ORGANIZATION_DOMAIN_STATES,
  ORGANIZATION_DOMAIN_HOLDING_STATES,
  ORGANIZATION_DOMAIN_TERMINAL_STATES,
  ORGANIZATION_DOMAIN_RELEASE_CAUSES,
  ORGANIZATION_DOMAIN_CHECK_CLASSES,
  ORGANIZATION_DOMAIN_PLATFORM_HOLDS,
  ORGANIZATION_DOMAIN_PURPOSES,
  ORGANIZATION_DOMAIN_WEB_ROLES,
  ORGANIZATION_DOMAIN_CREATED_VIA,
} from "./domains";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../../drizzle/0057_presby_org_domains.sql", import.meta.url)),
  "utf8",
);

function namesCreatedByMigration(): Set<string> {
  const names = new Set<string>();
  for (const m of MIGRATION.matchAll(/alter table organization_domains add constraint (\w+)/g)) {
    names.add(m[1]);
  }
  for (const m of MIGRATION.matchAll(/create (?:unique )?index if not exists (\w+)\s+on organization_domains/g)) {
    names.add(m[1]);
  }
  const create = MIGRATION.match(/create table if not exists organization_domains \(([\s\S]*?)\n\);/);
  for (const c of create?.[1].matchAll(/constraint (\w+)/g) ?? []) names.add(c[1]);
  return names;
}

function namesDeclaredByDrizzle(): Set<string> {
  const cfg = getTableConfig(organizationDomains);
  return new Set<string>([
    ...cfg.checks.map((c) => c.name),
    ...cfg.indexes.map((i) => i.config.name).filter((n): n is string => Boolean(n)),
    ...cfg.uniqueConstraints.map((u) => u.getName()).filter((n): n is string => Boolean(n)),
  ]);
}

/** The quoted list inside `check (<col> in (...))` for one named constraint. */
function checkList(constraint: string): string[] {
  const m = MIGRATION.match(
    new RegExp(`add constraint ${constraint}\\s+check \\(\\w+ in \\(([^)]*)\\)\\)`),
  );
  if (!m) throw new Error(`no IN-list CHECK named ${constraint}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** The quoted state list of one partial index's `where state [not] in (...)`. */
function indexStateList(index: string): string[] {
  const m = MIGRATION.match(
    new RegExp(`create unique index if not exists ${index}[\\s\\S]*?where[^;]*?state (?:not )?in \\(([^)]*)\\)`),
  );
  if (!m) throw new Error(`no partial index ${index}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** The trigger's legal-edge table, parsed from between its markers. */
function parseLegalEdges(migration: string) {
  const block = migration.match(/-- BEGIN LEGAL EDGES[\s\S]*?-- END LEGAL EDGES/);
  if (!block) throw new Error("no LEGAL EDGES block in 0057");
  return [...block[0].matchAll(/\('(\w+)',\s*'(\w+)',\s*(null|'(\w+)')\)/g)].map((m) => ({
    from: m[1],
    to: m[2],
    scope: (m[4] ?? null) as "web" | "mail" | null,
  }));
}

describe("drizzle/0057 constraint and index names are mirrored in the domain model", () => {
  const created = namesCreatedByMigration();

  it("finds the names the design lists, so the parser itself is not vacuous", () => {
    expect([...created].sort()).toEqual(
      [
        "organization_domains_id_org_key",
        "organization_domains_purpose_allowed",
        "organization_domains_hostname_shape",
        "organization_domains_claim_name_shape",
        "organization_domains_host_in_claim",
        "organization_domains_web_role_allowed",
        "organization_domains_web_role_iff_web",
        "organization_domains_state_allowed",
        "organization_domains_proof_token_shape",
        "organization_domains_counts_nonnegative",
        "organization_domains_platform_hold_allowed",
        "organization_domains_reasons_shape",
        "organization_domains_release_cause_allowed",
        "organization_domains_last_check_class_allowed",
        "organization_domains_created_via_allowed",
        "organization_domains_jsonb_shape",
        "organization_domains_verified_stamped",
        "organization_domains_attached_stamped",
        "organization_domains_live_stamped",
        "organization_domains_grace_stamped",
        "organization_domains_released_stamped",
        "organization_domains_release_has_cause",
        "organization_domains_hostname_holding_uq",
        "organization_domains_org_host_uq",
        "organization_domains_one_canonical_uq",
        "organization_domains_due_ix",
        "organization_domains_org_ix",
      ].sort(),
    );
  });

  it("organizationDomains declares every name 0057 creates, and nothing 0057 does not", () => {
    expect([...namesDeclaredByDrizzle()].sort()).toEqual([...created].sort());
  });
});

describe("the TypeScript enumerations equal the migration's lists", () => {
  it.each([
    ["organization_domains_state_allowed", ORGANIZATION_DOMAIN_STATES],
    ["organization_domains_release_cause_allowed", ORGANIZATION_DOMAIN_RELEASE_CAUSES],
    ["organization_domains_last_check_class_allowed", ORGANIZATION_DOMAIN_CHECK_CLASSES],
    ["organization_domains_platform_hold_allowed", ORGANIZATION_DOMAIN_PLATFORM_HOLDS],
    ["organization_domains_purpose_allowed", ORGANIZATION_DOMAIN_PURPOSES],
    ["organization_domains_web_role_allowed", ORGANIZATION_DOMAIN_WEB_ROLES],
    ["organization_domains_created_via_allowed", ORGANIZATION_DOMAIN_CREATED_VIA],
  ] as const)("%s", (constraint, list) => {
    expect(checkList(constraint)).toEqual([...list]);
  });

  it("the holding index covers exactly ORGANIZATION_DOMAIN_HOLDING_STATES", () => {
    expect(indexStateList("organization_domains_hostname_holding_uq")).toEqual([
      ...ORGANIZATION_DOMAIN_HOLDING_STATES,
    ]);
  });

  it("the per-org uniques exclude exactly ORGANIZATION_DOMAIN_TERMINAL_STATES, and holding + terminal + pending = all states", () => {
    expect(indexStateList("organization_domains_org_host_uq").sort()).toEqual(
      [...ORGANIZATION_DOMAIN_TERMINAL_STATES].sort(),
    );
    expect(indexStateList("organization_domains_one_canonical_uq").sort()).toEqual(
      [...ORGANIZATION_DOMAIN_TERMINAL_STATES].sort(),
    );
    expect(
      ["pending", ...ORGANIZATION_DOMAIN_HOLDING_STATES, ...ORGANIZATION_DOMAIN_TERMINAL_STATES].sort(),
    ).toEqual([...ORGANIZATION_DOMAIN_STATES].sort());
  });
});

describe("the update guard's legal-edge table", () => {
  const edges = parseLegalEdges(MIGRATION);

  it("holds exactly 25 edges (Phase 3: 24 shared + the mail-only lapsed -> released)", () => {
    expect(edges).toHaveLength(25);
    expect(new Set(edges.map((e) => `${e.from}>${e.to}`)).size).toBe(25);
  });

  it("names only real states, never leaves a terminal state, and never enters pending", () => {
    const states = new Set<string>(ORGANIZATION_DOMAIN_STATES);
    for (const e of edges) {
      expect(states.has(e.from), e.from).toBe(true);
      expect(states.has(e.to), e.to).toBe(true);
      expect(ORGANIZATION_DOMAIN_TERMINAL_STATES as readonly string[]).not.toContain(e.from);
      expect(e.to).not.toBe("pending");
    }
  });

  it("a mail row can never enter attach_pending, attached, live, parked or release_pending", () => {
    const webOnlyTargets = ["attach_pending", "attached", "live", "parked", "release_pending"];
    for (const e of edges.filter((x) => webOnlyTargets.includes(x.to))) {
      expect(e.scope, `${e.from} -> ${e.to}`).toBe("web");
    }
    expect(edges.filter((e) => e.scope === "mail")).toEqual([
      { from: "lapsed", to: "released", scope: "mail" },
    ]);
  });
});

describe("the policy constants have exactly one definition in the trigger", () => {
  it("the 30-day grace (A1) and the next_check_at caps (suggestion 2)", () => {
    expect(MIGRATION.match(/c_grace_period constant interval := interval '30 days';/g)).toHaveLength(1);
    expect(MIGRATION.match(/c_next_check_cap\s+constant interval := interval '6 hours';/g)).toHaveLength(1);
    expect(
      MIGRATION.match(/c_next_check_cap_parked constant interval := interval '24 hours';/g),
    ).toHaveLength(1);
  });

  it("the caps: 3 web hosts, 1 mail domain", () => {
    expect(MIGRATION).toMatch(/c_web_cap\s+constant integer := 3;/);
    expect(MIGRATION).toMatch(/c_mail_cap constant integer := 1;/);
  });
});
