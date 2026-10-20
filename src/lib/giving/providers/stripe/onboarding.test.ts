import { describe, expect, it } from "vitest";
import { buildCreateAccountParams, buildOnboardingLinkParams, statementDescriptorFor } from "./onboarding";

describe("the Accounts v2 create body (Phase 3 'Stripe confirmations' 1) - it cannot be changed after the fact", () => {
  it("is exactly the confirmed shape", () => {
    expect(
      buildCreateAccountParams({
        displayName: "Alder Creek Fellowship",
        contactEmail: "treasurer.fixture@example.invalid",
        statementDescriptor: "ALDER CREEK FELLOWSHIP",
      }),
    ).toEqual({
      display_name: "Alder Creek Fellowship",
      contact_email: "treasurer.fixture@example.invalid",
      dashboard: "full",
      identity: { country: "us", entity_type: "company" },
      configuration: {
        merchant: {
          capabilities: { card_payments: { requested: true }, ach_debit_payments: { requested: true } },
          statement_descriptor: { descriptor: "ALDER CREEK FELLOWSHIP" },
        },
      },
      defaults: {
        currency: "usd",
        responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
      },
      include: ["configuration.merchant", "identity", "defaults", "requirements"],
    });
  });

  it("requests ACH DEBIT, not the push-style bank transfer capability", () => {
    const body = JSON.stringify(buildCreateAccountParams({ displayName: "X Church", contactEmail: "a@example.invalid", statementDescriptor: null }));
    expect(body).toContain("ach_debit_payments");
    expect(body).not.toContain("us_bank_transfer_payments");
  });

  it("omits the statement descriptor when none is usable (Stripe then uses the name it collects)", () => {
    const body = buildCreateAccountParams({ displayName: "X", contactEmail: "a@example.invalid", statementDescriptor: null });
    expect(body.configuration?.merchant).not.toHaveProperty("statement_descriptor");
  });

  it("takes no application fee and no liability: Stripe collects fees and carries losses", () => {
    const body = buildCreateAccountParams({ displayName: "X Church", contactEmail: "a@example.invalid", statementDescriptor: null });
    expect(body.defaults?.responsibilities).toEqual({ fees_collector: "stripe", losses_collector: "stripe" });
    expect(JSON.stringify(body)).not.toContain("application");
  });

  it("bounds the display name", () => {
    const body = buildCreateAccountParams({ displayName: "A".repeat(500), contactEmail: "a@example.invalid", statementDescriptor: null });
    expect(body.display_name).toHaveLength(200);
  });
});

describe("statementDescriptorFor", () => {
  it.each([
    ["Alder Creek Fellowship", "Alder Creek Fellowship"],
    ["First Presbyterian Church of Some Very Long Town Name", "First Presbyterian Chu"],
    ["St. Andrew's  Kirk", "St. Andrew s Kirk"],
    ['Quote "Church" <b>*', "Quote Church b"],
  ])("%j -> %j", (input, expected) => {
    expect(statementDescriptorFor(input)).toBe(expected);
  });

  it.each(["", "Ab", "1234567", "!!!!!", "教会教会教会"])("%j has nothing usable -> null", (input) => {
    expect(statementDescriptorFor(input)).toBeNull();
  });

  it("never returns a forbidden character, or more than 22 characters", () => {
    const out = statementDescriptorFor("A<>\\'\"*B CHURCH OF THE VERY LONG NAME INDEED");
    expect(out).not.toMatch(/[<>\\'"*]/);
    expect(out!.length).toBeLessThanOrEqual(22);
  });
});

describe("the onboarding link body", () => {
  it("is account_onboarding with fixed return and refresh URLs", () => {
    expect(
      buildOnboardingLinkParams({
        accountId: "acct_fixtureAccount0001",
        returnUrl: "https://example.invalid/o/alder/admin/giving/connect/return",
        refreshUrl: "https://example.invalid/o/alder/admin/giving/connect/refresh",
      }),
    ).toEqual({
      account: "acct_fixtureAccount0001",
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          return_url: "https://example.invalid/o/alder/admin/giving/connect/return",
          refresh_url: "https://example.invalid/o/alder/admin/giving/connect/refresh",
        },
      },
    });
  });
});
