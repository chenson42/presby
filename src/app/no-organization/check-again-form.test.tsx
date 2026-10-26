// @vitest-environment jsdom
/**
 * "Check again" (Community Increment 2b, Copy groups A and B). Mocked at the
 * `./actions` boundary: `actions.test.ts` owns the action's behaviour. These pin
 * the CLIENT contract: disabled until hydration (DECISION-159), 44px, the four
 * distinct outcomes, and every word from the copy module.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const mockCheck = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  checkAgainAction: (...a: unknown[]) => mockCheck(...a),
  acceptInPlaceAction: vi.fn(),
  switchAccountAction: vi.fn(),
}));

import { CheckAgainForm } from "./check-again-form";
import { NO_ORG_COPY, NO_ORG_SECOND_FACTOR_COPY } from "@/lib/onboarding/no-organization-copy";

afterEach(() => {
  cleanup();
  mockCheck.mockReset();
});

async function press() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: NO_ORG_COPY.buttons.checkAgain }));
  });
}

describe("CheckAgainForm", () => {
  it("the button is disabled in the server render, before hydration", () => {
    const html = renderToString(<CheckAgainForm enrolled={false} />);
    expect(html.match(/<button[^>]*>/g)?.[0]).toContain('disabled=""');
  });

  it("is a 44px target labelled 'Check again'", () => {
    render(<CheckAgainForm enrolled={false} />);
    const button = screen.getByRole("button", { name: "Check again" });
    expect(button.className).toContain("min-h-11");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("declined -> 'Nothing new yet.' as a status", async () => {
    mockCheck.mockResolvedValue({ status: "nothing_new" });
    render(<CheckAgainForm enrolled={false} />);
    await press();
    expect(screen.getByRole("status").textContent).toBe("Nothing new yet.");
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it("needs a second factor, enrolled -> 'Continue to verification' to /totp, returning here", async () => {
    mockCheck.mockResolvedValue({ status: "needs_second_factor" });
    render(<CheckAgainForm enrolled />);
    await press();
    expect(screen.getByText(NO_ORG_SECOND_FACTOR_COPY.enrolled.body)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Continue to verification" });
    expect(link.getAttribute("href")).toBe("/totp?callbackUrl=%2Fno-organization");
  });

  it("needs a second factor, not enrolled -> 'Set up two-factor sign-in' to /account/2fa, returning here", async () => {
    mockCheck.mockResolvedValue({ status: "needs_second_factor" });
    render(<CheckAgainForm enrolled={false} />);
    await press();
    expect(screen.getByText(NO_ORG_SECOND_FACTOR_COPY.notEnrolled.body)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Set up two-factor sign-in" });
    expect(link.getAttribute("href")).toBe("/account/2fa?callbackUrl=%2Fno-organization");
  });

  it("an error shows the action's own sentence as an alert", async () => {
    mockCheck.mockResolvedValue({ status: "error", code: "db_error", message: NO_ORG_COPY.checkFailed });
    render(<CheckAgainForm enrolled={false} />);
    await press();
    expect(screen.getByRole("alert").textContent).toBe("We couldn't check just now. Try again.");
  });

  it("can be pressed again after an answer", async () => {
    mockCheck.mockResolvedValueOnce({ status: "nothing_new" }).mockResolvedValueOnce({ status: "nothing_new" });
    render(<CheckAgainForm enrolled={false} />);
    await press();
    await press();
    expect(mockCheck).toHaveBeenCalledTimes(2);
  });
});
