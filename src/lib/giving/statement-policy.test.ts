import { describe, expect, it } from "vitest";
import {
  COUNT_DONOR_COVERED_FEE_AS_CONTRIBUTION,
  STATEMENT_WORDING_VERSION,
} from "./statement-policy";

describe("statement policy constants (G10, G11)", () => {
  it("counts a donor-covered fee as part of the contribution until the CPA rules otherwise (Operator Q6)", () => {
    expect(COUNT_DONOR_COVERED_FEE_AS_CONTRIBUTION).toBe(true);
  });

  it("starts the code-generated wording at version 1, a positive integer", () => {
    expect(STATEMENT_WORDING_VERSION).toBe(1);
    expect(Number.isInteger(STATEMENT_WORDING_VERSION)).toBe(true);
  });
});
