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
