import { describe, expect, it } from "vitest";
import type { ConnectionStatusInput } from "../../types";
import {
  mapAccountSnapshotToStatus,
  mapV2AccountToStatus,
  type V1AccountSnapshot,
  type V2AccountSnapshot,
} from "./status";

/**
 * ONE expected table, TWO mappers. The same account must read the same whether
 * we learn about it from the v1 `account.updated` snapshot (the event) or from
 * the v2 retrieve (the "Refresh status" button and the return page) - a
 * disagreement would flip a congregation's status depending on which path
 * touched it last.
 */

interface Scenario {
  name: string;
  v1: V1AccountSnapshot;
  v2: V2AccountSnapshot;
  expected: ConnectionStatusInput;
}

const cap = (status: string, codes: string[] = []) => ({
  status,
  status_details: codes.map((code) => ({ code, resolution: "provide_info" })),
});
const userDue = (status: "currently_due" | "past_due" | "eventually_due" = "currently_due") => ({
  awaiting_action_from: "user",
  minimum_deadline: { status },
});

const SCENARIOS: Scenario[] = [
  {
    name: "a brand-new account that has not started onboarding",
    v1: {
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      capabilities: { card_payments: "inactive", us_bank_account_ach_payments: "inactive" },
      requirements: { currently_due: ["business_profile.url", "external_account"], past_due: [], disabled_reason: "requirements.past_due" },
    },
    v2: {
      configuration: {
        merchant: {
          capabilities: {
            card_payments: cap("restricted", ["requirements_past_due"]),
            ach_debit_payments: cap("restricted", ["requirements_past_due"]),
            stripe_balance: { payouts: cap("restricted", ["requirements_past_due"]) },
          },
        },
      },
      requirements: { entries: [userDue("currently_due"), userDue("eventually_due")] },
    },
    expected: {
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      cardEnabled: false,
      achEnabled: false,
      requirementsDue: true,
      disabledReason: null,
    },
  },
  {
    name: "details submitted, Stripe still verifying (capabilities pending)",
    v1: {
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      capabilities: { card_payments: "pending", us_bank_account_ach_payments: "pending" },
      requirements: { currently_due: [], past_due: [], disabled_reason: "requirements.pending_verification" },
    },
    v2: {
      configuration: {
        merchant: {
          capabilities: {
            card_payments: cap("pending", ["requirements_pending_verification"]),
            ach_debit_payments: cap("pending", ["requirements_pending_verification"]),
            stripe_balance: { payouts: cap("pending", ["requirements_pending_verification"]) },
          },
        },
      },
      requirements: { entries: [{ awaiting_action_from: "stripe", minimum_deadline: { status: "currently_due" } }] },
    },
    expected: {
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: true,
      cardEnabled: false,
      achEnabled: false,
      requirementsDue: false,
      disabledReason: null,
    },
  },
  {
    name: "fully active (card, ACH and payouts)",
    v1: {
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      capabilities: { card_payments: "active", us_bank_account_ach_payments: "active" },
      requirements: { currently_due: [], past_due: [], disabled_reason: null },
    },
    v2: {
      configuration: {
        merchant: {
          capabilities: {
            card_payments: cap("active"),
            ach_debit_payments: cap("active"),
            stripe_balance: { payouts: cap("active") },
          },
        },
      },
      requirements: { entries: [userDue("eventually_due")] },
    },
    expected: {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      cardEnabled: true,
      achEnabled: true,
      requirementsDue: false,
      disabledReason: null,
    },
  },
  {
    name: "card only (ACH not approved), payouts on",
    v1: {
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      capabilities: { card_payments: "active", us_bank_account_ach_payments: "pending" },
      requirements: { currently_due: [], past_due: [], disabled_reason: null },
    },
    v2: {
      configuration: {
        merchant: {
          capabilities: {
            card_payments: cap("active"),
            ach_debit_payments: cap("pending"),
            stripe_balance: { payouts: cap("active") },
          },
        },
      },
      requirements: { entries: [] },
    },
    expected: {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      cardEnabled: true,
      achEnabled: false,
      requirementsDue: false,
      disabledReason: null,
    },
  },
  {
    name: "was active, now restricted by Stripe (not a requirement)",
    v1: {
      charges_enabled: false,
      payouts_enabled: true,
      details_submitted: true,
      capabilities: { card_payments: "inactive", us_bank_account_ach_payments: "inactive" },
      requirements: { currently_due: [], past_due: [], disabled_reason: "restricted_other" },
    },
    v2: {
      configuration: {
        merchant: {
          capabilities: {
            card_payments: cap("restricted", ["restricted_other"]),
            ach_debit_payments: cap("restricted", ["restricted_other"]),
            stripe_balance: { payouts: cap("active") },
          },
        },
      },
      requirements: { entries: [] },
    },
    expected: {
      chargesEnabled: false,
      payoutsEnabled: true,
      detailsSubmitted: true,
      cardEnabled: false,
      achEnabled: false,
      requirementsDue: false,
      disabledReason: "restricted_other",
    },
  },
  {
    name: "rejected by Stripe for fraud",
    v1: {
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      capabilities: { card_payments: "inactive", us_bank_account_ach_payments: "inactive" },
      requirements: { currently_due: [], past_due: [], disabled_reason: "rejected.fraud" },
    },
    v2: {
      configuration: {
        merchant: {
          capabilities: {
            card_payments: cap("rejected", ["rejected_fraud"]),
            ach_debit_payments: cap("rejected", ["rejected_fraud"]),
            stripe_balance: { payouts: cap("rejected", ["rejected_fraud"]) },
          },
        },
      },
      requirements: { entries: [] },
    },
    expected: {
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: true,
      cardEnabled: false,
      achEnabled: false,
      requirementsDue: false,
      disabledReason: "rejected.fraud",
    },
  },
];

describe("status mappers: v1 snapshot and v2 retrieve agree on one table", () => {
  for (const scenario of SCENARIOS) {
    it(`v1 - ${scenario.name}`, () => {
      expect(mapAccountSnapshotToStatus(scenario.v1)).toEqual(scenario.expected);
    });
    it(`v2 - ${scenario.name}`, () => {
      const mapped = mapV2AccountToStatus(scenario.v2);
      // The v2 reason uses the code with underscores; the v1 uses dots. Both are
      // the same machine code up to separator - normalized for the comparison.
      expect({ ...mapped, disabledReason: mapped.disabledReason?.replace(/_/g, ".") ?? null }).toEqual({
        ...scenario.expected,
        disabledReason: scenario.expected.disabledReason?.replace(/_/g, ".") ?? null,
      });
    });
  }
});

describe("the one known divergence: details_submitted", () => {
  // v1 keeps `details_submitted: true` forever once the form was filed, even if
  // Stripe later asks for more. v2 has no such field, so it is INFERRED as "no
  // requirement is due from the account holder". For an account that was active
  // and then has a requirement come due, v1 says submitted and v2 says not. The
  // database only uses the flag to choose `restricted` over `onboarding` for an
  // account that was never active, so the divergence cannot change a status
  // that was already active or restricted (presby_giving__set_connection_status).
  it("v1 says submitted, v2 says not, while a requirement is due again", () => {
    const v1 = mapAccountSnapshotToStatus({
      charges_enabled: false,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { currently_due: ["external_account"], past_due: ["external_account"], disabled_reason: "requirements.past_due" },
    });
    const v2 = mapV2AccountToStatus({
      configuration: { merchant: { capabilities: { card_payments: cap("restricted", ["requirements_past_due"]) } } },
      requirements: { entries: [userDue("past_due")] },
    });
    expect(v1.detailsSubmitted).toBe(true);
    expect(v2.detailsSubmitted).toBe(false);
    expect(v1.requirementsDue).toBe(true);
    expect(v2.requirementsDue).toBe(true);
  });
});

describe("v1 snapshot edge cases", () => {
  it("treats a missing object as everything off", () => {
    expect(mapAccountSnapshotToStatus({})).toEqual({
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      cardEnabled: false,
      achEnabled: false,
      requirementsDue: false,
      disabledReason: null,
    });
  });

  it("requires strict true / 'active' (a truthy string is not enabled)", () => {
    const status = mapAccountSnapshotToStatus({
      charges_enabled: "true" as unknown as boolean,
      capabilities: { card_payments: "Active" },
    });
    expect(status.chargesEnabled).toBe(false);
    expect(status.cardEnabled).toBe(false);
  });

  it("sanitizes a disabled reason to lower-case [a-z0-9_.] and 60 characters", () => {
    const status = mapAccountSnapshotToStatus({ requirements: { disabled_reason: "Under Review: <script>" } });
    expect(status.disabledReason).toMatch(/^[a-z0-9_.]+$/);
    expect(mapAccountSnapshotToStatus({ requirements: { disabled_reason: "x".repeat(200) } }).disabledReason).toHaveLength(60);
  });

  it("does not report a requirements.* reason as a disabling reason (requirementsDue carries it)", () => {
    expect(mapAccountSnapshotToStatus({ requirements: { disabled_reason: "requirements.pending_verification" } }).disabledReason).toBeNull();
  });
});

describe("v2 retrieve edge cases", () => {
  it("falls back to the requirements summary when there is no entry list", () => {
    expect(mapV2AccountToStatus({ requirements: { summary: { minimum_deadline: { status: "past_due" } } } }).requirementsDue).toBe(true);
    expect(mapV2AccountToStatus({ requirements: { summary: { minimum_deadline: { status: "eventually_due" } } } }).requirementsDue).toBe(false);
  });

  it("ignores a requirement that is Stripe's to act on, or only eventually due", () => {
    const status = mapV2AccountToStatus({
      requirements: { entries: [{ awaiting_action_from: "stripe", minimum_deadline: { status: "past_due" } }, userDue("eventually_due")] },
    });
    expect(status.requirementsDue).toBe(false);
  });

  it("reads an unsupported business as a disabling reason", () => {
    const status = mapV2AccountToStatus({
      configuration: { merchant: { capabilities: { card_payments: cap("unsupported", ["unsupported_business"]) } } },
    });
    expect(status.disabledReason).toBe("unsupported_business");
  });

  it("an empty response is everything off", () => {
    expect(mapV2AccountToStatus({})).toEqual({
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      cardEnabled: false,
      achEnabled: false,
      requirementsDue: false,
      disabledReason: null,
    });
  });
});
