// @vitest-environment jsdom
/** A diagram page (E6, E7, E12). */
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
vi.mock("../../erd", () => ({ Erd: () => <div data-testid="erd" /> }));
vi.mock("@/lib/dev-docs", async (orig) => ({
  ...(await orig<typeof import("@/lib/dev-docs")>()),
  buildSchemaDocs: buildMock,
  loadDescriptions: loadMock,
}));

import ErdPage from "./page";

const params = (module: string) => ({ params: Promise.resolve({ module }) });

beforeEach(() => {
  vi.clearAllMocks();
  gateMock.mockResolvedValue("ok");
  loadMock.mockResolvedValue({});
  buildMock.mockReturnValue([
    { name: "people", module: "B. Roll", tenantScoped: true, columns: [], indexes: [], foreignKeys: [], checks: [], notes: [] },
  ]);
});
afterEach(cleanup);

describe("erd module page", () => {
  it("gates first with a literal path", async () => {
    await ErdPage(params("b-roll"));
    expect(gateMock).toHaveBeenCalledWith("/developer/erd/b-roll");
  });

  it("forbidden: notFound and loadDescriptions never called, even for a missing module (E6)", async () => {
    gateMock.mockResolvedValue("forbidden");
    render(await ErdPage(params("no-such-module")));
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(loadMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Your account doesn't include/)).toBeTruthy();
  });

  it("unavailable: loadDescriptions not called", async () => {
    gateMock.mockResolvedValue("unavailable");
    render(await ErdPage(params("b-roll")));
    expect(loadMock).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
      "/developer/erd/b-roll",
    );
  });

  it("an unknown module is notFound for an entitled viewer", async () => {
    await expect(ErdPage(params("no-such-module"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders the crumb back to the data model, the diagram and an honest 'no description yet'", async () => {
    render(await ErdPage(params("b-roll")));
    expect(screen.getByRole("link", { name: "Data model" }).getAttribute("href")).toBe(
      "/developer/data-model",
    );
    expect(screen.getByRole("heading", { level: 1, name: "B. Roll" })).toBeTruthy();
    expect(screen.getByTestId("erd")).toBeTruthy();
    expect(screen.getByText("No description yet")).toBeTruthy();
  });
});
