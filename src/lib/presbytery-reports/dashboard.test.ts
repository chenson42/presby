/**
 * The dashboard composition (DECISION-342), with every reader and the
 * transaction wrapper mocked: the properties under test are the ORDER (hub
 * first, forbidden before any read), the INDEPENDENCE (one transaction per
 * reader, settled separately, so one failure degrades one card) and the
 * `OrgAccessError` rule (rethrown, never a card error).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  FakeOrgAccessError: class FakeOrgAccessError extends Error {},
  withOrgContext: vi.fn(),
  readRoster: vi.fn(),
  getReportsHub: vi.fn(),
  getMembershipTrend: vi.fn(),
  getVacantPulpits: vi.fn(),
  getPerCapita: vi.fn(),
  getViability: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  OrgAccessError: mocks.FakeOrgAccessError,
  withOrgContext: mocks.withOrgContext,
}));
vi.mock("./roster", () => ({ readRoster: mocks.readRoster }));
vi.mock("./hub", () => ({ getReportsHub: mocks.getReportsHub }));
vi.mock("./membership-trend", () => ({ getMembershipTrend: mocks.getMembershipTrend }));
vi.mock("./vacant-pulpits", () => ({ getVacantPulpits: mocks.getVacantPulpits }));
vi.mock("./per-capita", () => ({ getPerCapita: mocks.getPerCapita }));
vi.mock("./viability", () => ({ getViability: mocks.getViability }));

import { getPresbyteryDashboard, getRosterCount } from "./dashboard";
import { deriveMembershipTrend, derivePerCapita, deriveVacantPulpits, deriveViability } from "./derive";

const VIEWER = { userId: "u1", email: null, personId: "p1", organizationId: "o1" };
const ROSTER = [
  { id: "a", name: "Alder Creek" },
  { id: "b", name: "Birch Hollow" },
];
const ALL_HELD = { held: { vacant_pulpits: true, membership_trend: true, viability: true, per_capita: true } };
const NONE_HELD = { held: { vacant_pulpits: false, membership_trend: false, viability: false, per_capita: false } };
const NOW = new Date("2026-11-16T15:00:00Z");

const ok = <T>(data: T) => ({ kind: "ok" as const, data });

function wireHappyReaders() {
  mocks.getMembershipTrend.mockResolvedValue(
    ok(deriveMembershipTrend(ROSTER, new Map(), new Map([[2025, new Map([["a", { endingActive: 80, provenance: "imported" }]])]]), 2021, 2025)),
  );
  mocks.getVacantPulpits.mockResolvedValue(ok(deriveVacantPulpits(ROSTER, [], "2026-11-16")));
  mocks.getPerCapita.mockResolvedValue(
    ok(derivePerCapita({ roster: ROSTER, records: [], billingYear: 2026, rateBasisYear: null, basisFigureOrgIds: new Set(), anyBillsAnyYear: false })),
  );
  mocks.getViability.mockResolvedValue(ok(deriveViability(ROSTER, [])));
}

beforeEach(() => {
  vi.clearAllMocks();
  // The transaction wrapper just runs the callback with a placeholder tx.
  mocks.withOrgContext.mockImplementation(async (_p: string, _o: string, fn: (tx: unknown) => unknown) => fn({}));
  mocks.readRoster.mockResolvedValue(ROSTER);
  mocks.getReportsHub.mockResolvedValue(ALL_HELD);
  wireHappyReaders();
});

describe("getPresbyteryDashboard", () => {
  it("holding none of the four keys returns forbidden and reads nothing else", async () => {
    mocks.getReportsHub.mockResolvedValue(NONE_HELD);
    expect(await getPresbyteryDashboard(VIEWER, NOW)).toEqual({ kind: "forbidden" });
    expect(mocks.readRoster).not.toHaveBeenCalled();
    expect(mocks.withOrgContext).not.toHaveBeenCalled();
    for (const reader of [mocks.getMembershipTrend, mocks.getVacantPulpits, mocks.getPerCapita, mocks.getViability]) {
      expect(reader).not.toHaveBeenCalled();
    }
  });

  it("a failed hub read is error, never forbidden", async () => {
    mocks.getReportsHub.mockRejectedValue(new Error("connection reset"));
    expect(await getPresbyteryDashboard(VIEWER, NOW)).toEqual({ kind: "error" });
  });

  it("returns every card and the roster count for a viewer who holds all four keys", async () => {
    const result = await getPresbyteryDashboard(VIEWER, NOW);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.roster).toEqual({ kind: "ok", count: 2 });
    expect(result.cards.membership_trend).toMatchObject({ kind: "ok", data: { kind: "figure", year: 2025, total: 80 } });
    expect(result.cards.vacant_pulpits).toEqual({ kind: "ok", data: { kind: "not_recorded" } });
    expect(result.cards.per_capita).toEqual({ kind: "ok", data: { kind: "none", billingYear: 2026, rateSet: false } });
    expect(result.cards.viability.kind).toBe("ok");
  });

  it("a key not held is locked and its reader is never called", async () => {
    mocks.getReportsHub.mockResolvedValue({ held: { ...ALL_HELD.held, per_capita: false, viability: false } });
    const result = await getPresbyteryDashboard(VIEWER, NOW);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.cards.per_capita).toEqual({ kind: "locked" });
    expect(result.cards.viability).toEqual({ kind: "locked" });
    expect(mocks.getPerCapita).not.toHaveBeenCalled();
    expect(mocks.getViability).not.toHaveBeenCalled();
    expect(mocks.getMembershipTrend).toHaveBeenCalledTimes(1);
  });

  it("a reader's forbidden renders that card locked", async () => {
    mocks.getVacantPulpits.mockResolvedValue({ kind: "forbidden" });
    const result = await getPresbyteryDashboard(VIEWER, NOW);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.cards.vacant_pulpits).toEqual({ kind: "locked" });
    expect(result.cards.membership_trend.kind).toBe("ok");
  });

  it("one rejected reader degrades only its own card", async () => {
    mocks.getMembershipTrend.mockRejectedValue(new Error("statement aborted"));
    const result = await getPresbyteryDashboard(VIEWER, NOW);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.cards.membership_trend).toEqual({ kind: "error" });
    expect(result.cards.vacant_pulpits.kind).toBe("ok");
    expect(result.cards.per_capita.kind).toBe("ok");
    expect(result.cards.viability.kind).toBe("ok");
    expect(result.roster).toEqual({ kind: "ok", count: 2 });
  });

  it("a throwing summarizer degrades only its own card", async () => {
    // deriveViability throws a RangeError on an out-of-range score, inside the reader.
    mocks.getViability.mockRejectedValue(new RangeError("viability score out of range: 9"));
    const result = await getPresbyteryDashboard(VIEWER, NOW);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.cards.viability).toEqual({ kind: "error" });
    expect(result.cards.membership_trend.kind).toBe("ok");
    expect(result.cards.vacant_pulpits.kind).toBe("ok");
  });

  it("a failed roster read is roster error while the cards still render", async () => {
    mocks.readRoster.mockRejectedValue(new Error("boom"));
    const result = await getPresbyteryDashboard(VIEWER, NOW);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.roster).toEqual({ kind: "error" });
    expect(result.cards.membership_trend.kind).toBe("ok");
  });

  it("starts every held reader before any settles", async () => {
    const gates: Array<() => void> = [];
    const hold = <T>(value: T) =>
      new Promise<T>((resolve) => {
        gates.push(() => resolve(value));
      });
    mocks.getMembershipTrend.mockReturnValue(hold(ok(deriveMembershipTrend(ROSTER, new Map(), new Map(), 2021, 2025))));
    mocks.getVacantPulpits.mockReturnValue(hold(ok(deriveVacantPulpits(ROSTER, [], "2026-11-16"))));
    mocks.getPerCapita.mockReturnValue(
      hold(ok(derivePerCapita({ roster: ROSTER, records: [], billingYear: 2026, rateBasisYear: null, basisFigureOrgIds: new Set(), anyBillsAnyYear: false }))),
    );
    mocks.getViability.mockReturnValue(hold(ok(deriveViability(ROSTER, []))));

    const pending = getPresbyteryDashboard(VIEWER, NOW);
    // Let the hub read settle and the tasks start; none has resolved yet.
    await vi.waitFor(() => {
      expect(mocks.getMembershipTrend).toHaveBeenCalledTimes(1);
      expect(mocks.getVacantPulpits).toHaveBeenCalledTimes(1);
      expect(mocks.getPerCapita).toHaveBeenCalledTimes(1);
      expect(mocks.getViability).toHaveBeenCalledTimes(1);
      expect(mocks.readRoster).toHaveBeenCalledTimes(1);
    });
    expect(gates).toHaveLength(4);
    for (const open of gates) open();
    expect((await pending).kind).toBe("ok");
  });

  it("an OrgAccessError from the hub, the roster or any reader is rethrown and never a card error", async () => {
    const denied = () => new mocks.FakeOrgAccessError("ended");

    mocks.getReportsHub.mockRejectedValueOnce(denied());
    await expect(getPresbyteryDashboard(VIEWER, NOW)).rejects.toBeInstanceOf(mocks.FakeOrgAccessError);

    mocks.readRoster.mockRejectedValueOnce(denied());
    await expect(getPresbyteryDashboard(VIEWER, NOW)).rejects.toBeInstanceOf(mocks.FakeOrgAccessError);

    for (const reader of [mocks.getMembershipTrend, mocks.getVacantPulpits, mocks.getPerCapita, mocks.getViability]) {
      wireHappyReaders();
      reader.mockRejectedValueOnce(denied());
      await expect(getPresbyteryDashboard(VIEWER, NOW)).rejects.toBeInstanceOf(mocks.FakeOrgAccessError);
    }
  });

  it("derives the trend window and billing year from one now", async () => {
    await getPresbyteryDashboard(VIEWER, NOW);
    expect(mocks.getMembershipTrend).toHaveBeenCalledWith(VIEWER, { from: 2021, to: 2025 });
    expect(mocks.getPerCapita).toHaveBeenCalledWith(VIEWER, { kind: "year", billingYear: 2026 });
    expect(mocks.getVacantPulpits).toHaveBeenCalledWith(VIEWER, NOW);
  });

  it("near New Year the UTC year leads an Ohio calendar: the reader is called with 2026 and the summary carries 2026", async () => {
    const newYear = new Date("2026-01-01T03:00:00Z"); // still Dec 31, 2025 in Ohio
    mocks.getPerCapita.mockResolvedValue(
      ok(derivePerCapita({ roster: ROSTER, records: [], billingYear: 2026, rateBasisYear: 2024, basisFigureOrgIds: new Set(), anyBillsAnyYear: false })),
    );
    const result = await getPresbyteryDashboard(VIEWER, newYear);
    expect(mocks.getPerCapita).toHaveBeenCalledWith(VIEWER, { kind: "year", billingYear: 2026 });
    expect(mocks.getMembershipTrend).toHaveBeenCalledWith(VIEWER, { from: 2021, to: 2025 });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.cards.per_capita).toEqual({ kind: "ok", data: { kind: "none", billingYear: 2026, rateSet: true } });
  });
});

describe("getRosterCount", () => {
  it("counts the roster inside the viewer's own transaction", async () => {
    expect(await getRosterCount(VIEWER)).toBe(2);
    expect(mocks.withOrgContext).toHaveBeenCalledWith("p1", "o1", expect.any(Function));
    expect(mocks.readRoster).toHaveBeenCalledWith({}, "o1");
  });
});
