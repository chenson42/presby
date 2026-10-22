/**
 * Schema pin for drizzle/0059_presby_account_invitations.sql (DECISION-184).
 *
 * `npm run check:schema-parity` compares columns, nullability and foreign keys
 * between the Drizzle domain model and the live catalog; it deliberately does
 * NOT compare CHECK constraints or indexes. This file is the complement, in
 * the domains.schema.test.ts shape: every constraint and index name 0059
 * creates on `account_invitations` must be declared on `accountInvitations`,
 * and the TypeScript enumerations in ./invitations must equal the lists the
 * migration's CHECKs actually spell. It also pins the two structural promises
 * the migration's prose makes: no begin/commit of its own (apply with -1),
 * and EXECUTE granted to presby_app on exactly two functions.
 *
 * Pure: no database. Policies, grants, FORCE RLS and the guards' behaviour
 * are proven by scripts/invitations/test-rls-59.sql (presby_app) and
 * src/lib/db/domain/invitations.db.test.ts (owner path).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
// The canonical entry point first, so the domain module cycle initialises
// from schema.ts; ./invitations is not yet re-exported from ./index (that line
// is added at integration, Rule 16).
import "../schema";
import {
  accountInvitations,
  ACCOUNT_INVITATION_PURPOSES,
  ACCOUNT_INVITATION_ORIGINS,
  ACCOUNT_INVITATION_BLOCKED_REASONS,
  ACCOUNT_INVITATION_ACCEPT_MARKER,
  ACCOUNT_INVITATION_MAX_RESENDS,
  ACCOUNT_INVITATION_MAX_EXPIRY_DAYS,
} from "./invitations";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../../drizzle/0059_presby_account_invitations.sql", import.meta.url)),
  "utf8",
);
/** The migration with `--` comments removed, so prose cannot satisfy a code assertion. */
const CODE = MIGRATION.replace(/--[^\n]*/g, "");

function namesCreatedByMigration(): Set<string> {
  const names = new Set<string>();
  for (const m of CODE.matchAll(/alter table account_invitations add constraint (\w+)/g)) names.add(m[1]);
  for (const m of CODE.matchAll(/create (?:unique )?index if not exists (\w+)\s+on account_invitations/g)) names.add(m[1]);
  const create = CODE.match(/create table if not exists account_invitations \(([\s\S]*?)\n\);/);
  for (const c of create?.[1].matchAll(/constraint (\w+)/g) ?? []) names.add(c[1]);
  return names;
}

function namesDeclaredByDrizzle(): Set<string> {
  const cfg = getTableConfig(accountInvitations);
  return new Set<string>([
    ...cfg.checks.map((c) => c.name),
    ...cfg.indexes.map((i) => i.config.name).filter((n): n is string => Boolean(n)),
    ...cfg.uniqueConstraints.map((u) => u.getName()).filter((n): n is string => Boolean(n)),
    // Only the explicitly named composite FKs: the single-column inline
    // `.references()` are unnamed in 0059 too (Postgres and Drizzle each
    // auto-name them, differently), and check:schema-parity compares FK shape.
    ...cfg.foreignKeys.filter((f) => f.reference().columns.length > 1).map((f) => f.getName()),
  ]);
}

/** The quoted list inside `check (<col> in (...))` for one named constraint. */
function checkList(constraint: string): string[] {
  const m = CODE.match(new RegExp(`add constraint ${constraint}\\s+check \\(\\w+ in \\(([^)]*)\\)\\)`));
  if (!m) throw new Error(`no IN-list CHECK named ${constraint}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("drizzle/0059 constraint and index names are mirrored in the domain model", () => {
  const created = namesCreatedByMigration();

  it("finds the names the design lists, so the parser itself is not vacuous", () => {
    expect([...created].sort()).toEqual(
      [
        "account_invitations_id_org_key",
        "account_invitations_token_hash_key",
        "account_invitations_person_membership_fk",
        "account_invitations_resent_from_fk",
        "account_invitations_purpose_allowed",
        "account_invitations_origin_allowed",
        "account_invitations_email_shape",
        "account_invitations_email_null_iff_redacted",
        "account_invitations_names_shape",
        "account_invitations_names_by_purpose",
        "account_invitations_treasurer_has_person",
        "account_invitations_token_hash_shape",
        "account_invitations_expiry_window",
        "account_invitations_resend_count_range",
        "account_invitations_resend_lineage",
        "account_invitations_one_terminal",
        "account_invitations_accepted_shape",
        "account_invitations_revoked_shape",
        "account_invitations_blocked_shape",
        "account_invitations_blocked_reason_allowed",
        "account_invitations_redacted_terminal",
        "account_invitations_open_address_uq",
        "account_invitations_open_designation_uq",
        "account_invitations_resent_from_uq",
        "account_invitations_email_created_ix",
        "account_invitations_inviter_created_ix",
        "account_invitations_org_created_ix",
      ].sort(),
    );
  });

  it("accountInvitations declares every name 0059 creates, and nothing 0059 does not", () => {
    expect([...namesDeclaredByDrizzle()].sort()).toEqual([...created].sort());
  });
});

describe("drizzle/0059 enumerations equal the TypeScript lists", () => {
  it("purpose, origin and blocked_reason CHECK lists", () => {
    expect(checkList("account_invitations_purpose_allowed")).toEqual([...ACCOUNT_INVITATION_PURPOSES]);
    expect(checkList("account_invitations_origin_allowed")).toEqual([...ACCOUNT_INVITATION_ORIGINS]);
    expect(checkList("account_invitations_blocked_reason_allowed")).toEqual([...ACCOUNT_INVITATION_BLOCKED_REASONS]);
  });

  it("the D-2 designation index covers exactly the TypeScript purposes", () => {
    const m = CODE.match(/create unique index if not exists account_invitations_open_designation_uq[\s\S]*?purpose in \(([^)]*)\)/);
    expect([...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual([...ACCOUNT_INVITATION_PURPOSES]);
  });

  it("the resend cap and expiry cap numbers", () => {
    expect(CODE).toMatch(new RegExp(`resend_count between 0 and ${ACCOUNT_INVITATION_MAX_RESENDS}\\b`));
    expect(CODE).toMatch(new RegExp(`created_at \\+ interval '${ACCOUNT_INVITATION_MAX_EXPIRY_DAYS} days'`));
  });

  it("every blocked reason presby_accept_invitation can commit is in the CHECK list", () => {
    const body = CODE.slice(CODE.indexOf("create or replace function presby_accept_invitation("));
    const assigned = new Set([...body.matchAll(/v_block := '(\w+)'/g)].map((m) => m[1]));
    const fromDetail = [...body.matchAll(/v_detail in \(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]));
    for (const r of fromDetail) assigned.add(r);
    expect([...assigned].sort()).toEqual([...ACCOUNT_INVITATION_BLOCKED_REASONS].sort());
  });
});

describe("drizzle/0059 structural promises", () => {
  it("carries no top-level begin/commit of its own (apply with psql -1)", () => {
    expect(CODE).not.toMatch(/^\s*(begin|commit)\s*;/im);
  });

  it("grants presby_app EXECUTE on exactly the two functions, and no table privilege", () => {
    const grants = [...CODE.matchAll(/grant (\w+)[^;]*? to presby_app;/g)].map((m) => m[0].replace(/\s+/g, " "));
    expect(grants).toEqual([
      "grant execute on function presby_preview_invitation(text, uuid) to presby_app;",
      "grant execute on function presby_accept_invitation(text, uuid, text, text, text) to presby_app;",
    ]);
  });

  it("names the marker the update guard checks, and only presby_accept_invitation arms it", () => {
    const armings = [...CODE.matchAll(new RegExp(`set_config\\('${ACCOUNT_INVITATION_ACCEPT_MARKER.replace(".", "\\.")}', 'true', true\\)`, "g"))];
    expect(armings.length).toBe(2); // the claim (inner block) and the blocked update (outer block, D-5.1)
    const acceptStart = CODE.indexOf("create or replace function presby_accept_invitation(");
    for (const a of armings) expect(a.index!).toBeGreaterThan(acceptStart);
    expect(CODE).toContain(`current_setting('${ACCOUNT_INVITATION_ACCEPT_MARKER}', true)`);
  });

  it("the exception mapping matches users_email_unique by constraint name, never unique_violation alone (D-5.2)", () => {
    const handler = CODE.slice(CODE.indexOf("when unique_violation then"), CODE.indexOf("when insufficient_privilege then"));
    expect(handler).toMatch(/get stacked diagnostics v_con = constraint_name/);
    expect(handler).toMatch(/if v_con = 'users_email_unique' then/);
    expect(handler).toMatch(/else\s+raise;/);
  });
});
