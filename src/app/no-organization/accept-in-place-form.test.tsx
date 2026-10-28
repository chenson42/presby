// @vitest-environment jsdom
/**
 * "Accept the invitation", in place (Community Increment 2b, Copy group C). The
 * action is mocked; its behaviour is `actions.test.ts`'s. These pin the CLIENT
 * contract: the only field is the invitation id, disabled until hydration, 44px,
 * the second-factor notice in place of the button (before the click, or after the
 * action says so), and the finished states (dead, blocked) that remove the button.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const mockAccept = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  checkAgainAction: vi.fn(),
  acceptInPlaceAction: (...a: unknown[]) => mockAccept(...a),
  switchAccountAction: vi.fn(),
}));

import { AcceptInPlaceForm } from "./accept-in-place-form";
import { NO_ORG_INVITATION_COPY } from "@/lib/onboarding/no-organization-copy";
import { INVITATION_DEAD_IN_PLACE_COPY } from "@/lib/onboarding/labels";

afterEach(() => {
  cleanup();
  mockAccept.mockReset();
});

const ID = "11111111-1111-4111-8111-111111111111";

async function accept() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Accept the invitation" }));
  });
}

describe("AcceptInPlaceForm", () => {
  it("the button is disabled in the server render, before hydration", () => {
    const html = renderToString(<AcceptInPlaceForm invitationId={ID} secondFactorNeeded={false} enrolled={false} />);
    expect(html.match(/<button[^>]*>/g)?.[0]).toContain('disabled=""');
  });

  it("posts only the invitation id, and the button is a 44px target", async () => {
    mockAccept.mockResolvedValue({ status: "idle" });
    render(<AcceptInPlaceForm invitationId={ID} secondFactorNeeded={false} enrolled={false} />);
    expect(screen.getByRole("button", { name: "Accept the invitation" }).className).toContain("min-h-11");
    await accept();
    const fd = mockAccept.mock.calls[0][1] as FormData;
    expect([...fd.keys()]).toEqual(["invitationId"]);
    expect(fd.get("invitationId")).toBe(ID);
  });

  it("a card that already needs two-factor sign-in offers the notice and its link instead of Accept (enrolled)", () => {
    render(<AcceptInPlaceForm invitationId={ID} secondFactorNeeded enrolled />);
    expect(screen.queryByRole("button", { name: "Accept the invitation" })).toBeNull();
    expect(screen.getByText(NO_ORG_INVITATION_COPY.secondFactor.enrolled.body)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Continue to verification" }).getAttribute("href")).toBe(
      "/totp?callbackUrl=%2Fno-organization",
    );
  });

  it("not enrolled: 'Set up two-factor sign-in'", () => {
    render(<AcceptInPlaceForm invitationId={ID} secondFactorNeeded enrolled={false} />);
    expect(screen.getByText(NO_ORG_INVITATION_COPY.secondFactor.notEnrolled.body)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Set up two-factor sign-in" }).getAttribute("href")).toBe(
      "/account/2fa?callbackUrl=%2Fno-organization",
    );
  });

  it("the action answering needs_second_factor swaps the button for the same notice", async () => {
    mockAccept.mockResolvedValue({ status: "needs_second_factor" });
    render(<AcceptInPlaceForm invitationId={ID} secondFactorNeeded={false} enrolled />);
    await accept();
    expect(screen.queryByRole("button", { name: "Accept the invitation" })).toBeNull();
    expect(screen.getByRole("link", { name: "Continue to verification" })).toBeTruthy();
  });

  it("dead is the end of the road: the sentence, no button (N4)", async () => {
    mockAccept.mockResolvedValue({ status: "error", code: "dead", message: INVITATION_DEAD_IN_PLACE_COPY });
    render(<AcceptInPlaceForm invitationId={ID} secondFactorNeeded={false} enrolled={false} />);
    await accept();
    expect(screen.getByRole("alert").textContent).toBe(INVITATION_DEAD_IN_PLACE_COPY);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("blocked is also finished (N3), with the action's neutral sentence", async () => {
    mockAccept.mockResolvedValue({ status: "error", code: "blocked", message: "This invitation can't be completed. Contact Alder Creek's office." });
    render(<AcceptInPlaceForm invitationId={ID} secondFactorNeeded={false} enrolled={false} />);
    await accept();
    expect(screen.getByRole("alert").textContent).toContain("can't be completed");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each([
    ["db_error", NO_ORG_INVITATION_COPY.dbError],
    ["rate_limited", NO_ORG_INVITATION_COPY.rateLimited(4)],
    ["not_signed_in", NO_ORG_INVITATION_COPY.signedOut],
  ] as const)("%s keeps the button so they can try again", async (code, message) => {
    mockAccept.mockResolvedValue({ status: "error", code, message });
    render(<AcceptInPlaceForm invitationId={ID} secondFactorNeeded={false} enrolled={false} />);
    await accept();
    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(screen.getByRole("button", { name: "Accept the invitation" })).toBeTruthy();
  });
});
