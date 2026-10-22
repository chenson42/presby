// @vitest-environment jsdom
/**
 * Orchestration test for `/admin/organizations/<id>`'s page.tsx —
 * docs/work-log/2026-09-28-founding-administrator.md Phase 4 Batch C.
 *
 * Pins the one thing this batch adds to the page: `countFoundingAdministrator
 * Holders()` and `foundingAdministratorPlan()` are read fresh on every
 * render (never cached) and their results are threaded into
 * `<FoundingAdministratorSection>`'s gate props (`canDesignate`,
 * `currentHolderCount`, `administrationPermissionKeys`,
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

const mockCountHolders = vi.hoisted(() => vi.fn());
const mockPlan = vi.hoisted(() => vi.fn());
vi.mock("@/lib/onboarding/founding-administrator", () => ({
  countFoundingAdministratorHolders: (...args: unknown[]) => mockCountHolders(...args),
  foundingAdministratorPlan: (...args: unknown[]) => mockPlan(...args),
}));

const foundingSectionSpy = vi.hoisted(() => vi.fn());
vi.mock("./founding-administrator-section", () => ({
  FoundingAdministratorSection: (props: unknown) => {
    foundingSectionSpy(props);
    return <div data-testid="founding-section" />;
  },
}));

const mockCountGiving = vi.hoisted(() => vi.fn());
vi.mock("@/lib/onboarding/treasurer-designation", () => ({
  countGivingManageHolders: (...args: unknown[]) => mockCountGiving(...args),
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
import OrganizationBrandDetailPage from "./page";

const ORG_ID = "e0000000-0000-0000-0000-000000000001";

beforeEach(() => {
  mockReadDomains.mockResolvedValue({ groups: [], siteStatus: null, toggles: {}, daysInState: {}, history: [] });
  mockGetAffiliation.mockResolvedValue(null);
  mockCountGiving.mockResolvedValue(0);
  mockListHealth.mockResolvedValue([]);
  mockListInvitations.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  mockReadDomains.mockReset();
  domainsSectionSpy.mockReset();
  mockGetAffiliation.mockReset();
  mockAuth.mockReset();
  mockCountHolders.mockReset();
  mockPlan.mockReset();
  foundingSectionSpy.mockReset();
  mockCountGiving.mockReset();
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
    mockCountHolders.mockResolvedValue(0);
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

    expect(mockCountHolders).toHaveBeenCalledWith(expect.anything(), ORG_ID);
    expect(mockPlan).toHaveBeenCalledWith("congregation");
    expect(foundingSectionSpy).toHaveBeenCalledTimes(1);
    const props = foundingSectionSpy.mock.calls[0][0];
    expect(props.organizationId).toBe(ORG_ID);
    expect(props.organizationName).toBe("Alder Creek Presbyterian Church");
    expect(props.organizationType).toBe("congregation");
    expect(props.canDesignate).toBe(true);
    expect(props.currentHolderCount).toBe(0);
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
    mockCountHolders.mockResolvedValue(2);
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
    expect(props.currentHolderCount).toBe(2);
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
    mockCountHolders.mockResolvedValue(0);
    mockPlan.mockReturnValue({
      administration: { key: "founding_administrator", name: "x", permissionKeys: [] },
      officeTemplateKey: null,
    });
  }

  it("a congregation with no giving.manage holder gets canDesignate: true and a fresh count of 0", async () => {
    arrangeOrg("congregation");
    mockCountGiving.mockResolvedValue(0);
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    expect(mockCountGiving).toHaveBeenCalledWith(expect.anything(), ORG_ID);
    expect(treasurerSectionSpy).toHaveBeenCalledTimes(1);
    const props = treasurerSectionSpy.mock.calls[0][0];
    expect(props).toEqual({
      organizationId: ORG_ID,
      organizationName: "Alder Creek Presbyterian Church",
      canDesignate: true,
      currentHolderCount: 0,
      invitations: [],
      localLoginEnabled: true,
      totpConfigured: true,
      inviterEmail: "operator@example.invalid",
    });
  });

  it("a congregation that already has holders gets canDesignate: false and the COUNT only (no names are ever passed)", async () => {
    arrangeOrg("congregation");
    mockCountGiving.mockResolvedValue(2);
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    const props = treasurerSectionSpy.mock.calls[0][0];
    expect(props.canDesignate).toBe(false);
    expect(props.currentHolderCount).toBe(2);
    expect(Object.keys(props).sort()).toEqual([
      "canDesignate",
      "currentHolderCount",
      "invitations",
      "inviterEmail",
      "localLoginEnabled",
      "organizationId",
      "organizationName",
      "totpConfigured",
    ]);
  });

  it("a new worshiping community renders the section", async () => {
    arrangeOrg("new_worshiping_community");
    render(await OrganizationBrandDetailPage({ params: makeParams() }));
    expect(treasurerSectionSpy).toHaveBeenCalledTimes(1);
  });

  it.each(["presbytery", "synod", "general_assembly"])(
    "a %s renders NO treasurer section and the page does not even read the holder count",
    async (type) => {
      arrangeOrg(type);
      render(await OrganizationBrandDetailPage({ params: makeParams() }));
      expect(treasurerSectionSpy).not.toHaveBeenCalled();
      expect(screen.queryByTestId("treasurer-section")).toBeNull();
      expect(mockCountGiving).not.toHaveBeenCalled();
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
    mockCountHolders.mockResolvedValue(0);
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
    mockCountHolders.mockResolvedValue(0);
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
    mockCountHolders.mockResolvedValue(0);
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
    mockCountHolders.mockResolvedValue(0);
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
