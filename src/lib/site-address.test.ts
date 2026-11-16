import { describe, expect, it } from "vitest";
import { MAX_ADDRESS_LEN, normalizeAddress } from "./site-address";

describe("normalizeAddress", () => {
  it("keeps a single-line address as it was", () => {
    expect(normalizeAddress("  1 Placeholder Way, Fillmore, ZZ 00000 ")).toEqual({
      ok: true,
      value: "1 Placeholder Way, Fillmore, ZZ 00000",
    });
  });

  it("normalizes every line break to LF, trims lines and drops blank ones", () => {
    const raw = " 1 Placeholder Way \r\nSuite B\r\r\n Fillmore,\tZZ 00000\u0085\n";
    expect(normalizeAddress(raw)).toEqual({
      ok: true,
      value: "1 Placeholder Way\nSuite B\nFillmore, ZZ 00000",
    });
  });

  it("an all-blank address is empty", () => {
    expect(normalizeAddress(" \n\r\n ")).toEqual({ ok: true, value: "" });
  });

  it("refuses more than six lines", () => {
    const result = normalizeAddress(["a", "b", "c", "d", "e", "f", "g"].join("\n"));
    expect(result).toEqual({ ok: false, error: "Address can have up to 6 lines." });
  });

  it("measures the length after normalizing", () => {
    const padded = `${"x".repeat(MAX_ADDRESS_LEN)}\n\n\n   `;
    expect(normalizeAddress(padded)).toEqual({ ok: true, value: "x".repeat(MAX_ADDRESS_LEN) });
    expect(normalizeAddress("x".repeat(MAX_ADDRESS_LEN + 1)).ok).toBe(false);
  });
});
