// @vitest-environment jsdom
/**
 * The one-glance summary every live `/invite` state starts with, now exhaustive
 * over the invitation purposes (Community Increment 2b, Batch B2; F196's
 * TypeScript half). A congregation's sign-in invitation carries no role and is
 * sent by a person at the congregation, so it must never read the platform
 * designation's sentence ("A PresbyPortal administrator invited you to be the
 * ..."), which would have been the silent fall-through of the old
 * `if (purpose === "treasurer") ... else founding administrator` shape. The
 * rest of the sign_in page (the states, the no-pre-fill rule) is Batch C's.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { InvitationPreview } from "@/lib/onboarding/accept";

vi.mock("@/components/shared/formatted-date", () => ({
  FormattedDate: ({ value }: { value: Date }) => <time>{value.toISOString().slice(0, 10)}</time>,
}));

import { InviteSummary } from "./invite-summary";

afterEach(() => cleanup());

function preview(over: Partial<InvitationPreview> = {}): InvitationPreview {
  return {
    organizationName: "Quillhaven Fellowship",
    organizationType: "congregation",
    purpose: "founding_administrator",
    inviteeFirstName: null,
    inviteeLastName: null,
    personDisplayName: null,
    maskedEmail: "w***@example.invalid",
    expiresAt: new Date("2026-10-28T12:00:00Z"),
    sessionMatches: null,
    ...over,
  };
}

describe("InviteSummary", () => {
  it("a sign_in invitation reads the congregation's own summary and none of the designation's role sentences", () => {
    const { container } = render(<InviteSummary preview={preview({ purpose: "sign_in" })} />);
    const text = container.textContent ?? "";
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("You're invited");
    expect(text).toContain(
      "Quillhaven Fellowship invited you to sign in. Signing in lets you see what Quillhaven Fellowship shares with its people. What you can do depends on your role there.",
    );
    expect(text).not.toMatch(/PresbyPortal administrator invited you/);
    expect(text).not.toMatch(/founding administrator|treasurer|two-factor/i);
    expect(text).toContain("Sent to w***@example.invalid.");
  });

  it("a sign_in summary never shows a person's name, even if the preview carried one (G5: the invitee sees nothing about the person before signing in)", () => {
    const { container } = render(
      <InviteSummary preview={preview({ purpose: "sign_in", personDisplayName: "Wendeline Ashgrove", inviteeFirstName: "Wendeline" })} />,
    );
    expect(container.textContent).not.toContain("Wendeline");
  });

  it("the founding administrator and treasurer summaries are unchanged", () => {
    const fa = render(<InviteSummary preview={preview({ purpose: "founding_administrator" })} />).container.textContent ?? "";
    expect(fa).toContain("A PresbyPortal administrator invited you to be the founding administrator at");
    expect(fa).toContain("As founding administrator you will be able to manage people, roles and settings for Quillhaven Fellowship, and give access to everyone else there.");
    cleanup();
    const tr = render(<InviteSummary preview={preview({ purpose: "treasurer" })} />).container.textContent ?? "";
    expect(tr).toContain("A PresbyPortal administrator invited you to be the treasurer at");
    expect(tr).toContain("This role requires two-factor sign-in.");
  });

  it("treasurer: names the giving and reimbursement abilities, byte for byte (treasury Inc 1, Phase 3 amendment ruling 2)", () => {
    const { container } = render(<InviteSummary preview={preview({ purpose: "treasurer" })} />);
    const org = preview().organizationName;
    expect(container.textContent ?? "").toContain(
      `As treasurer you will be able to view gifts and donors, record gifts, and manage giving settings for ${org}. If ${org} uses Reimbursements, you can also view reimbursement requests, record payments on them, and choose which groups can receive them. This role requires two-factor sign-in.`,
    );
  });

  it("founding administrator: no Reimbursements", () => {
    const { container } = render(<InviteSummary preview={preview({ purpose: "founding_administrator" })} />);
    expect(container.textContent ?? "").not.toMatch(/reimbursement/i);
  });
});
