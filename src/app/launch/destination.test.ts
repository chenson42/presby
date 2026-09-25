/**
 * The nine-row destination matrix, plus the two guards that make it survivable.
 *
 * This is P0's highest-value unit target: `/launch` renders nothing on the happy
 * path, so every rule here is otherwise verifiable only by signing in as six
 * different fixtures in a browser.
 */
import { describe, expect, it } from "vitest";
import { computeDestination, type DestinationInput } from "./destination";

const ALDER = { slug: "alder-creek" };
const FERNWOOD = { slug: "fernwood" };

function input(over: Partial<DestinationInput> = {}): DestinationInput {
  return {
    enterableOrgs: [],
    isPlatformAdmin: false,
    canAccessAdmin: false,
    requestedPath: null,
    ...over,
  };
}

describe("computeDestination — the matrix", () => {
  // Row 1
  it("0 orgs, no platform access → /no-organization", () => {
    expect(computeDestination(input())).toEqual({
      path: "/no-organization",
      reason: "no-organization",
    });
  });

  // Row 2
  it("1 org, no platform access → straight into that organization", () => {
    expect(computeDestination(input({ enterableOrgs: [ALDER] }))).toEqual({
      path: "/o/alder-creek",
      reason: "single-org",
    });
  });

  // Row 3
  it("2 orgs, no platform access → the chooser", () => {
    expect(
      computeDestination(input({ enterableOrgs: [ALDER, FERNWOOD] })),
    ).toEqual({ path: "/home", reason: "chooser" });
  });

  // Row 4 — "if you are only a super admin you would go straight into the
  // admin page." canAccessAdmin is the Edge's predicate, so this lands on a
  // page the Edge will actually admit them to.
  it("0 orgs, canAccessAdmin, not a platform admin → /admin", () => {
    expect(computeDestination(input({ canAccessAdmin: true }))).toEqual({
      path: "/admin",
      reason: "platform-admin-only",
    });
  });

  // Row 5
  it("1 org plus canAccessAdmin → the chooser, so the Platform block is reachable", () => {
    expect(
      computeDestination(
        input({ enterableOrgs: [ALDER], canAccessAdmin: true }),
      ),
    ).toEqual({ path: "/home", reason: "chooser" });
  });

  // Row 5, the developer half — DECISION-044(1). Routing an is_platform_admin
  // holder to /admin would bounce them to /access-pending, and would make the
  // Developer card unreachable for anyone holding both predicates.
  it("0 orgs and isPlatformAdmin → the chooser, never /admin", () => {
    expect(computeDestination(input({ isPlatformAdmin: true }))).toEqual({
      path: "/home",
      reason: "chooser",
    });
  });

  it("0 orgs holding BOTH predicates → the chooser, so the Developer card exists", () => {
    expect(
      computeDestination(input({ canAccessAdmin: true, isPlatformAdmin: true })),
    ).toEqual({ path: "/home", reason: "chooser" });
  });

  it("1 org and isPlatformAdmin → the chooser, not the single-org forward", () => {
    expect(
      computeDestination(
        input({ enterableOrgs: [ALDER], isPlatformAdmin: true }),
      ),
    ).toEqual({ path: "/home", reason: "chooser" });
  });

  // Row 6 — the platform_status row. An `unmanaged` or `invited` relationship
  // never reaches enterableOrgs (availableOrganizations filters it), so a user
  // whose only congregation is not a tenant is a zero-org user here.
  it("only unmanaged/invited relationships → /no-organization, not an empty chooser", () => {
    expect(computeDestination(input({ enterableOrgs: [] }))).toEqual({
      path: "/no-organization",
      reason: "no-organization",
    });
  });

  // Row 9 — the deep link. A user routed through /launch with a `next` lands
  // where they asked, and the chooser is convenience, never a gate.
  it("an explicit requested path wins over every computed destination", () => {
    expect(
      computeDestination(
        input({ enterableOrgs: [ALDER], requestedPath: "/account/2fa" }),
      ),
    ).toEqual({ path: "/account/2fa", reason: "requested-path" });
  });
});

describe("computeDestination — the requested path", () => {
  it("honors an /o/<slug> path when the slug is enterable", () => {
    expect(
      computeDestination(
        input({
          enterableOrgs: [ALDER, FERNWOOD],
          requestedPath: "/o/fernwood/roll?tab=active",
        }),
      ),
    ).toEqual({ path: "/o/fernwood/roll?tab=active", reason: "requested-path" });
  });

  it("falls through to the normal destination when the slug is not enterable", () => {
    // UX, not security: a stale bookmark gets the chooser rather than an
    // access-denied page. The gate is the independent resolve at /o/<slug>.
    expect(
      computeDestination(
        input({
          enterableOrgs: [ALDER, FERNWOOD],
          requestedPath: "/o/quillhaven",
        }),
      ),
    ).toEqual({ path: "/home", reason: "chooser" });
  });

  it("falls through to the single-org forward when the slug is not enterable", () => {
    expect(
      computeDestination(
        input({ enterableOrgs: [ALDER], requestedPath: "/o/quillhaven" }),
      ),
    ).toEqual({ path: "/o/alder-creek", reason: "single-org" });
  });

  it("drops a requested /launch, so ?next=/launch cannot loop", () => {
    expect(
      computeDestination(
        input({ enterableOrgs: [ALDER], requestedPath: "/launch" }),
      ),
    ).toEqual({ path: "/o/alder-creek", reason: "single-org" });
  });

  it("drops a requested /launch carrying a query string", () => {
    expect(
      computeDestination(
        input({ requestedPath: "/launch?next=%2Flaunch", canAccessAdmin: true }),
      ),
    ).toEqual({ path: "/admin", reason: "platform-admin-only" });
  });

  it("does not mistake /orgs for an org path", () => {
    // "/orgs".startsWith("/o/") is false, but a sloppier slug parser would
    // read the first segment as "orgs" and reject it as non-enterable.
    expect(
      computeDestination(
        input({ enterableOrgs: [ALDER, FERNWOOD], requestedPath: "/orgs" }),
      ),
    ).toEqual({ path: "/orgs", reason: "requested-path" });
  });

  it("passes a bare /o/ through as a non-org path rather than crashing", () => {
    expect(
      computeDestination(input({ enterableOrgs: [ALDER], requestedPath: "/o/" })),
    ).toEqual({ path: "/o/", reason: "requested-path" });
  });

  it("treats a null requested path as absent", () => {
    expect(
      computeDestination(input({ enterableOrgs: [ALDER], requestedPath: null })),
    ).toEqual({ path: "/o/alder-creek", reason: "single-org" });
  });
});

/**
 * Encodes CLAUDE.md's Post-Login Landing table (CLAUDE.md:606-612) row for
 * row, verbatim, so the doc and computeDestination() cannot silently diverge
 * again — docs/work-log/2026-09-25-e2e-red-on-main.md, Phase 1 traced the
 * "/admin vs /home" e2e failures to shared-dev-database drift rather than a
 * mismatch between this file and the table, but found no test that would
 * have caught a REAL mismatch either. Every case here is additive: none of
 * the existing `it()`s above change.
 *
 * | Enterable orgs   | canAccessAdmin | isPlatformAdmin | Destination                             |
 * |------------------|----------------|-----------------|------------------------------------------|
 * | any              | any            | any             | the sanitized `?next=`, if enterable      |
 * | 1                | no             | no              | `/o/<slug>`                               |
 * | 0                | no             | no              | `/no-organization`                        |
 * | 0                | yes            | no              | `/admin`                                  |
 * | everything else  |                |                 | `/home`                                   |
 */
describe("computeDestination — CLAUDE.md's Post-Login Landing table (CLAUDE.md:606-612)", () => {
  it("row 1 — any/any/any → the sanitized ?next=, if its slug is enterable", () => {
    expect(
      computeDestination(
        input({
          enterableOrgs: [ALDER],
          canAccessAdmin: true,
          isPlatformAdmin: true,
          requestedPath: "/o/alder-creek/roll",
        }),
      ),
    ).toEqual({ path: "/o/alder-creek/roll", reason: "requested-path" });
  });

  it("row 2 — 1/no/no → /o/<slug>", () => {
    expect(
      computeDestination(
        input({
          enterableOrgs: [ALDER],
          canAccessAdmin: false,
          isPlatformAdmin: false,
        }),
      ),
    ).toEqual({ path: "/o/alder-creek", reason: "single-org" });
  });

  it("row 3 — 0/no/no → /no-organization", () => {
    expect(
      computeDestination(
        input({ enterableOrgs: [], canAccessAdmin: false, isPlatformAdmin: false }),
      ),
    ).toEqual({ path: "/no-organization", reason: "no-organization" });
  });

  it("row 4 — 0/yes/no → /admin", () => {
    expect(
      computeDestination(
        input({ enterableOrgs: [], canAccessAdmin: true, isPlatformAdmin: false }),
      ),
    ).toEqual({ path: "/admin", reason: "platform-admin-only" });
  });

  it("row 5 — everything else → /home", () => {
    const everythingElse: DestinationInput[] = [
      // 2+ orgs, no platform access.
      input({ enterableOrgs: [ALDER, FERNWOOD] }),
      // 1 org plus canAccessAdmin.
      input({ enterableOrgs: [ALDER], canAccessAdmin: true }),
      // 1 org plus isPlatformAdmin.
      input({ enterableOrgs: [ALDER], isPlatformAdmin: true }),
      // 0 orgs, isPlatformAdmin only (not canAccessAdmin) — the row 4
      // exception: an is_platform_admin holder never lands on /admin.
      input({ enterableOrgs: [], isPlatformAdmin: true }),
      // 0 orgs, both predicates.
      input({ enterableOrgs: [], canAccessAdmin: true, isPlatformAdmin: true }),
      // 2+ orgs, both predicates.
      input({
        enterableOrgs: [ALDER, FERNWOOD],
        canAccessAdmin: true,
        isPlatformAdmin: true,
      }),
    ];

    for (const testCase of everythingElse) {
      expect(computeDestination(testCase)).toEqual({
        path: "/home",
        reason: "chooser",
      });
    }
  });
});
