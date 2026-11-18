// @vitest-environment jsdom
/**
 * U9: the congregation records' forms (docs/work-log/2026-11-17-congregation-
 * profile.md, "Test plan"): each root inside HydrationGate; C9's messages on the
 * right field with the injected `{year}`; money and year inputs are `type="text"`
 * with an `inputMode`; a refused save keeps the typed values and shows the fixed
 * `copy.ts` string; a duplicate lands under the field that collided.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const actions = vi.hoisted(() => ({
  setProfileAction: vi.fn(),
  createBuildingAction: vi.fn(),
  updateBuildingAction: vi.fn(),
  retireBuildingAction: vi.fn(),
  reinstateBuildingAction: vi.fn(),
  removeBuildingAction: vi.fn(),
  recordAppraisalAction: vi.fn(),
  removeAppraisalAction: vi.fn(),
  recordInsuranceAction: vi.fn(),
  updateInsuranceAction: vi.fn(),
  removeInsuranceAction: vi.fn(),
  recordLoanAction: vi.fn(),
  updateLoanAction: vi.fn(),
  markLoanPaidOffAction: vi.fn(),
  removeLoanAction: vi.fn(),
}));
vi.mock("./[aboutOrgId]/profile/edit/actions", () => ({ setProfileAction: actions.setProfileAction }));
vi.mock("./[aboutOrgId]/buildings/actions", () => ({
  createBuildingAction: actions.createBuildingAction,
  updateBuildingAction: actions.updateBuildingAction,
  retireBuildingAction: actions.retireBuildingAction,
  reinstateBuildingAction: actions.reinstateBuildingAction,
  removeBuildingAction: actions.removeBuildingAction,
}));
vi.mock("./[aboutOrgId]/buildings/[buildingId]/appraisals/actions", () => ({
  recordAppraisalAction: actions.recordAppraisalAction,
  removeAppraisalAction: actions.removeAppraisalAction,
}));
vi.mock("./[aboutOrgId]/insurance/actions", () => ({
  recordInsuranceAction: actions.recordInsuranceAction,
  updateInsuranceAction: actions.updateInsuranceAction,
  removeInsuranceAction: actions.removeInsuranceAction,
}));
vi.mock("./[aboutOrgId]/loans/actions", () => ({
  recordLoanAction: actions.recordLoanAction,
  updateLoanAction: actions.updateLoanAction,
  markLoanPaidOffAction: actions.markLoanPaidOffAction,
  removeLoanAction: actions.removeLoanAction,
}));

const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, info: vi.fn() } }));
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { ProfileForm } from "./[aboutOrgId]/profile/edit/profile-form";
import { BuildingForm } from "./[aboutOrgId]/buildings/building-form";
import { AppraisalForm } from "./[aboutOrgId]/buildings/[buildingId]/appraisals/appraisal-form";
import { InsuranceForm } from "./[aboutOrgId]/insurance/insurance-form";
import { LoanForm } from "./[aboutOrgId]/loans/loan-form";
import { OversightEditForm } from "./[aboutOrgId]/assessment/edit/edit-form";

vi.mock("./[aboutOrgId]/assessment/edit/actions", () => ({ setCongregationOversightAction: vi.fn() }));

const ENV = { year: 2026, today: "2026-11-18" };
const props = { slug: "northern-reach", aboutOrgId: "a1", env: ENV };

afterEach(() => {
  cleanup();
  Object.values(actions).forEach((m) => m.mockReset());
  toastError.mockReset();
  toastSuccess.mockReset();
  push.mockReset();
});

const submit = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("every form root is inside HydrationGate", () => {
  const forms: Array<[string, () => React.ReactElement]> = [
    ["profile", () => <ProfileForm {...props} profile={null} />],
    ["building", () => <BuildingForm {...props} building={null} />],
    ["appraisal", () => <AppraisalForm {...props} buildingId="b1" />],
    ["insurance", () => <InsuranceForm {...props} year={null} />],
    ["loan", () => <LoanForm {...props} loan={null} />],
  ];
  for (const [name, make] of forms) {
    it(`${name}`, () => {
      const { container } = render(make());
      const gate = container.querySelector('fieldset[data-slot="hydration-gate"]');
      expect(gate).toBeTruthy();
      expect(gate!.querySelector("form")).toBeTruthy();
    });
  }

  it("the moved assessment form (already gated)", () => {
    const { container } = render(
      <OversightEditForm slug="s" aboutOrgId="a1" row={{ organizationId: "a1", name: "n", platformStatus: "managed", hasData: false, viabilityScore: null, redevelopmentNotes: null, buildingsNotes: null, latitude: null, longitude: null, updatedAt: null }} />,
    );
    expect(container.querySelector('fieldset[data-slot="hydration-gate"] form')).toBeTruthy();
  });
});

describe("money and year inputs are text with an inputMode, never type=number", () => {
  it("every control across the forms", () => {
    const checks: Array<[React.ReactElement, Array<[string | RegExp, string]>]> = [
      [<ProfileForm key="p" {...props} profile={null} />, [["Year organized", "numeric"]]],
      [<BuildingForm key="b" {...props} building={null} />, [["Year built", "numeric"], ["First addition", "numeric"], ["Second addition", "numeric"], ["Square feet", "numeric"]]],
      [<AppraisalForm key="a" {...props} buildingId="b1" />, [["Year assessed", "numeric"], ["Appraised amount (dollars)", "decimal"]]],
      [<LoanForm key="l" {...props} loan={null} />, [["Original amount (dollars)", "decimal"], ["Current balance (dollars)", "decimal"], ["Grants (dollars)", "decimal"]]],
    ];
    for (const [element, expected] of checks) {
      const { unmount } = render(element);
      for (const [label, mode] of expected) {
        const input = screen.getByLabelText(label) as HTMLInputElement;
        expect(input.type).toBe("text");
        expect(input.getAttribute("inputmode")).toBe(mode);
      }
      unmount();
    }
  });
});

describe("C9 messages on the right field, with the injected year", () => {
  it("profile: a year outside 1600 and the current year", async () => {
    render(<ProfileForm {...props} profile={null} />);
    type("Year organized", "1500");
    submit(/^save$/i);
    expect(await screen.findByText("Year organized must be between 1600 and 2026.")).toBeTruthy();
    expect(actions.setProfileAction).not.toHaveBeenCalled();
  });

  it("building: an empty save names the name and the type", async () => {
    render(<BuildingForm {...props} building={null} />);
    submit(/save building/i);
    expect(await screen.findByText("Enter a name for the building.")).toBeTruthy();
    expect(screen.getByText("Choose a type.")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
  });

  it("building: the addition-order rule is under the first addition", async () => {
    render(<BuildingForm {...props} building={null} />);
    type("Name", "Hall");
    type("Type", "annex");
    type("Year built", "1990");
    type("First addition", "1980");
    submit(/save building/i);
    expect(await screen.findByText("The first addition can't be before the year built.")).toBeTruthy();
  });

  it("appraisal: the dollars rule and the hint", async () => {
    render(<AppraisalForm {...props} buildingId="b1" />);
    expect(screen.getByText("Dollars, for example 1250000 or 1250000.50.")).toBeTruthy();
    type("Year assessed", "2024");
    type("Appraised amount (dollars)", "abc");
    submit(/save appraisal/i);
    expect(await screen.findByText("Enter the amount in dollars, for example 1250000 or 1250000.50.")).toBeTruthy();
  });

  it("insurance: the policy year ceiling is next year", async () => {
    render(<InsuranceForm {...props} year={null} />);
    type("Policy year", "2040");
    submit(/save insurance/i);
    expect(await screen.findByText("Policy year must be between 1900 and 2027.")).toBeTruthy();
  });

  it("loan: a date without a balance is refused on the balance", async () => {
    render(<LoanForm {...props} loan={null} />);
    type("Kind of loan", "other");
    type("Balance as of", "2026-01-01");
    submit(/save loan/i);
    expect(await screen.findByText("Enter the balance this date applies to, or clear the date.")).toBeTruthy();
  });
});

describe("a refused save keeps the values and shows the fixed string", () => {
  it("building: a duplicate name lands under Name and the form keeps what was typed", async () => {
    actions.createBuildingAction.mockResolvedValue({ ok: false, error: "A building with that name is already recorded.", kind: "duplicate_name" });
    render(<BuildingForm {...props} building={null} />);
    type("Name", "Sanctuary");
    type("Type", "annex");
    type("Notes", "kept");
    submit(/save building/i);
    expect(await screen.findByText("A building with that name is already recorded.")).toBeTruthy();
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("kept");
    expect(push).not.toHaveBeenCalled();
  });

  it("loan: a stale edit shows the fixed string in a toast and keeps the values", async () => {
    const stale = "This record was changed by someone else after you opened it. Reload the page to see their change, then make yours again.";
    actions.updateLoanAction.mockResolvedValue({ ok: false, error: stale, kind: "stale" });
    const loan = {
      id: "l1", buildingId: null, kind: "other", lender: "Fixture Lender", originalAmountCents: 100000, currentBalanceCents: 50000,
      balanceAsOf: "2026-06-30", grantsAmountCents: null, guaranteeNote: null, notes: null, status: "open", paidOffOn: null,
      provenance: "presbytery_entered", rowVersion: 2,
    } as const;
    render(<LoanForm {...props} loan={loan} />);
    type("Notes", "my change");
    submit(/save loan/i);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(stale));
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("my change");
    expect(actions.updateLoanAction).toHaveBeenCalledWith("northern-reach", "a1", "l1", expect.objectContaining({ notes: "my change", lender: "Fixture Lender" }), 2);
  });

  it("a server `invalid` result goes under its own field", async () => {
    actions.recordInsuranceAction.mockResolvedValue({ ok: false, error: "Insurance for that year is already recorded. Edit it instead.", kind: "duplicate_policy_year" });
    render(<InsuranceForm {...props} year={null} />);
    type("Policy year", "2025");
    submit(/save insurance/i);
    expect(await screen.findByText("Insurance for that year is already recorded. Edit it instead.")).toBeTruthy();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("a create success returns to the record page", async () => {
    actions.createBuildingAction.mockResolvedValue({ ok: true, data: { id: "b1" } });
    render(<BuildingForm {...props} building={null} />);
    type("Name", "Hall");
    type("Type", "annex");
    submit(/save building/i);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/o/northern-reach/admin/oversight/a1"));
    expect(toastSuccess).toHaveBeenCalledWith("Building added.");
  });
});
