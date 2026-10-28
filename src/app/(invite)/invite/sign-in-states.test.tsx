// @vitest-environment jsdom
/**
 * The `/invite` states for a congregation's `sign_in` invitation (Community
 * Increment 2b, Batch C; Phase 3 "The invite page"): mismatch, confirm, the
 * two-factor hop and the blocked end state. The summary and the anonymous
 * no-pre-fill rule are `invite-summary.test.tsx` and `anonymous-state.test.tsx`;
 * the dead-link page is unchanged and uniform. The point here: a `sign_in`
 * invitation never borrows a designation's role sentence, never shows the
 * person before the right account is signed in (G5), and its blocked sentences
 * are the neutral ones that never name why (G6).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { InvitationPreview } from "@/lib/onboarding/accept";

const mockAccept = vi.hoisted(() => vi.fn());
vi.mock("../actions", () => ({
  acceptSignedInAction: (prev: unknown, fd: FormData) => mockAccept(prev, fd),
  switchAccountAction: vi.fn(),
  continueToVerifyAction: vi.fn(),
}));

import { AcceptSignedInForm } from "./accept-signed-in-form";
import { ConfirmState } from "./confirm-state";
import { MismatchState } from "./mismatch-state";
import { TwoFactorState } from "./two-factor-state";
import { SIGN_IN_INVITE_COPY } from "@/lib/onboarding/sign-in-copy";
import { inviteeBlockedCopy } from "@/lib/onboarding/labels";

afterEach(() => {
  cleanup();
  mockAccept.mockReset();
});

const TOKEN = "A".repeat(43);

function preview(over: Partial<InvitationPreview> = {}): InvitationPreview {
  return {
    organizationName: "Alder Creek Presbyterian Church",
    organizationType: "congregation",
    purpose: "sign_in",
    inviteeFirstName: null,
    inviteeLastName: null,
    personDisplayName: null,
    maskedEmail: "n***@example.invalid",
    expiresAt: new Date("2026-11-01T12:00:00Z"),
    sessionMatches: true,
    ...over,
  };
}

const NO_ROLE_SENTENCE = /as treasurer|as founding administrator|an administrator invited you|this role requires/i;

describe("/invite, sign_in: confirm", () => {
  it("names the person only now that the right account is signed in (G5), at the congregation", () => {
    const { container } = render(
      <ConfirmState preview={preview({ personDisplayName: "Nora Ashgrove" })} token={TOKEN} />,
    );
    expect(container.textContent).toContain(SIGN_IN_INVITE_COPY.summary("Alder Creek Presbyterian Church"));
    expect(container.textContent).toContain("Accepting as Nora Ashgrove at Alder Creek Presbyterian Church.");
    expect(container.textContent).toContain("If that isn't you, don't accept");
    expect(container.textContent).not.toMatch(NO_ROLE_SENTENCE);
    expect(screen.getByRole("button", { name: "Accept invitation" })).toBeTruthy();
  });

  it("without a name it still names the congregation and never prints 'null'", () => {
    const { container } = render(<ConfirmState preview={preview()} token={TOKEN} />);
    expect(container.textContent).toContain("Accepting at Alder Creek Presbyterian Church.");
    expect(container.textContent).not.toMatch(/null|undefined/);
  });

  it("the accept button is a 44px full-width target", () => {
    render(<ConfirmState preview={preview()} token={TOKEN} />);
    const button = screen.getByRole("button", { name: "Accept invitation" });
    expect(button.className).toContain("min-h-11");
    expect(button.className).toContain("w-full");
  });
});

describe("/invite, sign_in: mismatch", () => {
  it("says the invitation went to a masked address and offers Sign out to accept, and names no person", () => {
    const { container } = render(
      <MismatchState preview={preview({ sessionMatches: false, personDisplayName: "Nora Ashgrove" })} token={TOKEN} />,
    );
    expect(container.textContent).toContain(SIGN_IN_INVITE_COPY.summary("Alder Creek Presbyterian Church"));
    expect(screen.getByRole("alert").textContent).toContain("You're signed in as another account.");
    expect(screen.getByRole("alert").textContent).toContain("n***@example.invalid");
    expect(screen.getByRole("button", { name: "Sign out to accept" }).className).toContain("min-h-11");
    expect(container.textContent).not.toMatch(NO_ROLE_SENTENCE);
  });
});

describe("/invite, sign_in: two-factor", () => {
  it("sends an account that must use two-factor sign-in to verify first, without a role sentence", () => {
    const { container } = render(<TwoFactorState preview={preview()} token={TOKEN} />);
    expect(container.textContent).toContain("Your account uses two-factor sign-in.");
    expect(screen.getByRole("button", { name: "Verify and continue" }).className).toContain("min-h-11");
    expect(container.textContent).not.toMatch(NO_ROLE_SENTENCE);
  });
});

describe("/invite, sign_in: blocked, the neutral end state (G6)", () => {
  async function blockedWith(message: string) {
    mockAccept.mockResolvedValue({ status: "error", code: "blocked", message });
    render(<AcceptSignedInForm token={TOKEN} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));
    });
  }

  it.each(["membership_ended", "person_merged", "person_deceased"] as const)(
    "%s reads the same office sentence and names no cause",
    async (reason) => {
      const message = inviteeBlockedCopy("sign_in", reason, "Alder Creek Presbyterian Church");
      expect(message).toBe("This invitation can't be completed. Contact Alder Creek Presbyterian Church's office.");
      await blockedWith(message);
      expect(screen.getByRole("alert").textContent).toBe(message);
      expect(screen.getByRole("alert").textContent).not.toMatch(/deceased|died|merged|ended/i);
      // The token is spent or gone: nothing is left to click into it again.
      expect(screen.queryByRole("button")).toBeNull();
    },
  );

  it.each(["ambiguous_person", "person_linked_elsewhere"] as const)("%s reads the shared-address sentence", async (reason) => {
    const message = inviteeBlockedCopy("sign_in", reason, "Alder Creek Presbyterian Church");
    expect(message).toBe(SIGN_IN_INVITE_COPY.blockedSharedAddress);
    await blockedWith(message);
    expect(screen.getByRole("alert").textContent).toContain("Each person needs their own address.");
  });
});
