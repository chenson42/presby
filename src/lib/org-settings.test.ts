import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { orgTimeZoneInTx } from "./org-settings";
import type { OrgTx } from "@/lib/authz";

const ORG = "11111111-1111-4111-8111-111111111111";

function txReturning(rows: unknown[]): OrgTx {
  return { execute: vi.fn().mockResolvedValue({ rows }) } as unknown as OrgTx;
}

describe("orgTimeZoneInTx", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the default when the org has no settings row (F132: the fallback is the contract)", async () => {
    expect(await orgTimeZoneInTx(txReturning([]), ORG)).toBe("America/New_York");
  });

  it("returns the stored zone when it is valid", async () => {
    expect(
      await orgTimeZoneInTx(txReturning([{ time_zone: "America/Chicago" }]), ORG),
    ).toBe("America/Chicago");
  });

  it("falls back to the default AND logs only the org id for a zone the runtime rejects", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const zone = await orgTimeZoneInTx(txReturning([{ time_zone: "Nope/Zone" }]), ORG);
    expect(zone).toBe("America/New_York");
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0].map(String).join(" ");
    expect(logged).toContain(ORG);
    expect(logged).not.toContain("Nope/Zone");
  });

  it("treats a null column value like a missing row", async () => {
    expect(await orgTimeZoneInTx(txReturning([{ time_zone: null }]), ORG)).toBe(
      "America/New_York",
    );
  });

  it("does not log on the happy path", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await orgTimeZoneInTx(txReturning([{ time_zone: "Pacific/Honolulu" }]), ORG);
    expect(spy).not.toHaveBeenCalled();
  });
});
