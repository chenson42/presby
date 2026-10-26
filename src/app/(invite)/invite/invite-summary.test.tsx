// @vitest-environment jsdom
/**
 * <InviteSummary>: the role sentence an invitee reads before accepting. The
 * treasurer sentence is pinned byte for byte (Phase 3 amendment, ruling 2): it
 * names the reimbursement abilities conditionally, so it is true whether or not
 * the organization uses Reimbursements. The founding-administrator sentence
 * carries no reimbursement key and must not mention Reimbursements.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { InvitationPreview } from "@/lib/onboarding/accept";
import { InviteSummary } from "./invite-summary";

afterEach(cleanup);

const ORG = "Example Fellowship Church";

function preview(purpose: InvitationPreview["purpose"]): InvitationPreview {
  return {
    organizationName: ORG,
    organizationType: "congregation",
    purpose,
    inviteeFirstName: "Wilhelmina",
    inviteeLastName: "Thorncastle",
    personDisplayName: null,
    maskedEmail: "w***@example.invalid",
    expiresAt: new Date("2030-01-15T12:00:00Z"),
    sessionMatches: null,
  };
}

/** The role sentence is the muted paragraph that starts "As ". */
function roleText(container: HTMLElement): string {
  const p = Array.from(container.querySelectorAll("p")).find((n) =>
    (n.textContent ?? "").startsWith("As "),
  );
  if (!p) throw new Error("no role sentence rendered");
  return p.textContent ?? "";
}

describe("InviteSummary role sentence", () => {
  it("treasurer: names the giving and reimbursement abilities, byte for byte", () => {
    const { container } = render(<InviteSummary preview={preview("treasurer")} />);
    expect(roleText(container)).toBe(
      `As treasurer you will be able to view gifts and donors, record gifts, and manage giving settings for ${ORG}. If ${ORG} uses Reimbursements, you can also view reimbursement requests, record payments on them, and choose which groups can receive them. This role requires two-factor sign-in.`,
    );
  });

  it("treasurer: keeps the two-factor sentence", () => {
    const { container } = render(<InviteSummary preview={preview("treasurer")} />);
    expect(roleText(container)).toContain("This role requires two-factor sign-in.");
  });

  it("founding administrator: unchanged, and no Reimbursements", () => {
    const { container } = render(<InviteSummary preview={preview("founding_administrator")} />);
    const text = roleText(container);
    expect(text).toBe(
      `As founding administrator you will be able to manage people, roles and settings for ${ORG}, and give access to everyone else there.`,
    );
    expect(text).not.toMatch(/reimbursement/i);
  });
});
