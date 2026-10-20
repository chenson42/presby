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

/**
 * The give page and its return panels (Batch 4b): what a visitor or member reads
 * around the form. Written for a donor, not a treasurer (`MONTHLY_STOP_NOTE`
 * above speaks to the congregation). The "gift only" line is the online form's
 * half of G7; the receipt line follows G18 (a payment receipt is not the year-end
 * statement). A fork's branding pass reviews these with the rest of the file.
 */
export const GIVE_PAGE = {
  intro: "Your gift goes to the congregation's own account. You finish on Stripe's secure page, so your card or bank details never pass through this site.",
  presetsLabel: "Choose an amount",
  amountLabel: "Amount (US dollars)",
  amountHint: "Pick one above, or type any amount from $1 to $25,000.",
  fundLabel: "Fund",
  frequencyLabel: "How often?",
  onceLabel: "Give once",
  monthlyLabel: "Give every month",
  coverFeesLabel: "Add the processing fee so the full amount reaches the church",
  coverFeesHint: "Left unticked by default. Ticking it makes your total a little higher.",
  methodLabel: "How will you pay?",
  methodHint: "The fee is different for each, so choose one.",
  cardLabel: "Card",
  bankLabel: "Bank account",
  feeNeedsAmount: "Enter an amount to see the fee.",
  feeNote: "You will see the final total on Stripe's page before you pay.",
  giftOnly: "This form is for gifts only. You receive no goods or services in return. Dinners, tickets and purchases are not made here.",
  processing: "Stripe charges the congregation a processing fee on each gift. Bank transfers take several days to confirm.",
  monthly: "A monthly gift repeats until it is stopped. To stop or change it, contact the church and a treasurer will cancel it.",
  submit: "Give",
  submitting: "Starting your gift…",
  contactPrefix: "Questions, or want to give another way? Call",
  contactGeneric: "Questions, or want to give another way? Contact the church.",
} as const;

/** Said on the give page itself while the congregation's Stripe account is in test mode. */
export const TEST_MODE_DONOR_DETAIL =
  "Online giving here is set up for practice only. Nothing you enter is a real gift, and no real money moves.";

export function giveHeading(organizationName: string): string {
  return `Give to ${organizationName}`;
}

/** "Gift $50.00 + fees $1.75 = total $51.75" - display only; Stripe's page shows the real total. */
export function feePreviewText(gift: string, fees: string, total: string): string {
  return `Your gift ${gift} + fees ${fees} = total ${total}`;
}

/** The notice for a congregation whose site is live but whose giving is not (also the slot's). */
export const GIVING_UNAVAILABLE = {
  heading: "Online giving isn't available right now",
  body: "Nothing has been charged. Please try again later, or give another way.",
} as const;

export type ReturnPanelKey = "confirming" | "received" | "bank_pending" | "failed" | "unknown" | "error";

/** One heading and one body per return panel. Nothing here is a name, an email or an id. */
export const RETURN_PANELS: Record<ReturnPanelKey, { heading: string; body: string }> = {
  confirming: {
    heading: "We've received your gift and are confirming it",
    body: "This usually takes a few seconds and this page updates by itself. You can also close it: nothing more is needed from you.",
  },
  received: {
    heading: "Thank you for your gift",
    body: "Stripe emails a payment receipt to the address you gave at checkout. That receipt is separate from your congregation's year-end giving statement, which comes after the year ends.",
  },
  bank_pending: {
    heading: "Your bank transfer is on its way",
    body: "Bank transfers take several days to confirm. Your gift is recorded once your bank confirms it, and nothing more is needed from you.",
  },
  failed: {
    heading: "Your gift didn't go through",
    body: "No gift was recorded. If you see a charge you don't recognize, contact the church. You are welcome to try again.",
  },
  unknown: {
    heading: "We can't find that gift",
    body: "This link may have expired or may be incomplete. If you gave and want to check, contact the church.",
  },
  error: {
    heading: "We can't load this right now",
    body: "Your gift is not affected. Try again in a moment.",
  },
};

export const RETURN_COPY = {
  monthlyEvery: "every month",
  monthlyStop:
    "This gift repeats every month. To stop or change it, contact the church and a treasurer will cancel it.",
  stillConfirming:
    "Still confirming. This can take a few minutes. You don't need to do anything, and you can close this page.",
  giveAgain: "Give again",
  tryAgain: "Try again",
  backToSite: "Back to the church's website",
  backToPortal: "Back to the portal",
} as const;

/** "$50.00 to General Fund" or "$25.00 every month to General Fund". */
export function returnGiftLine(amount: string, fundName: string, monthly: boolean): string {
  return `${amount}${monthly ? ` ${RETURN_COPY.monthlyEvery}` : ""} to ${fundName}`;
}

/**
 * The member's own giving page, `/o/<slug>/giving` (Batch 6; Flow 12). Written
 * for the person who gave. The empty state is Flow 12's, verbatim. The error is
 * its own sentence on purpose: an empty list on a failure would read as lost
 * money. A gift's statuses are plain words, never colour alone.
 */
export const MEMBER_GIVING = {
  heading: "Giving",
  giveHeading: "Give online",
  giveBody: "Give once or every month, by card or bank account. You finish on Stripe's secure page, so your card or bank details never pass through this site.",
  giveButton: "Give online",
  giftsHeading: "Your gifts",
  giftsHelp: "Gifts you gave while signed in, and gifts your church office has matched to you.",
  giftsEmptyTitle: "No gifts are linked to you yet",
  giftsEmptyBody:
    "Gifts you give while signed in, or that your church office links to you, will appear here.",
  giftsTruncated: (shown: number) =>
    `Showing your ${shown} most recent gifts. A year-end statement lists every gift for a finished year.`,
  pendingNote: "A gift that is still processing is not on a year-end statement until it completes.",
  statementsHeading: "Year-end statements",
  statementsHelp:
    "Your congregation's written record of what you gave in a year, for your taxes. It is separate from the payment receipt Stripe emails you.",
  statementsEmptyTitle: "No statements yet",
  statementsEmptyBody:
    "Your congregation issues a giving statement after the year ends. When one is ready for you, it appears here to download.",
  download: "Download PDF",
  correctedBadge: "Corrected statement",
  previousSummary: (n: number) => `Earlier versions (${n})`,
  previousHelp:
    "Statements that a newer one replaced, or that were issued to another record of yours before the congregation combined them. They stay here so you can still download them.",
  previousReplaced: "Replaced by a newer version",
  previousCombined: "Issued before your records were combined",
  loadError: "We can't load your giving history right now.",
  loadErrorBody: "Your gifts are not affected. Try again in a moment.",
  tryAgain: "Try again",
} as const;

export type MyGiftStatusKey = "succeeded" | "pending" | "failed";

/** The words a gift's status and reversal wear on the member's list. */
export function giftStatusLabel(status: MyGiftStatusKey, amountCents: number, reversedCents: number): string {
  if (status === "pending") return "Processing";
  if (status === "failed") return "Didn't go through";
  if (reversedCents >= amountCents) return "Refunded or reversed";
  if (reversedCents > 0) return "Partly refunded or reversed";
  return "Received";
}

/**
 * The payouts page, `/o/<slug>/admin/giving/settlements` (Batch 6). Written for
 * the treasurer matching a bank-statement line to gifts. The three honest states
 * of a payout's contents each get their own sentence: a MANUAL payout is
 * "reconciliation unavailable" (never "no transactions"), a payout whose
 * contents have not arrived is "waiting", and a mismatch is said, not hidden.
 */
export const SETTLEMENTS_COPY = {
  heading: "Payouts",
  intro: (organizationName: string) =>
    `What Stripe has paid out to ${organizationName}'s bank, and what each deposit contained, so a line on your bank statement can be matched to gifts.`,
  emptyTitle: "No payouts yet",
  emptyBody:
    "Stripe tells PresbyPortal each time it pays out to your bank. They appear here, with what each deposit contained, once there is a payout to show.",
  noDate: "Date not given",
  paid: "Paid",
  failed: "Failed",
  automatic: "Automatic",
  manual: "Manual",
  test: "Test",
  manualTitle: "Reconciliation unavailable",
  manualBody:
    "This was a manual payout. Stripe doesn't list what a manual payout contains, so PresbyPortal can't match it to gifts. If your Stripe payouts are set to automatic, future deposits are itemized.",
  waiting: "What this payout contained hasn't arrived yet. It usually appears within a few minutes.",
  failedBody:
    "This payout failed. Stripe returns the money to your Stripe balance, so there is nothing to match to your bank.",
  balanced: "The transactions below add up to the payout.",
  mismatch: (listed: string, payout: string) =>
    `The transactions listed total ${listed}, but the payout was ${payout}. Open this payout in your Stripe dashboard to see the difference.`,
  allMatched: "Every charge matches a gift recorded here.",
  unmatched: (n: number) =>
    `${n} ${n === 1 ? "charge doesn't" : "charges don't"} match a gift recorded here, for example a payment taken in Stripe directly or one not recorded yet.`,
  truncated: (n: number) => `Showing the ${n} most recent payouts.`,
  loadErrorBody: "Your payouts and gifts are not affected. Try again in a moment.",
  charges: "Charges",
  returns: "Refunds and disputes",
  fees: "Stripe fees",
  net: "Net deposited",
  testNote: "A payout from a Stripe test account is practice only.",
} as const;

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
    GIVE_PAGE,
    TEST_MODE_DONOR_DETAIL,
    GIVING_UNAVAILABLE,
    RETURN_PANELS,
    RETURN_COPY,
    MEMBER_GIVING,
    SETTLEMENTS_COPY,
  ].forEach(walk);
  out.push(
    disconnectDialogBody(0),
    disconnectDialogBody(1),
    disconnectDialogBody(3),
    rateLimitedMessage(1),
    rateLimitedMessage(61),
    giveHeading("Alder Creek"),
    feePreviewText("$50.00", "$1.75", "$51.75"),
    returnGiftLine("$25.00", "General Fund", true),
    returnGiftLine("$25.00", "General Fund", false),
    MEMBER_GIVING.giftsTruncated(200),
    MEMBER_GIVING.previousSummary(2),
    SETTLEMENTS_COPY.intro("Alder Creek"),
    SETTLEMENTS_COPY.mismatch("$80.00", "$90.00"),
    SETTLEMENTS_COPY.unmatched(1),
    SETTLEMENTS_COPY.unmatched(2),
    SETTLEMENTS_COPY.truncated(100),
    giftStatusLabel("succeeded", 100, 0),
    giftStatusLabel("succeeded", 100, 50),
    giftStatusLabel("succeeded", 100, 100),
    giftStatusLabel("pending", 100, 0),
    giftStatusLabel("failed", 100, 0),
  );
  return out;
}
