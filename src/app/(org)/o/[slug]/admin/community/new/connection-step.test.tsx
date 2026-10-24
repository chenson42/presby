// @vitest-environment jsdom
/**
 * `ConnectionStep` and `ReviewStep`: the Member choice follows the Session
 * (R15, F185), and the review note tells the truth when no one can approve yet
 * (Flow 7).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { ConnectionStep } from "./connection-step";
import { ReviewStep } from "./review-step";
import {
  WIZARD_DEFAULT_VALUES,
  type MemberWizardValues,
} from "./member-wizard-schema";

afterEach(cleanup);

function StepHarness(props: { canProposeRoll: boolean; memberAvailable?: boolean }) {
  const form = useForm<MemberWizardValues>({ defaultValues: WIZARD_DEFAULT_VALUES });
  return <ConnectionStep form={form} {...props} />;
}

function ReviewHarness({ sessionWaits }: { sessionWaits?: boolean }) {
  const form = useForm<MemberWizardValues>({
    defaultValues: {
      ...WIZARD_DEFAULT_VALUES,
      relationship: "member",
      rollAction: { effectiveDate: "2026-06-01", minuteReference: "" },
    },
  });
  return <ReviewStep form={form} sessionWaits={sessionWaits} />;
}

function optionValues() {
  return screen.getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
}

describe("ConnectionStep — the Member choice", () => {
  it("offers Visitor, Participant and Member when the organization has a Session", () => {
    render(<StepHarness canProposeRoll memberAvailable />);
    expect(optionValues()).toEqual(["visitor", "participant", "member"]);
    expect(screen.queryByTestId("no-session-note")).toBeNull();
  });

  it("hides Member and says why when there is no Session", () => {
    render(<StepHarness canProposeRoll memberAvailable={false} />);
    expect(optionValues()).toEqual(["visitor", "participant"]);
    expect(screen.getByTestId("no-session-note").textContent).toBe(
      "This organization has no Session, so members can't be proposed here. Participants and visitors can still be added.",
    );
  });

  it("defaults to Member available (an unread Session state never hides it)", () => {
    render(<StepHarness canProposeRoll />);
    expect(optionValues()).toContain("member");
  });

  it("without roll.propose it is Visitor only, with no Session note", () => {
    render(<StepHarness canProposeRoll={false} memberAvailable={false} />);
    expect(optionValues()).toEqual(["visitor"]);
    expect(screen.queryByTestId("no-session-note")).toBeNull();
  });
});

describe("ReviewStep — the member note", () => {
  it("says the proposal will wait when no one on the Session can approve yet", () => {
    render(<ReviewHarness sessionWaits />);
    expect(
      screen.getByText(
        "This person's roll action will wait. No one on your Session can approve yet.",
      ),
    ).toBeTruthy();
  });

  it("otherwise keeps the Increment 1 note", () => {
    render(<ReviewHarness />);
    expect(
      screen.getByText(/will wait for the Session to approve before they appear as a member/i),
    ).toBeTruthy();
  });
});
