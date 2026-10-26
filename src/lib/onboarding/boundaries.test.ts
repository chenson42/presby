/**
 * Source-scan boundaries for the invitation flow (docs/work-log/
 * 2026-10-21-invitations.md, Phase 2 S4 and addendum D-3). Pure file reads: no
 * database, always run. These pin the properties that keep an anonymous,
 * internet-facing route away from the owner connection and keep the one
 * identity the acceptance trusts coming from the session.
 *
 *   1. ACCEPT NEVER TOUCHES THE OWNER CONNECTION. `accept.ts` and everything
 *      under `src/app/(invite)/` never import `getPlatformDb`, and never import
 *      `issue.ts` (the platform-connection side). The only database door on the
 *      anonymous path is presby_app EXECUTE on the two definer functions.
 *   2. ISSUE IS ADMIN-ONLY. `issue.ts` is imported only from `(admin)` code (the
 *      `src/lib/giving/` idiom): a platform operator's connection is never
 *      reachable from a tenant or public surface.
 *   3. D-3: `previewInvitation(token, userId)`'s `userId`, and the existing-
 *      account `userId` handed to `acceptInvitation`, come ONLY from the
 *      `auth()` session - never from form data, the query or a cookie.
 *   4. The `(invite)` route group has no layout and no loading boundary (a
 *      Suspense boundary would flush a 200 before a page that redirects).
 *   6. DESIGNATION HOLDERS (docs/work-log/2026-10-22-designation-revoke.md,
 *      DECISION-194/196). `designation-holders.ts` is the platform-connection
 *      library for the holder list and the revoke: imported only from (admin),
 *      holds `getPlatformDb` and never the tenant `db`, selects no contact or
 *      email column. The platform side never writes `role_grants.ends_on`
 *      except through the owner-only SQL function (no `update role_grants`, no
 *      `.update(roleGrants)`, no `ends_on` assignment under `src/lib/onboarding/`
 *      or `src/app/(admin)/`); `src/lib/role-grants.ts` (the tenant module)
 *      never imports `getPlatformDb`; and the two pure files the client
 *      components read (`-types`, `-copy`, plus `-rows`) import nothing from
 *      the database, `server-only` or the library.
 *   5. THE HAND-OFF COOKIE IS NAMED ONLY WHERE IT IS READ OR WRITTEN (Phase 2
 *      addendum 2). It is `Path=/` now, so every platform request carries it for
 *      up to 30 minutes; only this scan keeps the reading of it confined to
 *      `(invite)`. The name may be referenced only in `invite-cookie.ts`,
 *      `(invite)/actions.ts` and `(invite)/invite/page.tsx`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const isTest = (file: string) => /\.(test|spec)\.(ts|tsx)$/.test(file);
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (file: string) => stripComments(readFileSync(file, "utf8"));
const rel = (file: string) => path.relative(ROOT, file);

const ALL = walk(SRC);
const NON_TEST = ALL.filter((f) => !isTest(f));
const INVITE_TREE = path.join(SRC, "app", "(invite)");
const INVITE_FILES = walk(INVITE_TREE).filter((f) => !isTest(f));

describe("S4: the anonymous accept path never holds the owner connection", () => {
  it("accept.ts imports db (presby_app) and never getPlatformDb or issue.ts", () => {
    const code = read(path.join(SRC, "lib/onboarding/accept.ts"));
    expect(code).toMatch(/import\s*\{\s*db\s*\}\s*from\s*"@\/lib\/db"/);
    expect(code).not.toMatch(/getPlatformDb/);
    expect(code).not.toMatch(/onboarding\/issue|from\s+"\.\/issue"/);
  });

  it("nothing under src/app/(invite)/ imports getPlatformDb or issue.ts", () => {
    expect(INVITE_FILES.length).toBeGreaterThan(0);
    const offenders = INVITE_FILES.filter((f) => {
      const code = read(f);
      return /getPlatformDb/.test(code) || /onboarding\/issue/.test(code);
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it("the invitation token never reaches a database module other than through accept.ts", () => {
    const offenders = INVITE_FILES.filter((f) => /from\s+"@\/lib\/db(\/[^"]*)?"/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("the (invite) route group has no layout.tsx and no loading.tsx", () => {
    const names = INVITE_FILES.map((f) => path.basename(f));
    expect(names).not.toContain("layout.tsx");
    expect(names).not.toContain("loading.tsx");
    // And nothing there emits brand tokens (the group is un-brandable).
    expect(INVITE_FILES.filter((f) => /BrandTokens/.test(read(f))).map(rel)).toEqual([]);
  });
});

describe("S4: issue.ts is imported only from (admin) code", () => {
  it("every non-test importer of the issue module lives under src/app/(admin)/ or is a sibling in src/lib/onboarding", () => {
    const importers = NON_TEST.filter((f) => {
      if (f === path.join(SRC, "lib/onboarding/issue.ts")) return false;
      const code = read(f);
      return (
        /from\s+"@\/lib\/onboarding\/issue"/.test(code) ||
        (f.startsWith(path.join(SRC, "lib/onboarding") + path.sep) && /from\s+"\.\/issue"/.test(code))
      );
    });
    const outside = importers
      .filter((f) => !f.startsWith(path.join(SRC, "app", "(admin)") + path.sep))
      .map(rel);
    expect(outside).toEqual([]);
    // And it IS used from (admin) - the guard is not vacuous.
    expect(importers.map(rel)).toContain(rel(path.join(SRC, "app/(admin)/admin/organizations/[id]/actions.ts")));
  });

  it("issue.ts itself holds the platform connection and never the tenant one", () => {
    const code = read(path.join(SRC, "lib/onboarding/issue.ts"));
    expect(code).toMatch(/getPlatformDb/);
    expect(code).not.toMatch(/import\s*\{[^}]*\bdb\b[^}]*\}\s*from\s*"@\/lib\/db"/);
  });
});

describe("D-3: identities come only from the auth() session", () => {
  it("every non-test caller of previewInvitation passes a session-derived second argument", () => {
    const callers = NON_TEST.filter(
      (f) => f !== path.join(SRC, "lib/onboarding/accept.ts") && /\bpreviewInvitation\(/.test(read(f)),
    );
    for (const file of callers) {
      const code = read(file);
      const calls = [...code.matchAll(/\bpreviewInvitation\(([^)]*)\)/g)];
      expect(calls.length, rel(file)).toBeGreaterThan(0);
      for (const [, args] of calls) {
        const parts = args!.split(",").map((p) => p.trim());
        expect(parts.length, `${rel(file)}: previewInvitation needs the session id as its second argument`).toBe(2);
        expect(parts[1], rel(file)).toMatch(/\bsession\b/);
        expect(parts[1], rel(file)).not.toMatch(/formData|searchParams|cookies|query|params/i);
      }
    }
  });

  it("every existing-account acceptInvitation call takes userId from the session", () => {
    const callers = NON_TEST.filter(
      (f) => f !== path.join(SRC, "lib/onboarding/accept.ts") && /kind:\s*"existing_account"/.test(read(f)),
    );
    expect(callers.map(rel)).toContain(rel(path.join(INVITE_TREE, "actions.ts")));
    for (const file of callers) {
      const code = read(file);
      for (const m of code.matchAll(/kind:\s*"existing_account"[\s\S]{0,80}?userId:\s*([^,\n]+)/g)) {
        expect(m[1], rel(file)).toMatch(/\bsession\b/);
      }
    }
  });

  it("the actions never read a user id or an email out of form data", () => {
    const code = read(path.join(INVITE_TREE, "actions.ts"));
    expect(code).not.toMatch(/formData\.get\(\s*["'](userId|email|organizationId|organization|slug)["']\s*\)/);
  });
});

describe("addendum 2: the hand-off cookie's name is referenced only where it is used", () => {
  const ALLOWED = new Set(
    [
      "src/lib/onboarding/invite-cookie.ts",
      "src/app/(invite)/actions.ts",
      "src/app/(invite)/invite/page.tsx",
    ].map((f) => path.join(ROOT, f)),
  );
  // The literal names (either spelling) and the helper that resolves them.
  const NAMES = /invite_token|__Host-invite_token|inviteTokenCookieName/;

  it("nothing outside the three allowed files names the cookie (comments excluded)", () => {
    const offenders = NON_TEST.filter((f) => !ALLOWED.has(f) && NAMES.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("the literal cookie names live in invite-cookie.ts and nowhere else; the other two files go through inviteTokenCookieName()", () => {
    const literalHolders = NON_TEST.filter((f) => /["'`](?:__Host-)?invite_token["'`]/.test(read(f))).map(rel);
    expect(literalHolders).toEqual([rel(path.join(SRC, "lib/onboarding/invite-cookie.ts"))]);
    for (const file of [path.join(INVITE_TREE, "actions.ts"), path.join(INVITE_TREE, "invite", "page.tsx")]) {
      expect(read(file), rel(file)).toMatch(/inviteTokenCookieName\(/);
    }
  });

  it("the proxy never reads the cookie (it stays a pure function of host, path and session claims)", () => {
    expect(read(path.join(SRC, "proxy.ts"))).not.toMatch(NAMES);
    expect(read(path.join(SRC, "proxy.ts"))).not.toMatch(/invite-cookie/);
  });

  it("no module outside the allowed three imports the cookie module", () => {
    const importers = NON_TEST.filter((f) => /from\s+"@\/lib\/onboarding\/invite-cookie"/.test(read(f)));
    expect(importers.filter((f) => !ALLOWED.has(f)).map(rel)).toEqual([]);
    expect(importers.map(rel).sort()).toEqual(
      [path.join(INVITE_TREE, "actions.ts"), path.join(INVITE_TREE, "invite", "page.tsx")].map(rel).sort(),
    );
  });
});

describe("S4: designation-holders.ts is imported only from (admin) code (DECISION-196)", () => {
  const LIB = path.join(SRC, "lib/onboarding/designation-holders.ts");

  it("every non-test importer of the library lives under src/app/(admin)/", () => {
    const importers = NON_TEST.filter((f) => {
      if (f === LIB) return false;
      const code = read(f);
      return (
        /from\s+"@\/lib\/onboarding\/designation-holders"/.test(code) ||
        (f.startsWith(path.join(SRC, "lib/onboarding") + path.sep) && /from\s+"\.\/designation-holders"/.test(code))
      );
    });
    const outside = importers
      .filter((f) => !f.startsWith(path.join(SRC, "app", "(admin)") + path.sep))
      .map(rel);
    expect(outside).toEqual([]);
    // And it IS used from (admin): the guard is not vacuous.
    const names = importers.map(rel);
    expect(names).toContain(rel(path.join(SRC, "app/(admin)/admin/organizations/[id]/actions.ts")));
    expect(names).toContain(rel(path.join(SRC, "app/(admin)/admin/organizations/[id]/page.tsx")));
  });

  it("holds the platform connection and never the tenant one", () => {
    const code = read(LIB);
    expect(code).toMatch(/getPlatformDb/);
    expect(code).not.toMatch(/import\s*\{[^}]*\bdb\b[^}]*\}\s*from\s*"@\/lib\/db"/);
    expect(code).not.toMatch(/withOrgContext/);
  });

  it("the name select names no contact or email column, and no group member is name-resolved", () => {
    const code = read(LIB);
    expect(code).not.toMatch(/contactMethods|contact_methods/);
    // The only people columns selected are the three name columns plus the id.
    const select = /\.select\(\{([\s\S]*?)\}\)\s*\.from\(people\)/.exec(code);
    expect(select, "the people name select").not.toBeNull();
    const columns = [...select![1]!.matchAll(/(\w+)\s*:/g)].map((m) => m[1]).sort();
    expect(columns).toEqual(["firstName", "id", "lastName", "preferredName"]);
    // Names are resolved for the person-arm subject ids only.
    expect(code).toMatch(/inArray\(people\.id,\s*personSubjectIds\)/);
    // No SQL here selects an email column.
    expect(code).not.toMatch(/select[^;`]*\bemail\b/i);
  });

  it("the platform side never writes role_grants.ends_on: no update of role_grants under src/lib/onboarding/ or src/app/(admin)/", () => {
    const scoped = NON_TEST.filter(
      (f) =>
        f.startsWith(path.join(SRC, "lib/onboarding") + path.sep) ||
        f.startsWith(path.join(SRC, "app", "(admin)") + path.sep),
    );
    expect(scoped.length).toBeGreaterThan(0);
    const offenders = scoped
      .filter((f) => {
        const code = read(f);
        return (
          /update\s+role_grants/i.test(code) ||
          /\.update\(\s*roleGrants\s*\)/.test(code) ||
          /\bends_on\s*=(?!=)/.test(code)
        );
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("src/lib/role-grants.ts (the tenant module) never imports getPlatformDb", () => {
    expect(read(path.join(SRC, "lib/role-grants.ts"))).not.toMatch(/getPlatformDb/);
  });

  it("the pure files the client components read import nothing from the database, server-only or the library", () => {
    for (const name of [
      "designation-holder-types.ts",
      "designation-holder-copy.ts",
      "designation-holder-rows.ts",
      "invitation-copy.ts",
    ]) {
      const code = read(path.join(SRC, "lib/onboarding", name));
      expect(code, name).not.toMatch(/@\/lib\/db/);
      expect(code, name).not.toMatch(/server-only/);
      expect(code, name).not.toMatch(/designation-holders"/);
      expect(code, name).not.toMatch(/audit-tx|getPlatformDb/);
    }
    // The types file has NO imports at all (client-safe by construction).
    expect(read(path.join(SRC, "lib/onboarding/designation-holder-types.ts"))).not.toMatch(/^\s*import\b/m);
  });

  it("the client components import types and copy, never the server-only library", () => {
    const dir = path.join(SRC, "app/(admin)/admin/organizations/[id]");
    for (const name of [
      "designation-holder-list.tsx",
      "revoke-holder-dialog.tsx",
      "founding-administrator-section.tsx",
      "treasurer-designation-section.tsx",
    ]) {
      const code = read(path.join(dir, name));
      expect(code, name).toMatch(/^"use client"|^\s*"use client"/m);
      expect(code, name).not.toMatch(/onboarding\/designation-holders"/);
      expect(code, name).not.toMatch(/@\/lib\/db/);
    }
  });
});

// ---------------------------------------------------------------------------
// Community Increment 2b, Batch B1 (docs/work-log/2026-10-22-founding-admin-
// directory.md, Phase 3 amendment 2 section 7.4, T-11; E-4, E-24, E-30, E-39).
// Address proof and auto-connect have a handful of call sites, and the
// properties that make them safe are properties of WHERE they are called. These
// are tripwires, not the control (the definers and the DB tests are): they catch
// the next file that quietly breaks a rule. Every scan below proves it can fail
// with a deliberately offending sample.
// ---------------------------------------------------------------------------

const AUTH_TS = path.join(SRC, "auth.ts");
const ONBOARDING = path.join(SRC, "lib/onboarding");
const CONNECT_TS = path.join(ONBOARDING, "connect.ts");
const EMAIL_PROOF_TS = path.join(SRC, "lib/auth/email-proof.ts");
const EMAIL_CHANGE_TS = path.join(SRC, "lib/auth/email-change.ts");
const VERIFY_EMAIL_PAGE = path.join(SRC, "app/(email-verify)/account/verify-email/[token]/page.tsx");
const NO_ORG_ACTIONS = path.join(SRC, "app/no-organization/actions.ts");
const NO_ORG_DIR = path.join(SRC, "app/no-organization");

/**
 * The non-test, comment-stripped application files that contain `pattern`. Test
 * support (`src/lib/testing/`) writes fixtures on the owner connection and calls
 * the definers directly on purpose, so it is excluded, as in the other scans.
 */
function namers(pattern: RegExp): string[] {
  const testing = path.join(SRC, "lib/testing") + path.sep;
  return NON_TEST.filter((f) => !f.startsWith(testing) && pattern.test(read(f)));
}

describe("2b B1: connect has two call sites and one SQL door", () => {
  it("connectSignedInAccount is referenced only by src/auth.ts, the Check-again action and its own module", () => {
    const found = namers(/\bconnectSignedInAccount\b/);
    const allowed = new Set([AUTH_TS, NO_ORG_ACTIONS, CONNECT_TS]);
    expect(found.filter((f) => !allowed.has(f)).map(rel)).toEqual([]);
    expect(found).toContain(AUTH_TS);
    expect(found).toContain(CONNECT_TS);
  });

  it("presby_connect_signed_in_account is named in exactly connect.ts", () => {
    expect(namers(/presby_connect_signed_in_account/).map(rel)).toEqual([rel(CONNECT_TS)]);
  });

  it("src/auth.ts calls it once, with via 'sign_in' and no second-factor flag", () => {
    const code = read(AUTH_TS);
    expect([...code.matchAll(/connectSignedInAccount\(/g)]).toHaveLength(1);
    const call = /connectSignedInAccount\(\{([\s\S]*?)\}\)/.exec(code);
    expect(call, "the call").not.toBeNull();
    expect(call![1]).toMatch(/via:\s*"sign_in"/);
    expect(call![1]).not.toMatch(/secondFactor/);
    expect(call![1]).toMatch(/userId:\s*user\.id/);
  });

  it("the Check-again action, once it exists, takes the user id and the factor flag from the session only (E-30)", () => {
    let source: string;
    try {
      source = read(NO_ORG_ACTIONS);
    } catch {
      return; // B2 adds the action; this scan engages when it lands
    }
    for (const m of source.matchAll(/connectSignedInAccount\(\{([\s\S]*?)\}\)/g)) {
      expect(m[1]).toMatch(/userId:\s*session\.user\.id/);
      expect(m[1]).toMatch(/secondFactorVerified:\s*session\.user\.twoFactorVerified\s*===\s*true/);
      expect(m[1]).not.toMatch(/formData|searchParams|cookies|params/i);
    }
  });
});

describe("2b B1: address proof is recorded in one place, behind the Google test (E-4)", () => {
  it("recordGoogleEmailProof is referenced only by src/auth.ts and its own module", () => {
    const found = namers(/\brecordGoogleEmailProof\b/);
    expect(found.filter((f) => f !== AUTH_TS && f !== EMAIL_PROOF_TS).map(rel)).toEqual([]);
    expect(found).toContain(AUTH_TS);
  });

  it("the call in src/auth.ts sits in the same condition as the provider === 'google' test and the strict claim check", () => {
    const code = read(AUTH_TS);
    expect([...code.matchAll(/recordGoogleEmailProof\(/g)]).toHaveLength(1);
    expect(proofCallIsGuarded(code)).toBe(true);
  });

  it("presby_record_google_email_proof is named only in email-proof.ts, and presby_complete_email_change only in email-change.ts", () => {
    expect(namers(/presby_record_google_email_proof/).map(rel)).toEqual([rel(EMAIL_PROOF_TS)]);
    expect(namers(/presby_complete_email_change/).map(rel)).toEqual([rel(EMAIL_CHANGE_TS)]);
  });

  it("completeEmailChange is referenced only by its module and the verify-email page", () => {
    const found = namers(/\bcompleteEmailChange\b/);
    expect(found.filter((f) => f !== EMAIL_CHANGE_TS && f !== VERIFY_EMAIL_PAGE).map(rel)).toEqual([]);
    expect(found).toContain(VERIFY_EMAIL_PAGE);
  });

  it("the verify-email page no longer writes users itself (the definer stamps the new address)", () => {
    const code = read(VERIFY_EMAIL_PAGE);
    expect(code).not.toMatch(/\.update\(\s*users\s*\)|update\s+users\b|@\/lib\/db\b/);
  });

  it("the scan can fail: an unguarded call, a call guarded by another provider, and a call without the claim check are all refused", () => {
    expect(proofCallIsGuarded('if (account?.provider === "google" && isEmailClaimVerified(profile?.email_verified)) { await recordGoogleEmailProof({}); }')).toBe(true);
    expect(proofCallIsGuarded("await recordGoogleEmailProof({ userId, address });")).toBe(false);
    expect(proofCallIsGuarded('if (account?.provider === "credentials" && isEmailClaimVerified(x)) { await recordGoogleEmailProof({}); }')).toBe(false);
    expect(proofCallIsGuarded('if (account?.provider === "google") { await recordGoogleEmailProof({}); }')).toBe(false);
    expect(proofCallIsGuarded('if (account?.provider === "google" && isEmailClaimVerified(x)) { y(); } await recordGoogleEmailProof({});')).toBe(false);
  });
});

/**
 * True when the (single) `recordGoogleEmailProof(` call is still INSIDE an
 * `if (...) {` block whose condition names the Google provider and the strict
 * claim predicate. (A guard whose block closed before the call does not count.)
 */
function proofCallIsGuarded(source: string): boolean {
  const call = source.indexOf("recordGoogleEmailProof(");
  if (call < 0) return false;
  const window = source.slice(Math.max(0, call - 600), call);
  const provider = window.lastIndexOf('provider === "google"');
  if (provider < 0) return false;
  const ifAt = window.lastIndexOf("if (", provider);
  if (ifAt < 0) return false;
  const fromGuard = window.slice(ifAt);
  if (!/isEmailClaimVerified\(/.test(fromGuard)) return false;
  const opens = (fromGuard.match(/\{/g) ?? []).length;
  const closes = (fromGuard.match(/\}/g) ?? []).length;
  return opens > closes;
}

describe("2b B1: nothing here reads an update payload or imports the verification grant (DECISION-230, E-39)", () => {
  const TWO_FACTOR_SURFACE = /two-factor-grant|\bwithTwoFactorGrant\b|\btakeTwoFactorGrant\b/;
  const PAYLOAD_READ = /trigger\s*===?\s*["']update["']|\bunstable_update\(\s*\{[^}]/;

  function filesOfTheFeature(): string[] {
    const files = [CONNECT_TS, EMAIL_PROOF_TS, EMAIL_CHANGE_TS, path.join(ONBOARDING, "in-place.ts")];
    const out = files.filter((f) => {
      try {
        statSync(f);
        return true;
      } catch {
        return false; // in-place.ts arrives in B2
      }
    });
    return [...out, ...walk(NO_ORG_DIR).filter((f) => !isTest(f))];
  }

  it("no connect, proof, email-change, in-place or no-organization file imports two-factor-grant or passes data to unstable_update", () => {
    const files = filesOfTheFeature();
    expect(files.length).toBeGreaterThanOrEqual(4);
    const offenders = files.filter((f) => TWO_FACTOR_SURFACE.test(read(f)) || PAYLOAD_READ.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("the scan can fail: a grant import, a grant call and a non-empty update are all caught", () => {
    for (const sample of [
      'import { withTwoFactorGrant } from "@/lib/auth/two-factor-grant";',
      "takeTwoFactorGrant(id)",
      "await unstable_update({ user: { twoFactorVerified: true } });",
      'if (trigger === "update") { token.x = session.y; }',
    ]) {
      expect(TWO_FACTOR_SURFACE.test(sample) || PAYLOAD_READ.test(sample), sample).toBe(true);
    }
    expect(PAYLOAD_READ.test("await unstable_update({});")).toBe(false);
  });

  it("src/auth.ts keeps the sign-in branch's proof and connect between ensureDefaultRole and the two-factor requirement (E-12)", () => {
    const code = read(AUTH_TS);
    const order = ["await ensureDefaultRole(", "recordGoogleEmailProof(", "connectSignedInAccount(", "computeEffectiveTwoFactor("].map((s) => code.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("2b B1: scripts/seed.ts creates stamped users on the owner connection (orchestrator ruling 1 on Batch A1)", () => {
  const SEED = path.join(ROOT, "scripts/seed.ts");
  const INSERTERS = (source: string) => [...source.matchAll(/(\w+)\s*\.insert\(\s*schema\.users\s*\)/g)].map((m) => m[1]);

  it("every users insert in seed.ts runs on platformDb, never on db (a non-owner role may not stamp email_verified, drizzle/0065 section 3)", () => {
    const inserters = INSERTERS(readFileSync(SEED, "utf8"));
    expect(inserters.length).toBeGreaterThanOrEqual(3);
    expect(inserters.filter((i) => i !== "platformDb")).toEqual([]);
  });

  it("the scan can fail: an insert on the tenant connection is caught", () => {
    expect(INSERTERS("await db\n      .insert(schema.users)\n      .values({})")).toEqual(["db"]);
    expect(INSERTERS("await platformDb.insert(schema.users).values({})")).toEqual(["platformDb"]);
  });
});

// ---------------------------------------------------------------------------
// Community Increment 2b, Batch B2 (Phase 3 "Library > Boundaries"; amendment 2
// sections 7.2 and 7.4, T-11; E-24, E-30, E-39). The congregation's own sign-in
// invitation has one library, one set of definers, one in-place acceptance and
// one listing; the properties that keep them safe are properties of WHERE they
// are named and what they import. Tripwires, not the control (the definers and
// the DB tests are). Every scan proves it can fail with an offending sample.
// ---------------------------------------------------------------------------

const ORG_INVITE_TS = path.join(ONBOARDING, "org-invite.ts");
const IN_PLACE_TS = path.join(ONBOARDING, "in-place.ts");
const ACCEPT_TS = path.join(ONBOARDING, "accept.ts");
const NO_ORG_PAGE = path.join(NO_ORG_DIR, "page.tsx");

describe("2b B2: org-invite.ts is the congregation's side only, and the only file that names its definers", () => {
  const code = read(ORG_INVITE_TS);

  it("holds presby_app through withOrgContext: never getPlatformDb, never the platform issue module", () => {
    expect(code).toMatch(/withOrgContext/);
    expect(code).not.toMatch(/getPlatformDb/);
    expect(code).not.toMatch(/from\s+["']\.\/issue["']|onboarding\/issue/);
  });

  it("never reads users, the invitation table or the contact table (the sender's own row is read in SQL by the definer, DECISION-189; the address comes through contact-methods/reader.ts)", () => {
    expect(code).not.toMatch(/\bfrom\s+users\b|\bjoin\s+users\b/i);
    expect(code).not.toMatch(/accountInvitations|\bfrom\s+account_invitations\b|\bjoin\s+account_invitations\b/i);
    expect(code).not.toMatch(/contact_methods|contactMethods|presby_person_email/);
    expect(code).toMatch(/@\/lib\/contact-methods\/reader/);
  });

  it("touches email_queue only through insertQueueRowInTx, cancelQueuedEmail and attemptQueuedSend", () => {
    expect(code).not.toMatch(/emailQueue|\bemail_queue\b/);
    const queueImports = /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/email\/queue["']/.exec(code);
    expect(queueImports, "the queue import").not.toBeNull();
    expect(queueImports![1]!.split(",").map((s) => s.trim()).filter(Boolean).sort()).toEqual(
      ["attemptQueuedSend", "cancelQueuedEmail", "insertQueueRowInTx"].sort(),
    );
  });

  it("writes its audit rows with insertAuditRow in the transaction, never recordAudit() (a failed audit insert must fail the change)", () => {
    expect(code).toMatch(/insertAuditRow\(tx,/);
    expect(code).not.toMatch(/recordAudit\(/);
  });

  it("the five definers are named in exactly org-invite.ts", () => {
    for (const fn of [
      "presby_issue_sign_in_invitation",
      "presby_resend_sign_in_invitation",
      "presby_revoke_sign_in_invitation",
      "presby_sign_in_invitation_states",
      "presby_sign_in_card_standing",
    ]) {
      expect(namers(new RegExp(fn)).map(rel), fn).toEqual([rel(ORG_INVITE_TS)]);
    }
  });

  it("org-invite.ts is imported only from the tenant portal (src/app/(org)/): never (admin), (invite), no-organization or src/auth.ts", () => {
    const importers = NON_TEST.filter((f) => f !== ORG_INVITE_TS && /@\/lib\/onboarding\/org-invite|from\s+["']\.\/org-invite["']/.test(read(f)));
    expect(importers.length).toBeGreaterThan(0);
    const outside = importers.filter((f) => !f.startsWith(path.join(SRC, "app", "(org)") + path.sep)).map(rel);
    expect(outside).toEqual([]);
  });

  it("the scan can fail: a platform import, a users read and a contact-table read are all caught", () => {
    expect(/getPlatformDb/.test('import { getPlatformDb } from "@/lib/db";')).toBe(true);
    expect(/\bfrom\s+users\b|\bjoin\s+users\b/i.test("select 1 from users u where u.id = x")).toBe(true);
    expect(/contact_methods|contactMethods/.test("select value from contact_methods")).toBe(true);
    expect(/emailQueue|\bemail_queue\b/.test("insert into email_queue")).toBe(true);
  });
});

describe("2b B2: the in-place acceptance and the listing each have one TypeScript door and one SQL door", () => {
  it("presby_accept_in_place is named in exactly accept.ts, and presby_list_invitations_for_account in exactly in-place.ts", () => {
    expect(namers(/presby_accept_in_place/).map(rel)).toEqual([rel(ACCEPT_TS)]);
    expect(namers(/presby_list_invitations_for_account/).map(rel)).toEqual([rel(IN_PLACE_TS)]);
  });

  it("acceptInvitationInPlace is referenced only by accept.ts and the no-organization action; listInvitationsForAccount only by in-place.ts and the no-organization page", () => {
    const accept = namers(/\bacceptInvitationInPlace\b/);
    expect(accept.filter((f) => f !== ACCEPT_TS && f !== NO_ORG_ACTIONS).map(rel)).toEqual([]);
    expect(accept).toContain(NO_ORG_ACTIONS);
    const listing = namers(/\blistInvitationsForAccount\b/);
    expect(listing.filter((f) => f !== IN_PLACE_TS && f !== NO_ORG_PAGE).map(rel)).toEqual([]);
    expect(listing).toContain(IN_PLACE_TS);
  });

  it("in-place.ts and accept.ts hold presby_app only", () => {
    for (const f of [IN_PLACE_TS, ACCEPT_TS]) expect(read(f), rel(f)).not.toMatch(/getPlatformDb/);
  });

  it("the Check-again scan is no longer vacuous: the action exists and calls connect from the session only (E-30)", () => {
    const source = read(NO_ORG_ACTIONS);
    expect([...source.matchAll(/connectSignedInAccount\(/g)]).toHaveLength(1);
    expect(source).toMatch(/userId:\s*session\.user\.id/);
    expect(source).toMatch(/secondFactorVerified:\s*session\.user\.twoFactorVerified\s*===\s*true/);
  });

  it("the in-place action takes the user id and the factor flag from the session only", () => {
    const source = read(NO_ORG_ACTIONS);
    const call = /acceptInvitationInPlace\(\{([\s\S]*?)\}\)/.exec(source);
    expect(call, "the call").not.toBeNull();
    expect(call![1]).toMatch(/userId:\s*session\.user\.id/);
    expect(call![1]).toMatch(/secondFactorVerified:\s*session\.user\.twoFactorVerified\s*===\s*true/);
    expect(call![1]).not.toMatch(/formData|searchParams|cookies|params/i);
  });

  it("nothing under src/app/no-organization/ imports getPlatformDb", () => {
    const files = walk(NO_ORG_DIR).filter((f) => !isTest(f));
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => /getPlatformDb/.test(read(f))).map(rel)).toEqual([]);
  });

  it("the in-place feature files are now present in the DECISION-230 scan (it is not vacuous for in-place.ts)", () => {
    expect(statSync(IN_PLACE_TS).isFile()).toBe(true);
    expect(read(IN_PLACE_TS)).not.toMatch(/two-factor-grant|unstable_update/);
  });
});

describe("2b B2: nothing outside the 0065 definers writes people.user_id (the A2 owner-path scan, DECISION-208)", () => {
  /**
   * The owner path is not bound by the `people_guard_user_link` trigger (the
   * guard refuses every non-owner role), so this scan is the mitigation: no
   * non-test application file may write the column. `src/lib/testing/` writes
   * fixtures on the owner connection on purpose and is excluded.
   */
  const WRITES = [
    /\bupdate\s+people\s+set\b[^;`]*\buser_id\b/i,
    /\binsert\s+into\s+people\b[^;`]*\buser_id\b/i,
    /\.update\(\s*people\s*\)[\s\S]{0,300}?\.set\(\s*\{[^}]*\buserId\b/,
    /\.insert\(\s*people\s*\)[\s\S]{0,400}?\.values\(\s*\{[^}]*\buserId\b/,
  ];
  const writes = (source: string) => WRITES.some((re) => re.test(source));

  it("no non-test file under src/ (outside src/lib/testing/) writes userId in a people insert or update", () => {
    const offenders = namers(/./).filter((f) => writes(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("the scan reads real files (not vacuous)", () => {
    expect(namers(/\bpeople\b/).length).toBeGreaterThan(10);
  });

  it("the scan can fail: each shape of write is caught, and a read is not", () => {
    expect(writes("await tx.execute(sql`update people set user_id = ${u} where id = ${p}`)")).toBe(true);
    expect(writes("insert into people (first_name, user_id) values ('a', 'b')")).toBe(true);
    expect(writes("await tx.update(people).set({ userId: u }).where(eq(people.id, p))")).toBe(true);
    expect(writes("await tx.insert(people).values({ firstName: 'a', userId: u })")).toBe(true);
    expect(writes("select user_id from people where id = 1")).toBe(false);
    expect(writes("await tx.update(people).set({ firstName: 'a' })")).toBe(false);
  });
});

describe("2b B2: the pure copy and type modules are client-safe", () => {
  const PURE = ["sign-in-types.ts", "sign-in-copy.ts", "no-organization-copy.ts", "labels.ts", "invitation-copy.ts"];

  it("none imports the database (a TYPE import aside), server-only, the audit writer or a library module", () => {
    for (const name of PURE) {
      const code = read(path.join(ONBOARDING, name));
      expect(code, name).not.toMatch(/import\s+(?!type)[^;]*from\s+["']@\/lib\/db/);
      expect(code, name).not.toMatch(/server-only|audit-tx|getPlatformDb|next\/headers/);
      expect(code, name).not.toMatch(/from\s+["']\.\/(org-invite|issue|accept|in-place|connect)["']/);
    }
  });

  it("the scan can fail", () => {
    expect(/import\s+(?!type)[^;]*from\s+["']@\/lib\/db/.test('import { db } from "@/lib/db";')).toBe(true);
    expect(/import\s+(?!type)[^;]*from\s+["']@\/lib\/db/.test('import type { X } from "@/lib/db/domain/invitations";')).toBe(false);
  });
});

describe("2b B2: the 0065 migration deletes no record (rows are never deleted; every removal is a terminal timestamp)", () => {
  const deletes = (source: string) => [...source.replace(/^\s*--.*$/gm, "").matchAll(/\bdelete\s+from\s+([a-z_]+)/gi)].map((m) => m[1]!.toLowerCase());

  it("its only deletes are SPENT single-use email-verification tokens (the email change consumes its token); no invitation, person, user, contact or audit row", () => {
    const migration = readFileSync(path.join(ROOT, "drizzle/0065_presby_sign_in_and_connect.sql"), "utf8");
    const targets = deletes(migration);
    expect(targets.length).toBeGreaterThan(0);
    expect([...new Set(targets)]).toEqual(["email_verification_tokens"]);
  });

  it("the scan can fail: a delete of an invitation is caught", () => {
    expect(deletes("delete from account_invitations where id = 1;")).toEqual(["account_invitations"]);
    expect(deletes("-- delete from people\nselect 1")).toEqual([]);
  });
});

describe("2b B2: the platform's masked panel never holds a full address or a token hash", () => {
  const ISSUE_TS = path.join(ONBOARDING, "issue.ts");
  /** The code of summarizeOrgSentInvitations with its one SQL template (the mask) removed. */
  const summarizeCode = (source: string) => {
    const start = source.indexOf("export async function summarizeOrgSentInvitations");
    if (start < 0) return null;
    return source.slice(start).replace(/sql<string \| null>`[\s\S]*?`/, "MASK");
  };

  it("selects named columns only: never the whole row, the address column or the hash outside the SQL mask", () => {
    const code = summarizeCode(read(ISSUE_TS));
    expect(code, "summarizeOrgSentInvitations").not.toBeNull();
    expect(code).toMatch(/MASK/);
    expect(code).not.toMatch(/inv:\s*accountInvitations\b/);
    expect(code).not.toMatch(/emailNormalized|tokenHash|createdByUserId|\.personId|inviteeFirstName|inviteeLastName/);
  });

  it("the scan can fail: a whole-row select and a read of the address column are caught", () => {
    const bad = summarizeCode("export async function summarizeOrgSentInvitations() { select({ inv: accountInvitations, x: r.emailNormalized }) }");
    expect(/inv:\s*accountInvitations\b/.test(bad!)).toBe(true);
    expect(/emailNormalized/.test(bad!)).toBe(true);
  });
});
