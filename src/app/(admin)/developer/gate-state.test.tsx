// @vitest-environment jsdom
/**
 * The two non-ok gate outcomes (E5, E7): forbidden is the shared "doesn't
 * include" page; unavailable owns the fault and retries the page's own path.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GateState } from "./gate-state";

afterEach(cleanup);

describe("GateState", () => {
  it("forbidden says the account doesn't include the portal, and names no role", () => {
    render(<GateState gate="forbidden" retryHref="/developer" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Developer portal" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Your account doesn't include the developer portal. Ask a platform administrator if you need it.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("unavailable owns the fault and retries the page's own literal path", () => {
    render(
      <GateState gate="unavailable" retryHref="/developer/tables/roll_actions" />,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "We can't check your access right now",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText("This is on our end, not yours. Try again in a moment."),
    ).toBeTruthy();
    const retry = screen.getByRole("link", { name: "Try again" });
    expect(retry.getAttribute("href")).toBe("/developer/tables/roll_actions");
    expect(document.body.textContent).not.toMatch(/removed|revoked|denied/i);
  });
});
