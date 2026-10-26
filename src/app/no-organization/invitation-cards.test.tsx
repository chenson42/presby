// @vitest-environment jsdom
/**
 * The invitation cards (N1; Copy group C): the heading for one or several, each
 * card's sentence from the copy module for its purpose, the expiry as a
 * timezone-safe <time>, and the long-name wrapping that keeps a 360px screen whole.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("./actions", () => ({
  checkAgainAction: vi.fn(),
  acceptInPlaceAction: vi.fn(),
  switchAccountAction: vi.fn(),
}));

import { InvitationCards, invitationsHeading } from "./invitation-cards";
import type { InvitationCardView } from "./view";

afterEach(cleanup);

const EXPIRES = new Date("2026-11-01T12:00:00Z");

function card(over: Partial<InvitationCardView> & { invitationId: string }): InvitationCardView {
  return {
    organizationName: "Alder Creek Presbyterian Church",
    purpose: "sign_in",
    expiresAt: EXPIRES,
    personDisplayName: "Nora Ashgrove",
    secondFactorNeeded: false,
    ...over,
  };
}

describe("InvitationCards", () => {
  it("renders nothing without cards", () => {
    const { container } = render(<InvitationCards cards={[]} enrolled={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("one invitation: 'You're invited to {Congregation}', the sign_in sentence naming the person, the expiry and Accept", () => {
    render(<InvitationCards cards={[card({ invitationId: "a" })]} enrolled={false} headingLevel={1} />);
    expect(screen.getByRole("heading", { level: 1, name: "You're invited to Alder Creek Presbyterian Church" })).toBeTruthy();
    const c = screen.getByTestId("invitation-card");
    expect(c.textContent).toContain(
      "Alder Creek Presbyterian Church invited you to sign in. Accepting connects this sign-in to your record there as Nora Ashgrove. What you can do depends on your role at Alder Creek Presbyterian Church.",
    );
    expect(c.textContent).toMatch(/This invitation expires .+\./);
    expect(c.querySelector("time")?.getAttribute("datetime")).toBe(EXPIRES.toISOString());
    expect(within(c).getByRole("button", { name: "Accept the invitation" })).toBeTruthy();
  });

  it("several: 'You have {n} invitations', one card each, in the listing's order", () => {
    render(
      <InvitationCards
        cards={[card({ invitationId: "a", organizationName: "First" }), card({ invitationId: "b", organizationName: "Second" })]}
        enrolled={false}
      />,
    );
    expect(screen.getByRole("heading", { name: "You have 2 invitations" })).toBeTruthy();
    const cards = screen.getAllByTestId("invitation-card");
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain("First invited you");
    expect(cards[1].textContent).toContain("Second invited you");
  });

  it.each([
    ["founding_administrator", "Alder invited you to be its founding administrator. Accepting gives you that role."],
    ["treasurer", "Alder invited you to be its treasurer. Accepting gives you that access."],
  ] as const)("%s reads the designation sentence built from the role words", (purpose, sentence) => {
    render(
      <InvitationCards
        cards={[card({ invitationId: "a", organizationName: "Alder", purpose, personDisplayName: null, secondFactorNeeded: true })]}
        enrolled
      />,
    );
    expect(screen.getByTestId("invitation-card").textContent).toContain(sentence);
    // A designation needs two-factor sign-in before the click.
    expect(screen.getByRole("link", { name: "Continue to verification" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept the invitation" })).toBeNull();
  });

  it("a long congregation name wraps instead of overflowing", () => {
    const long = "The Very Long Name Of A Presbyterian Congregation That Keeps Going ".repeat(3).trim();
    render(<InvitationCards cards={[card({ invitationId: "a", organizationName: long })]} enrolled={false} />);
    expect(screen.getByRole("heading").className).toContain("break-words");
    expect(screen.getByTestId("invitation-card").querySelector("p")?.className).toContain("break-words");
  });

  it("a sign_in row with no name falls back to a grammatical sentence, never 'as null'", () => {
    render(<InvitationCards cards={[card({ invitationId: "a", personDisplayName: null })]} enrolled={false} />);
    expect(screen.getByTestId("invitation-card").textContent).not.toMatch(/null|undefined/);
  });

  it("invitationsHeading counts", () => {
    expect(invitationsHeading([card({ invitationId: "a" }), card({ invitationId: "b" }), card({ invitationId: "c" })])).toBe(
      "You have 3 invitations",
    );
  });
});
