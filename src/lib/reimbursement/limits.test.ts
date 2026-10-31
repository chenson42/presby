import { describe, expect, it } from "vitest";
import {
  CLIENT_KEY_PATTERN,
  MAX_AMOUNT_CENTS,
  MAX_EXPENSE_DAYS_BACK,
  MAX_LENGTH,
  MAX_OPEN_DRAFTS,
  MAX_RECEIPTS,
  MAX_RECEIPT_BODY_BYTES,
  MAX_RECEIPT_BYTES,
  MIN_AMOUNT_CENTS,
} from "./limits";
import { MIGRATION_0073 } from "./migration-text";

describe("limits.ts agrees with drizzle/0073 (the database enforces its own copy)", () => {
  it("amount: integer cents 1 to 10,000,000", () => {
    expect(MIGRATION_0073).toContain(`between ${MIN_AMOUNT_CENTS} and ${MAX_AMOUNT_CENTS}`);
    expect(MAX_AMOUNT_CENTS).toBe(10_000_000);
  });

  it("field lengths are the CHECK bounds", () => {
    for (const [column, max] of [
      ["name", MAX_LENGTH.category],
      ["vendor_name", MAX_LENGTH.vendor],
      ["purpose", MAX_LENGTH.purpose],
      ["pre_approved_by_name", MAX_LENGTH.preApprover],
      ["receipt_waiver_note", MAX_LENGTH.waiverNote],
      ["display_name", MAX_LENGTH.displayName],
      ["reference", MAX_LENGTH.reference],
      ["reason", MAX_LENGTH.reason],
      ["note", MAX_LENGTH.note],
    ] as const) {
      expect(MIGRATION_0073, column).toMatch(new RegExp(`char_length\\(${column}\\) between 1 and ${max}\\b`));
    }
    expect(MAX_LENGTH.paymentNote).toBe(300);
  });

  it("receipts: at most five live, 4,000,000 bytes stored", () => {
    expect(MIGRATION_0073).toContain(`between 1 and ${MAX_RECEIPT_BYTES}`);
    expect(MIGRATION_0073).toMatch(new RegExp(`>= ${MAX_RECEIPTS}\\b`));
    expect(MAX_RECEIPT_BODY_BYTES).toBeGreaterThan(MAX_RECEIPT_BYTES);
  });

  it("twenty open drafts per user; a year of expense dates", () => {
    expect(MIGRATION_0073).toMatch(new RegExp(`status = 'draft'\\) >= ${MAX_OPEN_DRAFTS}\\b`));
    expect(MIGRATION_0073).toMatch(new RegExp(`v_today - ${MAX_EXPENSE_DAYS_BACK}\\b|today - ${MAX_EXPENSE_DAYS_BACK}\\b`));
  });

  it("the client key pattern is the column's CHECK", () => {
    expect(MIGRATION_0073).toContain("'^[A-Za-z0-9_-]{8,64}$'");
    expect(CLIENT_KEY_PATTERN.source).toBe("^[A-Za-z0-9_-]{8,64}$");
  });
});
