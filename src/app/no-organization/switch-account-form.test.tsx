// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";

vi.mock("./actions", () => ({
  checkAgainAction: vi.fn(),
  acceptInPlaceAction: vi.fn(),
  switchAccountAction: vi.fn(),
}));

import { SwitchAccountForm } from "./switch-account-form";
import { SecondFactorNotice } from "./second-factor-notice";

afterEach(cleanup);

describe("SwitchAccountForm", () => {
  it("is a plain form over the server action, so it works before hydration, with a 44px 'Sign in with a different account' button", () => {
    render(<SwitchAccountForm />);
    const button = screen.getByRole("button", { name: "Sign in with a different account" });
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.className).toContain("min-h-11");
    expect(renderToString(<SwitchAccountForm />)).not.toContain('disabled=""');
    expect(button.closest("form")).not.toBeNull();
  });
});

describe("SecondFactorNotice", () => {
  it("is a status with the sentence and one 44px link, to the verification challenge when enrolled", () => {
    render(<SecondFactorNotice body="Body." button="Continue to verification" enrolled />);
    expect(screen.getByRole("status").textContent).toContain("Body.");
    const link = screen.getByRole("link", { name: "Continue to verification" });
    expect(link.getAttribute("href")).toBe("/totp?callbackUrl=%2Fno-organization");
    expect(link.className).toContain("min-h-11");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("goes to enrolment when not enrolled", () => {
    render(<SecondFactorNotice body="Body." button="Set up two-factor sign-in" enrolled={false} />);
    expect(screen.getByRole("link", { name: "Set up two-factor sign-in" }).getAttribute("href")).toBe(
      "/account/2fa?callbackUrl=%2Fno-organization",
    );
  });
});
