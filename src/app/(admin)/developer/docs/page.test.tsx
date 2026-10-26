// @vitest-environment jsdom
/** The Documentation placeholder page: seven rows, each Planned, honest about where the material lives. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const { gateMock } = vi.hoisted(() => ({ gateMock: vi.fn() }));
vi.mock("../guard", () => ({ requireDeveloper: gateMock }));

import DeveloperDocs from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  gateMock.mockResolvedValue("ok");
});
afterEach(cleanup);

describe("developer documentation page", () => {
  it("gates with the literal /developer/docs path", async () => {
    await DeveloperDocs();
    expect(gateMock).toHaveBeenCalledWith("/developer/docs");
  });

  it("lists seven rows, each marked Planned with a kind and where it lives today", async () => {
    render(await DeveloperDocs());

    expect(screen.getByRole("heading", { level: 1, name: "Documentation" })).toBeTruthy();
    expect(
      screen.getByText(/Nothing here is rendered yet; each document is a file in the repository\./),
    ).toBeTruthy();

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(within(row).getByText("Planned")).toBeTruthy();
      expect(row.textContent).toMatch(/Planned\. Not built yet\. Today/);
    }

    const start = rows[0];
    expect(within(start).getByRole("heading", { name: "Getting started" })).toBeTruthy();
    expect(within(start).getByText("Tutorial")).toBeTruthy();
    expect(start.textContent).toContain(
      "Planned. Not built yet. Today this material lives in README.md and docs/testing.md.",
    );
    expect(rows[6].textContent).toContain(
      "Planned. Not built yet. Today, parts of this appear on the platform administrators' dashboard (email queue and domains).",
    );
  });

  it("states a reviewed date and nothing about being current", async () => {
    render(await DeveloperDocs());
    expect(screen.getByText(/^Reviewed/).textContent).toMatch(/Reviewed\s+(2026-10-25|10\/25\/2026)/);
    expect(document.body.textContent).not.toMatch(/up to date|complete/i);
  });

  it("mentions no API, SDK, rate limit or webhook", async () => {
    render(await DeveloperDocs());
    expect(document.body.textContent).not.toMatch(/\bAPI\b|sdk|rate limit|webhook/i);
  });

  it("forbidden and unavailable render the gate states", async () => {
    gateMock.mockResolvedValue("forbidden");
    const { unmount } = render(await DeveloperDocs());
    expect(screen.getByText(/Your account doesn't include/)).toBeTruthy();
    unmount();

    gateMock.mockResolvedValue("unavailable");
    render(await DeveloperDocs());
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
      "/developer/docs",
    );
  });
});
