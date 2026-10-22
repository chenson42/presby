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
