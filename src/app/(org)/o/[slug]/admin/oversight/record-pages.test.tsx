// @vitest-environment jsdom
/**
 * U8: the record page and every form page of the congregation records
 * (docs/work-log/2026-11-17-congregation-profile.md, Phase 3 "Test plan"): the gate
 * runs before any read; a non-UUID segment 404s before any reader is called; a
 * viewer with neither key gets `OversightForbidden`; each section is Locked from
 * the key set; one section's rejection leaves the others rendered; an
 * `OrgAccessError` is rethrown; a form page opened by URL without its key renders
 * a Locked page and no form.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/oversight/action-gate", () => ({}));
vi.mock("@/lib/oversight/store", () => ({}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/authz", () => {
  class MockOrgAccessError extends Error {}
  return { OrgAccessError: MockOrgAccessError };
});

const gate = vi.fn();
vi.mock("@/lib/presbytery-reports/gate", () => ({ gateOversightPage: (...a: unknown[]) => gate(...a) }));

const r = vi.hoisted(() => ({
  readOversightAccess: vi.fn(),
  readProfile: vi.fn(),
  readBuildings: vi.fn(),
  readBuilding: vi.fn(),
  readAppraisals: vi.fn(),
  readInsuranceYears: vi.fn(),
  readInsuranceYear: vi.fn(),
  readLoans: vi.fn(),
  readLoan: vi.fn(),
  readFormEnv: vi.fn(),
}));
vi.mock("@/lib/oversight/reads", () => r);

const detail = vi.fn();
vi.mock("@/lib/presbytery", () => ({ getCongregationOversightDetail: (...a: unknown[]) => detail(...a) }));

const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { OrgAccessError } from "@/lib/authz";
import RecordPage from "./[aboutOrgId]/page";
import ProfileEditPage from "./[aboutOrgId]/profile/edit/page";
import NewBuildingPage from "./[aboutOrgId]/buildings/new/page";
import BuildingPage from "./[aboutOrgId]/buildings/[buildingId]/page";
import NewAppraisalPage from "./[aboutOrgId]/buildings/[buildingId]/appraisals/new/page";
import NewInsurancePage from "./[aboutOrgId]/insurance/new/page";
import EditInsurancePage from "./[aboutOrgId]/insurance/[recordId]/edit/page";
import NewLoanPage from "./[aboutOrgId]/loans/new/page";
import EditLoanPage from "./[aboutOrgId]/loans/[loanId]/edit/page";

const A = "22222222-2222-4222-8222-222222222222";
const B = "b0890000-0000-4000-8000-000000000002";
const R = "b0890000-0000-4000-8000-000000000005";
const ENV = { year: 2026, today: "2026-11-18" };
const IDENTITY = { personId: "p1", organizationId: "org-1", organizationName: "Presbytery of the Northern Reach", organizationType: "presbytery", slug: "northern-reach" };
const CONG = { id: A, name: "Alder Creek Presbyterian Church", platformStatus: "managed" };

afterEach(() => {
  cleanup();
  gate.mockReset();
  notFoundMock.mockClear();
  Object.values(r).forEach((m) => m.mockReset());
  detail.mockReset();
});

function setup(keys: { manage: boolean; finance: boolean }) {
  gate.mockResolvedValue({ ok: true, identity: IDENTITY });
  r.readOversightAccess.mockResolvedValue({ kind: "ok", data: { ...keys, congregation: CONG } });
  r.readFormEnv.mockResolvedValue(ENV);
}

const BUILDING = {
  id: B, name: "Sanctuary", buildingType: "sanctuary", yearBuilt: 1962, firstAdditionYear: null, secondAdditionYear: null, squareFeet: 9200,
  roofCondition: "fair", plumbingCondition: null, hvacCondition: null, boilerCondition: null, hasSprinklers: null, hasFireAlarm: true,
  hasSecuritySystem: null, isPrimary: true, notes: null, retiredOn: null, retiredReason: null, provenance: "presbytery_entered", rowVersion: 1,
};
const LOAN = {
  id: "l1", buildingId: null, kind: "presbytery_program", lender: null, originalAmountCents: 12000000, currentBalanceCents: null, balanceAsOf: null,
  grantsAmountCents: null, guaranteeNote: null, notes: null, status: "open", paidOffOn: null, provenance: "imported", rowVersion: 1,
};

const p = (extra: Record<string, string> = {}): Promise<any> => Promise.resolve({ slug: "northern-reach", aboutOrgId: A, ...extra });

describe("the record page", () => {
  it("renders the gate's state before any read", async () => {
    gate.mockResolvedValue({ ok: false, state: { kind: "flag_off", name: "Presbytery of the Northern Reach" } });
    render(await RecordPage({ params: p() }));
    expect(screen.getByText(/isn.t turned on/i)).toBeTruthy();
    expect(r.readOversightAccess).not.toHaveBeenCalled();
  });

  it("404s a non-UUID segment before any reader is called", async () => {
    setup({ manage: true, finance: true });
    await expect(RecordPage({ params: p({ aboutOrgId: "not-a-uuid" }) })).rejects.toThrow("NOT_FOUND");
    expect(r.readOversightAccess).not.toHaveBeenCalled();
  });

  it("neither key gives OversightForbidden", async () => {
    gate.mockResolvedValue({ ok: true, identity: IDENTITY });
    r.readOversightAccess.mockResolvedValue({ kind: "forbidden" });
    render(await RecordPage({ params: p() }));
    expect(screen.getByText(/don.t have permission to manage congregation oversight records/i)).toBeTruthy();
  });

  it("a congregation that is not this presbytery's is a 404", async () => {
    gate.mockResolvedValue({ ok: true, identity: IDENTITY });
    r.readOversightAccess.mockResolvedValue({ kind: "not_found" });
    await expect(RecordPage({ params: p() })).rejects.toThrow("NOT_FOUND");
  });

  it("a manage-only viewer sees the tier-1 sections and two Locked finance sections; no tier-2 reader is called", async () => {
    setup({ manage: true, finance: false });
    r.readProfile.mockResolvedValue({ kind: "ok", data: { profile: null } });
    detail.mockResolvedValue({ kind: "ok", data: { viabilityScore: 3, redevelopmentNotes: null, buildingsNotes: "Roof", latitude: null, longitude: null } });
    r.readBuildings.mockResolvedValue({ kind: "ok", data: { buildings: [BUILDING], inUse: 1, retired: 0 } });
    render(await RecordPage({ params: p() }));
    expect(screen.getByRole("heading", { level: 1, name: CONG.name })).toBeTruthy();
    expect(screen.getByText(/can keep its own profile there/)).toBeTruthy();
    expect(screen.getByText("Nothing is recorded in the profile yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add profile details" })).toBeTruthy();
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(screen.getByRole("link", { name: /^open sanctuary/i }).getAttribute("href")).toBe(`/o/northern-reach/admin/oversight/${A}/buildings/${B}`);
    const insurance = screen.getByRole("region", { name: "Insurance" });
    expect(within(insurance).getByText("Locked")).toBeTruthy();
    expect(within(insurance).getByText(/manage congregation property finances/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Loans" })).getByText("Locked")).toBeTruthy();
    expect(r.readInsuranceYears).not.toHaveBeenCalled();
    expect(r.readLoans).not.toHaveBeenCalled();
  });

  it("a finance-only viewer sees Locked Profile, Assessment and Buildings and no tier-1 reader runs", async () => {
    setup({ manage: false, finance: true });
    r.readInsuranceYears.mockResolvedValue({ kind: "ok", data: { years: [], today: ENV.today } });
    r.readLoans.mockResolvedValue({ kind: "ok", data: { loans: [LOAN] } });
    render(await RecordPage({ params: p() }));
    for (const name of ["Profile", "Assessment", "Buildings"]) {
      expect(within(screen.getByRole("region", { name })).getByText("Locked")).toBeTruthy();
    }
    expect(screen.getByText("No insurance is recorded for this congregation.")).toBeTruthy();
    // An unrecorded figure is never a zero; an imported row says so.
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
    expect(screen.getByText("$120,000")).toBeTruthy();
    expect(screen.getByText("Imported from an earlier record.")).toBeTruthy();
    expect(r.readProfile).not.toHaveBeenCalled();
    expect(r.readBuildings).not.toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
  });

  it("one section's rejection renders its own load error and leaves the others up", async () => {
    setup({ manage: true, finance: true });
    r.readProfile.mockRejectedValue(new Error("connection reset"));
    detail.mockResolvedValue({ kind: "ok", data: { viabilityScore: null, redevelopmentNotes: null, buildingsNotes: null, latitude: null, longitude: null } });
    r.readBuildings.mockResolvedValue({ kind: "ok", data: { buildings: [], inUse: 0, retired: 0 } });
    r.readInsuranceYears.mockResolvedValue({ kind: "ok", data: { years: [], today: ENV.today } });
    r.readLoans.mockResolvedValue({ kind: "ok", data: { loans: [] } });
    render(await RecordPage({ params: p() }));
    const profile = screen.getByRole("region", { name: "Profile" });
    expect(within(profile).getByText("We couldn't load this section. Try again in a moment.")).toBeTruthy();
    expect(within(profile).getByRole("link", { name: "Try again" })).toBeTruthy();
    expect(screen.getByText("No buildings are recorded for this congregation.")).toBeTruthy();
    expect(screen.getByText("No loans are recorded for this congregation.")).toBeTruthy();
  });

  it("rethrows an OrgAccessError from a section reader", async () => {
    setup({ manage: true, finance: false });
    r.readProfile.mockRejectedValue(new OrgAccessError("p1", "org-1"));
    detail.mockResolvedValue({ kind: "ok", data: {} });
    r.readBuildings.mockResolvedValue({ kind: "ok", data: { buildings: [], inUse: 0, retired: 0 } });
    await expect(RecordPage({ params: p() })).rejects.toBeInstanceOf(OrgAccessError);
  });
});

describe("the form pages", () => {
  it("a manage-only viewer at /insurance/new and /loans/new gets a Locked page and no form", async () => {
    for (const Page of [NewInsurancePage, NewLoanPage]) {
      setup({ manage: true, finance: false });
      const { container, unmount } = render(await Page({ params: p() }));
      expect(screen.getByText("Locked")).toBeTruthy();
      expect(screen.getByText(/manage congregation property finances/)).toBeTruthy();
      expect(container.querySelector("form")).toBeNull();
      unmount();
    }
  });

  it("a finance-only viewer at /buildings/new and /profile/edit gets a Locked page and no form", async () => {
    setup({ manage: false, finance: true });
    r.readProfile.mockResolvedValue({ kind: "forbidden" });
    const a = render(await NewBuildingPage({ params: p() }));
    expect(screen.getByText("Locked")).toBeTruthy();
    expect(a.container.querySelector("form")).toBeNull();
    a.unmount();
    const b = render(await ProfileEditPage({ params: p() }));
    expect(screen.getByText("Locked")).toBeTruthy();
    expect(b.container.querySelector("form")).toBeNull();
  });

  it("every form page 404s a non-UUID id before any reader is called", async () => {
    setup({ manage: true, finance: true });
    const pages: Array<[(a: { params: Promise<never> }) => Promise<unknown>, Record<string, string>]> = [
      [ProfileEditPage as never, { aboutOrgId: "x" }],
      [NewBuildingPage as never, { aboutOrgId: "x" }],
      [BuildingPage as never, { buildingId: "x" }],
      [NewAppraisalPage as never, { buildingId: "x" }],
      [EditInsurancePage as never, { recordId: "x" }],
      [EditLoanPage as never, { loanId: "x" }],
    ];
    for (const [Page, extra] of pages) {
      await expect(Page({ params: p(extra) as never })).rejects.toThrow("NOT_FOUND");
    }
    expect(r.readOversightAccess).not.toHaveBeenCalled();
  });

  it("a missing row is a 404 (a removed building, another congregation's loan)", async () => {
    setup({ manage: true, finance: true });
    r.readBuilding.mockResolvedValue({ kind: "not_found" });
    r.readAppraisals.mockResolvedValue({ kind: "not_found" });
    await expect(BuildingPage({ params: p({ buildingId: B }) })).rejects.toThrow("NOT_FOUND");
    r.readLoan.mockResolvedValue({ kind: "not_found" });
    await expect(EditLoanPage({ params: p({ loanId: R }) })).rejects.toThrow("NOT_FOUND");
  });

  it("the building page shows its facts and a Locked Appraisals block without the finance key", async () => {
    setup({ manage: true, finance: false });
    r.readBuilding.mockResolvedValue({ kind: "ok", data: BUILDING });
    render(await BuildingPage({ params: p({ buildingId: B }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Sanctuary" })).toBeTruthy();
    expect(screen.getByText("9,200")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Appraisals" })).getByText("Locked")).toBeTruthy();
    expect(r.readAppraisals).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retire this building" })).toBeTruthy();
  });

  it("the appraisals block names the newest year Current and offers Record an appraisal", async () => {
    setup({ manage: true, finance: true });
    r.readBuilding.mockResolvedValue({ kind: "ok", data: BUILDING });
    r.readAppraisals.mockResolvedValue({
      kind: "ok",
      data: { appraisals: [{ id: "a2", buildingId: B, assessedYear: 2024, amountCents: 125000000, notes: null, provenance: "presbytery_entered" }], latestId: "a2" },
    });
    render(await BuildingPage({ params: p({ buildingId: B }) }));
    expect(screen.getByText("$1,250,000")).toBeTruthy();
    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Record an appraisal" })).toBeTruthy();
  });

  it("a retired building offers Bring back into use instead of Retire", async () => {
    setup({ manage: true, finance: false });
    r.readBuilding.mockResolvedValue({ kind: "ok", data: { ...BUILDING, isPrimary: false, retiredOn: "2026-01-02", retiredReason: "sold" } });
    render(await BuildingPage({ params: p({ buildingId: B }) }));
    expect(screen.getByRole("button", { name: "Bring back into use" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retire this building" })).toBeNull();
    expect(screen.getByText(/^Sold on/)).toBeTruthy();
  });

  it("the insurance edit page reads the year, keeps the policy year read-only and says Edit insurance for {year}", async () => {
    setup({ manage: false, finance: true });
    r.readInsuranceYear.mockResolvedValue({
      kind: "ok",
      data: { id: R, policyYear: 2026, carrier: null, policyNumber: null, policyExpiresOn: null, recentClaims: null, poolInterest: null, notes: null, provenance: "presbytery_entered", rowVersion: 3 },
    });
    render(await EditInsurancePage({ params: p({ recordId: R }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Edit insurance for 2026" })).toBeTruthy();
    expect((screen.getByLabelText("Policy year") as HTMLInputElement).readOnly).toBe(true);
  });

  it("rethrows an OrgAccessError from a form page's reader", async () => {
    setup({ manage: true, finance: true });
    r.readLoan.mockRejectedValue(new OrgAccessError("p1", "org-1"));
    await expect(EditLoanPage({ params: p({ loanId: R }) })).rejects.toBeInstanceOf(OrgAccessError);
  });

  it("a failed reader renders the load error, not a form", async () => {
    setup({ manage: true, finance: true });
    r.readProfile.mockRejectedValue(new Error("boom"));
    const { container } = render(await ProfileEditPage({ params: p() }));
    expect(screen.getByText(/couldn.t load oversight records right now/i)).toBeTruthy();
    expect(container.querySelector("form")).toBeNull();
  });
});
