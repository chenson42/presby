vi.mock("server-only", () => ({}));

const mockExecute = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { execute: (...args: unknown[]) => mockExecute(...args) } }));

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mapPublicConfigRow,
  mapReturnStateRow,
  readPublicGivingConfig,
  readReturnState,
} from "./public-config";

const FUND_A = "d9100000-0000-0000-0000-0000000000a1";
const FUND_B = "d9100000-0000-0000-0000-0000000000a2";

function liveRow(overrides: Record<string, unknown> = {}) {
  return {
    state: "live",
    organization_name: "Alder Creek Church",
    livemode: false,
    contact_phone: "555-0100",
    fund_ids: [FUND_A, FUND_B],
    fund_names: ["General Fund", "Missions"],
    card_enabled: true,
    ach_enabled: true,
    card_fee_bps: 290,
    card_fee_fixed_cents: 30,
    ach_fee_bps: 80,
    ach_fee_cap_cents: 500,
    min_amount_cents: 100,
    max_amount_cents: 2_500_000,
    ...overrides,
  };
}

beforeEach(() => {
  mockExecute.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("mapPublicConfigRow", () => {
  it("maps a live row to the form's inputs, funds paired by position", () => {
    expect(mapPublicConfigRow(liveRow())).toEqual({
      state: "live",
      organizationName: "Alder Creek Church",
      livemode: false,
      contactPhone: "555-0100",
      funds: [
        { id: FUND_A, name: "General Fund" },
        { id: FUND_B, name: "Missions" },
      ],
      cardEnabled: true,
      achEnabled: true,
      rates: { cardBps: 290, cardFixedCents: 30, achBps: 80, achCapCents: 500 },
      minAmountCents: 100,
      maxAmountCents: 2_500_000,
    });
  });

  it("maps unavailable to the name and the public phone only", () => {
    expect(
      mapPublicConfigRow({ state: "unavailable", organization_name: "Alder Creek Church", contact_phone: null }),
    ).toEqual({ state: "unavailable", organizationName: "Alder Creek Church", contactPhone: null });
  });

  it("absent, a missing row and every unrecognized state are `absent`", () => {
    expect(mapPublicConfigRow({ state: "absent" })).toEqual({ state: "absent" });
    expect(mapPublicConfigRow(undefined)).toEqual({ state: "absent" });
    expect(mapPublicConfigRow({ state: "something_new" })).toEqual({ state: "absent" });
  });

  it("a malformed live row is `absent`, never a half-built form", () => {
    for (const bad of [
      liveRow({ fund_ids: [] , fund_names: []}),
      liveRow({ fund_ids: [FUND_A], fund_names: ["a", "b"] }),
      liveRow({ fund_ids: "{a,b}" }),
      liveRow({ fund_names: [""] , fund_ids: [FUND_A]}),
      liveRow({ organization_name: null }),
      liveRow({ card_fee_bps: null }),
      liveRow({ livemode: null }),
      liveRow({ max_amount_cents: "lots" }),
    ]) {
      expect(mapPublicConfigRow(bad)).toEqual({ state: "absent" });
    }
  });

  it("never carries an account id or an organization id, even if the row were to hold one", () => {
    const mapped = JSON.stringify(
      mapPublicConfigRow(liveRow({ external_account_id: "acct_fixtureABCDEFGH", organization_id: "org-1" })),
    );
    expect(mapped).not.toMatch(/acct_/);
    expect(mapped).not.toMatch(/org-1/);
  });
});

describe("readPublicGivingConfig", () => {
  it("is `absent` for a non-slug without touching the database", async () => {
    for (const bad of ["", "Alder Creek", "../x", "a".repeat(80)]) {
      expect(await readPublicGivingConfig(bad)).toEqual({ state: "absent" });
    }
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("reads through the one DEFINER function", async () => {
    mockExecute.mockResolvedValue({ rows: [liveRow()] });
    const config = await readPublicGivingConfig("alder-creek");
    expect(config.state).toBe("live");
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("a database failure is `absent`, logged with the slug and a stage but no row or message", async () => {
    mockExecute.mockRejectedValue(new Error("connection terminated: password=hunter2"));
    expect(await readPublicGivingConfig("alder-creek")).toEqual({ state: "absent" });
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls);
    expect(logged).toContain("alder-creek");
    expect(logged).not.toContain("hunter2");
  });
});

describe("mapReturnStateRow", () => {
  const row = (state: string, overrides: Record<string, unknown> = {}) => ({
    state,
    gift_amount_cents: 5000,
    covered_cents: 175,
    fund_name: "General Fund",
    frequency: "once",
    livemode: true,
    ...overrides,
  });

  it.each(["confirming", "received", "bank_pending", "failed"])("maps %s with the donor-visible facts", (state) => {
    expect(mapReturnStateRow(row(state))).toEqual({
      state,
      giftAmountCents: 5000,
      coveredCents: 175,
      fundName: "General Fund",
      frequency: "once",
      livemode: true,
    });
  });

  it("unknown, a missing row, an unrecognized state and a malformed row are all `unknown`", () => {
    const unknown = { state: "unknown" };
    expect(mapReturnStateRow({ state: "unknown" })).toEqual(unknown);
    expect(mapReturnStateRow(undefined)).toEqual(unknown);
    expect(mapReturnStateRow(row("paid"))).toEqual(unknown);
    expect(mapReturnStateRow(row("received", { fund_name: null }))).toEqual(unknown);
    expect(mapReturnStateRow(row("received", { frequency: "weekly" }))).toEqual(unknown);
    expect(mapReturnStateRow(row("received", { gift_amount_cents: "5000.5" }))).toEqual(unknown);
  });
});

describe("readReturnState", () => {
  it("answers `unknown` for a malformed session id or slug without touching the database", async () => {
    for (const bad of ["", "garbage", "cs_short", "cs_" + "x".repeat(300), "pi_test_abcdefghij"]) {
      expect(await readReturnState("alder-creek", bad)).toEqual({ state: "unknown" });
    }
    expect(await readReturnState("Not A Slug", "cs_test_abcdefghij")).toEqual({ state: "unknown" });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("reads presby's own rows for a well-formed id", async () => {
    mockExecute.mockResolvedValue({
      rows: [{ state: "received", gift_amount_cents: 2500, covered_cents: 0, fund_name: "General Fund", frequency: "monthly", livemode: false }],
    });
    expect(await readReturnState("alder-creek", "cs_test_abcdefghij")).toMatchObject({ state: "received", frequency: "monthly" });
  });

  it("a database failure is its own `error` state (never `unknown`, never a guess), logged without the session id", async () => {
    mockExecute.mockRejectedValue(new Error("boom"));
    expect(await readReturnState("alder-creek", "cs_test_abcdefghij")).toEqual({ state: "error" });
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls);
    expect(logged).not.toContain("cs_test_abcdefghij");
  });
});
