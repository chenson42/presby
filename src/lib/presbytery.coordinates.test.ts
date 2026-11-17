/**
 * The oversight write's coordinate gate (DECISION-343). No database: `authz` is
 * mocked so that a refusal can be proven to return BEFORE `withOrgContext`
 * (a bad value never opens a transaction), and the accepted cases can be proven
 * to reach it. The stored round trip is in `presbytery.test.ts` (Postgres-backed).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const withOrgContext = vi.fn();
// The schema barrel is not needed to exercise the gate (and has an import cycle through schema.ts).
vi.mock("@/lib/db/domain/org", () => ({ organizations: {} }));
vi.mock("@/lib/db/domain/presbytery", () => ({
  congregationOversight: {},
  congregationStatistics: {},
  perCapitaRates: {},
  perCapitaRecords: {},
}));
vi.mock("@/lib/authz", () => ({ withOrgContext: (...a: unknown[]) => withOrgContext(...a) }));

import { setCongregationOversight } from "./presbytery";
import { COORDINATE_MESSAGES } from "./coordinates";

const IDS = ["viewer", "org", "user", "about"] as const;
const call = (input: Record<string, unknown>) =>
  setCongregationOversight(...IDS, input as Parameters<typeof setCongregationOversight>[4]);

beforeEach(() => {
  withOrgContext.mockReset();
  withOrgContext.mockResolvedValue({ kind: "ok", data: { id: "row" } });
});

describe("setCongregationOversight coordinate validation", () => {
  it.each([
    ["NaN latitude", { latitude: Number.NaN, longitude: -82 }, COORDINATE_MESSAGES.latitudeNumber],
    ["Infinity latitude", { latitude: Number.POSITIVE_INFINITY, longitude: -82 }, COORDINATE_MESSAGES.latitudeNumber],
    ["a string latitude", { latitude: "39.9", longitude: -82 }, COORDINATE_MESSAGES.latitudeNumber],
    ["NaN longitude", { latitude: 39, longitude: Number.NaN }, COORDINATE_MESSAGES.longitudeNumber],
    ["a string longitude", { latitude: 39, longitude: "-82.9" }, COORDINATE_MESSAGES.longitudeNumber],
    ["latitude out of range", { latitude: 91, longitude: -82 }, "Latitude must be between -90 and 90."],
    ["longitude out of range", { latitude: 39, longitude: -181 }, "Longitude must be between -180 and 180."],
    ["latitude alone", { latitude: 39.9, longitude: null }, COORDINATE_MESSAGES.halfSet],
    ["longitude alone", { latitude: undefined, longitude: -82.9 }, COORDINATE_MESSAGES.halfSet],
    ["0 and 0", { latitude: 0, longitude: 0 }, COORDINATE_MESSAGES.zeroZero],
  ])("refuses %s before any transaction opens", async (_name, input, message) => {
    const result = await call(input);
    expect(result).toEqual({ kind: "invalid_input", message });
    expect(withOrgContext).not.toHaveBeenCalled();
  });

  it.each([
    ["a valid pair", { latitude: 39.9612, longitude: -82.9988 }],
    ["both blank", { latitude: null, longitude: null }],
    ["both omitted", {}],
  ])("lets %s through to the transaction", async (_name, input) => {
    const result = await call(input);
    expect(result).toEqual({ kind: "ok", data: { id: "row" } });
    expect(withOrgContext).toHaveBeenCalledTimes(1);
  });
});
