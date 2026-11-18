/**
 * The six presbytery report readers, against a REAL Postgres (the harness of
 * `src/lib/presbytery.test.ts`: the `hasDb` skip-guard, dynamic imports in
 * `beforeAll`, a self-contained fixture torn down per file, `vi.mock("server-only")`).
 * Run serially:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/presbytery-reports/readers.db.test.ts
 *
 * TWO PRESBYTERIES. A is the subject: congregations built to exercise every
 * vacancy rule, statistics for three years, oversight rows, a rate and bills.
 * B is the cross-tenant control: its own congregation, appointment, statistics,
 * oversight and bill, plus a congregation that MOVED from A to B (A's
 * affiliation closed, B's opened, as `seed-dev.sql` does for Quillhaven) whose
 * appointment row A keeps. Nothing of B may appear in any A report.
 *
 * What is pinned here: the key checked inside the transaction (each key opens
 * only its own report), the roster fence, page-and-CSV agreement
 * (`exportX().csv === buildXCsv(getX().data)`), the audit row written in the
 * export's own transaction (and none on a refusal or a failed insert), trend
 * parity with the existing single-year rollup, and the per-capita sub-cent
 * rounding that `recordPerCapitaPayment` lets through.
 *
 * The two oversight reports (DECISION-348, Buildings and Insurance and loans) are
 * pinned in their own describes at the end, on rows written directly as the owner
 * (so a failure is never the store's): the tier-1 and tier-2 keys each opening only
 * their own report, removed and retired rows left out, the newest policy year, open
 * loans only, the roster fence (another presbytery, a congregation that moved away
 * and one that is no longer active), the sentinels that must never reach a page or a
 * file (street address, policy number, notes, lender), and the export's audit row.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

// A fixed "now": 2026-06-15 noon UTC, the same calendar day in every US zone.
const NOW = new Date("2026-06-15T12:00:00Z");

describe.skipIf(!hasDb)("presbytery-reports readers (Postgres-backed)", () => {
  let readers: {
    vacant: typeof import("./vacant-pulpits");
    trend: typeof import("./membership-trend");
    viability: typeof import("./viability");
    viabilityMap: typeof import("./viability-map");
    perCapita: typeof import("./per-capita");
    buildings: typeof import("./buildings");
    insuranceLoans: typeof import("./insurance-loans");
    hub: typeof import("./hub");
    csv: typeof import("./csv");
  };
  let presbytery: typeof import("@/lib/presbytery");
  let withOrgContext: typeof import("@/lib/authz").withOrgContext;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let schema: {
    organizations: typeof import("@/lib/db/domain/org").organizations;
    affiliations: typeof import("@/lib/db/domain/lifecycle").organizationAffiliations;
    groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
    groups: typeof import("@/lib/db/domain/groups").groups;
    people: typeof import("@/lib/db/domain/people").people;
    memberships: typeof import("@/lib/db/domain/people").memberships;
    permissions: typeof import("@/lib/db/domain/authz").permissions;
    appRoles: typeof import("@/lib/db/domain/authz").appRoles;
    appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
    roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
    appointments: typeof import("@/lib/db/domain/officers").appointments;
    stats: typeof import("@/lib/db/domain/presbytery").congregationStatistics;
    oversight: typeof import("@/lib/db/domain/presbytery").congregationOversight;
    ovProfiles: typeof import("@/lib/db/domain/oversight").oversightProfiles;
    ovBuildings: typeof import("@/lib/db/domain/oversight").oversightBuildings;
    ovAppraisals: typeof import("@/lib/db/domain/oversight").oversightBuildingAppraisals;
    ovInsurance: typeof import("@/lib/db/domain/oversight").oversightInsuranceYears;
    ovLoans: typeof import("@/lib/db/domain/oversight").oversightLoans;
    rates: typeof import("@/lib/db/domain/presbytery").perCapitaRates;
    records: typeof import("@/lib/db/domain/presbytery").perCapitaRecords;
    users: typeof import("@/lib/db/schema").users;
    auditEvents: typeof import("@/lib/db/schema").auditEvents;
  };

  // organizations
  let A: string;
  let B: string;
  const c: Record<string, string> = {}; // A's congregations by short key
  let bCong: string;
  let nwcA: string;

  // people
  let minister: string;
  let bMinister: string;
  const holder: Record<"all" | "vacant" | "trend" | "viability" | "perCapita" | "finance" | "none", string> = {} as never;
  let bHolder: string;
  let userId: string;

  const viewerFor = (personId: string, organizationId = A, id = userId) => ({
    userId: id,
    email: "reports-test@example.invalid",
    personId,
    organizationId,
  });

  const stamp = Date.now();

  async function withTriggersOff(
    platform: ReturnType<typeof import("@/lib/db").getPlatformDb>,
    triggers: string[],
    body: () => Promise<void>,
  ) {
    const parsed = triggers.map((t) => t.split(":") as [string, string]);
    for (const [table, trigger] of parsed) await platform.execute(sql.raw(`alter table ${table} disable trigger ${trigger}`));
    try {
      await body();
    } finally {
      for (const [table, trigger] of parsed) await platform.execute(sql.raw(`alter table ${table} enable trigger ${trigger}`));
    }
  }
  const allOrgs: string[] = [];
  const allPeople: string[] = [];
  const roleIds: string[] = [];

  beforeAll(async () => {
    const [vacant, trend, viability, viabilityMap, perCapita, buildings, insuranceLoans, hub, csv] = await Promise.all([
      import("./vacant-pulpits"),
      import("./membership-trend"),
      import("./viability"),
      import("./viability-map"),
      import("./per-capita"),
      import("./buildings"),
      import("./insurance-loans"),
      import("./hub"),
      import("./csv"),
    ]);
    readers = { vacant, trend, viability, viabilityMap, perCapita, buildings, insuranceLoans, hub, csv };
    presbytery = await import("@/lib/presbytery");
    ({ withOrgContext } = await import("@/lib/authz"));
    ({ getPlatformDb } = await import("@/lib/db"));
    schema = {
      organizations: (await import("@/lib/db/domain/org")).organizations,
      affiliations: (await import("@/lib/db/domain/lifecycle")).organizationAffiliations,
      groupTypes: (await import("@/lib/db/domain/groups")).groupTypes,
      groups: (await import("@/lib/db/domain/groups")).groups,
      people: (await import("@/lib/db/domain/people")).people,
      memberships: (await import("@/lib/db/domain/people")).memberships,
      permissions: (await import("@/lib/db/domain/authz")).permissions,
      appRoles: (await import("@/lib/db/domain/authz")).appRoles,
      appRolePermissions: (await import("@/lib/db/domain/authz")).appRolePermissions,
      roleGrants: (await import("@/lib/db/domain/authz")).roleGrants,
      appointments: (await import("@/lib/db/domain/officers")).appointments,
      stats: (await import("@/lib/db/domain/presbytery")).congregationStatistics,
      oversight: (await import("@/lib/db/domain/presbytery")).congregationOversight,
      ovProfiles: (await import("@/lib/db/domain/oversight")).oversightProfiles,
      ovBuildings: (await import("@/lib/db/domain/oversight")).oversightBuildings,
      ovAppraisals: (await import("@/lib/db/domain/oversight")).oversightBuildingAppraisals,
      ovInsurance: (await import("@/lib/db/domain/oversight")).oversightInsuranceYears,
      ovLoans: (await import("@/lib/db/domain/oversight")).oversightLoans,
      rates: (await import("@/lib/db/domain/presbytery")).perCapitaRates,
      records: (await import("@/lib/db/domain/presbytery")).perCapitaRecords,
      users: (await import("@/lib/db/schema")).users,
      auditEvents: (await import("@/lib/db/schema")).auditEvents,
    };

    const platform = getPlatformDb();

    async function makeOrg(label: string, type: "presbytery" | "congregation" | "new_worshiping_community", parent: string | null, from = "2000-01-01") {
      const slugLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const [row] = await platform
        .insert(schema.organizations)
        .values({
          deletableUntil: fixtureDeletableUntil(),
          organizationType: type,
          name: `Fixture ${label} (reports test)`,
          slug: `reports-test-${slugLabel}-${stamp}`,
          path: `reports_test_${slugLabel.replace(/-/g, "_")}_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: schema.organizations.id });
      allOrgs.push(row!.id);
      if (parent) {
        await platform.insert(schema.affiliations).values({
          organizationId: parent,
          subjectOrgId: row!.id,
          parentOrgId: parent,
          relationshipType: type === "new_worshiping_community" ? "member_nwc" : "member_congregation",
          effectiveFrom: from,
          authority: "recorded",
          minuteReference: `Fixture affiliation (reports test, ${label})`,
        });
      }
      return row!.id;
    }

    A = await makeOrg("Presbytery A", "presbytery", null);
    B = await makeOrg("Presbytery B", "presbytery", null);

    // A's congregations, each built for one vacancy or data rule.
    c.installed = await makeOrg("Alder installed", "congregation", A);
    c.ended = await makeOrg("Bramble ended", "congregation", A);
    c.none = await makeOrg("Cedar none", "congregation", A);
    c.supply = await makeOrg("Dunmore supply", "congregation", A);
    c.endsToday = await makeOrg("Elkhorn ends today", "congregation", A);
    c.startsToday = await makeOrg("Fairlawn starts today", "congregation", A);
    c.startsTomorrow = await makeOrg("Glenmoor starts tomorrow", "congregation", A);
    c.late = await makeOrg("Hollis late affiliation", "congregation", A, "2024-03-01");
    c.dissolved = await makeOrg("Iverson dissolved", "congregation", A);
    nwcA = await makeOrg("Juniper nwc", "new_worshiping_community", A);
    bCong = await makeOrg("Kestrel in B", "congregation", B);

    // The congregation that MOVED from A to B: A's closed row first, then B's open row.
    c.moved = await makeOrg("Larch moved", "congregation", null);
    await platform.insert(schema.affiliations).values([
      {
        organizationId: A,
        subjectOrgId: c.moved,
        parentOrgId: A,
        relationshipType: "member_congregation",
        effectiveFrom: "2000-01-01",
        effectiveTo: "2024-01-01",
        authority: "recorded",
        minuteReference: "Fixture affiliation (reports test, moved, A)",
        closedByOrgId: A,
        closedOn: "2024-01-01",
        closedMinuteReference: "Fixture closure (reports test, moved)",
      },
      {
        organizationId: B,
        subjectOrgId: c.moved,
        parentOrgId: B,
        relationshipType: "member_congregation",
        effectiveFrom: "2024-01-01",
        authority: "recorded",
        minuteReference: "Fixture affiliation (reports test, moved, B)",
      },
    ]);

    // Defence in depth: parent_id is still A, but the congregation is no longer active.
    await platform.execute(
      sql`update organizations set lifecycle_status = 'dissolved' where id = ${c.dissolved}::uuid`,
    );

    // roster group + people
    const [gt] = await platform
      .insert(schema.groupTypes)
      .values({ key: "roster", name: "roster" })
      .onConflictDoNothing()
      .returning({ id: schema.groupTypes.id });
    const rosterTypeId =
      gt?.id ??
      (await platform.select({ id: schema.groupTypes.id }).from(schema.groupTypes).where(eq(schema.groupTypes.key, "roster")).limit(1))[0]!.id;
    for (const org of [A, B]) {
      await platform.insert(schema.groups).values({
        organizationId: org,
        groupTypeId: rosterTypeId,
        name: "Active Membership",
        membershipSource: "derived",
        derivedFrom: "active_membership",
        isProtected: true,
      });
    }

    const [u] = await platform
      .insert(schema.users)
      .values({ email: `reports-test-${stamp}@example.invalid`, name: "Reports Test" })
      .returning({ id: schema.users.id });
    userId = u!.id;

    async function person(first: string, last: string, org: string) {
      const [p] = await platform
        .insert(schema.people)
        .values({ firstName: first, lastName: last, deletableUntil: fixtureDeletableUntil() })
        .returning({ id: schema.people.id });
      allPeople.push(p!.id);
      await platform.insert(schema.memberships).values({
        organizationId: org,
        personId: p!.id,
        engagementStatus: "regular",
        currentRoll: "active",
      });
      return p!.id;
    }
    minister = await person("Quentin", "Reportstest-Minister", A);
    bMinister = await person("Rosalind", "Reportstest-BMinister", B);

    // The four existing keys (already in the catalog of a migrated database).
    await platform
      .insert(schema.permissions)
      .values([
        { key: "credentials.manage", module: "presbytery", description: "Record credentials", sensitivityTier: 1 },
        { key: "statistics.manage", module: "presbytery", description: "Manage statistics", sensitivityTier: 2 },
        { key: "congregation_oversight.manage", module: "presbytery", description: "Manage oversight", sensitivityTier: 1 },
        { key: "per_capita.manage", module: "presbytery", description: "Manage per capita", sensitivityTier: 2 },
        { key: "congregation_oversight.finance", module: "presbytery", description: "Oversight finance", sensitivityTier: 2 },
      ])
      .onConflictDoNothing();

    async function grant(personId: string, org: string, label: string, keys: string[]) {
      const [role] = await platform
        .insert(schema.appRoles)
        .values({ organizationId: org, key: `reports_test_${label}_${stamp}`, name: `Reports test ${label}`, roleKind: "constitutional", isProtected: true })
        .returning({ id: schema.appRoles.id });
      roleIds.push(role!.id);
      await platform.insert(schema.appRolePermissions).values(keys.map((k) => ({ roleId: role!.id, permissionKey: k })));
      await platform.insert(schema.roleGrants).values({ organizationId: org, roleId: role!.id, personId, startsOn: "2020-01-01", grantedBy: userId });
    }
    const KEYS = {
      vacant: "credentials.manage",
      trend: "statistics.manage",
      viability: "congregation_oversight.manage",
      perCapita: "per_capita.manage",
      finance: "congregation_oversight.finance",
    } as const;
    holder.all = await person("Perpetua", "Reportstest-All", A);
    await grant(holder.all, A, "all", Object.values(KEYS));
    for (const k of ["vacant", "trend", "viability", "perCapita", "finance"] as const) {
      holder[k] = await person("Ptolemy", `Reportstest-${k}`, A);
      await grant(holder[k], A, k, [KEYS[k]]);
    }
    holder.none = await person("Nobody", "Reportstest-None", A);
    bHolder = await person("Beatrix", "Reportstest-BAll", B);
    await grant(bHolder, B, "ball", Object.values(KEYS));

    // Appointments (A's), relative to NOW = 2026-06-15.
    const appt = (org: string, who: string, serving: string, callType: "installed_pastor" | "designated_pastor" | "stated_supply" | "interim_pastor" | "temporary_supply" | "parish_associate", startsOn: string, endsOn: string | null = null) => ({
      organizationId: org,
      personId: who,
      servingOrgId: serving,
      callType,
      startsOn,
      endsOn,
    });
    await platform.insert(schema.appointments).values([
      appt(A, minister, c.installed, "installed_pastor", "2015-01-01"),
      appt(A, minister, c.ended, "installed_pastor", "2005-01-01", "2025-04-15"),
      appt(A, minister, c.supply, "installed_pastor", "2005-01-01", "2024-03-15"),
      appt(A, minister, c.supply, "interim_pastor", "2025-01-02"),
      appt(A, minister, c.endsToday, "installed_pastor", "2005-01-01", "2026-06-15"),
      appt(A, minister, c.startsToday, "designated_pastor", "2026-06-15"),
      appt(A, minister, c.startsTomorrow, "installed_pastor", "2026-06-16"),
      appt(A, minister, c.dissolved, "installed_pastor", "2001-01-01", "2010-01-01"),
      appt(B, bMinister, bCong, "installed_pastor", "2010-01-01"),
    ]);

    // The moved congregation's historical rows can only exist because they predate the move: the
    // about-org triggers (rightly) refuse them now, so they are written with those two triggers off.
    await withTriggersOff(platform, ["appointments:appointments_about_org", "per_capita_records:per_capita_records_about_org"], async () => {
      await platform.insert(schema.appointments).values(appt(A, minister, c.moved, "installed_pastor", "2001-01-01", "2020-01-01"));
      await platform.insert(schema.records).values({ organizationId: A, aboutOrgId: c.moved, billingYear: 2025, basisYear: 2023, endingActiveBasis: 20, rateApplied: "26.25", amountOwed: "525.00", updatedBy: userId });
    });

    // Statistics, through the real writer (it enforces the affiliation window).
    const clerk = holder.all;
    const stat = async (org: string, year: number, endingActive: number | null) => {
      const r = await presbytery.setCongregationStatistics(clerk, A, userId, org, year, { endingActive });
      if (r.kind !== "ok") throw new Error(`stat fixture failed: ${JSON.stringify(r)}`);
    };
    for (const y of [2023, 2024, 2025]) {
      await stat(c.installed, y, 100 + y - 2023);
      await stat(c.ended, y, 50 + y - 2023);
    }
    await stat(c.supply, 2023, 70);
    await stat(c.supply, 2025, 72); // 2024: no row -> "No data"
    await stat(c.none, 2023, null); // a row with no figure -> "Not reported"
    await stat(c.late, 2024, 30);
    await stat(c.late, 2025, 31);
    // B's own statistics: must never reach A.
    const bStat = await presbytery.setCongregationStatistics(bHolder, B, userId, bCong, 2024, { endingActive: 999 });
    if (bStat.kind !== "ok") throw new Error("B stat fixture failed");

    // Oversight.
    const over = async (org: string, input: { viabilityScore?: number | null; redevelopmentNotes?: string | null; buildingsNotes?: string | null; latitude?: number | null; longitude?: number | null }) => {
      const r = await presbytery.setCongregationOversight(clerk, A, userId, org, input);
      if (r.kind !== "ok") throw new Error(`oversight fixture failed: ${JSON.stringify(r)}`);
    };
    await over(c.installed, { viabilityScore: 3, redevelopmentNotes: "Steady", buildingsNotes: "SECRET-BUILDINGS", latitude: 12.5, longitude: -45.25 });
    // The superseded carrier column is no longer writable through setCongregationOversight (F451, R8), so the
    // sentinel the viability reader must never read is planted directly, as a legacy row would hold it.
    await platform.update(schema.oversight).set({ insuranceCarrier: "SECRET-CARRIER" }).where(and(eq(schema.oversight.organizationId, A), eq(schema.oversight.aboutOrgId, c.installed)));
    await over(c.ended, { viabilityScore: 1, redevelopmentNotes: 'Roof, "urgent"\nand boiler' });
    await over(c.none, { viabilityScore: null, redevelopmentNotes: "Watching closely" });
    await over(c.supply, { viabilityScore: 2 });
    const bOver = await presbytery.setCongregationOversight(bHolder, B, userId, bCong, { viabilityScore: 1, redevelopmentNotes: "B-ONLY-NOTE" });
    if (bOver.kind !== "ok") throw new Error("B oversight fixture failed");

    // Per capita: a 2025 rate on the 2023 basis, bills generated through the real writer.
    const rate = await presbytery.setPerCapitaRate(clerk, A, userId, 2025, { basisYear: 2023, ratePerMember: "26.25" });
    if (rate.kind !== "ok") throw new Error("rate fixture failed");
    const gen = await presbytery.generatePerCapitaRecords(clerk, A, userId, 2025);
    if (gen.kind !== "ok") throw new Error("generate fixture failed");
    // Payments through the real writer, including the sub-cent values it lets through.
    const recs = await platform
      .select({ id: schema.records.id, aboutOrgId: schema.records.aboutOrgId })
      .from(schema.records)
      .where(and(eq(schema.records.organizationId, A), eq(schema.records.billingYear, 2025)));
    const recFor = (org: string) => recs.find((r) => r.aboutOrgId === org)!.id;
    const pay = async (org: string, amount: string) => {
      const r = await presbytery.recordPerCapitaPayment(clerk, A, userId, recFor(org), { paidAmount: amount, paidAt: "2025-04-01" });
      if (r.kind !== "ok") throw new Error(`payment fixture failed: ${JSON.stringify(r)}`);
    };
    await pay(c.installed, "100.005"); // sub-cent -> 10001 cents
    await pay(c.ended, "1e3"); // overpays 51 * 26.25 = 1338.75? no: 1e3 = 1000.00
    // A bill for a congregation that is no longer on the roster (dissolved), and one that moved away.
    await platform.insert(schema.records).values([
      { organizationId: A, aboutOrgId: c.dissolved, billingYear: 2025, basisYear: 2023, endingActiveBasis: 10, rateApplied: "26.25", amountOwed: "262.50", updatedBy: userId },
      // a 2024 bill, for the all-years file
      { organizationId: A, aboutOrgId: c.installed, billingYear: 2024, basisYear: 2022, endingActiveBasis: 99, rateApplied: "25.00", amountOwed: "2475.00", updatedBy: userId },
    ]);
    // B's own bill: never in A.
    await platform.insert(schema.records).values({ organizationId: B, aboutOrgId: bCong, billingYear: 2025, basisYear: 2023, endingActiveBasis: 5, rateApplied: "1.00", amountOwed: "5.00", updatedBy: userId });

    // ── Congregation Oversight rows for the two oversight reports (DECISION-348), written as the owner. ──
    const by = { createdBy: userId, updatedBy: userId };
    const removal = { removedAt: new Date("2026-02-01T00:00:00Z"), removedBy: userId };
    const newBuilding = async (org: string, about: string, name: string, over: Partial<typeof schema.ovBuildings.$inferInsert> = {}) => {
      const [row] = await platform
        .insert(schema.ovBuildings)
        .values({ organizationId: org, aboutOrgId: about, name, buildingType: "sanctuary", ...by, ...over })
        .returning({ id: schema.ovBuildings.id });
      return row!.id;
    };
    const newAppraisal = (org: string, about: string, buildingId: string, assessedYear: number, amountCents: number, removed = false) =>
      platform.insert(schema.ovAppraisals).values({ organizationId: org, aboutOrgId: about, buildingId, assessedYear, amountCents, createdBy: userId, ...(removed ? removal : {}) });
    const newPolicy = (org: string, about: string, policyYear: number, over: Partial<typeof schema.ovInsurance.$inferInsert> = {}) =>
      platform.insert(schema.ovInsurance).values({ organizationId: org, aboutOrgId: about, policyYear, ...by, ...over });
    const newLoan = (org: string, about: string, over: Partial<typeof schema.ovLoans.$inferInsert> = {}) =>
      platform.insert(schema.ovLoans).values({ organizationId: org, aboutOrgId: about, kind: "presbytery_program", ...by, ...over });

    // Alder (installed): every rule on one congregation.
    await platform.insert(schema.ovProfiles).values({
      organizationId: A,
      aboutOrgId: c.installed,
      streetAddress: "100 SECRET-STREET LANE",
      city: "Alderton",
      county: "Marsh",
      ...by,
    });
    const sanctuary = await newBuilding(A, c.installed, "Sanctuary", {
      isPrimary: true,
      yearBuilt: 1902,
      firstAdditionYear: 1950,
      squareFeet: 12500,
      roofCondition: "good",
      plumbingCondition: "fair",
      hvacCondition: "poor",
      hasSprinklers: true,
      hasFireAlarm: false,
      notes: "SECRET-BUILDING-NOTE",
    });
    await newBuilding(A, c.installed, "Fellowship Hall", { buildingType: "fellowship_hall" });
    const annex = await newBuilding(A, c.installed, "Annex", { buildingType: "annex", retiredOn: "2025-05-01", retiredReason: "sold" });
    const oldHall = await newBuilding(A, c.installed, "Old Hall", { buildingType: "fellowship_hall" });
    await newAppraisal(A, c.installed, sanctuary, 2020, 90_000_000);
    await newAppraisal(A, c.installed, sanctuary, 2024, 95_000_050); // the newest: $950,000.50
    await newAppraisal(A, c.installed, sanctuary, 2025, 1, true); // removed: not the newest
    await newAppraisal(A, c.installed, annex, 2024, 77_777_700); // retired building: not counted
    await newAppraisal(A, c.installed, oldHall, 2024, 66_666_600); // its building is removed next
    await platform.update(schema.ovBuildings).set(removal).where(eq(schema.ovBuildings.id, oldHall));
    await newPolicy(A, c.installed, 2023, { carrier: "Old Mutual", policyExpiresOn: "2024-09-01" });
    await newPolicy(A, c.installed, 2025, {
      carrier: "Example Mutual",
      policyNumber: "SECRET-POLICY-NO",
      policyExpiresOn: "2026-09-01",
      recentClaims: false,
      poolInterest: true,
      notes: "SECRET-INS-NOTE",
    });
    await newPolicy(A, c.installed, 2026, { carrier: "REMOVED-MUTUAL", ...removal });
    await newLoan(A, c.installed, {
      lender: "SECRET-LENDER",
      originalAmountCents: 25_000_000,
      currentBalanceCents: 18_125_050,
      balanceAsOf: "2026-01-01",
      grantsAmountCents: 500_000,
      guaranteeNote: "Guaranteed up to the original amount",
      notes: "SECRET-LOAN-NOTE",
    });
    await newLoan(A, c.installed, { kind: "other" }); // open, nothing recorded
    await newLoan(A, c.installed, { status: "paid_off", paidOffOn: "2025-12-01", currentBalanceCents: 0, balanceAsOf: "2025-12-01", guaranteeNote: "PAID-OFF-GUARANTEE" });
    await newLoan(A, c.installed, { guaranteeNote: "REMOVED-GUARANTEE", ...removal });

    // Bramble (ended): a building with nothing recorded but its type.
    await newBuilding(A, c.ended, "Chapel", { buildingType: "other" });
    // Dunmore (supply): its only building is retired, so it has none in use.
    await newBuilding(A, c.supply, "Old Church", { retiredOn: "2024-01-01", retiredReason: "closed" });
    // Iverson (dissolved, still under A): rows exist, the reports leave it out.
    await platform.insert(schema.ovProfiles).values({ organizationId: A, aboutOrgId: c.dissolved, city: "DISSOLVED-CITY", ...by });
    await newBuilding(A, c.dissolved, "DISSOLVED-SANCTUARY");
    await newPolicy(A, c.dissolved, 2025, { carrier: "DISSOLVED-MUTUAL" });
    await newLoan(A, c.dissolved, { guaranteeNote: "DISSOLVED-GUARANTEE" });
    // Larch (moved to B): A keeps its rows from before the move, which the about-org triggers now refuse.
    await withTriggersOff(
      platform,
      ["oversight_buildings:oversight_buildings_about_org", "oversight_insurance_years:oversight_insurance_years_about_org", "oversight_loans:oversight_loans_about_org"],
      async () => {
        await newBuilding(A, c.moved, "MOVED-HALL");
        await newPolicy(A, c.moved, 2025, { carrier: "MOVED-MUTUAL" });
        await newLoan(A, c.moved, { guaranteeNote: "MOVED-GUARANTEE" });
      },
    );
    // B's own rows: never in A.
    await platform.insert(schema.ovProfiles).values({ organizationId: B, aboutOrgId: bCong, city: "Bville", county: "Bshire", ...by });
    const bBuilding = await newBuilding(B, bCong, "B-ONLY-BUILDING", { isPrimary: true });
    await newAppraisal(B, bCong, bBuilding, 2024, 42_000_000);
    await newPolicy(B, bCong, 2025, { carrier: "B-ONLY-MUTUAL", policyExpiresOn: "2027-01-01" });
    await newLoan(B, bCong, { guaranteeNote: "B-ONLY-GUARANTEE", currentBalanceCents: 123_400, balanceAsOf: "2026-01-01" });
  }, 60_000);

  afterAll(async () => {
    const platform = getPlatformDb();
    try {
      await platform.delete(schema.auditEvents).where(inArray(schema.auditEvents.resourceId, [A, B]));
      await platform.execute(sql`alter table congregation_statistics disable trigger congregation_statistics_freeze`);
      try {
        await platform.delete(schema.stats).where(inArray(schema.stats.organizationId, [A, B]));
      } finally {
        await platform.execute(sql`alter table congregation_statistics enable trigger congregation_statistics_freeze`);
      }
      await platform.delete(schema.records).where(inArray(schema.records.organizationId, [A, B]));
      await platform.delete(schema.rates).where(inArray(schema.rates.organizationId, [A, B]));
      // The six oversight tables' rows first (about_org_id has no cascade), children before buildings.
      await platform.delete(schema.ovAppraisals).where(inArray(schema.ovAppraisals.organizationId, [A, B]));
      await platform.delete(schema.ovLoans).where(inArray(schema.ovLoans.organizationId, [A, B]));
      await platform.delete(schema.ovInsurance).where(inArray(schema.ovInsurance.organizationId, [A, B]));
      await platform.delete(schema.ovProfiles).where(inArray(schema.ovProfiles.organizationId, [A, B]));
      await platform.delete(schema.ovBuildings).where(inArray(schema.ovBuildings.organizationId, [A, B]));
      await platform.delete(schema.oversight).where(inArray(schema.oversight.organizationId, [A, B]));
      await platform.delete(schema.appointments).where(inArray(schema.appointments.organizationId, [A, B]));
      await platform.execute(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
      try {
        for (const id of [...allOrgs].reverse()) {
          // congregations first, presbyteries last (the parent_org_id FK does not cascade)
          if (id === A || id === B) continue;
          await platform.delete(schema.organizations).where(eq(schema.organizations.id, id));
        }
        await platform.delete(schema.organizations).where(eq(schema.organizations.id, A));
        await platform.delete(schema.organizations).where(eq(schema.organizations.id, B));
      } finally {
        await platform.execute(sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
      }
    } finally {
      for (const id of allPeople) await platform.delete(schema.people).where(eq(schema.people.id, id));
      await platform.delete(schema.users).where(eq(schema.users.id, userId));
    }
  }, 60_000);

  const auditRows = async (org = A) => {
    const platform = getPlatformDb();
    return platform
      .select({ metadata: schema.auditEvents.metadata, actorUserId: schema.auditEvents.actorUserId })
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.resourceId, org), eq(schema.auditEvents.action, "tenant.presbytery_report.exported")));
  };

  // ---------------------------------------------------------------------------

  describe("the key is checked inside the transaction", () => {
    it("each key opens only its own report", async () => {
      const cases = [
        ["vacant", (p: string) => readers.vacant.getVacantPulpits(viewerFor(p), NOW)],
        ["trend", (p: string) => readers.trend.getMembershipTrend(viewerFor(p), { from: 2023, to: 2025 })],
        ["viability", (p: string) => readers.viability.getViability(viewerFor(p))],
        ["perCapita", (p: string) => readers.perCapita.getPerCapita(viewerFor(p), { kind: "year", billingYear: 2025 })],
      ] as const;
      for (const [own, read] of cases) {
        for (const who of ["vacant", "trend", "viability", "perCapita", "none"] as const) {
          const result = await read(holder[who]);
          expect(result.kind, `${who} reading the ${own} report`).toBe(who === own ? "ok" : "forbidden");
        }
        expect((await read(holder.all)).kind).toBe("ok");
      }
    });

    it("an export refuses the same viewers, and writes nothing for them", async () => {
      const before = (await auditRows()).length;
      expect(await readers.vacant.exportVacantPulpits(viewerFor(holder.none), NOW)).toEqual({ kind: "forbidden" });
      expect(await readers.trend.exportMembershipTrend(viewerFor(holder.vacant), { from: 2023, to: 2025 })).toEqual({ kind: "forbidden" });
      expect(await readers.viability.exportViability(viewerFor(holder.perCapita))).toEqual({ kind: "forbidden" });
      expect(await readers.perCapita.exportPerCapita(viewerFor(holder.trend), { kind: "all" })).toEqual({ kind: "forbidden" });
      expect((await auditRows()).length).toBe(before);
    });

    it("the hub reads the live lock state for all six reports (Buildings follows the manage key, Insurance and loans the finance key)", async () => {
      const none = { vacant_pulpits: false, membership_trend: false, viability: false, per_capita: false, buildings: false, insurance_and_loans: false };
      expect((await readers.hub.getReportsHub(viewerFor(holder.all))).held).toEqual({
        vacant_pulpits: true,
        membership_trend: true,
        viability: true,
        per_capita: true,
        buildings: true,
        insurance_and_loans: true,
      });
      expect((await readers.hub.getReportsHub(viewerFor(holder.trend))).held).toEqual({ ...none, membership_trend: true });
      expect((await readers.hub.getReportsHub(viewerFor(holder.viability))).held).toEqual({ ...none, viability: true, buildings: true });
      expect((await readers.hub.getReportsHub(viewerFor(holder.finance))).held).toEqual({ ...none, insurance_and_loans: true });
      expect((await readers.hub.getReportsHub(viewerFor(holder.none))).held).toEqual(none);
    });

    it("a person with no membership at the presbytery cannot even open the transaction", async () => {
      await expect(readers.viability.getViability(viewerFor(bHolder))).rejects.toThrow();
    });
  });

  describe("vacant pulpits", () => {
    const data = async () => {
      const r = await readers.vacant.getVacantPulpits(viewerFor(holder.vacant), NOW);
      if (r.kind !== "ok") throw new Error("expected ok");
      return r.data;
    };

    it("lists exactly the vacant congregations of A, with 'vacant since' and supply", async () => {
      const d = await data();
      const names = d.rows.map((r) => r.name.replace(/^Fixture | \(reports test\)$/g, ""));
      // Oldest vacancy first (Dunmore 2024-03-15, Bramble 2025-04-15), then no ended call (Cedar, Glenmoor, Hollis).
      expect(names).toEqual(["Dunmore supply", "Bramble ended", "Cedar none", "Glenmoor starts tomorrow", "Hollis late affiliation"]);
      const byName = Object.fromEntries(d.rows.map((r) => [r.name.replace(/^Fixture | \(reports test\)$/g, ""), r]));
      expect(byName["Dunmore supply"]).toMatchObject({ vacantSince: "2024-03-15", supply: { callType: "interim_pastor", startsOn: "2025-01-02" } });
      expect(byName["Bramble ended"]).toMatchObject({ vacantSince: "2025-04-15", supply: null });
      expect(byName["Cedar none"]).toMatchObject({ vacantSince: null, daysVacant: null });
      expect(d.rosterCount).toBe(8);
      expect(d.appointmentsRecorded).toBe(true);
    });

    it("the boundaries: a call ending today and one starting today both fill; one starting tomorrow does not", async () => {
      const ids = (await data()).rows.map((r) => r.organizationId);
      expect(ids).not.toContain(c.endsToday);
      expect(ids).not.toContain(c.startsToday);
      expect(ids).toContain(c.startsTomorrow);
      // Advance one day: the call that ended 'today' no longer fills, the one starting tomorrow now does.
      const tomorrow = await readers.vacant.getVacantPulpits(viewerFor(holder.vacant), new Date("2026-06-16T12:00:00Z"));
      if (tomorrow.kind !== "ok") throw new Error("expected ok");
      const t = tomorrow.data.rows.map((r) => r.organizationId);
      expect(t).toContain(c.endsToday);
      expect(t).not.toContain(c.startsTomorrow);
    });

    it("never lists a congregation that is off the roster: another presbytery's, a moved one, a dissolved one, an NWC", async () => {
      const ids = (await data()).rows.map((r) => r.organizationId);
      for (const off of [bCong, c.moved, c.dissolved, nwcA]) expect(ids).not.toContain(off);
    });

    it("the moved congregation keeps A's appointment row, though it is on no A report", async () => {
      const platform = getPlatformDb();
      const rows = await platform.select({ id: schema.appointments.id }).from(schema.appointments).where(and(eq(schema.appointments.organizationId, A), eq(schema.appointments.servingOrgId, c.moved)));
      expect(rows).toHaveLength(1);
    });

    it("B's own report lists the moved congregation with NO 'vacant since' from A's rows", async () => {
      const r = await readers.vacant.getVacantPulpits(viewerFor(bHolder, B), NOW);
      if (r.kind !== "ok") throw new Error(`expected ok, got ${r.kind}`);
      const moved = r.data.rows.find((x) => x.organizationId === c.moved);
      expect(moved).toMatchObject({ vacantSince: null, supply: null });
      expect(r.data.rows.map((x) => x.organizationId)).not.toContain(bCong); // B's congregation is filled
    });

    it("'appointments recorded' is false when the only appointment serves a congregation off the roster", async () => {
      // B has appointments for bCong only; query B's roster with the A-only moved row removed from view:
      // here we assert the roster-scoped rule through A's derive on a presbytery whose appointments all serve others.
      const platform = getPlatformDb();
      const lonely = await (async () => {
        const [org] = await platform
          .insert(schema.organizations)
          .values({ deletableUntil: fixtureDeletableUntil(), organizationType: "presbytery", name: "Fixture Lonely (reports test)", slug: `reports-test-lonely-${stamp}`, path: `reports_test_lonely_${stamp}`, platformStatus: "unmanaged" })
          .returning({ id: schema.organizations.id });
        allOrgs.push(org!.id);
        return org!.id;
      })();
      const [gt] = await platform.select({ id: schema.groupTypes.id }).from(schema.groupTypes).where(eq(schema.groupTypes.key, "roster")).limit(1);
      await platform.insert(schema.groups).values({ organizationId: lonely, groupTypeId: gt!.id, name: "Active Membership", membershipSource: "derived", derivedFrom: "active_membership", isProtected: true });
      const [p] = await platform.insert(schema.people).values({ firstName: "Lone", lastName: "Reportstest-Lonely", deletableUntil: fixtureDeletableUntil() }).returning({ id: schema.people.id });
      allPeople.push(p!.id);
      await platform.insert(schema.memberships).values({ organizationId: lonely, personId: p!.id, engagementStatus: "regular", currentRoll: "active" });
      const [role] = await platform.insert(schema.appRoles).values({ organizationId: lonely, key: `reports_test_lonely_${stamp}`, name: "Lonely", roleKind: "constitutional", isProtected: true }).returning({ id: schema.appRoles.id });
      await platform.insert(schema.appRolePermissions).values({ roleId: role!.id, permissionKey: "credentials.manage" });
      await platform.insert(schema.roleGrants).values({ organizationId: lonely, roleId: role!.id, personId: p!.id, startsOn: "2020-01-01", grantedBy: userId });
      // One congregation on the roster, with NO appointment; the only appointment serves a congregation that is not on it.
      const onRoster = await (async () => {
        const [org] = await platform
          .insert(schema.organizations)
          .values({ deletableUntil: fixtureDeletableUntil(), organizationType: "congregation", name: "Fixture Lonely child (reports test)", slug: `reports-test-lonely-child-${stamp}`, path: `reports_test_lonely_child_${stamp}`, platformStatus: "unmanaged" })
          .returning({ id: schema.organizations.id });
        allOrgs.push(org!.id);
        await platform.insert(schema.affiliations).values({ organizationId: lonely, subjectOrgId: org!.id, parentOrgId: lonely, relationshipType: "member_congregation", effectiveFrom: "2000-01-01", authority: "recorded", minuteReference: "Fixture (reports test, lonely)" });
        return org!.id;
      })();
      await withTriggersOff(platform, ["appointments:appointments_about_org"], async () => {
        await platform.insert(schema.appointments).values({ organizationId: lonely, personId: p!.id, servingOrgId: c.moved, callType: "installed_pastor", startsOn: "2001-01-01" });
      });
      try {
        const r = await readers.vacant.getVacantPulpits(viewerFor(p!.id, lonely), NOW);
        if (r.kind !== "ok") throw new Error("expected ok");
        expect(r.data.appointmentsRecorded).toBe(false);
        expect(r.data.rows.map((x) => x.organizationId)).toEqual([onRoster]);
        expect(await readers.vacant.exportVacantPulpits(viewerFor(p!.id, lonely), NOW)).toEqual({ kind: "nothing_to_export" });
        expect(await auditRows(lonely)).toHaveLength(0);
      } finally {
        await platform.delete(schema.appointments).where(eq(schema.appointments.organizationId, lonely));
        await platform.delete(schema.auditEvents).where(eq(schema.auditEvents.resourceId, lonely));
      }
    });
  });

  describe("membership trend", () => {
    const window = { from: 2022, to: 2025 };
    const data = async () => {
      const r = await readers.trend.getMembershipTrend(viewerFor(holder.trend), window);
      if (r.kind !== "ok") throw new Error("expected ok");
      return r.data;
    };
    const cellsFor = (d: Awaited<ReturnType<typeof data>>, org: string) => d.rows.find((r) => r.organizationId === org)!.cells;

    it("separates a dash (outside the affiliation window), 'no data' and 'not reported'", async () => {
      const d = await data();
      // Hollis: affiliated from 2024-03-01, so 2022 and 2023 are dashes; 2024 and 2025 have figures.
      expect(cellsFor(d, c.late).map((x) => x.kind)).toEqual(["not_member", "not_member", "value", "value"]);
      // Dunmore: 2023 and 2025 on file, 2024 and 2022 no data.
      expect(cellsFor(d, c.supply).map((x) => x.kind)).toEqual(["no_data", "value", "no_data", "value"]);
      // Cedar: a 2023 row with no figure.
      expect(cellsFor(d, c.none)[1]).toEqual({ kind: "value", endingActive: null, source: "presbytery_entered" });
    });

    it("never includes B's congregation, nor B's 999", async () => {
      const d = await data();
      expect(d.rows.map((r) => r.organizationId)).not.toContain(bCong);
      // Not a substring search: the payload carries random UUIDs, and "999"
      // turns up inside them often enough to redden a run (Phase 5 run 1).
      const cells = d.rows.flatMap((r) => r.cells);
      expect(cells.some((x) => x.kind === "value" && x.endingActive === 999)).toBe(false);
    });

    it("parity: every cell equals the figure the existing single-year rollup returns for that year", async () => {
      const d = await data();
      for (const year of [2022, 2023, 2024, 2025]) {
        const roll = await presbytery.getCongregationStatisticsRollup(holder.all, A, year);
        if (roll.kind !== "ok") throw new Error("expected ok");
        for (const row of roll.data) {
          const cell = d.rows.find((r) => r.organizationId === row.organizationId)?.cells[year - 2022];
          if (!cell || cell.kind === "not_member") continue;
          expect(cell.kind === "value" ? cell.endingActive : "no row", `${row.name} ${year}`).toEqual(row.hasData ? row.endingActive : "no row");
        }
      }
    });

    it("fetchStatisticsForYears returns each year of the window in one read, and none of B's rows", async () => {
      // The coalesce itself (published wins, withdrawn ignored) is pinned by presbytery.test.ts, whose
      // single-year path now delegates to this function; here the multi-year shape is pinned.
      const byYears = await withOrgContext(holder.all, A, (tx) => presbytery.fetchStatisticsForYears(tx, A, 2023, 2025));
      expect([...byYears.keys()].sort()).toEqual([2023, 2024, 2025]);
      expect(byYears.get(2024)!.has(bCong)).toBe(false);
      expect(byYears.get(2024)!.get(c.installed)?.endingActive).toBe(101);
    });
  });

  describe("viability", () => {
    it("sorts at risk first and 'not yet assessed' last, with notes; reads no building, insurance or coordinate", async () => {
      const r = await readers.viability.getViability(viewerFor(holder.viability));
      if (r.kind !== "ok") throw new Error("expected ok");
      const labels = r.data.rows.map((x) => x.label);
      expect(labels.slice(0, 3)).toEqual(["At risk", "Fair", "Healthy"]);
      expect(labels.slice(3).every((l) => l === "Not yet assessed")).toBe(true);
      expect(r.data.rows[0].notes).toBe('Roof, "urgent"\nand boiler');
      const text = JSON.stringify(r.data);
      for (const secret of ["SECRET-BUILDINGS", "SECRET-CARRIER", "12.5", "-45.25", "B-ONLY-NOTE"]) expect(text).not.toContain(secret);
      expect(r.data.rosterCount).toBe(8);
      expect(r.data.rows.map((x) => x.organizationId)).not.toContain(bCong);
      expect(r.data.rows.find((x) => x.organizationId === c.installed)!.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("viability map (DECISION-343)", () => {
    it("places only the congregation with a usable pair, roster first, and carries the four fields and nothing else", async () => {
      const r = await readers.viabilityMap.getViabilityMap(viewerFor(holder.viability));
      if (r.kind !== "ok") throw new Error("expected ok");
      expect(r.data.total).toBe(8);
      expect(r.data.pins).toHaveLength(1);
      expect(r.data.pins[0]).toMatchObject({ id: c.installed, lat: 12.5, lng: -45.25, score: 3, label: "Healthy" });
      expect(r.data.unplaced).toHaveLength(7);
      expect(r.data.unplaced.map((u) => u.id)).not.toContain(c.installed);
      const ids = [...r.data.pins.map((p) => p.id), ...r.data.unplaced.map((u) => u.id)];
      expect(ids).not.toContain(bCong);
      expect(ids).not.toContain(nwcA);
      const text = JSON.stringify(r.data);
      for (const secret of ["SECRET-BUILDINGS", "SECRET-CARRIER", "B-ONLY-NOTE", "Steady", "urgent"]) expect(text).not.toContain(secret);
    });

    it("is refused for every other key and for a person with no membership, live in its own transaction", async () => {
      for (const who of ["vacant", "trend", "perCapita", "none"] as const) {
        expect(await readers.viabilityMap.getViabilityMap(viewerFor(holder[who]))).toEqual({ kind: "forbidden" });
      }
      await expect(readers.viabilityMap.getViabilityMap(viewerFor(bHolder))).rejects.toThrow();
    });

    it("treats a stored 'NaN' (the unconstrained numeric column accepts it) as no location, not a pin", async () => {
      const platform = getPlatformDb();
      await platform
        .update(schema.oversight)
        .set({ latitude: "NaN", longitude: "NaN" })
        .where(and(eq(schema.oversight.organizationId, A), eq(schema.oversight.aboutOrgId, c.installed)));
      try {
        const r = await readers.viabilityMap.getViabilityMap(viewerFor(holder.viability));
        if (r.kind !== "ok") throw new Error("expected ok");
        expect(r.data.pins).toEqual([]);
        expect(r.data.unplaced.map((u) => u.id)).toContain(c.installed);
      } finally {
        await platform
          .update(schema.oversight)
          .set({ latitude: "12.5", longitude: "-45.25" })
          .where(and(eq(schema.oversight.organizationId, A), eq(schema.oversight.aboutOrgId, c.installed)));
      }
    });
  });

  describe("per capita", () => {
    const year = { kind: "year", billingYear: 2025 } as const;
    const data = async (params: Parameters<typeof readers.perCapita.getPerCapita>[1] = year) => {
      const r = await readers.perCapita.getPerCapita(viewerFor(holder.perCapita), params);
      if (r.kind !== "ok") throw new Error("expected ok");
      return r.data;
    };

    it("rounds each stored figure to the cent in SQL: 100.005 -> 10001 cents, 1e3 -> 100000 cents; outstanding is from the rounded cents", async () => {
      const d = await data();
      const installed = d.rows.find((r) => r.organizationId === c.installed)!;
      const ended = d.rows.find((r) => r.organizationId === c.ended)!;
      expect(installed.paidCents).toBe(10001);
      expect(installed.outstandingCents).toBe(installed.billedCents! - 10001);
      expect(ended.paidCents).toBe(100000);
    });

    it("keeps a departed congregation's bill, marks it, and never shows B's bill", async () => {
      const d = await data();
      expect(d.rows.find((r) => r.organizationId === c.dissolved)?.membership).toBe("departed");
      expect(d.rows.find((r) => r.organizationId === c.moved)?.membership).toBe("departed");
      expect(d.rows.map((r) => r.organizationId)).not.toContain(bCong);
    });

    it("explains why a roster congregation is not billed: no statistics for the basis year, or not generated yet", async () => {
      const d = await data();
      const notBilled = d.rows.filter((r) => r.status === "not_billed");
      // Cedar has a 2023 row with a null figure and Dunmore has 70 for 2023: Dunmore was billed by generate.
      expect(notBilled.find((r) => r.organizationId === c.none)?.notBilledReason).toBe("no_statistics");
      expect(notBilled.find((r) => r.organizationId === c.late)?.notBilledReason).toBe("no_statistics"); // no 2023 row (affiliated 2024)
      expect(d.rows.find((r) => r.organizationId === c.supply)?.status).not.toBe("not_billed");
      expect(d.rateBasisYear).toBe(2023);
      expect(d.anyBillsAnyYear).toBe(true);
    });

    it("a year with no bills is empty (no not-billed list) and still offers 'all years'", async () => {
      const d = await data({ kind: "year", billingYear: 2031 });
      expect(d.rows).toEqual([]);
      expect(d.anyBillsAnyYear).toBe(true);
    });

    it("the all-years form holds every year's bills, none of B's", async () => {
      const d = await data({ kind: "all" });
      expect(new Set(d.rows.map((r) => r.billingYear))).toEqual(new Set([2024, 2025]));
      expect(d.rows.some((r) => r.status === "not_billed")).toBe(false);
    });
  });

  describe("the page and the file agree (one read, one builder)", () => {
    it("vacant pulpits", async () => {
      const v = viewerFor(holder.vacant);
      const page = await readers.vacant.getVacantPulpits(v, NOW);
      const file = await readers.vacant.exportVacantPulpits(v, NOW);
      if (page.kind !== "ok" || file.kind !== "ok") throw new Error("expected ok");
      expect(file.csv).toBe(readers.csv.buildVacantPulpitsCsv(page.data));
      expect(file.rowCount).toBe(page.data.rows.length);
    });

    it("membership trend", async () => {
      const v = viewerFor(holder.trend);
      const params = { from: 2022, to: 2025 };
      const page = await readers.trend.getMembershipTrend(v, params);
      const file = await readers.trend.exportMembershipTrend(v, params);
      if (page.kind !== "ok" || file.kind !== "ok") throw new Error("expected ok");
      expect(file.csv).toBe(readers.csv.buildMembershipTrendCsv(page.data));
      const lines = file.csv.split("\r\n").length - 2; // header and the trailing empty
      expect(file.rowCount).toBe(lines);
    });

    it("viability", async () => {
      const v = viewerFor(holder.viability);
      const page = await readers.viability.getViability(v);
      const file = await readers.viability.exportViability(v);
      if (page.kind !== "ok" || file.kind !== "ok") throw new Error("expected ok");
      expect(file.csv).toBe(readers.csv.buildViabilityCsv(page.data));
    });

    it("per capita: the file's rows sum to the page's totals", async () => {
      const v = viewerFor(holder.perCapita);
      const params = { kind: "year", billingYear: 2025 } as const;
      const page = await readers.perCapita.getPerCapita(v, params);
      const file = await readers.perCapita.exportPerCapita(v, params);
      if (page.kind !== "ok" || file.kind !== "ok") throw new Error("expected ok");
      expect(file.csv).toBe(readers.csv.buildPerCapitaCsv(page.data));
      const cents = (text: string) => Math.round(Number(text) * 100);
      const sums = { billed: 0, paid: 0, outstanding: 0 };
      for (const line of file.csv.slice(1).split("\r\n").slice(1)) {
        if (!line) continue;
        // billed, paid, outstanding are columns 7 to 9; no field before them contains a comma in this fixture.
        const cells = line.split(",");
        if (cells[6] === "") continue;
        sums.billed += cents(cells[6]);
        sums.paid += cents(cells[7]);
        sums.outstanding += cents(cells[8]);
      }
      expect(sums).toEqual({ billed: page.data.totals.billedCents, paid: page.data.totals.paidCents, outstanding: page.data.totals.outstandingCents });
    });
  });

  describe("the export's audit row", () => {
    it("is written in the export's own transaction, one per export, with no name, note or amount", async () => {
      const before = (await auditRows()).length;
      const v = viewerFor(holder.all);
      await readers.vacant.exportVacantPulpits(v, NOW);
      await readers.trend.exportMembershipTrend(v, { from: 2023, to: 2025 });
      await readers.viability.exportViability(v);
      await readers.perCapita.exportPerCapita(v, { kind: "year", billingYear: 2025 });
      await readers.perCapita.exportPerCapita(v, { kind: "all" });
      const rows = await auditRows();
      expect(rows.length).toBe(before + 5);
      const fresh = rows.slice(before).map((r) => r.metadata as Record<string, unknown>);
      const reports = fresh.map((m) => m.report);
      expect(reports).toEqual(expect.arrayContaining(["vacant_pulpits", "membership_trend", "viability", "per_capita"]));
      expect(fresh.find((m) => m.report === "membership_trend")).toMatchObject({ organizationId: A, fromYear: 2023, toYear: 2025 });
      expect(fresh.filter((m) => m.report === "per_capita").map((m) => (m.billingYear ?? m.allYears))).toEqual(expect.arrayContaining([2025, true]));
      for (const m of fresh) {
        expect(typeof m.rowCount).toBe("number");
        const text = JSON.stringify(m);
        expect(text).not.toMatch(/Fixture|Alder|Bramble|Roof|Watching|Steady/);
      }
      expect(rows.every((r) => r.actorUserId === userId)).toBe(true);
    });

    it("a failed audit insert fails the export and leaves no row (the actor is not a real user)", async () => {
      const before = (await auditRows()).length;
      await expect(readers.viability.exportViability(viewerFor(holder.viability, A, randomUUID()))).rejects.toThrow();
      expect((await auditRows()).length).toBe(before);
    });
  });

  // ---------------------------------------------------------------------------
  // The two oversight reports (DECISION-348)
  // ---------------------------------------------------------------------------

  /** Everything the fixture writes that must never reach a page or a file. */
  const NEVER = /SECRET|B-ONLY|DISSOLVED|MOVED|REMOVED-|PAID-OFF|Old Mutual|Old Hall|Annex|Old Church|100 SECRET/;

  describe("the oversight reports: the key is checked inside the transaction", () => {
    it("Buildings opens for the manage key only; Insurance and loans for the finance key only", async () => {
      const buildings = (p: string) => readers.buildings.getBuildingsReport(viewerFor(p));
      const insurance = (p: string) => readers.insuranceLoans.getInsuranceLoans(viewerFor(p), NOW);
      // the manage key is the viability holder's; "all" holds every key
      for (const who of ["viability", "all"] as const) expect((await buildings(holder[who])).kind, `${who} reading buildings`).toBe("ok");
      for (const who of ["finance", "vacant", "trend", "perCapita", "none"] as const) {
        expect((await buildings(holder[who])).kind, `${who} reading buildings`).toBe("forbidden");
      }
      for (const who of ["finance", "all"] as const) expect((await insurance(holder[who])).kind, `${who} reading insurance`).toBe("ok");
      for (const who of ["viability", "vacant", "trend", "perCapita", "none"] as const) {
        expect((await insurance(holder[who])).kind, `${who} reading insurance`).toBe("forbidden");
      }
    });

    it("a refusal carries no data, and an export refuses the same viewers and writes no audit row", async () => {
      const before = (await auditRows()).length;
      expect(await readers.buildings.getBuildingsReport(viewerFor(holder.finance))).toEqual({ kind: "forbidden" });
      expect(await readers.insuranceLoans.getInsuranceLoans(viewerFor(holder.viability), NOW)).toEqual({ kind: "forbidden" });
      expect(await readers.buildings.exportBuildingsReport(viewerFor(holder.finance))).toEqual({ kind: "forbidden" });
      expect(await readers.buildings.exportBuildingsReport(viewerFor(holder.none))).toEqual({ kind: "forbidden" });
      expect(await readers.insuranceLoans.exportInsuranceLoans(viewerFor(holder.viability), NOW)).toEqual({ kind: "forbidden" });
      expect(await readers.insuranceLoans.exportInsuranceLoans(viewerFor(holder.none), NOW)).toEqual({ kind: "forbidden" });
      expect((await auditRows()).length).toBe(before);
    });

    it("a person with no membership at the presbytery cannot even open the transaction", async () => {
      await expect(readers.buildings.getBuildingsReport(viewerFor(bHolder))).rejects.toThrow();
      await expect(readers.insuranceLoans.getInsuranceLoans(viewerFor(bHolder), NOW)).rejects.toThrow();
    });
  });

  describe("buildings", () => {
    const data = async (who = holder.viability, org = A) => {
      const r = await readers.buildings.getBuildingsReport(viewerFor(who, org));
      if (r.kind !== "ok") throw new Error("expected ok");
      return r.data;
    };

    it("lists the active roster in order, one line per building in use, and a congregation with none as one empty line", async () => {
      const d = await data();
      expect(d.rows.map((r) => [r.organizationId, r.building?.name ?? null])).toEqual([
        [c.installed, "Sanctuary"],
        [c.installed, "Fellowship Hall"],
        [c.ended, "Chapel"],
        [c.none, null],
        [c.supply, null], // its only building is retired
        [c.endsToday, null],
        [c.startsToday, null],
        [c.startsTomorrow, null],
        [c.late, null],
      ]);
      expect(d.rosterCount).toBe(8);
      expect(d.withoutBuildings).toBe(6);
      expect(d.buildingCount).toBe(2 + 1);
    });

    it("carries the facts of one building, and the profile's city and county on each line of its congregation", async () => {
      const d = await data();
      const [first, second, chapel] = d.rows;
      expect(first).toMatchObject({ name: "Fixture Alder installed (reports test)", city: "Alderton", county: "Marsh" });
      expect(first.building).toMatchObject({
        name: "Sanctuary",
        buildingType: "sanctuary",
        yearBuilt: 1902,
        firstAdditionYear: 1950,
        secondAdditionYear: null,
        squareFeet: 12500,
        roofCondition: "good",
        plumbingCondition: "fair",
        hvacCondition: "poor",
        boilerCondition: null,
        hasSprinklers: true,
        hasFireAlarm: false,
        hasSecuritySystem: null,
        isPrimary: true,
      });
      expect(second).toMatchObject({ city: "Alderton", county: "Marsh" });
      expect(second.building).toMatchObject({ name: "Fellowship Hall", isPrimary: false });
      expect(chapel).toMatchObject({ city: null, county: null });
    });

    it("leaves out a removed building, a retired one, and every row of a congregation off the roster (dissolved, moved away, another presbytery's)", async () => {
      const text = JSON.stringify(await data());
      expect(text).not.toMatch(NEVER);
    });

    it("never selects a street address or a note, so neither can reach the page or the file", async () => {
      const text = JSON.stringify(await data());
      expect(text).not.toMatch(/SECRET/);
      const file = await readers.buildings.exportBuildingsReport(viewerFor(holder.viability));
      if (file.kind !== "ok") throw new Error("expected ok");
      expect(file.csv).not.toMatch(NEVER);
    });

    it("presbytery B reads only its own congregation, and never A's", async () => {
      const d = await data(bHolder, B);
      expect(d.rows.map((r) => [r.organizationId, r.building?.name ?? null, r.city])).toEqual([
        [bCong, "B-ONLY-BUILDING", "Bville"],
        [c.moved, null, null], // B's roster; A's rows about it are A's, not B's
      ]);
      expect(JSON.stringify(d)).not.toMatch(/Sanctuary|Alderton|Chapel|SECRET|MOVED/);
    });
  });

  describe("insurance and loans", () => {
    const data = async (who = holder.finance, org = A) => {
      const r = await readers.insuranceLoans.getInsuranceLoans(viewerFor(who, org), NOW);
      if (r.kind !== "ok") throw new Error("expected ok");
      return r.data;
    };
    const rowOf = (d: Awaited<ReturnType<typeof data>>, org: string) => d.rows.find((r) => r.organizationId === org)!;

    it("one row per active member congregation, in roster order, and none for one that is off the roster", async () => {
      const d = await data();
      expect(d.rows.map((r) => r.organizationId)).toEqual([c.installed, c.ended, c.none, c.supply, c.endsToday, c.startsToday, c.startsTomorrow, c.late]);
      expect(d.rosterCount).toBe(8);
      expect(d.today).toBe("2026-06-15");
    });

    it("the newest live policy year wins (a removed newer year and an older year do not), with its expiry measured against the organization's day", async () => {
      const alder = rowOf(await data(), c.installed);
      expect(alder.insurance).toEqual({
        policyYear: 2025,
        carrier: "Example Mutual",
        policyExpiresOn: "2026-09-01",
        expiry: "current",
        recentClaims: false,
        poolInterest: true,
      });
      expect(rowOf(await data(), c.ended).insurance).toBeNull();
    });

    it("counts the open loans only, sums what is recorded, and says how many are not recorded", async () => {
      const alder = rowOf(await data(), c.installed);
      expect(alder).toMatchObject({
        openLoans: 2, // the paid-off loan and the removed one are not open loans
        originalCents: 25_000_000,
        balanceCents: 18_125_050,
        grantsCents: 500_000,
        originalUnrecorded: 1,
        balanceUnrecorded: 1,
        grantsUnrecorded: 1,
        guarantees: ["Guaranteed up to the original amount"],
      });
      expect(rowOf(await data(), c.ended)).toMatchObject({ openLoans: 0, originalCents: null, balanceCents: null, grantsCents: null, guarantees: [] });
    });

    it("appraised value is each in-use building's newest live appraisal; a retired or removed building's does not count", async () => {
      const d = await data();
      expect(rowOf(d, c.installed)).toMatchObject({ appraisedCents: 95_000_050, buildingsWithoutAppraisal: 1 });
      expect(rowOf(d, c.ended)).toMatchObject({ appraisedCents: null, buildingsWithoutAppraisal: 1 });
      expect(rowOf(d, c.supply)).toMatchObject({ appraisedCents: null, buildingsWithoutAppraisal: 0 });
      expect(d.totals).toMatchObject({ appraisedCents: 95_000_050, buildingsWithoutAppraisal: 2, openLoans: 2 });
    });

    it("never reads a policy number, a note, a lender or a street address, and leaves out removed, paid-off and other presbyteries' rows", async () => {
      const text = JSON.stringify(await data());
      expect(text).not.toMatch(NEVER);
      const file = await readers.insuranceLoans.exportInsuranceLoans(viewerFor(holder.finance), NOW);
      if (file.kind !== "ok") throw new Error("expected ok");
      expect(file.csv).not.toMatch(NEVER);
    });

    it("presbytery B reads only its own rows", async () => {
      const d = await data(bHolder, B);
      const b = rowOf(d, bCong);
      expect(b).toMatchObject({
        insurance: { policyYear: 2025, carrier: "B-ONLY-MUTUAL" },
        openLoans: 1,
        balanceCents: 123_400,
        guarantees: ["B-ONLY-GUARANTEE"],
        appraisedCents: 42_000_000,
      });
      expect(JSON.stringify(d)).not.toMatch(/Example Mutual|Alder|SECRET|Guaranteed up to/);
    });
  });

  describe("the oversight reports: the page and the file agree, and the export audits", () => {
    it("buildings: the file is the page's data through the builder, one line per row", async () => {
      const v = viewerFor(holder.viability);
      const page = await readers.buildings.getBuildingsReport(v);
      const file = await readers.buildings.exportBuildingsReport(v);
      if (page.kind !== "ok" || file.kind !== "ok") throw new Error("expected ok");
      expect(file.csv).toBe(readers.csv.buildBuildingsCsv(page.data));
      expect(file.rowCount).toBe(page.data.rows.length);
      expect(file.csv.split("\r\n").length - 2).toBe(file.rowCount);
      expect(file.filenameBase).toBe("buildings");
    });

    it("insurance and loans: the file is the page's data through the builder; its figures are the page's cents as decimals", async () => {
      const v = viewerFor(holder.finance);
      const page = await readers.insuranceLoans.getInsuranceLoans(v, NOW);
      const file = await readers.insuranceLoans.exportInsuranceLoans(v, NOW);
      if (page.kind !== "ok" || file.kind !== "ok") throw new Error("expected ok");
      expect(file.csv).toBe(readers.csv.buildInsuranceLoansCsv(page.data));
      expect(file.rowCount).toBe(page.data.rows.length);
      expect(file.filenameBase).toBe("insurance-and-loans");
      const alder = file.csv.slice(1).split("\r\n").find((l) => l.startsWith("Fixture Alder installed"))!;
      expect(alder).toBe(
        "Fixture Alder installed (reports test),Example Mutual,2025,2026-09-01,No,Yes,2,250000.00,181250.50,1,5000.00,Guaranteed up to the original amount,950000.50,1",
      );
    });

    it("each export writes ONE audit row in its own transaction: the key, the row count, no name, note or amount", async () => {
      const before = (await auditRows()).length;
      await readers.buildings.exportBuildingsReport(viewerFor(holder.all));
      await readers.insuranceLoans.exportInsuranceLoans(viewerFor(holder.all), NOW);
      const rows = await auditRows();
      expect(rows.length).toBe(before + 2);
      const fresh = rows.slice(before).map((r) => r.metadata as Record<string, unknown>);
      expect(fresh.map((m) => m.report).sort()).toEqual(["buildings", "insurance_and_loans"]);
      for (const m of fresh) {
        expect(m).toEqual({ organizationId: A, report: m.report, rowCount: 9 - (m.report === "insurance_and_loans" ? 1 : 0) });
        expect(JSON.stringify(m)).not.toMatch(/Alder|Fixture|Sanctuary|Example|SECRET/);
      }
    });

    it("a failed audit insert fails the export and leaves no row (the actor is not a real user)", async () => {
      const before = (await auditRows()).length;
      await expect(readers.buildings.exportBuildingsReport(viewerFor(holder.viability, A, randomUUID()))).rejects.toThrow();
      await expect(readers.insuranceLoans.exportInsuranceLoans(viewerFor(holder.finance, A, randomUUID()), NOW)).rejects.toThrow();
      expect((await auditRows()).length).toBe(before);
    });
  });

  describe("the lifecycle filter", () => {
    it("a congregation whose parent_id is still A but whose lifecycle is dissolved is on no roster", async () => {
      const platform = getPlatformDb();
      const [row] = await platform.select({ parentId: schema.organizations.parentId, status: schema.organizations.lifecycleStatus }).from(schema.organizations).where(eq(schema.organizations.id, c.dissolved));
      expect(row).toEqual({ parentId: A, status: "dissolved" });
      const v = await readers.viability.getViability(viewerFor(holder.viability));
      if (v.kind !== "ok") throw new Error("expected ok");
      expect(v.data.rows.map((r) => r.organizationId)).not.toContain(c.dissolved);
    });
  });
});
