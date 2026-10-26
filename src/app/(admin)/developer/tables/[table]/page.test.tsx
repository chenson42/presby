// @vitest-environment jsdom
/** A table page (E6, E7): the gate runs before notFound and every read; crumbs and eyebrow use the new wording. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

const { gateMock, buildMock, loadMock, notFoundMock } = vi.hoisted(() => ({
  gateMock: vi.fn(),
  buildMock: vi.fn(),
  loadMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("../../guard", () => ({ requireDeveloper: gateMock }));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/lib/dev-docs", async (orig) => ({
  ...(await orig<typeof import("@/lib/dev-docs")>()),
  buildSchemaDocs: buildMock,
  loadDescriptions: loadMock,
}));

import TableDetail from "./page";

const col = { name: "id", type: "uuid", primaryKey: true, notNull: true, hasDefault: false };
const t = (extra: Record<string, unknown> = {}) => ({
  name: "roll_actions",
  module: "B. Roll",
  tenantScoped: true,
  columns: [col],
  indexes: [],
  foreignKeys: [],
  checks: [],
  notes: [],
  ...extra,
});
const params = (table: string) => ({ params: Promise.resolve({ table }) });

beforeEach(() => {
  vi.clearAllMocks();
  gateMock.mockResolvedValue("ok");
  loadMock.mockResolvedValue({});
  buildMock.mockReturnValue([t({ description: "Append-only." })]);
});
afterEach(cleanup);

describe("table detail page", () => {
  it("gates first with a literal, encoded path", async () => {
    await TableDetail(params("roll_actions"));
    expect(gateMock).toHaveBeenCalledWith("/developer/tables/roll_actions");
  });

  it("forbidden: notFound and loadDescriptions never called, even for a missing table (E6)", async () => {
    gateMock.mockResolvedValue("forbidden");
    render(await TableDetail(params("no_such_table")));
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(loadMock).not.toHaveBeenCalled();
    expect(buildMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Your account doesn't include/)).toBeTruthy();
  });

  it("unavailable: loadDescriptions not called, retry goes to this table", async () => {
    gateMock.mockResolvedValue("unavailable");
    render(await TableDetail(params("roll_actions")));
    expect(loadMock).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
      "/developer/tables/roll_actions",
    );
  });

  it("an entitled viewer asking for a missing table gets notFound (E12)", async () => {
    await expect(TableDetail(params("no_such_table"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("crumbs lead back to the data model and the module; the eyebrow names the column, not a policy", async () => {
    render(await TableDetail(params("roll_actions")));
    expect(screen.getByRole("link", { name: "Data model" }).getAttribute("href")).toBe(
      "/developer/data-model",
    );
    expect(screen.getByRole("link", { name: "B. Roll" }).getAttribute("href")).toBe(
      "/developer/erd/b-roll",
    );
    expect(screen.getByText("has organization_id")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/rls enforced|not tenant-isolated/);
  });

  it("a global table says no organization_id, and a missing description says how to add one", async () => {
    buildMock.mockReturnValue([t({ tenantScoped: false })]);
    render(await TableDetail(params("roll_actions")));
    expect(screen.getByText("no organization_id")).toBeTruthy();
    expect(document.body.textContent).toContain(
      "No description yet. Add one with COMMENT ON TABLE roll_actions IS '…' in the migration.",
    );
  });
});
