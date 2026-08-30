// @vitest-environment jsdom
/**
 * Structural tests for the public `/` landing page — second revision, docs/
 * work-log/2026-08-27-platform-home-and-portal.md ("Commit 3 — second
 * revision"): a top sign-in bar, PresbyPortal naming (DECISION-126), an
 * open-source/sponsor section, an architecture teaser, and a get-involved
 * section, layered onto the marketing-redesign structure from the prior
 * pass. Pins:
 *
 *   1. Signed-out: shows "Sign in" (now in the top bar), never "Continue" or
 *      "Sign out" (DECISION-034 — signed-in Continue path stays
 *      byte-identical).
 *   2. Signed-in: shows "Continue" (to /launch, never a redirect) and
 *      "Sign out", never "Sign in" — both now surfaced once, in the top bar,
 *      not duplicated lower on the page.
 *   3. The hero renders: the PresbyPortal-framed headline and the four-court
 *      connectional diagram's labels.
 *   4. The copy names congregations, presbyteries, and synods as distinct
 *      served levels, and uses "PresbyPortal" (not "presby") in prose.
 *   5. The honest pre-release note survives.
 *   6. The sponsor line, architecture teaser (with its GitHub doc link), and
 *      get-involved section (with its GitHub repo link, no invented
 *      contribution process) all render.
 *   7. Single <h1>; <h2> section headings; heading hierarchy intact.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({
  auth: () => mockAuth(),
  signOut: vi.fn(),
}));

import Home from "./page";

afterEach(() => {
  cleanup();
  mockAuth.mockReset();
});

describe("/ — signed out", () => {
  it("shows Sign in, not Continue or Sign out", async () => {
    mockAuth.mockResolvedValue(null);

    const el = await Home();
    render(el);

    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Continue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(screen.queryByText(/welcome back/i)).toBeNull();
  });
});

describe("/ — signed in", () => {
  it("shows Continue (to /launch) and Sign out, not Sign in", async () => {
    mockAuth.mockResolvedValue({ user: { name: "Jamie" } });

    const el = await Home();
    render(el);

    const continueLink = screen.getByRole("link", { name: "Continue" });
    expect(continueLink.getAttribute("href")).toBe("/launch");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.getByText(/welcome back/i).textContent).toMatch(/Jamie/);
  });

  it("falls back to email when no name is on the session", async () => {
    mockAuth.mockResolvedValue({ user: { email: "someone@example.invalid" } });

    const el = await Home();
    render(el);

    expect(screen.getByText(/someone@example\.invalid/)).toBeTruthy();
  });
});

describe("/ — top bar", () => {
  it("renders the PresbyPortal wordmark linking home", async () => {
    mockAuth.mockResolvedValue(null);

    const el = await Home();
    render(el);

    const wordmark = screen.getByRole("link", { name: "PresbyPortal" });
    expect(wordmark.getAttribute("href")).toBe("/");
  });
});

describe("/ — hero", () => {
  it("renders the connectional-government headline", async () => {
    mockAuth.mockResolvedValue(null);

    const el = await Home();
    render(el);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toMatch(/connectional/i);
  });

  it("renders the four-court connectional diagram's labels", async () => {
    mockAuth.mockResolvedValue(null);

    const el = await Home();
    render(el);

    expect(screen.getByText("Congregation")).toBeTruthy();
    expect(screen.getByText("Presbytery")).toBeTruthy();
    expect(screen.getByText("Synod")).toBeTruthy();
    expect(screen.getByText("General Assembly")).toBeTruthy();
  });

  it("marks the connectional diagram's SVG as decorative", async () => {
    mockAuth.mockResolvedValue(null);

    const el = await Home();
    const { container } = render(el);

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("/ — copy content", () => {
  it("names congregations, presbyteries, and synods as distinct served levels", async () => {
    mockAuth.mockResolvedValue(null);

    const el = await Home();
    render(el);

    expect(screen.getAllByText(/congregations?/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/presbyter(y|ies)/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/synods?/i).length).toBeGreaterThan(0);
  });

  it("names capabilities grounded in the functionality map, not invented ones", async () => {
    mockAuth.mockResolvedValue(null);

    const el = await Home();
    render(el);

    expect(screen.getByText(/What PresbyPortal does/i)).toBeTruthy();
    expect(screen.getByText(/Membership & records/i)).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Council operations" }),
    ).toBeTruthy();
    expect(screen.getByText(/Public websites/i)).toBeTruthy();
    // Not-built capabilities (functionality-map.md's "NOT built" line) must
    // never be claimed here.
    expect(screen.queryByText(/giving/i)).toBeNull();
    expect(screen.queryByText(/worship/i)).toBeNull();
  });

  it("keeps the honest pre-release note", async () => {
    mockAuth.mockResolvedValue(null);

    const el = await Home();
    render(el);

    expect(
      screen.getByText(/pre-release\. nothing here is a live congregation\./i),
    ).toBeTruthy();
  });

  it("uses the settled PresbyPortal name in prose, not the bare 'presby' placeholder", async () => {
    mockAuth.mockResolvedValue(null);

    const el = await Home();
    render(el);

    // DECISION-126 settled the name; the <h1> itself is still the marketing
    // headline (not the bare product name), but prose elsewhere says
    // "PresbyPortal", never the old unnamed-project "presby" placeholder.
    // (The repo URL "github.com/chenson42/presby" legitimately contains the
    // substring "presby" — that's a real, unchangeable identifier, not a
    // naming placeholder, so it's excluded from this check rather than
    // asserted against.)
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).not.toBe("presby");
    expect(screen.getAllByText(/PresbyPortal/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { name: "What PresbyPortal does" }),
    ).toBeTruthy();
    expect(screen.queryByText(/^presby$/i)).toBeNull();
  });

  it("names the FPCW sponsor in a short, dignified open-source section", async () => {
    mockAuth.mockResolvedValue(null);

    const el = await Home();
    render(el);

    expect(screen.getByRole("heading", { name: "Open source" })).toBeTruthy();
    expect(
      screen.getByText(
        /PresbyPortal is open source, and its development is supported by the mission of First Presbyterian Church of Westerville\./,
      ),
    ).toBeTruthy();
  });

  it("teases the architecture with a real link, not a duplicate of the doc", async () => {
    mockAuth.mockResolvedValue(null);

    const el = await Home();
    render(el);

    expect(
      screen.getByRole("heading", { name: /How it.s built/i }),
    ).toBeTruthy();
    expect(screen.getByText(/walled off/i)).toBeTruthy();
    expect(screen.getByText(/never edited afterward/i)).toBeTruthy();
    expect(screen.getByText(/never down by inheritance/i)).toBeTruthy();

    const archLink = screen.getByRole("link", {
      name: "architecture overview",
    });
    expect(archLink.getAttribute("href")).toBe(
      "https://chenson42.github.io/presby/",
    );
  });

  it("points Get involved at the real repo without inventing a contribution process", async () => {
    mockAuth.mockResolvedValue(null);

    const el = await Home();
    render(el);

    expect(screen.getByRole("heading", { name: "Get involved" })).toBeTruthy();
    const repoLink = screen.getByRole("link", {
      name: "github.com/chenson42/presby",
    });
    expect(repoLink.getAttribute("href")).toBe(
      "https://github.com/chenson42/presby",
    );
    expect(screen.getByText(/MIT license/)).toBeTruthy();
    expect(
      screen.getByText(/Formal contribution guidelines aren.t written yet\./),
    ).toBeTruthy();
  });

  it("uses a single <h1> and at least two <h2> section headings", async () => {
    mockAuth.mockResolvedValue(null);

    const el = await Home();
    render(el);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThanOrEqual(2);
  });
});
