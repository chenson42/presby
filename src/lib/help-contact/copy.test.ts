import { describe, expect, it } from "vitest";
import { HELP_CONTACT_LIMITS as LIMITS } from "./contract";
import {
  HELP_CONTACT_ANNOUNCE_AT,
  HELP_CONTACT_FORM_COPY as COPY,
  HELP_CONTACT_LIMIT_CHARS,
  HELP_CONTACT_OUTCOME_COPY as OUTCOME,
  withCommas,
} from "./copy";

describe("copy.ts repeats contract.ts's limits (it imports nothing); they must agree", () => {
  it("the numbers in the strings are the contract's", () => {
    expect(HELP_CONTACT_LIMIT_CHARS).toBe(LIMITS.messageMax);
    expect(OUTCOME.nameTooLong).toContain(`${LIMITS.name} characters`);
    expect(OUTCOME.congregationTooLong).toContain(`${LIMITS.congregation} characters`);
    expect(OUTCOME.emailTooLong).toContain(`${LIMITS.email} characters`);
    expect(OUTCOME.messageShort).toContain(`${LIMITS.messageMin} characters`);
    expect(COPY.messageHelper).toContain(`${LIMITS.messageMin} characters`);
    expect(OUTCOME.messageTooLong(2500)).toContain("The limit is 2,000.");
    expect(COPY.counter(5)).toBe("5 of 2,000 characters");
    expect(COPY.counterLimit).toContain("2,000 character limit");
  });
  it("the live region speaks below the limit, never above it", () => {
    expect(HELP_CONTACT_ANNOUNCE_AT).toBeLessThan(LIMITS.messageMax);
  });
});

describe("withCommas", () => {
  it("separates thousands without toLocaleString", () => {
    expect([0, 999, 1000, 1234, 12345, 2000, 1234567].map(withCommas)).toEqual(["0", "999", "1,000", "1,234", "12,345", "2,000", "1,234,567"]);
  });
});

describe("the form copy never uses the word 'ticket' (C2: a contact message is not a ticket)", () => {
  it("in any public string", () => {
    const all = JSON.stringify([COPY, OUTCOME]);
    expect(all).not.toMatch(/ticket/i);
  });
});
