/**
 * T-5 (Community Increment 2b, Batch A2): THE STANDING CORE, R40 / S13.
 * drizzle/0065 section 11 (presby_membership_standing and
 * presby__person_sign_in_standing) against a real database, and every caller
 * mapped through the one fixed table of Phase 3 amendment 2 section 5.7
 * (docs/work-log/2026-10-22-founding-admin-directory.md).
 *
 * Anti-drift pins (5.7):
 *   (1) ONE fixture matrix drives every caller (issue, connect with and
 *       without a factor, token acceptance, in-place acceptance with and
 *       without a factor, card standing, the reader) and asserts each
 *       caller's verdict is the mapping of the core's output;
 *   (2) migration-text AND live-catalog scans: the classifier call, the R31
 *       other-organization `exists` and the closed derived list each occur in
 *       the core's body and in no other function body;
 *   (3) "another live person holds this address" has one meaning in three
 *       places (E-25): findSharedAddressNotes (ER23b), address_shared (R29,
 *       issue and card) and connect's candidate count.
 * Plus F177 condition 3: the classifier's `visitor` equals the Community
 * Visitors list's predicate (read from community.ts itself) over roll null
 * and every listed roll value, with the one documented difference asserted
 * by name.
 *
 * Every caller call that could write runs inside a rolled-back presby_app
 * transaction, so one fixture serves every caller.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/sign-in-standing.db.test.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { Row, SignInFixture } from "@/lib/testing/sign-in-fixture";
import { DIRECTORY_STATUSES } from "@/lib/directory-status";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

// drizzle/0066 section 9 (Increment 3a, Batch A2) re-creates three of these
// bodies (the core's closed list gains all_memberships; check 10 drops the
// visitor acknowledgement; connect step 10 asks for member standing), so the
// migration-text scans read 0065 then 0066 and the LAST definition of each
// function wins, as it does in the database. 0066 is found by name, not
// number (the orchestrator may renumber it at integration).
const M65 = readFileSync(path.join(process.cwd(), "drizzle", "0065_presby_sign_in_and_connect.sql"), "utf8");
const M66_FILES = readdirSync(path.join(process.cwd(), "drizzle")).filter((f) => /^\d{4}_presby_membership_standing\.sql$/.test(f));
if (M66_FILES.length !== 1) throw new Error(`expected one *_presby_membership_standing.sql, found ${M66_FILES.length}`);
const MIGRATION = M65 + "\n" + readFileSync(path.join(process.cwd(), "drizzle", M66_FILES[0]!), "utf8");
const COMMUNITY = readFileSync(path.join(process.cwd(), "src", "lib", "community.ts"), "utf8");

/** Every function body in a migration text, keyed by name (the last definition wins). */
export function functionBodies(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /create or replace function (\w+)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1]!;
    const open = /(?:^|\s)as (\$\w*\$)/m.exec(text.slice(m.index));
    if (!open) throw new Error(`no body for ${name}`);
    const tag = open[1]!;
    const start = m.index + open.index + open[0].length;
    const close = text.indexOf(tag, start);
    out.set(name, text.slice(start, close));
  }
  return out;
}

const MARKERS = {
  classifier: "presby_membership_standing(",
  r31: "m2.organization_id <> p_org",
  // drizzle/0066 section 9 (D10b): all_memberships joins the list;
  // deacons_moderator deliberately does not (the Moderator seat carries
  // parishes.assign and stays in T; F247).
  closedList: "derived_from in ('active_membership', 'all_memberships', 'session', 'diaconate')",
} as const;

/**
 * Which function bodies hold each marker. drizzle/0066 section 2 (Increment
 * 3a, DECISION-233) adds ONE other caller of the classifier, by design:
 * presby_membership_is_member_standing, the composition member standing is
 * read through. No sign-in caller is added. The same map holds for the
 * migration text (0065 then 0066) and the live catalog.
 */
const HOLDERS: Record<keyof typeof MARKERS, string[]> = {
  classifier: ["presby__person_sign_in_standing", "presby_membership_is_member_standing"],
  r31: ["presby__person_sign_in_standing"],
  closedList: ["presby__person_sign_in_standing"],
};

class Rollback extends Error {}

describe.skipIf(!hasDb)("drizzle/0065 the standing core and its callers (T-5)", () => {
  let f: SignInFixture;
  let orgA: string;
  let orgB: string;
  let full: { userId: string; personId: string; email: string };
  let noOfficers: { userId: string; personId: string; email: string };

  /** A presby_app call inside a transaction that is always rolled back. */
  async function rb(org: string | null, query: SQL): Promise<Row> {
    let out: Row | undefined;
    try {
      await f.appDb.transaction(async (tx) => {
        if (org) await tx.execute(sql`select set_config('app.current_org_id', ${org}, true)`);
        const r = await tx.execute(query);
        out = ((r as unknown as { rows?: Row[] }).rows ?? (r as unknown as Row[]))[0];
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
    return out!;
  }

  function verdict(r: Row): string {
    return r.outcome === "blocked" ? `blocked:${String(r.blocked_reason)}` : String(r.outcome);
  }

  beforeAll(async () => {
    const { createSignInFixture } = await import("@/lib/testing/sign-in-fixture");
    f = await createSignInFixture("st65");
    orgA = await f.congregation("a");
    orgB = await f.congregation("b");
    full = await f.sender(orgA, ["people.manage", "officers.manage", "directory.view", "events.view"]);
    noOfficers = await f.sender(orgA, ["people.manage", "directory.view", "events.view"]);
  });

  afterAll(async () => {
    if (f) await f.cleanup();
  });

  // ===========================================================================
  // (1) the matrix
  // ===========================================================================
  interface Expect {
    refusal: string | null;
    standing: string | null;
    authority: boolean;
    session?: boolean;
    diaconate?: boolean;
    keys?: string[];
    issue: string;
    connect: string;
    connectFactor: string;
    token: string;
    inPlace: string;
    inPlaceFactor: string;
    reader?: string;
  }

  type Build = () => Promise<string>;
  const AUTH_FREE_OK = {
    issue: "ok", connect: "connected", connectFactor: "connected",
    token: "accepted", inPlace: "accepted", inPlaceFactor: "accepted",
  };
  const AUTH = {
    connect: "needs_second_factor", connectFactor: "connected",
    token: "accepted", inPlace: "needs_second_factor", inPlaceFactor: "accepted",
  };
  function refused(r: string, issue: string, reader: string): Omit<Expect, "standing"> {
    return {
      refusal: r, authority: false, issue, connect: "declined", connectFactor: "declined",
      token: `blocked:${r}`, inPlace: `blocked:${r}`, inPlaceFactor: `blocked:${r}`, reader,
    };
  }

  const matrix: Array<[string, () => Build, Expect]> = [
    ["merged", () => async () => { const p = await f.person(orgA); await f.merge(p.id); return p.id; },
      { ...refused("person_merged", "person_merged", "person_merged"), standing: "listed" }],
    ["deceased", () => async () => (await f.person(orgA, { deceased: "2024-01-01" })).id,
      { ...refused("person_deceased", "person_deceased", "person_deceased"), standing: "listed" }],
    ["membership ended", () => async () => (await f.person(orgA, { endedOn: "2024-01-01" })).id,
      { ...refused("membership_ended", "membership_ended", "membership_ended"), standing: null }],
    ["two organizations, both live", () => async () => { const p = await f.person(orgA); await f.elsewhere(p.id, orgB); return p.id; },
      { ...refused("person_elsewhere", "needs_support", "needs_support"), standing: "listed" }],
    ["two organizations, the other ended", () => async () => { const p = await f.person(orgA); await f.elsewhere(p.id, orgB, "2023-01-01"); return p.id; },
      { ...refused("person_elsewhere", "needs_support", "needs_support"), standing: "listed" }],
    // drizzle/0066 section 9 (Increment 3a): issue no longer asks for a
    // visitor acknowledgement (check 10), and connect declines every standing
    // that is not member standing (step 10, R55); acceptance is unchanged.
    ["visitor without a roll", () => async () => (await f.person(orgA, { engagement: "visitor", roll: null })).id,
      { refusal: null, standing: "visitor", authority: false, ...AUTH_FREE_OK, connect: "declined", connectFactor: "declined" }],
    ["visitor with a roll (a member now, E-36)", () => async () => (await f.person(orgA, { engagement: "visitor", roll: "active" })).id,
      { refusal: null, standing: "listed", authority: false, ...AUTH_FREE_OK }],
    ["visitor engagement with an unlisted roll value (the documented difference)", () => async () => (await f.person(orgA, { engagement: "visitor", roll: "legacy_roll" })).id,
      { refusal: null, standing: "visitor", authority: false, ...AUTH_FREE_OK, connect: "declined", connectFactor: "declined" }],
    // drizzle/0066 section 9 (R55): inactive and moved away are declined by
    // connect like a visitor (2b connected them: only 'visitor' declined).
    ["inactive without a roll (0066, R55)", () => async () => (await f.person(orgA, { engagement: "inactive", roll: null })).id,
      { refusal: null, standing: "inactive", authority: false, ...AUTH_FREE_OK, connect: "declined", connectFactor: "declined" }],
    ["moved away without a roll (0066, R55)", () => async () => (await f.person(orgA, { engagement: "moved_away", roll: null })).id,
      { refusal: null, standing: "inactive", authority: false, ...AUTH_FREE_OK, connect: "declined", connectFactor: "declined" }],
    ["inactive WITH a roll stays listed and connects (0066: member standing)", () => async () => (await f.person(orgA, { engagement: "inactive", roll: "active" })).id,
      { refusal: null, standing: "listed", authority: false, ...AUTH_FREE_OK }],
    ["regular without a roll is listed and connects", () => async () => (await f.person(orgA, { engagement: "regular", roll: null })).id,
      { refusal: null, standing: "listed", authority: false, ...AUTH_FREE_OK }],
    ["staff anchor", () => async () => (await f.person(orgA, { engagement: "staff", roll: null })).id,
      { refusal: null, standing: "staff_anchor", authority: false, ...AUTH_FREE_OK }],
    // "unclassified engagement" left this matrix with drizzle/0066 (Increment
    // 3a, D3): memberships_engagement_status_allowed refuses any engagement
    // outside the five, so no stored row can classify as `unclassified`. The
    // classifier's `unclassified` arm is covered by the SQL cross-product in
    // src/lib/membership-standing.db.test.ts; the refusal is asserted below.
    ["elder seat", () => async () => { const p = await f.person(orgA); await f.seat(orgA, p.id); return p.id; },
      { refusal: null, standing: "listed", authority: true, session: true, keys: [], issue: "ok", ...AUTH }],
    ["future-dated elder seat (no starts_on bound)", () => async () => { const p = await f.person(orgA); await f.seat(orgA, p.id, "ruling_elder", "2099-01-01"); return p.id; },
      { refusal: null, standing: "listed", authority: true, session: true, keys: [], issue: "ok", ...AUTH }],
    ["deacon seat", () => async () => { const p = await f.person(orgA); await f.seat(orgA, p.id, "deacon"); return p.id; },
      { refusal: null, standing: "listed", authority: true, diaconate: true, keys: [], issue: "ok", ...AUTH }],
    ["ended elder seat", () => async () => { const p = await f.person(orgA); await f.seat(orgA, p.id, "ruling_elder", "2015-01-01", "2018-01-01"); return p.id; },
      { refusal: null, standing: "listed", authority: false, ...AUTH_FREE_OK }],
    ["person-arm grant the sender lacks", () => async () => { const p = await f.person(orgA); await f.personGrant(orgA, p.id, ["roles.manage"]); return p.id; },
      { refusal: null, standing: "listed", authority: true, keys: ["roles.manage"], issue: "exceeds_your_access", ...AUTH }],
    ["future-dated person-arm grant (A4)", () => async () => { const p = await f.person(orgA); await f.personGrant(orgA, p.id, ["roles.manage"], { startsOn: "2099-01-01" }); return p.id; },
      { refusal: null, standing: "listed", authority: true, keys: ["roles.manage"], issue: "exceeds_your_access", ...AUTH }],
    ["person-arm grant within the sender's own access", () => async () => { const p = await f.person(orgA); await f.personGrant(orgA, p.id, ["events.view"]); return p.id; },
      { refusal: null, standing: "listed", authority: true, keys: ["events.view"], issue: "ok", ...AUTH }],
    ["managed-group grant", () => async () => { const p = await f.person(orgA); await f.groupGrant(orgA, p.id, ["roles.manage"]); return p.id; },
      { refusal: null, standing: "listed", authority: true, keys: ["roles.manage"], issue: "exceeds_your_access", ...AUTH }],
    ["future-dated managed-group membership (A4)", () => async () => { const p = await f.person(orgA); await f.groupGrant(orgA, p.id, ["roles.manage"], { memberStartsOn: "2099-01-01" }); return p.id; },
      { refusal: null, standing: "listed", authority: true, keys: ["roles.manage"], issue: "exceeds_your_access", ...AUTH }],
    ["ended person-arm grant", () => async () => { const p = await f.person(orgA); await f.personGrant(orgA, p.id, ["roles.manage"], { endsOn: "2021-01-01" }); return p.id; },
      { refusal: null, standing: "listed", authority: false, ...AUTH_FREE_OK }],
    ["ended managed-group membership", () => async () => { const p = await f.person(orgA); await f.groupGrant(orgA, p.id, ["roles.manage"], { memberEndsOn: "2021-01-01" }); return p.id; },
      { refusal: null, standing: "listed", authority: false, ...AUTH_FREE_OK }],
    // D11 (Increment 3a): an unclassified kind can no longer be stored
    // (groups_derived_kind_check, drizzle/0066), so the A5 arm is exercised by
    // a REAL kind outside the T exclusion list: the Moderator of the Board of
    // Deacons seat, which carries authority (parishes.assign) and stays in T.
    ["a derived kind outside the T exclusion list counts in T (the Moderator seat; F247)", () => async () => { const p = await f.person(orgA); await f.groupGrant(orgA, p.id, ["roles.manage"], { derivedFrom: "deacons_moderator" }); return p.id; },
      { refusal: null, standing: "listed", authority: true, keys: ["roles.manage"], issue: "exceeds_your_access", ...AUTH }],
  ];

  it.each(matrix)("%s: the core and every caller's verdict", async (_name, build, e) => {
    const personId = await build()();
    const [{ address }] = (await f.q(sql`
      select cm.value as address from contact_methods cm
       where cm.person_id = ${personId} and cm.kind = 'email' and cm.ended_at is null`)) as Array<{ address: string }>;
    const userId = await f.user(address, { totp: true });

    // The core itself.
    const core = await f.standing(personId, orgA);
    expect(core.refusal ?? null, "core refusal").toBe(e.refusal);
    expect(core.standing ?? null, "core standing").toBe(e.standing);
    expect(core.authority_bearing, "core authority_bearing").toBe(e.authority);
    expect(core.session_seat, "core session_seat").toBe(e.session ?? false);
    expect(core.diaconate_seat, "core diaconate_seat").toBe(e.diaconate ?? false);
    if (e.keys) expect(core.permission_keys, "core permission_keys").toEqual(e.keys);
    expect((core.role_keys as string[]).length > 0, "role_keys non-empty iff a role is in T").toBe(
      e.authority && !(e.session || e.diaconate),
    );

    // Card standing: the core's standing and authority, own organization only.
    const [cardRow] = await f.card(orgA, full.userId, personId);
    expect(cardRow?.standing ?? null, "card standing").toBe(e.standing);
    expect(cardRow?.authority_bearing, "card authority").toBe(e.authority);

    // Issue (no open row yet) and connect (no open invitation to the address yet).
    const issued = await rb(orgA, sql`
      select * from presby_issue_sign_in_invitation(${personId}::uuid, ${"a".repeat(64)}, now() + interval '7 days',
             null::uuid, ${address}, false, ${full.userId}::uuid)`);
    expect(issued.outcome, "issue").toBe(e.issue);
    // drizzle/0066 section 9: no row in this matrix carries an
    // acknowledgement any more (do_not_contact is the only reason; none here).
    if (e.issue === "ok") expect(issued.ack_reasons, "no acknowledgement reason").toEqual([]);
    expect(verdict(await rb(null, sql`select * from presby_connect_signed_in_account(${userId}::uuid, false)`)), "connect").toBe(e.connect);
    expect(verdict(await rb(null, sql`select * from presby_connect_signed_in_account(${userId}::uuid, true)`)), "connect with a factor").toBe(e.connectFactor);

    // Acceptance, both presentations.
    const inv = await f.signInRow(orgA, personId, address);
    expect(verdict(await rb(null, sql`select * from presby_accept_invitation(${inv.token}, ${userId}::uuid, null, null, null)`)), "token").toBe(e.token);
    expect(verdict(await rb(null, sql`select * from presby_accept_in_place(${inv.id}::uuid, ${userId}::uuid, false)`)), "in place").toBe(e.inPlace);
    expect(verdict(await rb(null, sql`select * from presby_accept_in_place(${inv.id}::uuid, ${userId}::uuid, true)`)), "in place with a factor").toBe(e.inPlaceFactor);

    // The reader's blocked mapping: commit a token acceptance, then read.
    if (e.reader) {
      const committed = await f.accept(inv.token, { userId });
      expect(committed.outcome).toBe("blocked");
      const [state] = await f.states(orgA, full.userId, [personId]);
      expect(state!.state).toBe("blocked");
      expect(state!.outcome).toBe(e.reader);
    }
  });

  it("a Session or diaconate seat needs officers.manage to send (needs_officers_permission), whatever else holds", async () => {
    for (const office of ["ruling_elder", "deacon", "installed_pastor"]) {
      const p = await f.person(orgA, office === "installed_pastor" ? { engagement: "regular", roll: null } : {});
      await f.seat(orgA, p.id, office);
      const r = await rb(orgA, sql`
        select * from presby_issue_sign_in_invitation(${p.id}::uuid, ${"b".repeat(64)}, now() + interval '7 days',
               null::uuid, ${p.email}, false, ${noOfficers.userId}::uuid)`);
      expect(r.outcome, office).toBe("needs_officers_permission");
    }
  });

  it("derived-baseline authority (a grant on Active Membership) is outside T", async () => {
    const orgC = await f.congregation("c");
    const sender = await f.sender(orgC, ["people.manage", "officers.manage"]);
    const roleId = await f.role(orgC, ["roles.manage"]);
    await f.q(sql`
      insert into role_grants (organization_id, role_id, group_id, starts_on)
      select ${orgC}, ${roleId}, g.id, '2020-01-01' from groups g
       where g.organization_id = ${orgC} and g.derived_from = 'active_membership'`);
    const p = await f.person(orgC);
    const core = await f.standing(p.id, orgC);
    expect(core).toMatchObject({ refusal: null, standing: "listed", authority_bearing: false, role_keys: [], permission_keys: [] });
    // The sender holds roles.manage through the same baseline, so nothing exceeds.
    const r = await rb(orgC, sql`
      select * from presby_issue_sign_in_invitation(${p.id}::uuid, ${"c".repeat(64)}, now() + interval '7 days',
             null::uuid, ${p.email}, false, ${sender.userId}::uuid)`);
    expect(r.outcome).toBe("ok");
  });

  it("a grant on All Current Records (all_memberships) is outside T, and auto-connect needs no factor for it (0066 section 9, R49, EC-12)", async () => {
    const orgE = await f.congregation("e");
    const sender = await f.sender(orgE, ["people.manage", "officers.manage"]);
    const roleId = await f.role(orgE, ["roles.manage"]);
    const inserted = await f.q(sql`
      insert into role_grants (organization_id, role_id, group_id, starts_on)
      select ${orgE}, ${roleId}, g.id, '2020-01-01' from groups g
       where g.organization_id = ${orgE} and g.derived_from = 'all_memberships'
      returning id`);
    expect(inserted, "premise: the organization has All Current Records (the pair trigger made it)").toHaveLength(1);
    // A visitor and a member both hold the all_memberships row; neither is
    // authority-bearing through it.
    for (const [engagement, roll, standing] of [["regular", "active", "listed"], ["visitor", null, "visitor"]] as const) {
      const p = await f.person(orgE, { engagement, roll });
      const core = await f.standing(p.id, orgE);
      expect(core, `${engagement}`).toMatchObject({ refusal: null, standing, authority_bearing: false, role_keys: [], permission_keys: [] });
    }
    const member = await f.person(orgE);
    const userId = await f.user(member.email!);
    expect(verdict(await rb(null, sql`select * from presby_connect_signed_in_account(${userId}::uuid, false)`))).toBe("connected");
    const r = await rb(orgE, sql`
      select * from presby_issue_sign_in_invitation(${member.id}::uuid, ${"e".repeat(64)}, now() + interval '7 days',
             null::uuid, ${member.email}, false, ${sender.userId}::uuid)`);
    expect(r.outcome).toBe("ok");
  });

  it("a Session-bound tenant role is outside T (the seat gate covers it; DECISION-207's recorded consequence)", async () => {
    const orgD = await f.congregation("d");
    const roleId = await f.role(orgD, ["roles.manage"]);
    await f.q(sql`
      insert into role_grants (organization_id, role_id, group_id, starts_on)
      select ${orgD}, ${roleId}, g.id, '2020-01-01' from groups g
       where g.organization_id = ${orgD} and g.derived_from = 'session'`);
    const p = await f.person(orgD);
    await f.seat(orgD, p.id);
    const core = await f.standing(p.id, orgD);
    expect(core).toMatchObject({ session_seat: true, authority_bearing: true, role_keys: [], permission_keys: [] });
  });

  it("no membership at the organization is membership_ended (fail closed), and the person's own org standing is separate", async () => {
    const p = await f.person(orgB);
    expect(await f.standing(p.id, orgA)).toMatchObject({ refusal: "membership_ended", standing: null });
    expect(await f.standing(p.id, orgB)).toMatchObject({ refusal: null, standing: "listed" });
    // and the card answers nothing at all for a person outside the organization
    expect(await f.card(orgA, full.userId, p.id)).toEqual([]);
  });

  // ===========================================================================
  // F177 condition 3: the classifier's visitor = the Community Visitors list
  // ===========================================================================
  it("the classifier's 'visitor' equals listPredicate('visitors') over roll null and every listed roll, with exactly the one documented difference", async () => {
    const m = COMMUNITY.match(/case "visitors":[\s\S]*?return sql`([\s\S]*?)`;/);
    expect(m, "community.ts visitors predicate").not.toBeNull();
    const predicate = m![1]!.replace(/\s+/g, " ").trim();
    expect(predicate).not.toMatch(/\$\{/); // a literal predicate, safe to evaluate as SQL text

    const rolls = [null, ...DIRECTORY_STATUSES, "legacy_roll"] as const;
    const engagements = ["visitor", "regular", "staff", "inactive", "moved_away"] as const;
    const values = rolls.flatMap((r) => engagements.map((e) => sql`(${r}::text, ${e}::text)`));
    const rows = await f.q(sql`
      select x.current_roll, x.engagement_status,
             (presby_membership_standing(x.current_roll, x.engagement_status) = 'visitor') as classifier,
             (select ${sql.raw(predicate)}
                from (select x.engagement_status, x.current_roll, null::date as ended_on, x.person_id) m,
                     (select null::uuid as merged_into_id, null::date as date_of_death) p) as list
        from (select v.*, null::uuid as person_id from (values ${sql.join(values, sql`, `)}) v(current_roll, engagement_status)) x`);
    const differ = rows.filter((r) => r.classifier !== r.list);
    expect(differ.map((r) => `${String(r.current_roll)}/${String(r.engagement_status)}`)).toEqual(["legacy_roll/visitor"]);
    const knownRolls = rows.filter((r) => r.current_roll !== "legacy_roll");
    expect(knownRolls.every((r) => r.classifier === r.list)).toBe(true);
  });

  it("the classifier's listed rolls are exactly DIRECTORY_STATUSES, and its values and order are R50's", async () => {
    const body = MIGRATION.slice(MIGRATION.indexOf("create or replace function presby_membership_standing("));
    const listed = body.match(/p_current_roll in \(([^)]*)\)/)![1]!;
    expect([...listed.matchAll(/'(\w+)'/g)].map((x) => x[1])).toEqual([...DIRECTORY_STATUSES]);
    const order = [...body.slice(0, body.indexOf("$$;")).matchAll(/then '(\w+)'|else '(\w+)'/g)].map((x) => x[1] ?? x[2]);
    expect(order).toEqual(["listed", "staff_anchor", "visitor", "inactive", "unclassified"]);
    const [row] = await f.q(sql`
      select p.provolatile, p.prosecdef, p.proconfig, l.lanname,
             has_function_privilege('presby_app', p.oid, 'execute') as app
        from pg_proc p join pg_language l on l.oid = p.prolang
       where p.proname = 'presby_membership_standing'`);
    expect(row).toMatchObject({ provolatile: "i", prosecdef: false, proconfig: null, lanname: "sql", app: true });
  });

  // ===========================================================================
  // (2) migration-text and live-catalog scans
  // ===========================================================================
  it("migration text (0065 then 0066, last definition wins): the R31 exists and the closed derived list occur only in the core's body; the classifier call also in 0066's composition", () => {
    const bodies = functionBodies(MIGRATION);
    expect(bodies.size).toBeGreaterThan(15);
    for (const [label, marker] of Object.entries(MARKERS) as Array<[keyof typeof MARKERS, string]>) {
      const holders = [...bodies.entries()].filter(([, b]) => b.includes(marker)).map(([n]) => n);
      expect(holders.sort(), label).toEqual([...HOLDERS[label]].sort());
    }
    // D10b: the Moderator seat is NOT excluded from T.
    expect(bodies.get("presby__person_sign_in_standing")).not.toContain("deacons_moderator");
  });

  it("live catalog: the same three markers occur only in the core (and the classifier call also in 0066's classifier layer)", async () => {
    const LIVE_HOLDERS = HOLDERS;
    for (const [label, marker] of Object.entries(MARKERS) as Array<[keyof typeof MARKERS, string]>) {
      const rows = await f.q(sql`
        select p.proname from pg_proc p
         where p.pronamespace = 'public'::regnamespace and strpos(p.prosrc, ${marker}) > 0
         order by 1`);
      expect(rows.map((r) => r.proname), label).toEqual(LIVE_HOLDERS[label]);
    }
  });

  it("an engagement outside the five can no longer be stored, so `unclassified` is unreachable from rows (drizzle/0066, D3)", async () => {
    const p = await f.person(orgA);
    let caught: unknown;
    try {
      await f.q(sql`update memberships set engagement_status = 'fixture_unknown' where person_id = ${p.id}`);
    } catch (err) {
      caught = err;
    }
    const chain: unknown[] = [];
    for (let cur: unknown = caught; cur && chain.length < 6; cur = (cur as { cause?: unknown }).cause) chain.push(cur);
    expect(chain.some((e) => (e as { constraint?: unknown }).constraint === "memberships_engagement_status_allowed")).toBe(true);
  });

  it("the scan can fail: an offending sample body is detected", () => {
    const sample = `create or replace function presby_offender() returns void language plpgsql as $$ begin perform 1 from memberships m2 where m2.organization_id <> p_org; end $$;`;
    const holders = [...functionBodies(MIGRATION + "\n" + sample).entries()].filter(([, b]) => b.includes(MARKERS.r31)).map(([n]) => n);
    expect(holders.sort()).toEqual(["presby__person_sign_in_standing", "presby_offender"]);
  });

  it("the core reads no platform predicate and no contact proof (R43, E-24)", () => {
    const core = functionBodies(MIGRATION).get("presby__person_sign_in_standing")!;
    expect(core).not.toMatch(/is_platform_admin|verified_at|contact_methods/);
  });

  // ===========================================================================
  // (3) E-25: one meaning of "another live person holds this address"
  // ===========================================================================
  describe("E-25: findSharedAddressNotes, address_shared and connect's candidate count agree", () => {
    async function sharedNotes(org: string, personId: string, address: string): Promise<number> {
      const { findSharedAddressNotes } = await import("@/lib/contact-methods/store");
      return f.appDb.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_org_id', ${org}, true)`);
        const notes = await findSharedAddressNotes(tx as never, personId, [address]);
        return notes.length;
      });
    }

    async function threeWays(holderOptions: { deceased?: string; endedOn?: string } | null) {
      const org = await f.congregation(`e${Math.floor(Math.random() * 1e6)}`);
      const sender = await f.sender(org, ["people.manage", "officers.manage", "directory.view", "events.view"]);
      const subject = await f.person(org);
      if (holderOptions) {
        const other = await f.person(org, { email: false, ...holderOptions });
        await f.addEmail(other.id, subject.email!);
      }
      const card = (await f.card(org, sender.userId, subject.id))[0]!;
      const issue = await rb(org, sql`
        select * from presby_issue_sign_in_invitation(${subject.id}::uuid, ${"d".repeat(64)}, now() + interval '7 days',
               null::uuid, ${subject.email}, false, ${sender.userId}::uuid)`);
      const userId = await f.user(subject.email!);
      const connect = await rb(null, sql`select * from presby_connect_signed_in_account(${userId}::uuid, false)`);
      return {
        card: Boolean(card.address_shared),
        issue: issue.outcome === "address_shared",
        connect: connect.outcome !== "connected",
        notes: (await sharedNotes(org, subject.id, subject.email!)) > 0,
      };
    }

    it("a live person at the organization shares the address: all agree it is shared", async () => {
      expect(await threeWays({})).toEqual({ card: true, issue: true, connect: true, notes: true });
    });

    it("nobody else holds it: all agree it is not shared", async () => {
      expect(await threeWays(null)).toEqual({ card: false, issue: false, connect: false, notes: false });
    });

    it("the other holder's membership ended: all agree it is not shared", async () => {
      expect(await threeWays({ endedOn: "2024-01-01" })).toEqual({ card: false, issue: false, connect: false, notes: false });
    });

    it("the other holder is deceased: all four agree it is not shared (findSharedAddressNotes gained date_of_death is null in Batch B2)", async () => {
      expect(await threeWays({ deceased: "2024-01-01" })).toEqual({ card: false, issue: false, connect: false, notes: false });
    });
  });
});
