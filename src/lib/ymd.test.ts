import { describe, expect, it } from "vitest";
import { isRealYmd, todayUtcYmd } from "./ymd";
import { isUuid } from "./is-uuid";

describe("isRealYmd", () => {
  it.each(["2026-10-22", "2024-02-29", "1900-01-01", "2000-12-31"])("accepts %s", (v) => {
    expect(isRealYmd(v)).toBe(true);
  });

  it.each([
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-10-00",
    "2026-1-5",
    "26-10-22",
    "03/01/2026",
    "2026-10-22T00:00:00Z",
    " 2026-10-22",
    "",
    "0000-01-01x",
  ])("rejects %j", (v) => {
    expect(isRealYmd(v)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isRealYmd(undefined)).toBe(false);
    expect(isRealYmd(null)).toBe(false);
    expect(isRealYmd(20261022)).toBe(false);
    expect(isRealYmd(new Date())).toBe(false);
  });
});

describe("todayUtcYmd", () => {
  it("is the UTC date, not the local one", () => {
    expect(todayUtcYmd(new Date("2026-10-22T23:59:59Z"))).toBe("2026-10-22");
    expect(todayUtcYmd(new Date("2026-10-23T00:00:00Z"))).toBe("2026-10-23");
  });

  it("is a real date by its own predicate", () => {
    expect(isRealYmd(todayUtcYmd())).toBe(true);
  });
});

describe("isUuid", () => {
  it("accepts a v4 UUID and rejects look-alikes", () => {
    expect(isUuid("c0000000-0000-0000-0000-00000000f0c1")).toBe(true);
    expect(isUuid("p-1")).toBe(false);
    expect(isUuid("c0000000-0000-0000-0000-00000000f0c1; drop table people")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
