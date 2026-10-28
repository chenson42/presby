// @vitest-environment jsdom
/**
 * The anonymous `/invite` state never pre-fills a name for a sign_in invitation
 * (Community Increment 2b, Batch B2; G5): the invitee sees nothing about the
 * person before signing in. The preview already returns no name to an anonymous
 * visitor; this pins that the page does not guess one if that ever changes,
 * while a treasurer's roster name is still split into the form (unchanged).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { InvitationPreview } from "@/lib/onboarding/accept";

vi.mock("../actions", () => ({
  acceptNewAccountAction: vi.fn(),
  startSignInToAcceptAction: vi.fn(),
}));
vi.mock("@/components/shared/formatted-date", () => ({
  FormattedDate: ({ value }: { value: Date }) => <time>{value.toISOString().slice(0, 10)}</time>,
}));

import { AnonymousState } from "./anonymous-state";

afterEach(() => cleanup());

const preview = (over: Partial<InvitationPreview>): InvitationPreview => ({
  organizationName: "Quillhaven Fellowship",
  organizationType: "congregation",
  purpose: "sign_in",
  inviteeFirstName: null,
  inviteeLastName: null,
  personDisplayName: null,
  maskedEmail: "w***@example.invalid",
  expiresAt: new Date("2026-10-28T12:00:00Z"),
  sessionMatches: null,
  ...over,
});

describe("AnonymousState name pre-fill", () => {
  it("a sign_in invitation leaves both name fields empty even when a display name is present", () => {
    render(
      <AnonymousState
        preview={preview({ purpose: "sign_in", personDisplayName: "Wendeline Ashgrove", inviteeFirstName: null, inviteeLastName: null })}
        token={"A".repeat(43)}
        localLoginEnabled
      />,
    );
    expect((screen.getByLabelText(/first name/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/last name/i) as HTMLInputElement).value).toBe("");
  });

  it("a treasurer invitation still splits the roster's display name into the form (unchanged)", () => {
    render(
      <AnonymousState
        preview={preview({ purpose: "treasurer", personDisplayName: "Perpetua Ashgrove" })}
        token={"A".repeat(43)}
        localLoginEnabled
      />,
    );
    expect((screen.getByLabelText(/first name/i) as HTMLInputElement).value).toBe("Perpetua");
    expect((screen.getByLabelText(/last name/i) as HTMLInputElement).value).toBe("Ashgrove");
  });
});
