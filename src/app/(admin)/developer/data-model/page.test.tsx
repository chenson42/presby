// @vitest-environment jsdom
/** The data-model index (the former /developer): copy, counts, labels, and the gate before any read. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

const { gateMock, buildMock, loadMock } = vi.hoisted(() => ({
  gateMock: vi.fn(),
  buildMock: vi.fn(),
  loadMock: vi.fn(),
}));
vi.mock("../guard", () => ({ requireDeveloper: gateMock }));
vi.mock("@/lib/dev-docs", async (orig) => ({
  ...(await orig<typeof import("@/lib/dev-docs")>()),
  buildSchemaDocs: buildMock,
  loadDescriptions: loadMock,
}));

import DataModelIndex from "./page";

const table = (name: string, module: string, extra: Record<string, unknown> = {}) => ({
  name,
  module,
  tenantScoped: false,
  columns: [{ name: "id", description: "key" }],
  indexes: [],
  foreignKeys: [],
  checks: [],
  notes: [],
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  gateMock.mockResolvedValue("ok");
  loadMock.mockResolvedValue({});
  buildMock.mockReturnValue([
    table("roll_actions", "B. Roll", { tenantScoped: true, description: "Append-only roll." }),
    table("people", "B. Roll", { tenantScoped: true }),
    table("users", "Platform shell"),
  ]);
});
afterEach(cleanup);

describe("data-model index", () => {
  it("gates with the literal path before reading anything", async () => {
    gateMock.mockResolvedValue("forbidden");
    render(await DataModelIndex());
    expect(gateMock).toHaveBeenCalledWith("/developer/data-model");
    expect(loadMock).not.toHaveBeenCalled();
    expect(buildMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Your account doesn't include/)).toBeTruthy();
  });

  it("unavailable reads nothing and offers Try again to this page", async () => {
    gateMock.mockResolvedValue("unavailable");
    render(await DataModelIndex());
    expect(loadMock).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
      "/developer/data-model",
    );
  });

  it("renders the approved heading, eyebrow and standfirst, and drops the 'cannot drift' claim", async () => {
    render(await DataModelIndex());

    expect(screen.getByRole("heading", { level: 1, name: "Data model" })).toBeTruthy();
    expect(screen.getByText("Developer portal · reference")).toBeTruthy();
    const text = document.querySelector(".reg__masthead")!.textContent!;
    expect(text).toContain("The grouping into modules is a hand-kept list, and a test fails if a table is missing from it.");
    expect(text).toContain("Not shown here: row-level security policies, triggers and functions");
    expect(text).not.toMatch(/cannot drift|tenant-scoped|rules unenforced/);
    expect(document.body.textContent).not.toContain("What the schema guarantees");
  });

  it("counts tables, organization_id, rules that rely on review, and undescribed non-platform tables", async () => {
    render(await DataModelIndex());
    const counts = document.querySelector(".reg__counts")!.textContent!;
    expect(counts).toContain("3 tables");
    expect(counts).toContain("2 with organization_id");
    expect(counts).toMatch(/\d+ rules rely on review/);
    // people has no description; users is the platform shell and is not counted.
    expect(counts).toContain("1 undescribed");
    expect(within(document.querySelector(".reg__counts") as HTMLElement).getByRole("link", { name: "schema.json" })
      .getAttribute("href")).toBe("/developer/schema.json");
  });

  it("explains the dot and gives every row a screen-reader word instead of a tooltip", async () => {
    render(await DataModelIndex());
    expect(
      screen.getByText(/A filled dot marks a table with an/).textContent,
    ).toBe("A filled dot marks a table with an organization_id column; a hollow dot marks one without.");
    expect(screen.getAllByText("has organization_id").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("no organization_id").length).toBe(1);
    expect(document.querySelector("[title]")).toBeNull();
    expect(screen.getAllByText("No description yet").length).toBe(2);
  });

  it("links a diagram for each real module and none for the platform shell", async () => {
    render(await DataModelIndex());
    const diagrams = screen.getAllByRole("link", { name: "Diagram →" });
    expect(diagrams).toHaveLength(1);
    expect(diagrams[0].getAttribute("href")).toBe("/developer/erd/b-roll");
  });

  it("labels the three sections: tables Generated, rules Written by hand, permissions Generated", async () => {
    render(await DataModelIndex());
    const rules = screen.getByRole("heading", { name: "The rules the system relies on" }).parentElement!;
    expect(within(rules).getByText("Written by hand")).toBeTruthy();
    const perms = screen.getByRole("heading", { name: "Platform permissions" }).parentElement!;
    expect(within(perms).getByText("Generated")).toBeTruthy();
    expect(document.querySelector(".reg__provenance")!.textContent).toBe("Generated");
    expect(screen.getByText(/Rules marked/).parentElement!.textContent).toContain(
      "nothing in the database stops a violation, so review catches it.",
    );
  });
});
