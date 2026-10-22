// @vitest-environment jsdom
/**
 * Orchestration test for `/admin/organizations/<id>`'s page.tsx —
 * docs/work-log/2026-09-28-founding-administrator.md Phase 4 Batch C.
 *
 * Pins the one thing this batch adds to the page: `listDesignationHolders()`
 * (docs/work-log/2026-10-22-designation-revoke.md: the holder list, from which
 * the SQL count is derived) and `foundingAdministratorPlan()` are read fresh on
 * every render (never cached) and their results are threaded into
 * `<FoundingAdministratorSection>`'s props (`canDesignate`, `holderPeopleCount`,
 * `holders`, `administrationPermissionKeys`,
 * `officeTemplateName`) exactly as Phase 3's design specifies. Every other
 * collaborator on this page (brand, profile, sites, service times) is
 * mocked at its existing boundary — this file does not re-test them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));

const orgRowRef = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));
const brandRowRef = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));
const selectCallCount = vi.hoisted(() => ({ current: 0 }));

const dbMock = vi.hoisted(() => {
  function makeChain(resolve: () => Promise<unknown[]>) {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
    };
    chain.from.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.limit.mockImplementation(resolve);
    return chain;
  }
  const select = vi.fn(() => {
    selectCallCount.current += 1;
    // First select() call on this page is the organization row; second is
    // the brand row (page.tsx's own, unchanged query order).
    return selectCallCount.current === 1
      ? makeChain(() => Promise.resolve(orgRowRef.current ? [orgRowRef.current] : []))
      : makeChain(() => Promise.resolve(brandRowRef.current ? [brandRowRef.current] : []));
  });
  const platformDb = { select };
  return { select, getPlatformDb: vi.fn(() => platformDb) };
});

vi.mock("@/lib/db", async () => {
  await import("@/lib/db/schema");
  return { getPlatformDb: dbMock.getPlatformDb };
});

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockPlan = vi.hoisted(() => vi.fn());
vi.mock("@/lib/onboarding/founding-administrator", () => ({
  foundingAdministratorPlan: (...args: unknown[]) => mockPlan(...args),
}));

// The holder LIST is the page's one read per slot (drizzle/0060: the count is
// derived from it). One mock per slot, keyed by the slot argument.
const mockListFounding = vi.hoisted(() => vi.fn());
const mockListGiving = vi.hoisted(() => vi.fn());
vi.mock("@/lib/onboarding/designation-holders", () => ({
  listDesignationHolders: (db: unknown, orgId: string, slot: string) =>
    slot === "treasurer" ? mockListGiving(db, orgId) : mockListFounding(db, orgId),
}));

const foundingSectionSpy = vi.hoisted(() => vi.fn());
vi.mock("./founding-administrator-section", () => ({
  FoundingAdministratorSection: (props: unknown) => {
    foundingSectionSpy(props);
    return <div data-testid="founding-section" />;
  },
}));

vi.mock("@/lib/onboarding/treasurer-designation", () => ({
  // The real predicate is a one-line allow-list; restated here so the page's
  // branching is exercised, not the mock's.
  treasurerDesignationApplies: (t: string) =>
    t === "congregation" || t === "new_worshiping_community",
}));

const treasurerSectionSpy = vi.hoisted(() => vi.fn());
vi.mock("./treasurer-designation-section", () => ({
  TreasurerDesignationSection: (props: unknown) => {
    treasurerSectionSpy(props);
    return <div data-testid="treasurer-section" />;
  },
}));

const mockListInvitations = vi.hoisted(() => vi.fn());
vi.mock("@/lib/onboarding/issue", () => ({
  listInvitationsForOrg: (...args: unknown[]) => mockListInvitations(...args),
}));
vi.mock("@/lib/auth/local-login", () => ({ isLocalLoginEnabled: async () => true }));
vi.mock("@/lib/two-factor", () => ({ isTotpConfigured: () => true }));
const revokeAllSpy = vi.hoisted(() => vi.fn());
vi.mock("./revoke-all-invitations", () => ({
  RevokeAllInvitations: (props: unknown) => {
    revokeAllSpy(props);
    return <div data-testid="revoke-all" />;
  },
}));

const mockListHealth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/giving-ingest-health", () => ({
  listIngestHealth: (...args: unknown[]) => mockListHealth(...args),
}));

const healthSectionSpy = vi.hoisted(() => vi.fn());
vi.mock("./ingest-health-section", () => ({
  IngestHealthSection: (props: unknown) => {
    healthSectionSpy(props);
    return <div data-testid="health-section" />;
  },
}));

const mockGetAffiliation = vi.hoisted(() => vi.fn());
vi.mock("@/lib/org-provisioning", () => ({
  getOrganizationAffiliationAdminDetail: (...args: unknown[]) =>
    mockGetAffiliation(...args),
}));

const mockReadDomains = vi.hoisted(() => vi.fn());
vi.mock("@/lib/domains/platform-read", () => ({
  readOrgDomainsForPlatform: (...args: unknown[]) => mockReadDomains(...args),
}));
const domainsSectionSpy = vi.hoisted(() => vi.fn());
vi.mock("./domains-section", () => ({
  DomainsSection: (props: unknown) => {
    domainsSectionSpy(props);
    return <div data-testid="domains-section" />;
  },
}));

vi.mock("./brand-form", () => ({ BrandForm: () => null }));
vi.mock("./neutralize-dialog", () => ({ NeutralizeDialog: () => null }));
vi.mock("./site-section", () => ({ SiteSection: () => null }));
vi.mock("./profile-form", () => ({ ProfileForm: () => null }));
vi.mock("./service-times-section", () => ({ ServiceTimesSection: () => null }));

vi.mock("@/components/brand/org-mark", () => ({ OrgMark: () => null }));
vi.mock("@/components/brand/brand-preview-swatch", () => ({
  BrandPreviewSwatch: () => null,
  platformSchemeTokens: () => ({}),
}));
vi.mock("@/lib/brand/generate", () => ({
  generateBrandTokens: () => ({ tokens: { light: {}, dark: {} } }),
}));
vi.mock("@/lib/storage/blob-store", () => ({
  getBlobStore: () => ({ resolve: vi.fn().mockResolvedValue(null) }),
}));
vi.mock("@/lib/sites", () => ({
  getSiteAdminDetail: vi.fn().mockResolvedValue(null),
  getOrganizationProfileAdminDetail: vi.fn().mockResolvedValue(null),
  listOrganizationServiceTimes: vi.fn().mockResolvedValue([]),
}));

import { FEATURES } from "@/lib/permissions";
import type { HolderRow } from "@/lib/onboarding/designation-holder-types";
import { derivedGroupHolderRow, groupHolderRow, holderRow } from "./holder-row.fixture";
import OrganizationBrandDetailPage from "./page";

const ORG_ID = "e0000000-0000-0000-0000-000000000001";

/** The list read's result: a count and rows (display names only, never an email). */
const holdersOf = (count: number, rows: HolderRow[] = []) => ({ holderPeopleCount: count, rows });

beforeEach(() => {
  mockReadDomains.mockResolvedValue({ groups: [], siteStatus: null, toggles: {}, daysInState: {}, history: [] });
  mockGetAffiliation.mockResolvedValue(null);
  mockListGiving.mockResolvedValue(holdersOf(0));
  mockListHealth.mockResolvedValue([]);
  mockListInvitations.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  mockReadDomains.mockReset();
  domainsSectionSpy.mockReset();
  mockGetAffiliation.mockReset();
  mockAuth.mockReset();
  mockListFounding.mockReset();
  mockPlan.mockReset();
  foundingSectionSpy.mockReset();
  mockListGiving.mockReset();
  treasurerSectionSpy.mockReset();
  mockListHealth.mockReset();
  healthSectionSpy.mockReset();
  mockListInvitations.mockReset();
  revokeAllSpy.mockReset();
  orgRowRef.current = null;
  brandRowRef.current = null;
  selectCallCount.current = 0;
});

function makeParams() {
  return Promise.resolve({ id: ORG_ID });
}

describe("OrganizationBrandDetailPage — founding-administrator gate props", () => {
  it("passes canDesignate: true and the plan's permission keys when the holder count is zero", async () => {
    mockAuth.mockResolvedValue({
      user: { features: [FEATURES.ADMIN_ORGANIZATIONS] },
    });
    orgRowRef.current = {
      id: ORG_ID,
      name: "Alder Creek Presbyterian Church",
      organizationType: "congregation",
      platformStatus: "managed",
    };
    mockListFounding.mockResolvedValue(holdersOf(0));
    mockPlan.mockReturnValue({
      administration: {
        key: "founding_administrator",
        name: "Founding Administrator",
        permissionKeys: ["people.manage", "roles.manage"],
      },
      officeTemplateKey: "congregation_stated_clerk",
    });

    const el = await OrganizationBrandDetailPage({ params: makeParams() });
    render(el);

    expect(mockListFounding).toHaveBeenCalledWith(expect.anything(), ORG_ID);
    expect(mockPlan).toHaveBeenCalledWith("congregation");
    expect(foundingSectionSpy).toHaveBeenCalledTimes(1);
    const props = foundingSectionSpy.mock.calls[0][0];
    expect(props.organizationId).toBe(ORG_ID);
    expect(props.organizationName).toBe("Alder Creek Presbyterian Church");
    expect(props.organizationType).toBe("congregation");
    expect(props.canDesignate).toBe(true);
    expect(props.holderPeopleCount).toBe(0);
    expect(props.holders).toEqual([]);
    expect(props.administrationPermissionKeys).toEqual(["people.manage", "roles.manage"]);
    expect(props.officeTemplateName).toBe("Congregation Stated Clerk");
  });

  it("passes canDesignate: false and null officeTemplateName for a template-less org type with holders", async () => {
    mockAuth.mockResolvedValue({
      user: { features: [FEATURES.ADMIN_ORGANIZATIONS] },
    });
    orgRowRef.current = {
      id: ORG_ID,
      name: "Synod of the Alders",
      organizationType: "synod",
      platformStatus: "managed",
    };
    mockListFounding.mockResolvedValue(holdersOf(2, [holderRow(), holderRow({ key: "person:2", subjectId: "p2", displayName: "Barnaby Quill" })]));
    mockPlan.mockReturnValue({
      administration: {
        key: "founding_administrator",
        name: "Founding Administrator",
        permissionKeys: ["people.manage"],
      },
      officeTemplateKey: null,
    });

    const el = await OrganizationBrandDetailPage({ params: makeParams() });
    render(el);

    const props = foundingSectionSpy.mock.calls[0][0];
    expect(props.canDesignate).toBe(false);
    expect(props.holderPeopleCount).toBe(2);
    expect(props.holders.map((h: HolderRow) => h.displayName)).toEqual(["Perpetua Ashgrove", "Barnaby Quill"]);
    expect(props.officeTemplateName).toBeNull();
  });
});

describe("OrganizationBrandDetailPage — treasurer-designation gate props (online giving, R2)", () => {
  function arrangeOrg(organizationType: string) {
    mockAuth.mockResolvedValue({
      user: { features: [FEATURES.ADMIN_ORGANIZATIONS], email: "operator@example.invalid" },
    });
    orgRowRef.current = {
      id: ORG_ID,
      name: "Alder Creek Presbyterian Church",
      organizationType,
      platformStatus: "managed",
    };
    mockListFounding.mockResolvedValue(holdersOf(0));
    mockPlan.mockReturnValue({
      administration: { key: "founding_administrator", name: "x", permissionKeys: [] },
      officeTemplateKey: null,
    });
  }

  it("a congregation with no giving.manage holder gets canDesignate: true and a fresh count of 0", async () => {
    arrangeOrg("congregation");
    mockListGiving.mockResolvedValue(holdersOf(0));
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    expect(mockListGiving).toHaveBeenCalledWith(expect.anything(), ORG_ID);
    expect(treasurerSectionSpy).toHaveBeenCalledTimes(1);
    const props = treasurerSectionSpy.mock.calls[0][0];
    expect(props).toEqual({
      organizationId: ORG_ID,
      organizationName: "Alder Creek Presbyterian Church",
      canDesignate: true,
      holderPeopleCount: 0,
      holders: [],
      invitations: [],
      localLoginEnabled: true,
      totpConfigured: true,
      inviterEmail: "operator@example.invalid",
    });
  });

  it("a congregation that already has holders gets canDesignate: false, the count and the holder rows (names yes, emails never, group member names never)", async () => {
    arrangeOrg("congregation");
    const rows = [holderRow({ displayName: "Ottoline Fairweather" }), groupHolderRow()];
    mockListGiving.mockResolvedValue(holdersOf(4, rows));
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    const props = treasurerSectionSpy.mock.calls[0][0];
    expect(props.canDesignate).toBe(false);
    expect(props.holderPeopleCount).toBe(4);
    expect(props.holders).toEqual(rows);
    expect(Object.keys(props).sort()).toEqual([
      "canDesignate",
      "holderPeopleCount",
      "holders",
      "invitations",
      "inviterEmail",
      "localLoginEnabled",
      "organizationId",
      "organizationName",
      "totpConfigured",
    ]);
    // Names are passed; no email address and no group-member name ever is.
    const serialized = JSON.stringify(props.holders);
    expect(serialized).toContain("Ottoline Fairweather");
    expect(serialized).not.toMatch(/@/);
    expect(Object.keys(props.holders[0]).sort()).not.toContain("email");
  });

  it("derives canDesignate and the count from the SAME list read, with no second count query (F169)", async () => {
    arrangeOrg("congregation");
    mockListGiving.mockResolvedValue(holdersOf(1, [derivedGroupHolderRow()]));
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    expect(mockListGiving).toHaveBeenCalledTimes(1);
    const props = treasurerSectionSpy.mock.calls[0][0];
    expect(props.canDesignate).toBe(false);
    expect(props.holderPeopleCount).toBe(1);
  });

  it("a failed list read throws (the error boundary shows): no empty all-clear and no invite form", async () => {
    arrangeOrg("congregation");
    mockListFounding.mockRejectedValue(new Error("db down"));
    await expect(OrganizationBrandDetailPage({ params: makeParams() })).rejects.toThrow("db down");
    expect(foundingSectionSpy).not.toHaveBeenCalled();
    expect(treasurerSectionSpy).not.toHaveBeenCalled();
  });

  it("a failed treasurer list read throws too", async () => {
    arrangeOrg("congregation");
    mockListGiving.mockRejectedValue(new Error("db down"));
    await expect(OrganizationBrandDetailPage({ params: makeParams() })).rejects.toThrow("db down");
    expect(treasurerSectionSpy).not.toHaveBeenCalled();
  });

  it("a new worshiping community renders the section", async () => {
    arrangeOrg("new_worshiping_community");
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    expect(treasurerSectionSpy).toHaveBeenCalledTimes(1);
  });

  it.each(["presbytery", "synod", "general_assembly"])(
    "a %s renders NO treasurer section and the page does not even read the treasurer holder list",
    async (type) => {
      arrangeOrg(type);
      render(await OrganizationBrandDetailPage({ params: makeParams() }));
      expect(treasurerSectionSpy).not.toHaveBeenCalled();
      expect(screen.queryByTestId("treasurer-section")).toBeNull();
      expect(mockListGiving).not.toHaveBeenCalled();
    },
  );

  it("stacks the treasurer section directly after the founding-administrator section", async () => {
    arrangeOrg("congregation");
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    const founding = screen.getByTestId("founding-section");
    const treasurer = screen.getByTestId("treasurer-section");
    expect(
      Boolean(founding.compareDocumentPosition(treasurer) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });
});

describe("OrganizationBrandDetailPage — payment-notice health section (online giving, Batch 3b)", () => {
  const OTHER = "e0000000-0000-0000-0000-000000000002";
  const row = (organizationId: string, connectionId: string) => ({
    organizationId,
    connectionId,
    provider: "stripe",
    livemode: false,
    status: "active",
    receivedCount: 3,
    appliedCount: 2,
    parkedCount: 1,
    deadLetterCount: 0,
    lastReceivedAt: null,
    oldestPendingSeconds: null,
  });

  function arrangeOrg(organizationType: string) {
    mockAuth.mockResolvedValue({ user: { features: [FEATURES.ADMIN_ORGANIZATIONS] } });
    orgRowRef.current = {
      id: ORG_ID,
      name: "Alder Creek Presbyterian Church",
      organizationType,
      platformStatus: "managed",
    };
    mockListFounding.mockResolvedValue(holdersOf(0));
    mockPlan.mockReturnValue({
      administration: { key: "founding_administrator", name: "x", permissionKeys: [] },
      officeTemplateKey: null,
    });
  }

  it("hands the section ONLY this organization's rows (other organizations' counts never reach it)", async () => {
    arrangeOrg("congregation");
    mockListHealth.mockResolvedValue([row(ORG_ID, "c1"), row(OTHER, "c2")]);
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    expect(healthSectionSpy).toHaveBeenCalledTimes(1);
    expect(healthSectionSpy.mock.calls[0][0]).toEqual({ rows: [row(ORG_ID, "c1")] });
  });

  it("a failed health read passes null (rendered as 'can't load'), and the page still renders", async () => {
    arrangeOrg("congregation");
    mockListHealth.mockRejectedValue(new Error("db down"));
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    expect(healthSectionSpy.mock.calls[0][0]).toEqual({ rows: null });
    expect(screen.getByTestId("treasurer-section")).toBeTruthy();
  });

  it.each(["presbytery", "synod", "general_assembly"])("a %s renders no health section and reads nothing", async (type) => {
    arrangeOrg(type);
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    expect(screen.queryByTestId("health-section")).toBeNull();
    expect(mockListHealth).not.toHaveBeenCalled();
  });

  it("stacks the health section after the treasurer section", async () => {
    arrangeOrg("congregation");
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    const treasurer = screen.getByTestId("treasurer-section");
    const health = screen.getByTestId("health-section");
    expect(Boolean(treasurer.compareDocumentPosition(health) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });
});

describe("OrganizationBrandDetailPage — council affiliation section", () => {
  function arrange() {
    mockAuth.mockResolvedValue({
      user: { features: [FEATURES.ADMIN_ORGANIZATIONS] },
    });
    orgRowRef.current = {
      id: ORG_ID,
      name: "Alder Creek Presbyterian Church",
      organizationType: "congregation",
      platformStatus: "managed",
    };
    mockListFounding.mockResolvedValue(holdersOf(0));
    mockPlan.mockReturnValue({
      administration: { key: "founding_administrator", name: "x", permissionKeys: [] },
      officeTemplateKey: null,
    });
  }

  it("reads the affiliation for this organization id", async () => {
    arrange();
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    expect(mockGetAffiliation).toHaveBeenCalledWith(ORG_ID);
  });

  it("stacks founding-administrator section, then council affiliation, then current brand", async () => {
    arrange();
    mockGetAffiliation.mockResolvedValue({
      relationshipType: "member_congregation",
      effectiveFrom: "2026-05-14",
      authority: "backfill",
      minuteReference: null,
      parent: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Presbytery Alpha",
        slug: "alpha",
        organizationType: "presbytery",
      },
    });
    render(await OrganizationBrandDetailPage({ params: makeParams() }));

    const founding = screen.getByTestId("founding-section");
    const affiliationHeading = screen.getByText("Council affiliation");
    const brandHeading = screen.getByText("Current brand");
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(founding, affiliationHeading)).toBe(true);
    expect(follows(affiliationHeading, brandHeading)).toBe(true);
    expect(screen.getByRole("link", { name: "Presbytery Alpha" })).toBeTruthy();
  });

  it("a headless organization still renders the section with the headless copy", async () => {
    arrange();
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    expect(
      screen.getByText("This organization has no recorded parent council."),
    ).toBeTruthy();
  });
});


describe("OrganizationBrandDetailPage - the Domains section (Track F, Batch 1d)", () => {
  const arrange = () => {
    mockAuth.mockResolvedValue({ user: { features: [FEATURES.ADMIN_ORGANIZATIONS] } });
    orgRowRef.current = {
      id: ORG_ID,
      name: "Alder Creek Presbyterian Church",
      slug: "alder-creek",
      organizationType: "congregation",
      platformStatus: "managed",
    };
    mockListFounding.mockResolvedValue(holdersOf(0));
    mockPlan.mockReturnValue({
      administration: { key: "founding_administrator", name: "Founding Administrator", permissionKeys: [] },
      officeTemplateKey: null,
    });
  };

  it("reads this organization's domains by id and slug and hands them to the section", async () => {
    arrange();
    const data = { groups: [], siteStatus: "live", toggles: { "org_portal.domains": true }, daysInState: {}, history: [] };
    mockReadDomains.mockResolvedValue(data);
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    expect(mockReadDomains).toHaveBeenCalledWith(ORG_ID, "alder-creek");
    expect(screen.getByTestId("domains-section")).toBeTruthy();
    expect(domainsSectionSpy.mock.calls[0]![0]).toEqual({
      organizationId: ORG_ID,
      organizationName: "Alder Creek Presbyterian Church",
      data,
    });
  });

  it("a failed read is 'we couldn't load' - never an empty all-clear - and the rest of the page still renders", async () => {
    arrange();
    mockReadDomains.mockRejectedValue(new Error("connection terminated"));
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    expect(screen.getByTestId("domains-section-unavailable").textContent).toMatch(/couldn.t load this organization.s domains/);
    expect(screen.queryByTestId("domains-section")).toBeNull();
    expect(foundingSectionSpy).toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/connection terminated/);
  });
});

describe("OrganizationBrandDetailPage — invitations (account-invitations Batch 3)", () => {
  function arrange() {
    mockAuth.mockResolvedValue({
      user: { features: [FEATURES.ADMIN_ORGANIZATIONS], email: "operator@example.invalid" },
    });
    orgRowRef.current = {
      id: ORG_ID,
      name: "Alder Creek Presbyterian Church",
      organizationType: "congregation",
      platformStatus: "managed",
    };
    mockListFounding.mockResolvedValue(holdersOf(0));
    mockPlan.mockReturnValue({
      administration: { key: "founding_administrator", name: "x", permissionKeys: [] },
      officeTemplateKey: null,
    });
  }
  const row = (id: string, purpose: string, status: string) => ({ id, purpose, status });

  it("reads the org's invitations once and hands each section only its own purpose", async () => {
    arrange();
    mockListInvitations.mockResolvedValue([
      row("a", "founding_administrator", "pending"),
      row("b", "treasurer", "accepted"),
      row("c", "founding_administrator", "revoked"),
    ]);
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    expect(mockListInvitations).toHaveBeenCalledTimes(1);
    expect(mockListInvitations).toHaveBeenCalledWith(ORG_ID);
    expect(foundingSectionSpy.mock.calls[0][0].invitations.map((r: { id: string }) => r.id)).toEqual(["a", "c"]);
    expect(treasurerSectionSpy.mock.calls[0][0].invitations.map((r: { id: string }) => r.id)).toEqual(["b"]);
  });

  it("renders Revoke-all only when at least one invitation is open (pending or expired), with the count", async () => {
    arrange();
    mockListInvitations.mockResolvedValue([
      row("a", "founding_administrator", "expired"),
      row("b", "treasurer", "pending"),
      row("c", "treasurer", "accepted"),
    ]);
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    expect(screen.getByTestId("revoke-all")).toBeTruthy();
    expect(revokeAllSpy.mock.calls[0][0]).toMatchObject({ organizationId: ORG_ID, openCount: 2 });
  });

  it("renders no Revoke-all when nothing is open", async () => {
    arrange();
    mockListInvitations.mockResolvedValue([row("c", "treasurer", "accepted")]);
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    expect(screen.queryByTestId("revoke-all")).toBeNull();
  });

  it("a failed invitations read says so (never an empty, all-clear list) and the page still renders", async () => {
    arrange();
    mockListInvitations.mockRejectedValue(new Error("boom"));
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    expect(screen.getByRole("alert").textContent).toMatch(/couldn.t load this organization.s invitations/i);
    expect(screen.getByTestId("founding-section")).toBeTruthy();
    expect(foundingSectionSpy.mock.calls[0][0].invitations).toEqual([]);
  });
});
