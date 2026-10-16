import { describe, expect, it } from "vitest";
import {
  ATTEST_DIALOG,
  CONNECT_DISCLOSURE,
  CONNECT_NOTICES,
  GO_LIVE_ITEMS,
  MONTHLY_STOP_NOTE,
  STATE_COPY,
  STRIPE_RECEIPT_NOTE,
  GIVE_MESSAGES,
  GIVE_PAGE,
  RETURN_COPY,
  RETURN_PANELS,
  allGivingCopy,
  feePreviewText,
  giveHeading,
  returnGiftLine,
  disconnectDialogBody,
  rateLimitedMessage,
} from "./giving-copy";
import { AMOUNT_BOUNDS, formatCents } from "./money";

describe("giving-copy", () => {
  it("never calls a receipt an acknowledgment (G18): no string holds both words", () => {
    for (const text of allGivingCopy()) {
      expect(/receipt/i.test(text) && /acknowledg/i.test(text), text).toBe(false);
    }
  });

  it("the Stripe receipt note says it is a payment receipt and not the year-end statement", () => {
    expect(STRIPE_RECEIPT_NOTE).toMatch(/payment receipt/i);
    expect(STRIPE_RECEIPT_NOTE).toMatch(/not your congregation's year-end giving statement/i);
  });

  it("states the G15 disclosures: congregation bears fees and disputes, no PresbyPortal fee, no tax advice, statements from the congregation's records", () => {
    const text = CONNECT_DISCLOSURE.items.join(" ");
    expect(text).toMatch(/processing fee/i);
    expect(text).toMatch(/dispute/i);
    expect(text).toMatch(/charges no fee/i);
    expect(text).toMatch(/does not give tax advice/i);
    expect(text).toMatch(/generated from your congregation's own records/i);
    expect(text).toMatch(/congregation's name/i);
  });

  it("covers every display state with a badge and a summary", () => {
    for (const state of ["unconfigured", "not_started", "details_due", "pending_verification", "active", "restricted", "disconnected"] as const) {
      expect(STATE_COPY[state].badge.length).toBeGreaterThan(0);
      expect(STATE_COPY[state].summary.length).toBeGreaterThan(20);
    }
  });

  it("names all three go-live blockers", () => {
    expect(Object.keys(GO_LIVE_ITEMS).sort()).toEqual(["connection_active", "online_fund", "payouts_attested"]);
  });

  it("has a message for each of the five refresh-route notice codes", () => {
    expect(Object.keys(CONNECT_NOTICES).sort()).toEqual(["no_access", "no_connection", "refresh_failed", "unavailable", "unconfigured"]);
  });

  it("the disconnect body says how many monthly gifts keep charging, with agreement", () => {
    expect(disconnectDialogBody(0)).toMatch(/No monthly gifts are active/);
    expect(disconnectDialogBody(1)).toMatch(/1 monthly gift is still active in Stripe\. It keeps charging/);
    expect(disconnectDialogBody(4)).toMatch(/4 monthly gifts are still active in Stripe\. They keep charging/);
    expect(disconnectDialogBody(4)).toContain(MONTHLY_STOP_NOTE);
    expect(disconnectDialogBody(0)).toMatch(/connect a new Stripe account/);
  });

  it("the attest dialog asks about automatic payouts", () => {
    expect(ATTEST_DIALOG.body).toMatch(/automatic/);
  });

  it("the give messages state the real online bounds (pinned to AMOUNT_BOUNDS)", () => {
    expect(GIVE_MESSAGES.amountTooSmall).toContain(formatCents(AMOUNT_BOUNDS.online.min));
    expect(GIVE_MESSAGES.amountTooLarge).toContain(formatCents(AMOUNT_BOUNDS.online.max));
  });

  it("every failure a donor can see says whether they were charged (or is a field correction)", () => {
    for (const text of [GIVE_MESSAGES.unavailable, GIVE_MESSAGES.error, rateLimitedMessage(30)]) {
      expect(text).toMatch(/haven't been charged/);
    }
  });

  it("rateLimitedMessage rounds up to whole minutes, never says 0 minutes, and agrees in number", () => {
    expect(rateLimitedMessage(1)).toMatch(/in 1 minute\./);
    expect(rateLimitedMessage(60)).toMatch(/in 1 minute\./);
    expect(rateLimitedMessage(61)).toMatch(/in 2 minutes\./);
    expect(rateLimitedMessage(0)).toMatch(/in 1 minute\./);
    expect(rateLimitedMessage(Number.NaN)).toMatch(/in 1 minute\./);
  });

  it("the donor-facing strings are in the forbidden-word walk (so a future edit cannot call a receipt an acknowledgment unnoticed)", () => {
    const all = allGivingCopy();
    for (const text of [
      GIVE_PAGE.giftOnly,
      GIVE_PAGE.processing,
      GIVE_PAGE.monthly,
      RETURN_PANELS.received.body,
      RETURN_PANELS.confirming.heading,
      RETURN_COPY.monthlyStop,
      giveHeading("Alder Creek"),
      feePreviewText("$50.00", "$1.75", "$51.75"),
      returnGiftLine("$25.00", "General Fund", true),
    ]) {
      expect(all, text).toContain(text);
    }
  });

  it("the thank-you panel calls Stripe's receipt a payment receipt and separates it from the year-end statement (G18)", () => {
    expect(RETURN_PANELS.received.body).toMatch(/payment receipt/i);
    expect(RETURN_PANELS.received.body).toMatch(/year-end giving statement/i);
    for (const panel of Object.values(RETURN_PANELS)) {
      expect(`${panel.heading} ${panel.body}`).not.toMatch(/acknowledg/i);
    }
  });

  it("every return panel has a heading and a body, and the confirming one is the sentence the design promises", () => {
    expect(Object.keys(RETURN_PANELS).sort()).toEqual(["bank_pending", "confirming", "error", "failed", "received", "unknown"]);
    expect(RETURN_PANELS.confirming.heading).toBe("We've received your gift and are confirming it");
    expect(RETURN_PANELS.error.body).toMatch(/Your gift is not affected/);
    expect(RETURN_PANELS.bank_pending.body).toMatch(/several days/);
  });

  it("the give form says it is gifts only and that cover-fees is optional", () => {
    expect(GIVE_PAGE.giftOnly).toMatch(/gifts only/);
    expect(GIVE_PAGE.giftOnly).toMatch(/no goods or services/);
    expect(GIVE_PAGE.coverFeesHint).toMatch(/unticked by default/);
    expect(GIVE_PAGE.amountHint).toContain("$1 to $25,000");
  });

  it("the return gift line names the amount and fund, with 'every month' only for a monthly gift", () => {
    expect(returnGiftLine("$37.50", "General Fund", false)).toBe("$37.50 to General Fund");
    expect(returnGiftLine("$37.50", "General Fund", true)).toBe("$37.50 every month to General Fund");
  });
});
