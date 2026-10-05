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
vi.mock("@/lib/founding-administrator", () => ({
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

const mockGetAffiliation = vi.hoisted(() => vi.fn());
vi.mock("@/lib/org-provisioning", () => ({
  getOrganizationAffiliationAdminDetail: (...args: unknown[]) =>
    mockGetAffiliation(...args),
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
  mockGetAffiliation.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  mockGetAffiliation.mockReset();
  mockAuth.mockReset();
  mockCountHolders.mockReset();
  mockPlan.mockReset();
  foundingSectionSpy.mockReset();
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
