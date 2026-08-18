/**
 * Tests for the org-list wrappers in src/lib/authz.ts.
 *
 * What is worth testing here is precisely what is NOT in the database: the
 * de-duplication rule and the enterability policy. `presby_user_organizations`
 * deliberately filters nothing (see drizzle/0014_presby_org_router.sql and its
 * assertions in scripts/test-rls.sql), so if these two behaviors are wrong the
 * chooser renders one congregation twice, or offers a card for an organization
 * with no portal behind it, and nothing else fails.
 */

// vi.mock() calls are hoisted above the imports by Vitest's transform, so these
// must be declared before anything that transitively pulls them in.
vi.mock("server-only", () => ({}));

// The factory is hoisted above this file's own bindings, so it cannot close
// over a `const` declared here — it builds the mock and the test body reaches
// it through the imported module.
vi.mock("@/lib/db", () => ({
  db: { execute: vi.fn(), select: vi.fn(), transaction: vi.fn() },
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  assertOrgAccess,
  availableOrganizations,
  isEnterableOrganization,
  OrgAccessError,
  publicOrgSummary,
  resolveOrgContext,
  userOrganizations,
  withOrgContext,
  type UserOrganization,
} from "./authz";

const execute = vi.mocked(db.execute);
const select = vi.mocked(db.select);
const transaction = vi.mocked(db.transaction);

const USER = "e0000000-0000-0000-0000-0000000000a4";

/** One row in the shape presby_user_organizations() returns. */
function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    organization_id: "55555555-5555-5555-5555-555555555555",
    person_id: "c1000000-0000-0000-0000-000000000003",
    membership_id: "af043270-0331-41ff-8f6e-77f5632251df",
    name: "Fernwood Presbyterian Church",
    organization_type: "congregation",
    slug: "fernwood",
    platform_status: "managed",
    ended_on: null,
    membership_created_at: "2026-08-18T20:35:48.304+00:00",
    ...over,
  };
}

function returns(...rows: Array<Record<string, unknown>>) {
  // The wrapper reads `.rows` and nothing else; the rest of pg's QueryResult
  // shape is irrelevant to it and is not worth fabricating.
  execute.mockResolvedValueOnce({
    rows,
  } as unknown as Awaited<ReturnType<typeof db.execute>>);
}

/**
 * Stands in for the Drizzle query builder `publicOrgSummary` uses:
 * db.select({...}).from(organizations).where(...).limit(1) → rows.
 */
function selectReturns(...rows: Array<Record<string, unknown>>) {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  select.mockReturnValueOnce(chain as unknown as ReturnType<typeof db.select>);
}

beforeEach(() => {
  execute.mockReset();
  select.mockReset();
  transaction.mockReset();
});

describe("userOrganizations", () => {
  it("maps every column onto the camelCase contract", async () => {
    returns(row({ ended_on: "2026-03-31" }));

    const [org] = await userOrganizations(USER);

    expect(org).toEqual({
      organizationId: "55555555-5555-5555-5555-555555555555",
      personId: "c1000000-0000-0000-0000-000000000003",
      membershipId: "af043270-0331-41ff-8f6e-77f5632251df",
      name: "Fernwood Presbyterian Church",
      organizationType: "congregation",
      slug: "fernwood",
      platformStatus: "managed",
      endedOn: "2026-03-31",
      membershipCreatedAt: "2026-08-18T20:35:48.304+00:00",
    });
  });

  it("keeps endedOn a plain date string, never a Date", async () => {
    // The Neon WebSocket driver parses a `date` column into a JS Date in the
    // server's local zone, which is how a 31 March relationship renders as the
    // 30th. The SQL cast is what prevents it; this asserts the contract the
    // cast exists to hold.
    returns(row({ ended_on: "2026-03-31" }));

    const [org] = await userOrganizations(USER);

    expect(typeof org.endedOn).toBe("string");
    expect(org.endedOn).toBe("2026-03-31");
  });

  it("filters nothing — ended and non-tenant relationships both come back", async () => {
    returns(
      row(),
      row({
        organization_id: "44444444-4444-4444-4444-444444444444",
        slug: "quillhaven",
        platform_status: "unmanaged",
      }),
      row({
        organization_id: "66666666-6666-6666-6666-666666666666",
        slug: "marrowbone",
        platform_status: "invited",
        ended_on: "2026-03-31",
      }),
    );

    const orgs = await userOrganizations(USER);

    expect(orgs.map((o) => o.slug)).toEqual([
      "fernwood",
      "quillhaven",
      "marrowbone",
    ]);
  });

  it("de-duplicates two person rows at one organization, keeping the first", async () => {
    // The only reachable duplicate: two non-tombstoned `people` rows sharing a
    // user_id, each with its own membership at the same org.
    returns(
      row({ person_id: "c1000000-0000-0000-0000-000000000005" }),
      row({ person_id: "c1000000-0000-0000-0000-000000000006" }),
    );

    const orgs = await userOrganizations(USER);

    expect(orgs).toHaveLength(1);
    expect(orgs[0].personId).toBe("c1000000-0000-0000-0000-000000000005");
  });

  it("trusts the SQL ordering, so a current relationship wins over an ended one", async () => {
    // The function orders current-before-ended; the wrapper's whole rule is
    // "take the first row". If someone ever reorders the SQL, this is the test
    // that says the contract moved.
    returns(
      row({ person_id: "c1000000-0000-0000-0000-000000000005" }),
      row({
        person_id: "c1000000-0000-0000-0000-000000000006",
        ended_on: "2026-03-31",
      }),
    );

    const [org] = await userOrganizations(USER);

    expect(org.endedOn).toBeNull();
  });

  it("preserves the order of distinct organizations", async () => {
    returns(
      row({
        organization_id: "11111111-1111-1111-1111-111111111111",
        slug: "northern-reach",
        organization_type: "presbytery",
      }),
      row(),
      row({
        organization_id: "44444444-4444-4444-4444-444444444444",
        slug: "quillhaven",
      }),
    );

    const orgs = await userOrganizations(USER);

    expect(orgs.map((o) => o.slug)).toEqual([
      "northern-reach",
      "fernwood",
      "quillhaven",
    ]);
  });

  it("returns nothing for a user with no person row", async () => {
    returns();
    await expect(userOrganizations(USER)).resolves.toEqual([]);
  });

  it("does not swallow a database failure", async () => {
    // A DB outage must not read as "your access was revoked". The caller
    // decides what to render; this must propagate.
    execute.mockRejectedValueOnce(new Error("connection terminated"));

    await expect(userOrganizations(USER)).rejects.toThrow(
      "connection terminated",
    );
  });
});

describe("availableOrganizations", () => {
  it("returns only current relationships at managed organizations", async () => {
    returns(
      row(),
      row({
        organization_id: "44444444-4444-4444-4444-444444444444",
        slug: "quillhaven",
        platform_status: "unmanaged",
      }),
      row({
        organization_id: "66666666-6666-6666-6666-666666666666",
        slug: "marrowbone",
        platform_status: "invited",
      }),
      row({
        organization_id: "77777777-7777-7777-7777-777777777777",
        slug: "ended-managed",
        ended_on: "2026-03-31",
      }),
    );

    const orgs = await availableOrganizations(USER);

    expect(orgs.map((o) => o.slug)).toEqual(["fernwood"]);
  });

  it("gives a presbytery steward exactly one card", async () => {
    // The invariant that would be broken by a helpful-looking join on
    // organizations.path: stewardship of forty non-tenant congregations is not
    // forty cards. The query joins memberships and only memberships, so the
    // steward's single relationship is the single card.
    returns(
      row({
        organization_id: "11111111-1111-1111-1111-111111111111",
        slug: "northern-reach",
        organization_type: "presbytery",
      }),
    );

    const orgs = await availableOrganizations(USER);

    expect(orgs).toHaveLength(1);
    expect(orgs[0].slug).toBe("northern-reach");
  });

  it("reads the database exactly once", async () => {
    returns(row());

    await availableOrganizations(USER);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("is empty when every relationship has ended", async () => {
    returns(row({ ended_on: "2026-03-31" }));

    await expect(availableOrganizations(USER)).resolves.toEqual([]);
  });
});

describe("isEnterableOrganization", () => {
  // Exported so the chooser and the router cannot drift. /orgs has to read the
  // UNFILTERED list — it names the organizations still being set up — so
  // without this it would carry its own inline copy of the condition, and the
  // day the two disagree is the day /launch forwards a single-organization user
  // into an /o/<slug> the chooser refuses to show a card for.
  function org(over: Partial<UserOrganization> = {}): UserOrganization {
    return {
      organizationId: "55555555-5555-5555-5555-555555555555",
      personId: "c1000000-0000-0000-0000-000000000003",
      membershipId: "af043270-0331-41ff-8f6e-77f5632251df",
      name: "Fernwood Presbyterian Church",
      organizationType: "congregation",
      slug: "fernwood",
      platformStatus: "managed",
      endedOn: null,
      membershipCreatedAt: "2026-08-18T20:35:48.304+00:00",
      ...over,
    };
  }

  it("accepts a current relationship at a managed organization", () => {
    expect(isEnterableOrganization(org())).toBe(true);
  });

  it("rejects an unmanaged organization — there is no portal behind it", () => {
    expect(isEnterableOrganization(org({ platformStatus: "unmanaged" }))).toBe(
      false,
    );
  });

  it("rejects an invited organization — entering it needs a P1 permission", () => {
    expect(isEnterableOrganization(org({ platformStatus: "invited" }))).toBe(
      false,
    );
  });

  it("rejects an ended relationship even at a managed organization", () => {
    expect(isEnterableOrganization(org({ endedOn: "2026-03-31" }))).toBe(false);
  });

  it("is the predicate availableOrganizations() actually filters on", async () => {
    // Pins the two together: if the wrapper stops using it, this fails.
    returns(
      row(),
      row({
        organization_id: "44444444-4444-4444-4444-444444444444",
        slug: "quillhaven",
        platform_status: "unmanaged",
      }),
    );

    const orgs = await availableOrganizations(USER);

    expect(orgs).toEqual(orgs.filter(isEnterableOrganization));
    expect(orgs.map((o) => o.slug)).toEqual(["fernwood"]);
  });
});

describe("resolveOrgContext", () => {
  it("enters an active relationship at a managed organization", async () => {
    returns(row());

    const resolved = await resolveOrgContext(USER, "fernwood");

    expect(resolved).toEqual({
      kind: "ok",
      org: {
        organizationId: "55555555-5555-5555-5555-555555555555",
        personId: "c1000000-0000-0000-0000-000000000003",
        name: "Fernwood Presbyterian Church",
        organizationType: "congregation",
        slug: "fernwood",
        platformStatus: "managed",
      },
    });
    // The composite (personId, organizationId) pair comes from ONE row. It is
    // never assembled from two queries — F2.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("names and dates an ended relationship", async () => {
    returns(row({ ended_on: "2026-06-12" }));

    await expect(resolveOrgContext(USER, "fernwood")).resolves.toEqual({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-06-12",
    });
  });

  it("names and dates an ended relationship at an unmanaged organization too", async () => {
    // Ended is checked before platform status deliberately: the user already
    // knew the organization exists and that they were related to it, so the
    // date discloses nothing about tenancy.
    returns(row({ slug: "quillhaven", platform_status: "unmanaged", ended_on: "2026-06-12" }));

    await expect(resolveOrgContext(USER, "quillhaven")).resolves.toEqual({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-06-12",
    });
  });

  it("forbids an active relationship at an invited organization", async () => {
    returns(row({ slug: "marrowbone", platform_status: "invited" }));

    await expect(resolveOrgContext(USER, "marrowbone")).resolves.toEqual({
      kind: "forbidden",
      name: "Fernwood Presbyterian Church",
      organizationType: "congregation",
    });
  });

  it("forbids an active relationship at an unmanaged organization", async () => {
    returns(row({ slug: "quillhaven", platform_status: "unmanaged" }));

    await expect(resolveOrgContext(USER, "quillhaven")).resolves.toEqual({
      kind: "forbidden",
      name: "Fernwood Presbyterian Church",
      organizationType: "congregation",
    });
  });

  it("forbids a slug in the public tree the user has no relationship with", async () => {
    returns(row());
    selectReturns({
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });

    await expect(resolveOrgContext(USER, "bramblewood")).resolves.toEqual({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });
  });

  it("returns forbidden with NO platform status, whatever the organization is", async () => {
    // DECISION-040: the three forbidden branches — invited membership,
    // unmanaged membership, and non-member — must be indistinguishable. This
    // asserts the shape carries nothing to distinguish them WITH; the page's
    // byte-identical copy is asserted in e2e.
    returns(row({ slug: "marrowbone", platform_status: "invited" }));
    const member = await resolveOrgContext(USER, "marrowbone");

    returns(row());
    selectReturns({ name: "Fernwood Presbyterian Church", organizationType: "congregation" });
    const stranger = await resolveOrgContext(USER, "bramblewood");

    expect(Object.keys(member).sort()).toEqual(Object.keys(stranger).sort());
    expect(member).not.toHaveProperty("platformStatus");
    expect(stranger).not.toHaveProperty("platformStatus");
  });

  it("returns not-found for a slug that is not an organization at all", async () => {
    returns(row());
    selectReturns();

    await expect(resolveOrgContext(USER, "no-such-church")).resolves.toEqual({
      kind: "not-found",
    });
  });

  it("does not read the public tree when the user has a relationship", async () => {
    // The membership set is resolved FIRST and answers on its own. Inverting
    // the order — look organizations up by slug, then hand the id to
    // withOrgContext — is the security defect DECISION-035 forbids.
    returns(row());

    await resolveOrgContext(USER, "fernwood");

    expect(select).not.toHaveBeenCalled();
  });

  it("does not swallow a database failure", async () => {
    execute.mockRejectedValueOnce(new Error("connection terminated"));

    await expect(resolveOrgContext(USER, "fernwood")).rejects.toThrow(
      "connection terminated",
    );
  });
});

describe("publicOrgSummary", () => {
  it("returns name and type only — never platform status", async () => {
    selectReturns({
      name: "Quillhaven Presbyterian Church",
      organizationType: "congregation",
    });

    const summary = await publicOrgSummary("quillhaven");

    expect(summary).toEqual({
      name: "Quillhaven Presbyterian Church",
      organizationType: "congregation",
    });
    expect(summary).not.toHaveProperty("platformStatus");
  });

  it("returns null for a slug that is in no organization", async () => {
    selectReturns();

    await expect(publicOrgSummary("no-such-church")).resolves.toBeNull();
  });
});

describe("withOrgContext / assertOrgAccess", () => {
  const PERSON = "c1000000-0000-0000-0000-000000000003";
  const ORG = "55555555-5555-5555-5555-555555555555";

  /**
   * A transaction whose membership probe returns `rows`.
   *
   * The probe is `select presby_membership_is_active(...) as is_active`, so the
   * shape is one row carrying a boolean — NOT `select 1`. It goes through a
   * SECURITY DEFINER function because `memberships` is FORCE RLS keyed on the
   * org GUC, which this check deliberately runs before setting: a plain query
   * there returns zero rows for every member and rejects everyone (F26). See
   * drizzle/0015_presby_membership_probe.sql.
   */
  function txReturning(rows: unknown[]) {
    const statements: unknown[] = [];
    const tx = {
      execute: vi.fn(async (statement: unknown) => {
        statements.push(statement);
        // First execute is the membership check; later ones are set_config.
        return statements.length === 1 ? { rows } : { rows: [] };
      }),
    };
    transaction.mockImplementationOnce((async (
      fn: (t: typeof tx) => Promise<unknown>,
    ) => fn(tx)) as unknown as typeof db.transaction);
    return tx;
  }

  it("throws OrgAccessError, not a bare Error, when the membership is gone", async () => {
    txReturning([{ is_active: false }]);

    await expect(assertOrgAccess(PERSON, ORG)).rejects.toBeInstanceOf(
      OrgAccessError,
    );
  });

  it("admits a live membership through the definer probe — regression for withOrgContext rejected every member", async () => {
    // THE BUG: the probe used to be a plain `select 1 from memberships`, run —
    // correctly — before app.current_org_id is set. `memberships` is FORCE RLS
    // on `organization_id = presby_current_org()`, so with no GUC set it
    // returned ZERO ROWS for every person at every organization, and the gate
    // rejected the members it exists to admit. Every authenticated visit to
    // /o/<slug> by a genuine member landed on the error boundary. F26.
    //
    // This asserts the probe's SHAPE, which is what the fix changed: one row
    // carrying a boolean from presby_membership_is_active(), not a row count.
    // A revert to `select 1` makes the success row `{ "?column?": 1 }`, whose
    // is_active is undefined, and this test goes red.
    const tx = txReturning([{ is_active: true }]);

    await expect(assertOrgAccess(PERSON, ORG)).resolves.toBeUndefined();

    // Drizzle's sql`` object does not stringify usefully; its literal fragments
    // live in queryChunks, which JSON round-trips.
    const probe = JSON.stringify(tx.execute.mock.calls[0][0]);
    expect(probe).toContain("presby_membership_is_active");
  });

  it("rejects when the probe answers false rather than returning no row", async () => {
    // The definer function always returns exactly one row. "Not a member" is
    // `false` in that row, never an empty result — so reading row COUNT instead
    // of the boolean would admit every non-member.
    txReturning([{ is_active: false }]);

    await expect(assertOrgAccess(PERSON, ORG)).rejects.toBeInstanceOf(
      OrgAccessError,
    );
  });

  it("carries the person and organization on the error", async () => {
    txReturning([{ is_active: false }]);

    const error = await assertOrgAccess(PERSON, ORG).catch((e) => e);

    expect(error).toMatchObject({
      name: "OrgAccessError",
      personId: PERSON,
      organizationId: ORG,
    });
  });

  it("never sets the org context when the membership check fails", async () => {
    // The check runs BEFORE set_config so it cannot be satisfied by the very
    // context it authorizes. If this ever regresses, the only execute() call
    // on the failing path stops being the only one.
    const tx = txReturning([{ is_active: false }]);

    await assertOrgAccess(PERSON, ORG).catch(() => {});

    expect(tx.execute).toHaveBeenCalledTimes(1);
  });

  it("sets the org context and runs the callback for a live membership", async () => {
    const tx = txReturning([{ is_active: true }]);

    const result = await withOrgContext(PERSON, ORG, async () => "read");

    expect(result).toBe("read");
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });

  it("assertOrgAccess resolves and reads nothing beyond the gate", async () => {
    const tx = txReturning([{ is_active: true }]);

    await expect(assertOrgAccess(PERSON, ORG)).resolves.toBeUndefined();
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });
});
