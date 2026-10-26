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
  ACCOUNT_INVITATION_DESIGNATION_PURPOSES,
  ACCOUNT_INVITATION_PURPOSES_ALLOWED,
  ACCOUNT_INVITATION_ORIGINS_ALLOWED,
  ACCOUNT_INVITATION_BLOCKED_REASONS_ALLOWED,
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

/**
 * drizzle/0065 section 5 amends the table (Community Increment 2b): widened
 * vocabularies, two new CHECKs, the re-predicated open-address index and two
 * new indexes. Its sections 1-10 are Batch A1; A2 appends 11-15.
 */
const MIGRATION_0065 = readFileSync(
  fileURLToPath(new URL("../../../../drizzle/0065_presby_sign_in_and_connect.sql", import.meta.url)),
  "utf8",
);
const CODE_0065 = MIGRATION_0065.replace(/--[^\n]*/g, "");

function namesCreatedBy(code: string): Set<string> {
  const names = new Set<string>();
  for (const m of code.matchAll(/alter table account_invitations add constraint (\w+)/g)) names.add(m[1]);
  for (const m of code.matchAll(/create (?:unique )?index if not exists (\w+)\s+on account_invitations/g)) names.add(m[1]);
  const create = code.match(/create table if not exists account_invitations \(([\s\S]*?)\n\);/);
  for (const c of create?.[1].matchAll(/constraint (\w+)/g) ?? []) names.add(c[1]);
  return names;
}

function namesCreatedByMigration(): Set<string> {
  return namesCreatedBy(CODE);
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
function checkList(constraint: string, code: string = CODE): string[] {
  const m = code.match(new RegExp(`add constraint ${constraint}\\s+check \\(\\w+ in \\(([^)]*)\\)\\)`));
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

  it("0065 creates exactly the names its section 5 lists (re-created and new)", () => {
    expect([...namesCreatedBy(CODE_0065)].sort()).toEqual(
      [
        "account_invitations_purpose_allowed",
        "account_invitations_origin_allowed",
        "account_invitations_purpose_origin_tie",
        "account_invitations_names_by_purpose",
        "account_invitations_sign_in_has_person",
        "account_invitations_blocked_reason_allowed",
        "account_invitations_open_address_uq",
        "account_invitations_open_sign_in_person_uq",
        "account_invitations_person_created_ix",
      ].sort(),
    );
  });

  it("accountInvitations declares every name 0059 and 0065 create, and nothing they do not", () => {
    const both = new Set([...created, ...namesCreatedBy(CODE_0065)]);
    expect([...namesDeclaredByDrizzle()].sort()).toEqual([...both].sort());
  });
});

describe("drizzle/0065 enumerations equal the TypeScript lists (Increment 2b)", () => {
  it("purpose, origin and blocked_reason CHECK lists equal the *_ALLOWED vocabularies", () => {
    expect(checkList("account_invitations_purpose_allowed", CODE_0065)).toEqual([...ACCOUNT_INVITATION_PURPOSES_ALLOWED]);
    expect(checkList("account_invitations_origin_allowed", CODE_0065)).toEqual([...ACCOUNT_INVITATION_ORIGINS_ALLOWED]);
    expect(checkList("account_invitations_blocked_reason_allowed", CODE_0065)).toEqual([
      ...ACCOUNT_INVITATION_BLOCKED_REASONS_ALLOWED,
    ]);
  });

  it("each widened list is the 0059 list plus exactly the 2b value, in order", () => {
    expect(ACCOUNT_INVITATION_PURPOSES_ALLOWED).toEqual([...ACCOUNT_INVITATION_PURPOSES, "sign_in"]);
    expect(ACCOUNT_INVITATION_ORIGINS_ALLOWED).toEqual([...ACCOUNT_INVITATION_ORIGINS, "org"]);
    expect(ACCOUNT_INVITATION_BLOCKED_REASONS_ALLOWED).toEqual([...ACCOUNT_INVITATION_BLOCKED_REASONS, "person_deceased"]);
  });

  it("re-predicates open_address_uq to every purpose but sign_in, keeping the open predicate and no expiry term (R28)", () => {
    const m = CODE_0065.match(/create unique index if not exists account_invitations_open_address_uq([\s\S]*?);/);
    expect(m).not.toBeNull();
    const def = m![1].replace(/\s+/g, " ");
    expect(def).toContain("(organization_id, purpose, email_normalized)");
    expect(def).toContain("where purpose <> 'sign_in' and accepted_at is null and revoked_at is null and superseded_at is null and blocked_at is null");
    expect(def).not.toMatch(/expires_at/);
    // dropped first, so a re-apply really re-predicates the 0059 index
    expect(CODE_0065.indexOf("drop index if exists account_invitations_open_address_uq")).toBeLessThan(
      CODE_0065.indexOf("create unique index if not exists account_invitations_open_address_uq"),
    );
  });

  it("leaves the D-2 designation index alone", () => {
    expect(CODE_0065).not.toMatch(/account_invitations_open_designation_uq/);
  });
});

describe("drizzle/0059 enumerations equal the TypeScript lists", () => {
  it("purpose, origin and blocked_reason CHECK lists", () => {
    expect(checkList("account_invitations_purpose_allowed")).toEqual([...ACCOUNT_INVITATION_PURPOSES]);
    expect(checkList("account_invitations_origin_allowed")).toEqual([...ACCOUNT_INVITATION_ORIGINS]);
    expect(checkList("account_invitations_blocked_reason_allowed")).toEqual([...ACCOUNT_INVITATION_BLOCKED_REASONS]);
  });

  it("the D-2 designation index covers exactly the two designation purposes", () => {
    const m = CODE.match(/create unique index if not exists account_invitations_open_designation_uq[\s\S]*?purpose in \(([^)]*)\)/);
    expect([...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual([...ACCOUNT_INVITATION_DESIGNATION_PURPOSES]);
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

describe("drizzle/0065 structural promises (Increment 2b, Batch A1 sections)", () => {
  /** The body of one function in 0065, `as $$ ... $$`. */
  function body0065(fn: string): string {
    const start = CODE_0065.indexOf(`create or replace function ${fn}(`);
    if (start < 0) throw new Error(`${fn} not in 0065`);
    const open = CODE_0065.indexOf("$$", start);
    const close = CODE_0065.indexOf("$$", open + 2);
    return CODE_0065.slice(open + 2, close);
  }

  it("carries no top-level begin/commit of its own (apply with psql -1)", () => {
    expect(CODE_0065).not.toMatch(/^\s*(begin|commit)\s*;/im);
  });

  it("grants presby_app only EXECUTE, never a table privilege, and grants presby_platform nothing", () => {
    const grants = [...CODE_0065.matchAll(/grant ([^;]*?) to (\w+);/g)];
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) {
      expect(g[2]).toBe("presby_app");
      expect(g[1]).toMatch(/^execute on function /);
    }
  });

  it("the two proof writers are EXECUTE-granted to presby_app after a revoke from every application role", () => {
    for (const sig of ["presby_record_google_email_proof(uuid, text)", "presby_complete_email_change(text)"]) {
      const revoke = CODE_0065.indexOf(`revoke all on function ${sig} from public, presby_app, presby_platform;`);
      const grant = CODE_0065.indexOf(`grant execute on function ${sig} to presby_app;`);
      expect(revoke).toBeGreaterThan(-1);
      expect(grant).toBeGreaterThan(revoke);
    }
  });

  it("the users and people guards decide 'owner' from pg_class.relowner and name no role (A1)", () => {
    for (const fn of ["presby_users_guard_email_proof", "presby_guard_people_user_link"]) {
      const b = body0065(fn);
      expect(b).toMatch(/c\.relowner = \(select r\.oid from pg_roles r where r\.rolname = current_user\)/);
      expect(b).toMatch(/c\.oid = tg_relid/);
      expect(b).not.toMatch(/presby_app|presby_platform|neondb_owner/);
    }
  });

  it("the proof writers are SECURITY DEFINER with a pinned search_path and the column-wins pragma", () => {
    for (const fn of ["presby_record_google_email_proof", "presby_complete_email_change"]) {
      const start = CODE_0065.indexOf(`create or replace function ${fn}(`);
      const header = CODE_0065.slice(start, CODE_0065.indexOf("$$", start));
      expect(header).toMatch(/security definer/);
      expect(header).toMatch(/set search_path = public, pg_temp/);
      expect(body0065(fn)).toMatch(/^\s*#variable_conflict use_column/);
    }
  });

  it("no proof writer reads contact_methods (R43: proof comes from the account side only)", () => {
    for (const fn of ["presby_record_google_email_proof", "presby_complete_email_change", "presby_users_guard_email_proof"]) {
      expect(body0065(fn)).not.toMatch(/contact_methods|verified_at/);
    }
  });
});

describe("drizzle/0065 structural promises (Increment 2b, Batch A2 sections 11-15)", () => {
  /** Every function body in 0065, keyed by name (the last definition wins). */
  function bodies(): Map<string, string> {
    const out = new Map<string, string>();
    const re = /create or replace function (\w+)\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(CODE_0065))) {
      const open = /(?:^|\s)as (\$\w*\$)/m.exec(CODE_0065.slice(m.index));
      if (!open) throw new Error(`no body for ${m[1]}`);
      const start = m.index + open.index + open[0].length;
      out.set(m[1]!, CODE_0065.slice(start, CODE_0065.indexOf(open[1]!, start)));
    }
    return out;
  }
  /** Section N onward of the RAW text (CODE_0065 has its comments, and so its banners, stripped). */
  function fromSection(n: number): string {
    const at = MIGRATION_0065.search(new RegExp(`^-- ${n}\\. `, "m"));
    if (at < 0) throw new Error(`section ${n} not found`);
    return MIGRATION_0065.slice(at).replace(/--[^\n]*/g, "");
  }
  /** The header of one function (from `create` to its body), comments stripped. */
  function header(fn: string): string {
    const start = CODE_0065.indexOf(`create or replace function ${fn}(`);
    return CODE_0065.slice(start, CODE_0065.indexOf("\nas $", start));
  }

  const CALLABLE = [
    "presby_issue_sign_in_invitation(uuid, text, timestamptz, uuid, text, boolean, uuid)",
    "presby_resend_sign_in_invitation(uuid, text, timestamptz, uuid, text, boolean, uuid)",
    "presby_revoke_sign_in_invitation(uuid, uuid)",
    "presby_sign_in_invitation_states(uuid[], uuid)",
    "presby_sign_in_card_standing(uuid, uuid)",
    "presby_accept_invitation(text, uuid, text, text, text)",
    "presby_accept_in_place(uuid, uuid, boolean)",
    "presby_preview_invitation(text, uuid)",
    "presby_list_invitations_for_account(uuid)",
    "presby_connect_signed_in_account(uuid, boolean)",
    "presby_record_google_email_proof(uuid, text)",
    "presby_complete_email_change(text)",
    "presby_deny_sign_in_invitation()",
    "presby_membership_standing(text, text)",
    "presby_person_email(uuid, text)",
  ];

  it("section 15 grants presby_app EXECUTE on exactly the fifteen callables (5.11)", () => {
    const sec15 = fromSection(15);
    const granted = [...sec15.matchAll(/grant execute on function (.+?) to presby_app;/g)].map((m) => m[1]);
    expect(granted.sort()).toEqual([...CALLABLE].sort());
  });

  it("section 15 revokes every function the file defines from public, presby_app and presby_platform", () => {
    const sec15 = fromSection(15);
    const revoked = new Set([...sec15.matchAll(/revoke all on function (\w+)\(/g)].map((m) => m[1]));
    for (const fn of bodies().keys()) expect(revoked.has(fn), fn).toBe(true);
    for (const m of sec15.matchAll(/revoke all on function [^;]+;/g)) {
      expect(m[0]).toMatch(/from public, presby_app, presby_platform;$/);
    }
  });

  it("every plpgsql function of sections 11-14 pins search_path and, when it is a definer, carries the column-wins pragma", () => {
    const b = bodies();
    const a2Text = fromSection(11);
    const a2 = [...b.keys()].filter((fn) => a2Text.includes(`create or replace function ${fn}(`));
    expect(a2.length).toBeGreaterThanOrEqual(17);
    for (const fn of a2) {
      if (fn === "presby_membership_standing") continue; // plain immutable SQL, no SET (S13)
      const h = header(fn);
      expect(h, fn).toMatch(/set search_path = public, pg_temp/);
      if (/security definer/.test(h)) expect(b.get(fn)!, fn).toMatch(/^\s*#variable_conflict use_column/);
    }
  });

  it("the accept core's exception mapping maps BOTH users constraints to account_exists, never unique_violation alone (E1)", () => {
    const core = bodies().get("presby__accept_invitation_core")!;
    const handler = core.slice(core.indexOf("when unique_violation then"), core.indexOf("when insufficient_privilege then"));
    expect(handler).toMatch(/get stacked diagnostics v_con = constraint_name/);
    expect(handler).toMatch(/if v_con in \('users_email_unique', 'users_email_lower_uq'\) then/);
    expect(handler).toMatch(/else\s+raise;/);
  });

  it("every blocked reason the accept core can commit is in the 0065 CHECK list (the standing core's refusals included)", () => {
    const b = bodies();
    const core = b.get("presby__accept_invitation_core")!;
    const assigned = new Set([...core.matchAll(/v_block := '(\w+)'/g)].map((m) => m[1]!));
    for (const m of core.matchAll(/v_detail in \(([^)]*)\)/g)) for (const x of m[1]!.matchAll(/'(\w+)'/g)) assigned.add(x[1]!);
    for (const x of b.get("presby__person_sign_in_standing")!.matchAll(/then '(person_\w+|membership_ended)'/g)) assigned.add(x[1]!);
    expect([...assigned].sort()).toEqual([...ACCOUNT_INVITATION_BLOCKED_REASONS_ALLOWED].sort());
  });

  it("F196: purpose routing names all three purposes and ends in `else raise ... internal_error` (core steps 3-6, preview)", () => {
    const b = bodies();
    const core = b.get("presby__accept_invitation_core")!;
    expect(core.match(/unknown purpose %', v_inv\.purpose\s+using errcode = 'internal_error'/g)?.length).toBe(4);
    expect(core).toMatch(/unknown presentation %', p_presentation\s+using errcode = 'internal_error'/);
    expect(core).not.toMatch(/^\s*else\s*\n\s*-- founding_administrator/m);
    const preview = b.get("presby_preview_invitation")!;
    expect(preview).toMatch(/elsif v_inv\.purpose = 'founding_administrator' then/);
    expect(preview).toMatch(/elsif v_inv\.purpose = 'sign_in' then/);
    expect(preview).toMatch(/unknown purpose %', v_inv\.purpose\s+using errcode = 'internal_error'/);
  });

  it("only the accept core arms the acceptance marker; both presentations reach it", () => {
    const b = bodies();
    const arming = /set_config\('presby\.invitation_accept_active', 'true', true\)/g;
    for (const [fn, body] of b) {
      const n = body.match(arming)?.length ?? 0;
      expect(n, fn).toBe(fn === "presby__accept_invitation_core" ? 2 : 0);
    }
    expect(b.get("presby_accept_invitation")!).toMatch(/presby__accept_invitation_core\([^)]*'token', false\)/);
    expect(b.get("presby_accept_in_place")!).toMatch(/presby__accept_invitation_core\([^)]*'in_place', p_second_factor_verified\)/);
  });

  it("people.user_id writers in 0065: the update only in the bind helper, the insert only in the accept core (R44)", () => {
    for (const [fn, body] of bodies()) {
      expect(/update people\s+set user_id/.test(body), fn).toBe(fn === "presby__bind_person_account");
      expect(/insert into people\s*\([^)]*user_id/.test(body), fn).toBe(fn === "presby__accept_invitation_core");
    }
  });

  it("R43 / E-24: connect, the listing, in-place and the standing core read neither verified_at nor any platform predicate", () => {
    const b = bodies();
    for (const fn of ["presby_connect_signed_in_account", "presby_list_invitations_for_account", "presby_accept_in_place",
                      "presby__person_sign_in_standing", "presby_sign_in_card_standing"]) {
      expect(b.get(fn)!, fn).not.toMatch(/verified_at|is_platform_admin/);
    }
  });

  it("DECISION-189: of the issue, resend, revoke, reader and card bodies only the shared check reads users, and only the sender's own row", () => {
    const b = bodies();
    for (const fn of ["presby_issue_sign_in_invitation", "presby_resend_sign_in_invitation", "presby_revoke_sign_in_invitation",
                      "presby_sign_in_invitation_states", "presby_sign_in_card_standing"]) {
      expect(b.get(fn)!, fn).not.toMatch(/\busers\b/);
    }
    const reads = [...b.get("presby_sign_in__check")!.matchAll(/from users u where ([^;]+);/g)].map((m) => m[1]);
    expect(reads).toEqual(["u.id = p_sender_user"]);
  });

  it("every contact_methods read in sections 11-14 carries ended_at is null (0064 ER3b)", () => {
    for (const [fn, body] of bodies()) {
      if (!/contact_methods/.test(body)) continue;
      if (["presby_contact_methods_guard_write"].includes(fn)) continue;
      expect(body, fn).toMatch(/ended_at is null/);
    }
  });
});
