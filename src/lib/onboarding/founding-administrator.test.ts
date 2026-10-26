/**
 * Tests for src/lib/onboarding/founding-administrator.ts — docs/work-log/
 * 2026-09-28-founding-administrator.md (DECISION-155), as reshaped by
 * docs/work-log/2026-10-21-invitations.md (Batch 2d).
 *
 * The TypeScript `designateFoundingAdministrator()` transaction and
 * `deriveNameFromUser()` were DELETED in Batch 2d: the invitation model moved
 * the designation's effect into `presby_apply_founding_administrator` (pinned by
 * designation-parity.db.test.ts's golden snapshot) and every refusal it had is
 * now a `createInvitation()` / `presby_accept_invitation` outcome (issue.db.test.ts,
 * accept.db.test.ts, invitations.db.test.ts). What this file still pins is what
 * the module still is:
 *
 *   - `foundingAdministratorPlan()`: the bundle's DISPLAY COPY (and, via
 *     invitations.db.test.ts, its equality with the SQL source for every org
 *     type);
 *   - `countFoundingAdministratorHolders()`: a thin wrapper over the owner-only
 *     SQL count function;
 *   - the module's shape: no connection of its own, no designation transaction,
 *     no resolver-side import.
 *
 * Even the PURE plan tests sit inside the DB-gated `describe.skipIf` and import
 * the module dynamically: it is `server-only` and its sibling imports reach
 * `@/lib/db`'s module-scope pool construction, which throws without
 * DATABASE_URL (the harness `org-provisioning.test.ts` documents). `npm test` in
 * CI sets no DATABASE_URL, so the suite is SKIPPED there, not failed; the
 * source-shape suite below runs everywhere. Run it for real with:
 *   dotenv -e .env.local -- vitest run src/lib/onboarding/founding-administrator.test.ts --no-file-parallelism
 *
 * The earlier "four files unchanged" mechanical test was retired at the next
 * cross-pipeline merge (F131, 2026-10-05): a "byte-identical to main" assertion
 * is only meaningful inside the pipeline it guards. Its durable form is the
 * import-boundary test below plus scripts/test-rls.sql §44, which asserts what
 * the designee can and cannot resolve.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const ROOT = path.resolve(__dirname, "../../..");

// ---------------------------------------------------------------------------
// 1. The module's shape (no database)
// ---------------------------------------------------------------------------

describe("founding-administrator.ts — the module's shape and the DECISION-155 import boundary", () => {
  const SOURCE = readFileSync(path.join(ROOT, "src/lib/onboarding/founding-administrator.ts"), "utf8");
  // Strip comments so the header's prose naming the files is not an import.
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("imports none of authz.ts (beyond a TYPE), role-definitions.ts, role-grants.ts — no subset check, no adoptTemplate, no grantRole", () => {
    expect(CODE).not.toMatch(/import\s+(?!type)[^;]*from\s+["']@\/lib\/authz["']/);
    expect(CODE).not.toMatch(/from\s+["']@\/lib\/role-definitions["']/);
    expect(CODE).not.toMatch(/from\s+["']@\/lib\/role-grants["']/);
    expect(CODE).not.toMatch(/assertPermissionSubset|adoptTemplate|grantRole\(/);
    expect(CODE).not.toMatch(/presby_effective_permissions|withOrgContext/);
  });

  it("holds no connection of its own and no designation transaction; the gate is the single SQL source", () => {
    expect(CODE).not.toMatch(/import\s*\{[^}]*\bdb\b[^}]*\}\s*from\s*["']@\/lib\/db["']/);
    expect(CODE).not.toMatch(/import\s*\{[^}]*\bgetPlatformDb\b[^}]*\}\s*from\s*["']@\/lib\/db["']/);
    expect(CODE).not.toMatch(/designateFoundingAdministrator|deriveNameFromUser|\.transaction\(|for update/i);
    expect(CODE).toMatch(/presby_founding_administrator_holder_count/);
  });

  it("no module under src/lib/onboarding imports a resolver-side file (a TYPE import of OrganizationType aside)", () => {
    const dir = path.join(ROOT, "src/lib/onboarding");
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts") || /\.test\.ts$/.test(name)) continue;
      const code = readFileSync(path.join(dir, name), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      if (/import\s+(?!type)[^;]*from\s+["']@\/lib\/(authz|role-definitions|role-grants)["']/.test(code)) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Postgres-backed suite
// ---------------------------------------------------------------------------

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "founding-administrator.ts (Postgres-backed, real dev database)",
  () => {
    let countFoundingAdministratorHolders: typeof import("./founding-administrator").countFoundingAdministratorHolders;
    let foundingAdministratorPlan: typeof import("./founding-administrator").foundingAdministratorPlan;
    let fx: Awaited<ReturnType<typeof import("@/lib/testing/calendar-fixture").createCalendarFixture>>;
    let platform: Awaited<ReturnType<typeof import("@/lib/testing/calendar-fixture").createCalendarFixture>>["platform"];

    beforeAll(async () => {
      ({ countFoundingAdministratorHolders, foundingAdministratorPlan } = await import("./founding-administrator"));
      const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
      fx = await createCalendarFixture("fa-count");
      platform = fx.platform;
    });

    afterAll(async () => {
      if (fx) await fx.cleanup();
    });

    async function sqlCount(organizationId: string): Promise<number> {
      const r = await platform.execute(
        sql`select presby_founding_administrator_holder_count(${organizationId}::uuid) as n`,
      );
      const rows = (r as unknown as { rows: Array<{ n: number | string }> }).rows;
      return Number(rows[0]!.n);
    }

    describe("countFoundingAdministratorHolders()", () => {
      it("is 0 for an org nobody administers, counts a roles.manage holder and a role_grants.manage holder, and equals the SQL single source", async () => {
        const org = await fx.makeOrg("count");
        expect(await countFoundingAdministratorHolders(platform, org)).toBe(0);
        const a = await fx.makePerson("Marisol", "RolesHolder");
        await fx.enroll(org, a, ["roles.manage"]);
        expect(await countFoundingAdministratorHolders(platform, org)).toBe(1);
        const b = await fx.makePerson("Talbot", "GrantsHolder");
        await fx.enroll(org, b, ["role_grants.manage"]);
        expect(await countFoundingAdministratorHolders(platform, org)).toBe(2);
        expect(await sqlCount(org)).toBe(2);
      });

      it("does not count people who hold other keys, or holders at another org", async () => {
        const org = await fx.makeOrg("count-other");
        const elsewhere = await fx.makeOrg("count-else");
        const peopleManager = await fx.makePerson("Pia", "PeopleOnly");
        await fx.enroll(org, peopleManager, ["people.manage"]);
        const holderElsewhere = await fx.makePerson("Wren", "Elsewhere");
        await fx.enroll(elsewhere, holderElsewhere, ["roles.manage"]);
        expect(await countFoundingAdministratorHolders(platform, org)).toBe(0);
        expect(await countFoundingAdministratorHolders(platform, elsewhere)).toBe(1);
      });
    });

    describe("foundingAdministratorPlan()", () => {
      const BASE = [
        "people.manage",
        "roles.manage",
        "role_grants.manage",
        "groups.manage",
        "officers.manage",
        "org_features.manage",
        "tickets.file",
        "staff.manage",
        "domains.manage",
        "careers.manage",
        "careers.applicants",
      ];

      it("congregation: the base eleven keys (F118 — staff.manage joins the bundle; F150 — domains.manage joins it; F292 — careers.manage and careers.applicants join it), congregation_stated_clerk office, no congregation_oversight.manage", () => {
        const plan = foundingAdministratorPlan("congregation");
        expect(plan.administration.key).toBe("founding_administrator");
        expect(plan.administration.permissionKeys.sort()).toEqual(
          [...BASE].sort(),
        );
        expect(plan.administration.permissionKeys).not.toContain(
          "congregation_oversight.manage",
        );
        expect(plan.officeTemplateKey).toBe("congregation_stated_clerk");
      });

      it("presbytery: base eleven PLUS congregation_oversight.manage (12 total), presbytery_stated_clerk office", () => {
        const plan = foundingAdministratorPlan("presbytery");
        expect(plan.administration.permissionKeys.sort()).toEqual(
          [...BASE, "congregation_oversight.manage"].sort(),
        );
        expect(plan.officeTemplateKey).toBe("presbytery_stated_clerk");
      });

      it.each(["synod", "general_assembly", "new_worshiping_community"] as const)(
        "%s: administration half only, no office template",
        (organizationType) => {
          const plan = foundingAdministratorPlan(organizationType);
          expect(plan.administration.permissionKeys.sort()).toEqual(
            [...BASE].sort(),
          );
          expect(plan.officeTemplateKey).toBeNull();
        },
      );

      it("never carries an excluded tier-2 or tier-3 key (F111's enumerated-not-wildcard ceiling; staff.manage is CARRIED as of F118 and careers.applicants, tier 3, as of F292 / DECISION-265, so both are deliberately absent from this list)", () => {
        const excluded = [
          "roll.propose",
          "roll.approve",
          "branding.manage",
          "events.manage",
          "directory.view_hidden",
          "directory.view",
          "credentials.manage",
          "children.roster",
          "ledger.approve",
          "per_capita.manage",
          "statistics.manage",
          "demographics.manage",
          "medical.manage",
          "disabilities.manage",
          "pastoral_notes.manage",
        ];
        for (const organizationType of [
          "congregation",
          "presbytery",
          "synod",
          "general_assembly",
          "new_worshiping_community",
        ] as const) {
          const plan = foundingAdministratorPlan(organizationType);
          for (const key of excluded) {
            expect(plan.administration.permissionKeys).not.toContain(key);
          }
        }
      });
    });

    describe("foundingAdministratorPlan() — domains.manage (custom domains, F150)", () => {
      it.each([
        "congregation",
        "presbytery",
        "synod",
        "general_assembly",
        "new_worshiping_community",
      ] as const)(
        "%s: the administration half carries domains.manage (under assertPermissionSubset a key nobody at the org holds is ungrantable, so the bundle is the only door)",
        (organizationType) => {
          expect(
            foundingAdministratorPlan(organizationType).administration.permissionKeys,
          ).toContain("domains.manage");
        },
      );

      it("domains.manage is NOT bound to the stated-clerk office template (DECISION-101 brand_admin precedent: software administration is not a constitutional duty)", () => {
        // The office half is a template reference, not a key list, so the
        // assertion is on the plan's shape: the key lives on the enumerated
        // administration role only.
        const plan = foundingAdministratorPlan("congregation");
        expect(plan.administration.key).toBe("founding_administrator");
        expect(plan.officeTemplateKey).toBe("congregation_stated_clerk");
        expect(plan.administration.permissionKeys.filter((k) => k === "domains.manage")).toHaveLength(1);
      });
    });

    // careers Inc 1 (T7; F292, DECISION-265, operator ruling Q4): both careers
    // keys join the bundle in SQL (drizzle/0071), here, the designation golden
    // and the backfill together. invitations.db.test.ts pins this array EQUAL,
    // in order, to presby_founding_administrator_permission_keys().
    describe("foundingAdministratorPlan() — careers.manage and careers.applicants (careers, F292)", () => {
      const ALL_TYPES = [
        "congregation",
        "presbytery",
        "synod",
        "general_assembly",
        "new_worshiping_community",
      ] as const;

      it.each(ALL_TYPES)(
        "%s: the administration half carries both careers keys, each exactly once (under assertPermissionSubset a key nobody at the org holds is ungrantable, so the hiring_committee template needs the bundle)",
        (organizationType) => {
          const keys = foundingAdministratorPlan(organizationType).administration.permissionKeys;
          expect(keys.filter((k) => k === "careers.manage")).toHaveLength(1);
          expect(keys.filter((k) => k === "careers.applicants")).toHaveLength(1);
        },
      );

      it.each(ALL_TYPES)(
        "%s: the careers keys follow domains.manage, manage before applicants (the order the SQL function's array uses; invitations.db.test.ts compares arrays in order)",
        (organizationType) => {
          const keys = foundingAdministratorPlan(organizationType).administration.permissionKeys;
          const at = keys.indexOf("domains.manage");
          expect(keys.slice(at, at + 3)).toEqual(["domains.manage", "careers.manage", "careers.applicants"]);
        },
      );

      it("neither careers key is bound to a stated-clerk office template (DECISION-078: hiring is no PC(USA) office's duty) - they live on the enumerated administration role only", () => {
        for (const organizationType of ["congregation", "presbytery"] as const) {
          const plan = foundingAdministratorPlan(organizationType);
          expect(plan.administration.key).toBe("founding_administrator");
          expect(plan.officeTemplateKey).not.toBeNull();
          expect(plan.administration.permissionKeys).toContain("careers.applicants");
        }
      });
    });
  },
);
