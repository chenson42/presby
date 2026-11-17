/**
 * The map's pin reader (DECISION-343). `holdsPermissions`, `readRoster` and the
 * transaction are faked, so the properties under test are the ORDER (the key is
 * checked live before any other read) and the SHAPE of the one select.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  holdsPermissions: vi.fn(),
  readRoster: vi.fn(),
  withOrgContext: vi.fn(),
}));
vi.mock("@/lib/org-portal/permission-check", () => ({ holdsPermissions: mocks.holdsPermissions }));
vi.mock("./roster", () => ({ readRoster: mocks.readRoster }));
vi.mock("@/lib/authz", () => ({ withOrgContext: mocks.withOrgContext }));
vi.mock("@/lib/db/domain/presbytery", () => ({
  congregationOversight: {
    organizationId: "organizationId",
    aboutOrgId: "aboutOrgId",
    viabilityScore: "viabilityScore",
    latitude: "latitude",
    longitude: "longitude",
  },
}));

import { getViabilityMap, readViabilityMap } from "./viability-map";

const VIEWER = { userId: "u1", email: null, personId: "p1", organizationId: "o1" };
const ROSTER = [
  { id: "a", name: "Alder Creek" },
  { id: "b", name: "Birch Hollow" },
];

function fakeTx(rows: unknown[]) {
  const selected: unknown[] = [];
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn((cols: unknown) => {
    selected.push(cols);
    return { from };
  });
  return { tx: { select }, select, from, where, selected };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.holdsPermissions.mockResolvedValue([true]);
  mocks.readRoster.mockResolvedValue(ROSTER);
});

describe("readViabilityMap", () => {
  it("checks the viability key first, live, and returns forbidden before reading the roster or any row", async () => {
    mocks.holdsPermissions.mockResolvedValue([false]);
    const t = fakeTx([]);
    expect(await readViabilityMap(t.tx as never, VIEWER)).toEqual({ kind: "forbidden" });
    expect(mocks.holdsPermissions).toHaveBeenCalledWith(t.tx, VIEWER, ["congregation_oversight.manage"]);
    expect(mocks.readRoster).not.toHaveBeenCalled();
    expect(t.select).not.toHaveBeenCalled();
  });

  it("reads the roster before the oversight rows, and selects nothing for an empty roster", async () => {
    mocks.readRoster.mockResolvedValue([]);
    const t = fakeTx([]);
    expect(await readViabilityMap(t.tx as never, VIEWER)).toEqual({ kind: "ok", data: { total: 0, pins: [], unplaced: [] } });
    expect(mocks.readRoster).toHaveBeenCalledWith(t.tx, "o1");
    expect(t.select).not.toHaveBeenCalled();
  });

  it("selects EXACTLY four columns: the about-org id, the score and the two coordinates", async () => {
    const t = fakeTx([{ aboutOrgId: "a", viabilityScore: 3, latitude: "39.9", longitude: "-82.9" }]);
    const result = await readViabilityMap(t.tx as never, VIEWER);
    expect(Object.keys(t.selected[0] as object).sort()).toEqual(["aboutOrgId", "latitude", "longitude", "viabilityScore"]);
    expect(result).toMatchObject({
      kind: "ok",
      data: { total: 2, pins: [{ id: "a", label: "Healthy", lat: 39.9, lng: -82.9 }], unplaced: [{ id: "b" }] },
    });
  });

  it("source scan: the select names no notes, buildings, insurance or date column and writes nothing", () => {
    const src = readFileSync(path.join(__dirname, "viability-map.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const select = src.slice(src.indexOf(".select({"), src.indexOf(".from("));
    expect([...select.matchAll(/congregationOversight\.(\w+)/g)].map((m) => m[1]).sort()).toEqual([
      "aboutOrgId",
      "latitude",
      "longitude",
      "viabilityScore",
    ]);
    expect(src).not.toMatch(/redevelopmentNotes|buildingsNotes|insurance|updatedAt|updatedBy/);
    expect(src).not.toMatch(/\.(insert|update|delete)\(|recordAudit|auditReportExport|export\w*\(/);
  });

  it("propagates a thrown error (the dashboard turns it into the map's error line)", async () => {
    const t = fakeTx([]);
    t.where.mockRejectedValue(new Error("statement aborted"));
    await expect(readViabilityMap(t.tx as never, VIEWER)).rejects.toThrow("statement aborted");
  });
});

describe("getViabilityMap", () => {
  it("runs in the viewer's own org transaction", async () => {
    const t = fakeTx([]);
    mocks.withOrgContext.mockImplementation(async (_p: string, _o: string, fn: (tx: unknown) => unknown) => fn(t.tx));
    const result = await getViabilityMap(VIEWER);
    expect(mocks.withOrgContext).toHaveBeenCalledWith("p1", "o1", expect.any(Function));
    expect(result.kind).toBe("ok");
  });
});
