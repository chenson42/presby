// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import InviteAcceptedPage from "./page";

afterEach(cleanup);

describe("/invite/accepted", () => {
  it("is static: a confirmation and one button to the standard sign-in, no token anywhere", () => {
    render(<InviteAcceptedPage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Your account is ready");
    const link = screen.getByRole("link", { name: /sign in/i });
    expect(link.getAttribute("href")).toBe("/signin?callbackUrl=/launch");
    expect(document.body.innerHTML).not.toMatch(/token/i);
  });

  it("takes no props (it must not accept a token or parameter)", () => {
    expect(InviteAcceptedPage.length).toBe(0);
  });
});
