/**
 * The words online giving says to people, in one place - docs/work-log/
 * 2026-10-15-online-giving.md, G15 (disclosures), G17 (stopping a monthly
 * gift), G18 (receipt versus statement) and the Component / Page Plan
 * ("the disclosure copy is a constant in `giving-copy.ts`").
 *
 * PURE: strings and small lookups only, no imports, so a client component, a
 * server page and a unit test can all read it. A fork's branding pass reviews
 * this file first.
 *
 * THE FORBIDDEN WORD. The Stripe receipt is a PAYMENT receipt. It is not the
 * IRS written acknowledgment (that is the year-end statement, generated from
 * the congregation's own records). No string here may call a receipt an
 * "acknowledgment"; `giving-copy.test.ts` walks every exported string and
 * fails if "receipt" and "acknowledg" ever share one. Say "payment receipt"
 * for Stripe's and "year-end statement" for ours.
 *
 * Naming: the product is PresbyPortal on every surface a person reads.
 */

/** G15: what a congregation agrees to know before it connects Stripe. */
export const CONNECT_DISCLOSURE = {
  heading: "Before you connect",
  items: [
    "Your congregation has its own Stripe account. It pays Stripe's processing fee on every gift and carries the cost of any dispute or chargeback. PresbyPortal charges no fee of its own.",
    "PresbyPortal does not give tax advice. Year-end statements are generated from your congregation's own records, so check the wording with your accountant before you rely on it.",
    "Donors see your congregation's name on their card or bank statement, so a charge is easy to recognize.",
  ],
} as const;

/** G18: said wherever a donor's Stripe payment receipt is mentioned. */
export const STRIPE_RECEIPT_NOTE =
  "Stripe emails each donor a payment receipt. That receipt is not your congregation's year-end giving statement.";

/** G17: there is no donor self-service stop in v1; the church is the path. */
export const MONTHLY_STOP_NOTE =
  "To stop or change a monthly gift, the donor contacts your congregation and your treasurer cancels it in your Stripe account.";

export const TEST_MODE_BADGE = {
  label: "Test mode",
  detail:
    "Your Stripe account is in test mode, so online gifts are practice only. They are kept out of every total, export and year-end statement.",
} as const;

export const UNCONFIGURED_MESSAGE = "Online giving isn't enabled on this installation.";

export const UNCONFIGURED_DETAIL =
  "Everything else here works without it: you can record cash, check and stock gifts, keep your funds and donors, and set up the details for year-end statements.";

/** The six states of the connection card (plus "unconfigured"), after `connection-display.ts` derives them. */
export type ConnectDisplayState =
  | "unconfigured"
  | "not_started"
  | "details_due"
  | "pending_verification"
  | "active"
  | "restricted"
  | "disconnected";

export const STATE_COPY: Record<ConnectDisplayState, { badge: string; summary: string }> = {
  unconfigured: {
    badge: "Not available",
    summary: `${UNCONFIGURED_MESSAGE} ${UNCONFIGURED_DETAIL}`,
  },
  not_started: {
    badge: "Not connected",
    summary:
      "Connect your congregation's Stripe account so members and visitors can give by card or bank transfer. You finish a short setup on Stripe's own site, then come back here. You can keep recording cash, check and stock gifts in the meantime.",
  },
  details_due: {
    badge: "Setup needs details",
    summary:
      "Your Stripe account has been created, but Stripe still needs some details from you before it can take gifts. Continue where you left off.",
  },
  pending_verification: {
    badge: "Waiting for Stripe",
    summary:
      "You have sent Stripe everything it asked for. Stripe is checking it, which can take a day or two. Refresh to see the latest.",
  },
  active: {
    badge: "Connected",
    summary: "Your Stripe account is connected and can take gifts.",
  },
  restricted: {
    badge: "Needs attention",
    summary:
      "Stripe has paused part of your account, so it can't take gifts until a problem is fixed. Continue on Stripe to see what it needs.",
  },
  disconnected: {
    badge: "Disconnected",
    summary:
      "This Stripe account is no longer connected to PresbyPortal. Gifts already recorded stay exactly as they are. To take gifts online again you connect a new Stripe account.",
  },
};

/** One line at the top of the connect-return page, after the page has asked Stripe. */
export const RETURN_RESULT: Record<ConnectDisplayState, string> = {
  unconfigured: UNCONFIGURED_MESSAGE,
  not_started: "There's no Stripe connection to check yet. You can start one below.",
  details_due: "Welcome back. Stripe still needs a few details before it can take gifts.",
  pending_verification: "Welcome back. Stripe has your details and is checking them.",
  active: "Welcome back. Stripe confirms your account is connected and can take gifts.",
  restricted: "Welcome back. Stripe has paused part of your account until a problem is fixed.",
  disconnected: "This Stripe account is no longer connected.",
};

export const DISCONNECTED_REASON: Record<"treasurer" | "deauthorized", string> = {
  treasurer: "Disconnected from PresbyPortal by your treasurer.",
  deauthorized: "Disconnected from the Stripe side: the account holder removed PresbyPortal's access.",
};

/** The go-live blockers, named for a person. Keys are `GoLiveBlocker`. */
export const GO_LIVE_ITEMS: Record<string, string> = {
  connection_active: "A Stripe account that has finished setup",
  online_fund: "At least one fund offered online",
  payouts_attested: "Confirmation that Stripe pays out to your bank automatically",
};

/** `?connect=<code>` notices the refresh route sends the treasurer back with. */
export const CONNECT_NOTICES: Record<string, { tone: "info" | "problem"; text: string }> = {
  no_access: {
    tone: "problem",
    text: "You don't have permission to manage the Stripe connection here.",
  },
  unavailable: {
    tone: "problem",
    text: "We couldn't check your access just now. Try again in a moment.",
  },
  no_connection: {
    tone: "problem",
    text: "There's no Stripe connection to continue. Start a new one below.",
  },
  unconfigured: { tone: "problem", text: UNCONFIGURED_MESSAGE },
  refresh_failed: {
    tone: "problem",
    text: "Stripe's setup link had expired and we couldn't get a new one. Choose Continue setup to try again.",
  },
};

export const CONNECT_ACTION_LABELS = {
  start: "Connect Stripe",
  reconnect: "Connect a new Stripe account",
  continue: "Continue setup",
  review: "Review details on Stripe",
  refresh: "Refresh status",
  attest: "Confirm automatic payouts",
  goLive: "Turn on the give page",
  takeOffline: "Take the give page offline",
  disconnect: "Disconnect",
  editRates: "Edit fee rates",
} as const;

export const ATTEST_DIALOG = {
  title: "Are your Stripe payouts automatic?",
  body:
    "PresbyPortal can only match gifts to deposits when Stripe pays out to your bank on its own schedule, which is Stripe's default. In your Stripe account, check that payouts are set to automatic. By confirming, you tell PresbyPortal this is so.",
  confirm: "Yes, payouts are automatic",
  cancel: "Not yet",
} as const;

export const TAKE_OFFLINE_DIALOG = {
  title: "Take the give page offline?",
  body: `Visitors and members will no longer be able to give online. Monthly gifts already set up keep charging in Stripe. ${MONTHLY_STOP_NOTE}`,
  confirm: "Take it offline",
  cancel: "Keep it on",
} as const;

export function disconnectDialogBody(activeSchedules: number): string {
  const schedules =
    activeSchedules > 0
      ? `${activeSchedules} monthly ${activeSchedules === 1 ? "gift is" : "gifts are"} still active in Stripe. ${
          activeSchedules === 1 ? "It keeps" : "They keep"
        } charging until cancelled in your Stripe account, and the payments keep being recorded here. ${MONTHLY_STOP_NOTE}`
      : "No monthly gifts are active right now.";
  return `This stops your congregation taking new online gifts through PresbyPortal. Your Stripe account is not closed, and gifts already recorded stay exactly as they are. ${schedules} To take gifts online again you connect a new Stripe account.`;
}

export const GIVE_PAGE_COPY = {
  on: "The give page is on. Visitors and members can give online.",
  off: "The give page is off. Nobody can give online until you turn it on.",
  blocked: "To turn the give page on, you still need:",
} as const;

export const RATES_COPY = {
  heading: "Fee rates",
  help: "When a donor chooses to cover the fees, PresbyPortal adds this much to their gift so your congregation receives the full amount. These are the rates Stripe charges you; they do not change what Stripe actually charges.",
  cardPercent: "Card percentage",
  cardFixed: "Card fixed fee (dollars)",
  achPercent: "Bank percentage",
  achCap: "Bank fee cap (dollars)",
  save: "Save fee rates",
  saved: "Fee rates saved.",
} as const;

/**
 * What the give actions say back to a donor (Batch 4a). Plain, short, and
 * honest about money: every failure says whether anything was charged. The
 * minimum and maximum here are pinned to `AMOUNT_BOUNDS.online` by a test.
 */
export const GIVE_MESSAGES = {
  amountEmpty: "Enter an amount.",
  amountFormat: "Enter an amount in dollars, like 25 or 25.50.",
  amountTooSmall: "The smallest online gift is $1.00.",
  amountTooLarge: "The largest online gift is $25,000.00. To give more, please contact the church.",
  fund: "Choose a fund to give to.",
  fundUnavailable: "That fund isn't available for online giving right now. Please choose another.",
  frequency: "Choose whether to give once or every month.",
  method: "Choose card or bank account.",
  methodForFees: "To add processing fees to your gift, choose card or bank account.",
  methodUnavailable: "That way of paying isn't available right now. Please choose another.",
  form: "We couldn't read that form. Reload the page and try again.",
  captcha: "We couldn't confirm you're not a robot. Reload the page and try again.",
  unavailable: "Online giving isn't available right now. You haven't been charged.",
  alreadyStarted:
    "This gift was already started. Check your other tabs or windows, or reload this page to start a new one.",
  error: "We couldn't start your gift. You haven't been charged.",
} as const;

/** "Too many attempts. Please try again in 8 minutes." - minutes, rounded up, never "0 minutes". */
export function rateLimitedMessage(retryAfterSeconds: number): string {
  const seconds = Number.isFinite(retryAfterSeconds) ? Math.max(1, Math.ceil(retryAfterSeconds)) : 60;
  const minutes = Math.ceil(seconds / 60);
  return `Too many attempts. Please try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}. You haven't been charged.`;
}

/** Every exported string, flattened - what `giving-copy.test.ts` scans. */
export function allGivingCopy(): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  [
    CONNECT_DISCLOSURE,
    STRIPE_RECEIPT_NOTE,
    MONTHLY_STOP_NOTE,
    TEST_MODE_BADGE,
    UNCONFIGURED_MESSAGE,
    UNCONFIGURED_DETAIL,
    STATE_COPY,
    RETURN_RESULT,
    DISCONNECTED_REASON,
    GO_LIVE_ITEMS,
    CONNECT_NOTICES,
    CONNECT_ACTION_LABELS,
    ATTEST_DIALOG,
    TAKE_OFFLINE_DIALOG,
    GIVE_PAGE_COPY,
    RATES_COPY,
    GIVE_MESSAGES,
  ].forEach(walk);
  out.push(
    disconnectDialogBody(0),
    disconnectDialogBody(1),
    disconnectDialogBody(3),
    rateLimitedMessage(1),
    rateLimitedMessage(61),
  );
  return out;
}
