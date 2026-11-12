// @vitest-environment jsdom
/**
 * T11 - the leader panel's three `LeaderLink` states (docs/work-log/2026-11-10-learn-inc1a.md,
 * Phase 3 Copy G8; F442). Every member reads it, so it carries no instruction a member cannot follow.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LAST_REVIEWED } from "@/lib/learn/spot-the-scam/content";
import { LeaderPanel } from "./leader-panel";

afterEach(cleanup);

const LIVE = {
  kind: "live" as const,
  address: "presby.invalid/site/alder-creek/learn/spot-the-scam",
  href: "https://presby.invalid/site/alder-creek/learn/spot-the-scam",
};

describe("LeaderPanel", () => {
  it("live: the address as text, an 'Open the public page' link to the SiteUrls-built href, the maintainer fact, the review date and the help link", () => {
    render(<LeaderPanel link={LIVE} />);
    const panel = screen.getByTestId("leader-panel");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Using this outside the portal");
    expect(screen.getByTestId("leader-live").textContent).toContain(
      `Anyone can use this on your public website, with no sign-in: ${LIVE.address}`,
    );
    expect(screen.getByRole("link", { name: "Open the public page" }).getAttribute("href")).toBe(LIVE.href);
    expect(panel.textContent).toContain("Whoever maintains your website can also place this on a page.");
    expect(panel.textContent).toContain("The practice messages were last reviewed on ");
    expect(panel.querySelector(`time[datetime='${LAST_REVIEWED}']`)).not.toBeNull();
    expect(screen.getByRole("link", { name: "About Spot the scam" }).getAttribute("href")).toBe("/help/spot-the-scam");
    expect(screen.queryByTestId("leader-not-live")).toBeNull();
    expect(screen.queryByTestId("leader-unknown")).toBeNull();
  });

  it("not live: says there is no public address to share yet, offers no link to it, and still tells people the page works for them", () => {
    render(<LeaderPanel link={{ kind: "not_live" }} />);
    expect(screen.getByTestId("leader-not-live").textContent).toBe(
      "Your public website isn't showing right now, so there is no public address to share yet. People who sign in to the portal can still use this page.",
    );
    expect(screen.queryByRole("link", { name: "Open the public page" })).toBeNull();
    expect(screen.queryByTestId("leader-live")).toBeNull();
  });

  it("unknown (a read that did not complete): says so, claims neither live nor not live", () => {
    render(<LeaderPanel link={{ kind: "unknown" }} />);
    expect(screen.getByTestId("leader-unknown").textContent).toBe(
      "We couldn't check your public address just now. Try again later.",
    );
    expect(screen.queryByRole("link", { name: "Open the public page" })).toBeNull();
    expect(screen.queryByTestId("leader-not-live")).toBeNull();
  });

  it("is print:hidden, wraps a long address, and gives no instruction a plain member cannot follow (no 'turn on', no permission)", () => {
    for (const link of [LIVE, { kind: "not_live" as const }, { kind: "unknown" as const }]) {
      render(<LeaderPanel link={link} />);
      const panel = screen.getByTestId("leader-panel");
      expect(panel.className).toContain("print:hidden");
      expect(panel.textContent).not.toMatch(/turn (it|this) on|permission|ask (someone|your)/i);
      cleanup();
    }
    render(<LeaderPanel link={{ ...LIVE, address: "x".repeat(200) }} />);
    expect(screen.getByTestId("leader-live").className).toContain("[overflow-wrap:anywhere]");
  });
});
