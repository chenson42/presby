vi.mock("server-only", () => ({}));

const { checkMock, buildMock, loadMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  buildMock: vi.fn(),
  loadMock: vi.fn(),
}));

vi.mock("../guard", () => ({ checkDeveloperApiRequest: checkMock }));
vi.mock("@/lib/dev-docs", () => ({
  buildSchemaDocs: buildMock,
  buildPermissionDocs: () => [{ key: "k", name: "n", description: "d", category: "c" }],
  loadDescriptions: loadMock,
  INVARIANTS: [{ title: "t", detail: "d", enforcement: "paper", source: null }],
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  loadMock.mockResolvedValue({ tables: new Map(), columns: new Map() });
  buildMock.mockReturnValue([
    { name: "a", tenantScoped: true },
    { name: "b", tenantScoped: false },
  ]);
});

async function expectError(verdict: string, status: number, error: string) {
  checkMock.mockResolvedValue(verdict);
  const res = await GET();
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ error });
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(loadMock).not.toHaveBeenCalled();
  expect(buildMock).not.toHaveBeenCalled();
}

describe("GET /developer/schema.json", () => {
  it("no session is 401 unauthorized", async () => {
    await expectError("signed_out", 401, "unauthorized");
  });

  it("a required, unverified second factor is 403 two_factor_required", async () => {
    await expectError("two_factor_required", 403, "two_factor_required");
  });

  it("a failing access check is 503 unavailable, not 403", async () => {
    await expectError("unavailable", 503, "unavailable");
  });

  it("a signed-in viewer who is not entitled is 403 forbidden", async () => {
    await expectError("forbidden", 403, "forbidden");
  });

  it("a failing schema read is 503 unavailable and no-store", async () => {
    checkMock.mockResolvedValue("ok");
    loadMock.mockRejectedValue(new Error("catalog read failed"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("an entitled viewer gets the payload, no-store, with the invariants", async () => {
    checkMock.mockResolvedValue("ok");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.counts).toEqual({ tables: 2, tenantScoped: 1 });
    expect(body.generatedFrom).toBe("src/lib/db/schema");
    expect(body.invariants[0]).toMatchObject({ enforcement: "paper", source: null });
    expect(body.tables).toHaveLength(2);
  });

  it("the gate runs before any schema read", async () => {
    checkMock.mockImplementation(async () => {
      expect(buildMock).not.toHaveBeenCalled();
      expect(loadMock).not.toHaveBeenCalled();
      return "ok";
    });
    await GET();
    expect(buildMock).toHaveBeenCalled();
  });

  it("the response never leaks an error message or stack", async () => {
    checkMock.mockResolvedValue("ok");
    loadMock.mockRejectedValue(new Error("password=hunter2 at /srv/app.js:1"));
    const res = await GET();
    expect(JSON.stringify(await res.json())).not.toMatch(/hunter2|\.js/);
  });
});
