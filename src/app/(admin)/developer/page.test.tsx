// @vitest-environment jsdom
/**
 * The portal home (E20): two labelled cards, the legend for the labels in use,
 * no database read, and the gate's states.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

const { gateMock, buildMock, loadMock } = vi.hoisted(() => ({
  gateMock: vi.fn(),
  buildMock: vi.fn(),
  loadMock: vi.fn(),
}));
vi.mock("./guard", () => ({ requireDeveloper: gateMock }));
vi.mock("@/lib/dev-docs", () => ({
  buildSchemaDocs: buildMock,
  loadDescriptions: loadMock,
}));

import DeveloperHome from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  gateMock.mockResolvedValue("ok");
});
afterEach(cleanup);

describe("developer home", () => {
  it("gates with the literal /developer path", async () => {
    await DeveloperHome();
    expect(gateMock).toHaveBeenCalledWith("/developer");
  });

  it("renders the heading, standfirst and both section cards with their labels", async () => {
    render(await DeveloperHome());

    expect(screen.getByRole("heading", { level: 1, name: "Developer portal" })).toBeTruthy();
    expect(
      screen.getByText(
        "Engineering reference for PresbyPortal. It describes how the platform is built and does not read congregation records.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Sections" })).toBeTruthy();

    const data = screen.getByRole("link", { name: /Data model/ });
    expect(data.getAttribute("href")).toBe("/developer/data-model");
    expect(within(data).getByText("Generated")).toBeTruthy();
    expect(
      within(data).getByText(
        "Every table, its columns and its links, with a diagram for each module. Built from the schema in the code and the database's own comments.",
      ),
    ).toBeTruthy();

    const docs = screen.getByRole("link", { name: /Documentation/ });
    expect(docs.getAttribute("href")).toBe("/developer/docs");
    expect(within(docs).getByText("Planned")).toBeTruthy();
    expect(
      within(docs).getByText(
        "What documentation exists, where it lives today, and what is planned.",
      ),
    ).toBeTruthy();
  });

  it("explains only the labels in use", async () => {
    render(await DeveloperHome());

    expect(screen.getByRole("heading", { level: 2, name: "What the labels mean" })).toBeTruthy();
    expect(
      screen.getByText("Computed from the code and the database when you open the page."),
    ).toBeTruthy();
    expect(screen.getByText("Not built yet.")).toBeTruthy();
    expect(screen.queryByText(/nothing checks the wording/)).toBeNull();
    expect(screen.queryByText(/a test fails when it falls out of step/)).toBeNull();
  });

  it("makes no database or schema read (E20)", async () => {
    await DeveloperHome();
    expect(loadMock).not.toHaveBeenCalled();
    expect(buildMock).not.toHaveBeenCalled();
  });

  it("forbidden renders the doesn't-include page and nothing else", async () => {
    gateMock.mockResolvedValue("forbidden");
    render(await DeveloperHome());
    expect(screen.getByText(/Your account doesn't include the developer portal/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sections" })).toBeNull();
  });

  it("unavailable offers Try again to /developer", async () => {
    gateMock.mockResolvedValue("unavailable");
    render(await DeveloperHome());
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/developer");
  });
});
