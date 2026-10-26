import {
  MAX_AMOUNT_CENTS,
  MAX_LENGTH,
  MAX_OPEN_DRAFTS,
  MAX_RECEIPTS,
  MAX_RECEIPT_BYTES,
} from "./limits";
import { formatMoney } from "./amount-input";

/**
 * Every user-facing string of the reimbursement feature that is written down in
 * docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 "Copy" (C2 to C9; C10
 * email lives in Batch 3's `notices.ts`, C11 print in Batch 7). PURE: no
 * database, no `server-only`; a `'use client'` file may import it.
 *
 * THE RULE FOR THIS FILE: a string that is not in the Copy section is not
 * added here on an implementer's say-so; it is reported and ruled on. The few
 * exceptions are marked `// REUSED`: strings that already exist elsewhere in
 * the product and are borrowed verbatim for a case Copy does not name (the
 * gate boilerplate every `actions.ts` carries), with the source named.
 *
 * Numbers in sentences derive from `limits.ts` (the upload route and the
 * database enforce those same constants), so "4 MB" and "5 files" cannot drift
 * from the behaviour; `copy.test.ts` pins every string byte for byte, so a
 * change here is a deliberate edit to that test too.
 *
 * Templates take their `{org}`, `{group}`, `{date}` and `{reason}` as already
 * resolved plain strings. User-typed text (purpose, reasons, names) is
 * rendered as plain text, escaped by React; nothing here builds HTML.
 */

const megabytes = (bytes: number): string => `${bytes / 1_000_000} MB`;

export const COPY = {
  // ---------------------------------------------------------------------------
  // C2. Member page /o/<slug>/reimbursements
  // ---------------------------------------------------------------------------
  page: {
    heading: "Reimbursements",
    lead: (org: string) =>
      `Ask ${org} to pay you back for something you bought for the church, or to pay a vendor.`,
    newRequest: "New request",
    treasurerView: "Treasurer view",
    waitingHeading: (n: number) => `Waiting for your approval (${n})`,
    yourRequests: "Your requests",
    nothingWaiting: "Nothing is waiting.",
    noRequestsYet: "You haven't made a request yet.",
    cannotFile: (org: string) =>
      `Requests can be started by members, regular attenders and staff of ${org}. If you think you should be able to, tell the church office.`,
    toggleOff: (org: string) => `Reimbursements aren't turned on for ${org}.`,
    toggleOffCanManage: "You can turn them on under Features.",
    toggleOffAsk: "Ask an administrator who manages your organization's features to turn it on.",
    notApplicable: "Reimbursements aren't available for this kind of organization.",
    loadError: "We couldn't load your requests. Try again in a moment.",
  },

  /** Status labels (C2). Staff and approver lists say "Sent back" instead of "Sent back to you". */
  statusLabels: {
    requester: {
      draft: "Draft",
      submitted: "Waiting for approval",
      returned: "Sent back to you",
      not_approved: "Not approved",
      approved: "Approved, waiting for payment",
      paid: "Paid",
      withdrawn: "Withdrawn",
      voided: "Closed",
    },
    staff: {
      draft: "Draft",
      submitted: "Waiting for approval",
      returned: "Sent back",
      not_approved: "Not approved",
      approved: "Approved, waiting for payment",
      paid: "Paid",
      withdrawn: "Withdrawn",
      voided: "Closed",
    },
  },

  // ---------------------------------------------------------------------------
  // C3. The request form
  // ---------------------------------------------------------------------------
  form: {
    createHeading: "New reimbursement request",
    editHeading: "Edit your request",
    kindLabel: "What is this for?",
    kindOptions: {
      reimburse: "Pay me back",
      reimburseOther: "Pay someone else back",
      vendor: "Pay a vendor",
    },
    groupLabel: "Charge to",
    groupPlaceholder: "Choose a group",
    categoryLabel: "Category",
    categoryPlaceholder: "Choose a category",
    beneficiaryLabel: "Who are we paying back?",
    beneficiaryPlaceholder: "Search by name",
    beneficiaryNoMatch: "No match.",
    beneficiaryHint: "Only people who appear in the directory can be chosen.",
    /** A visually hidden polite status after a search that returned people (amendment T3). */
    searchFound: (n: number) => (n === 1 ? "1 person found." : `${n} people found.`),
    /** The call threw or the network dropped (a gate refusal shows the action's own error). */
    searchFailed: "We couldn't search just now. Try again.",
    /** After a person is picked: the button beside their name, and its accessible name. */
    changeBeneficiary: "Change",
    changeBeneficiaryLabel: "Change who we are paying back",
    vendorLabel: "Vendor name",
    amountLabel: "Amount",
    dateLabel: "Date of the expense",
    purposeLabel: "What was it for?",
    preApproverLabel: "Who approved this before you spent it? (optional)",
    receiptsLabel: "Receipts",
    addReceipt: "Add a receipt or invoice",
    receiptsHint: `Photos and PDFs. Each file can be up to ${megabytes(MAX_RECEIPT_BYTES)}, and you can add up to ${MAX_RECEIPTS}.`,
    noReceiptLabel: "I can't attach a receipt",
    noReceiptHint: "The treasurer decides whether that's okay before paying.",
    saveDraft: "Save draft",
    send: "Send request",
    cancel: "Cancel",
    saving: "Saving…",
    sending: "Sending…",
    draftSaved: "Draft saved.",
    saveFailed: "We couldn't save that. Your entries are still here. Try again.",
    changedInAnotherWindow: "This request changed in another window. Reload to see the latest.",
    tooManyDrafts: `You have ${MAX_OPEN_DRAFTS} unfinished drafts. Send or withdraw one first.`,
    /** After Send (C3): by the route the submit definer computed, live. */
    sent: {
      seat: (group: string) => `Sent to ${group} for approval.`,
      treasurer: (group: string) =>
        `No one in ${group} is able to approve this, so it was sent to the treasurer.`,
      nobody: (group: string) =>
        `No one in ${group} is able to approve this, and no one can record payments yet. It's saved and waiting. Let your church office know.`,
    },
  },

  /** Field errors (C3), server-supplied, shown next to the field. */
  fieldErrors: {
    amount: `Enter an amount between $0.01 and ${formatMoney(MAX_AMOUNT_CENTS)}.`,
    date: "Choose a date that isn't in the future or more than a year ago.",
    purpose: "Tell us what this was for.",
    tooLong: (max: number) => `Use ${max} characters or fewer.`,
    vendor: "Enter the vendor's name.",
    group: "Choose a group to charge this to.",
    groupUnavailable: "That group can't receive requests right now. Choose another.",
    category: "Choose a category.",
    beneficiary: "Choose who to pay back.",
    beneficiaryUnavailable: "We couldn't use that person. Search again and pick someone from the list.",
    receipt: "Add a receipt, or tick “I can't attach a receipt”.",
    forOthers: "You don't have permission to enter a request for someone else.",
  },

  // ---------------------------------------------------------------------------
  // C4. Receipt upload and download. {file} is the name the person's own device
  // gave the file, shown back to them only. (Batch 2b wires these to the route.)
  // ---------------------------------------------------------------------------
  receipts: {
    notAllowed: (file: string) => `${file} isn't a photo or PDF we can use.`,
    tooLarge: (file: string) =>
      `${file} is larger than ${megabytes(MAX_RECEIPT_BYTES)}. Try a photo of it, or a smaller scan.`,
    unreadable: (file: string) => `${file} couldn't be read. Try a different photo.`,
    tooMany: `You've added the most receipts allowed (${MAX_RECEIPTS}).`,
    duplicate: "That receipt is already on this request.",
    notEditable: "Receipts can't be changed on this request now.",
    rateLimited: "Too many uploads just now. Wait a few minutes and try again.",
    twoFactorRequired: "Please confirm your two-factor code to continue.",
    remove: "Remove",
    removeAccessibleName: (file: string) => `Remove ${file}`,
    none: "No receipt attached.",
    unavailable: "Receipt not available.",
    notFoundBody: "Not found",
  },

  // ---------------------------------------------------------------------------
  // C5. Request detail
  // ---------------------------------------------------------------------------
  detail: {
    labels: {
      amount: "Amount",
      date: "Date of the expense",
      chargedTo: "Charged to",
      category: "Category",
      payTo: "Pay to",
      preApprover: "Who approved it beforehand",
      purpose: "What it was for",
      receipts: "Receipts",
      history: "History",
    },
    enteredForYou: "Someone entered this request on your behalf.",
    enteredOnBehalf: "Entered on someone's behalf.",
    duplicateReceipt: "A receipt on this request was also attached to an earlier request.",
    viewDuplicate: "View that request",
    noReceiptClaimed: "The requester says they can't attach a receipt.",
    receiptWaived: "Receipt waived.",
    /** History labels (C5); the last four are shown to the treasury team only. */
    history: {
      created: "Started",
      submitted: "Sent for approval",
      resubmitted: "Sent again",
      approved: "Approved",
      returned: "Sent back",
      not_approved: "Not approved",
      withdrawn: "Withdrawn",
      voided: "Closed",
      payment_recorded: "Paid",
      payment_reversed: "Payment corrected",
      override_approved: "Approved by the treasurer",
      receipt_waived: "Receipt waived",
      note: "Note",
      imported: "Imported",
    },
    buttons: {
      editDraft: "Edit draft",
      editAndSendAgain: "Edit and send again",
      withdraw: "Withdraw request",
      print: "Print the form",
    },
    /** The neutral string: identical for a request that does not exist and one the viewer may not see. */
    unavailable: "This request isn't available.",
    back: "Back to reimbursements",
    /** Banners by status (C5), requester wording; `audience: "staff"` drops "to you". */
    banner: {
      draft: "This is a draft. Only you can see it.",
      submitted: {
        seat: "Waiting for approval.",
        treasurer: "Waiting for the treasurer to approve it.",
        nobody: "Waiting for approval. No one is able to approve it yet, so let the church office know.",
      },
      returned: (reason: string, audience: "requester" | "staff") =>
        `${audience === "requester" ? "Sent back to you" : "Sent back"}. Reason: ${reason}`,
      notApproved: (reason: string) => `Not approved. Reason: ${reason}`,
      approved: (date: string) => `Approved on ${date}. Waiting for payment.`,
      paid: (date: string) => `Paid on ${date}.`,
      withdrawn: "This request was withdrawn.",
      voided: "This request was closed. Ask the treasurer if you have questions.",
    },
  },

  // ---------------------------------------------------------------------------
  // C6. Approve, send back, withdraw
  // ---------------------------------------------------------------------------
  decision: {
    approveButton: "Approve",
    approveTitle: "Approve this request?",
    approveBody: (amount: string, payee: string, group: string) =>
      `${amount} to ${payee}, charged to ${group}. Once approved it goes to the treasurer for payment.`,
    approveConfirm: "Approve",
    cancel: "Cancel",
    sendBackButton: "Send back",
    sendBackTitle: "Send this request back?",
    needsChanges: "Needs changes",
    needsChangesHint: "The requester can fix it and send it again.",
    notApproved: "Not approved",
    notApprovedHint: "The request ends here unless the requester withdraws it.",
    reasonLabel: "Reason (the requester will see this)",
    sendBackConfirm: "Send back",
    approved: "Approved.",
    sentBack: "Sent back.",
    markedNotApproved: "Marked not approved.",
    reasonRequired: "Give a reason.",
    alreadyApproved: (date: string) => `This was already approved on ${date}.`,
    alreadySentBack: (date: string) => `This was already sent back on ${date}.`,
    changedAfterOpened: "This request changed after you opened it. Review it again.",
    unavailable: "This request isn't available.",
    withdrawTitle: "Withdraw this request?",
    withdrawBody: "It will be closed. You can start a new one any time.",
    withdrawConfirm: "Withdraw",
    withdrawKeep: "Keep it",
    /** Toast after a withdraw succeeds (amendment T3). Claims a status only; nothing is deleted. */
    withdrawn: "Request withdrawn.",
    withdrawAlreadyPaid: "This request was already paid, so it can't be withdrawn. Ask the treasurer.",
  },

  // ---------------------------------------------------------------------------
  // C7. Treasurer queue /admin/reimbursements
  // ---------------------------------------------------------------------------
  queue: {
    heading: "Reimbursement requests",
    tabs: {
      pay: "Waiting for payment",
      override: "Needs treasurer approval",
      progress: "In progress",
      paid: "Paid",
      all: "All",
    },
    overrideTabNote: "No one in the group is able to approve these, so they wait for a treasurer.",
    chargedTo: "Charged to",
    approvedOn: (date: string) => `Approved ${date}`,
    sentOn: (date: string) => `Sent ${date}`,
    enteredOnBehalfBadge: "Entered on someone's behalf",
    /** Empty states by tab, with no filter set; `filtered` when any of group, from or to is set (amendment S7). */
    empty: {
      pay: "Nothing is waiting for payment.",
      override: "Nothing needs a treasurer's approval.",
      progress: "Nothing is in progress.",
      paid: "Nothing has been paid yet.",
      all: "No one has sent in a request yet.",
      filtered: "No requests match those filters.",
    },
    filter: {
      groupAll: "All groups",
      groupSelected: "This group",
      submittedFrom: "Submitted from",
      submittedTo: "Submitted to",
      datesHint: "Dates are the day each request was last submitted.",
      apply: "Filter",
      clear: "Clear",
      groupsTruncated: "Only groups with one of the 2,000 most recent requests are listed.",
    },
    noPayHolder:
      "No one can record payments yet. Your church office can ask PresbyPortal support to set up a treasurer.",
    exportCsv: "Export CSV",
    exportTooLarge: "Narrow the date range: that export is more than 20,000 requests.",
    forbidden: (org: string) =>
      `This page is for the people who handle reimbursements at ${org}. If you think you should be one of them, ask your treasurer or another administrator there.`,
    loadError: "We couldn't load the requests. Try again in a moment.",
  },

  // ---------------------------------------------------------------------------
  // C8. Treasurer detail and verbs
  // ---------------------------------------------------------------------------
  treasury: {
    buttons: {
      recordPayment: "Record payment",
      reversePayment: "Reverse payment",
      waiveReceipt: "Waive receipt",
      sendBack: "Send back to requester",
      void: "Void request",
      approveAsTreasurer: "Approve as treasurer",
      addNote: "Add a note",
    },
    paymentForm: {
      methodLabel: "How was it paid?",
      methods: { check: "Check", ach: "ACH", cash: "Cash", other: "Other" },
      checkNumber: "Check number",
      reference: "Reference (optional)",
      datePaid: "Date paid",
      note: "Note (optional)",
      hint: "PresbyPortal records the payment. It doesn't send money or ask for bank details.",
      submit: "Record payment",
    },
    blocks: {
      approverCannotPay: "A different person must record this payment.",
      anotherPayer:
        "Another person who can record payments should do this, because you entered this request or are being paid by it.",
      receiptNeeded: "Add a receipt or waive it before paying.",
      notWaitingForPayment: "This request isn't waiting for payment.",
      alreadyPaid: "This payment was already recorded.",
    },
    reverse: {
      title: "Reverse this payment?",
      body: "The request goes back to “Approved, waiting for payment”. Both entries stay on record.",
      reason: "Reason",
    },
    void: {
      title: "Void this request?",
      body: "It will be closed and can't be paid. Nothing is deleted.",
      reason: "Reason",
    },
    waive: {
      title: "Waive the receipt?",
      body: "The request can be paid without one. This is recorded.",
      note: "Note (optional)",
    },
    override: {
      title: "Approve as treasurer?",
      body: (group: string) =>
        `No one in ${group} is able to approve this. Once approved, a different person who can record payments must pay it.`,
      seatHolderExists: (group: string) => `Someone in ${group} can approve this, so it needs their approval.`,
      needsSecondPayer:
        "This needs a second person who can record payments before you can approve it. Whoever approves can't also pay.",
      addOneUnderTeam: " Add one under Treasury team.",
    },
    /** Send back, treasurer tree: the kind is fixed to "needs changes", so there is no radio (amendment S4). */
    sendBack: {
      title: "Send this request back?",
      body: "The requester can fix it and send it again.",
      bodyApproved: "The requester can fix it and send it again. It will need approval again.",
    },
    /**
     * A refused verb in the treasurer tree (amendment S3): one sentence per outcome, each true for
     * every cause the outcome can have, so none names a cause. `not_found` and the whole member
     * tree stay on `COPY.detail.unavailable`.
     */
    refusals: {
      notWaivable: "A receipt can't be waived on this request. Reload the page to see where it stands.",
      receiptPresent: "This request already has a receipt, so there is nothing to waive.",
      notVoidable: "This request can't be voided. Reload the page to see where it stands.",
      notReversible: "This request has no payment that can be reversed. Reload the page to see where it stands.",
      notApprovable: "You can't approve this request as treasurer. Reload the page to see where it stands.",
      notReturnable: "You can't send this request back. Reload the page to see where it stands.",
    },
    note: { field: "Note", hint: "Only the treasury team can see notes." },
    results: {
      paymentRecorded: "Payment recorded.",
      paymentReversed: "Payment reversed.",
      receiptWaived: "Receipt waived.",
      voided: "Request voided.",
      sentBack: "Sent back.",
      approved: "Approved.",
      noteAdded: "Note added.",
      checkNumberRequired: "Enter a check number.",
      noteRequired: "Write a note.",
      dateOutOfRange: "Choose a date between the day of the expense and today.",
      reasonRequired: "Give a reason.",
    },
    extras: {
      approvedBy: (name: string, date: string, asTreasurer: boolean) =>
        `Approved by ${name} on ${date}${asTreasurer ? " as treasurer" : ""}`,
      selfPaid: "Marked as paid by the person who entered or is paid by the request.",
    },
  },

  // ---------------------------------------------------------------------------
  // C9. Settings, team and permission descriptions
  // ---------------------------------------------------------------------------
  settings: {
    heading: "Reimbursement settings",
    groupsHeading: "Groups that can receive requests",
    categoriesHeading: "Categories",
    chargeableSwitch: "Can receive requests",
    approverNote: (n: number) => `${n} chair or leader can approve.`,
    approversNote: (n: number) => `${n} chairs or leaders can approve.`,
    noApproverManaged: "No chair or leader right now: requests go to the treasurer.",
    noApproverDerived: "No chair or leader: requests go to the treasurer.",
    noGroups: "No group can receive requests yet. Choose at least one so people can make requests.",
    addCategory: "Add a category",
    categoryName: "Name",
    rename: "Rename",
    retire: "Retire",
    categoriesHint: "Retired categories stay on old requests.",
    categoryNameInvalid: `Use 1 to ${MAX_LENGTH.category} characters.`,
    categoryNameTaken: "You already have a category with that name.",
    categoryGone: "That category isn't in the list any more. Reload the page to see the current list.",
  },

  team: {
    heading: "Treasury team",
    intro: (org: string) =>
      `Who can handle reimbursements and giving at ${org}. Anyone who can view, pay or manage requests signs in with two-factor authentication.`,
    sectionHolders: "Who has a treasury role",
    sectionSetup: "Roles to set up",
    setUpTreasurer: "Set up the Treasurer role",
    setUpClerk: "Set up the Reimbursement Clerk role",
    clerkDescription: "Can enter requests on behalf of members who don't use the portal.",
    // Grant: the viewer holds reimbursement.manage, not roles.manage, so the instruction names
    // someone who can (amendment S2). Giving's twin takes the same sentence in Batch 6.
    notTreasuryOnly:
      "That role includes permissions outside Giving and Reimbursements. An administrator can grant it from Roles.",
    ensureNotTreasuryOnly:
      "That role already exists with permissions outside Giving and Reimbursements. An administrator can fix it under Roles.",
    lastManager: "That would leave no one able to manage reimbursements. Give the role to someone else first.",
    escalation: (keys: string) => `You can't grant permissions you don't hold yourself: ${keys}.`,
    alreadyGranted: "That person already has this role.",
    notAMember: "That person doesn't have a current membership here.",
    forbidden: "You don't have permission to manage the treasury team.",
    // The five answers of the team actions that Copy C9 names no sentence for. REUSED
    // verbatim from src/app/(org)/o/[slug]/admin/giving/team/actions.ts (none names a
    // module, so each is true on this page too); `copy.test.ts` asserts each appears there.
    invalidRole: "That role isn't available at this organization.", // REUSED
    assignmentEnded: "That role assignment has already ended.", // REUSED
    endFromRoles: "That assignment can only be ended from Roles.", // REUSED
    templateUnavailable: "That role isn't available to set up. Contact support.", // REUSED
    ensureEscalation: (keys: string) =>
      `You can't set up a role with permissions you don't hold yourself: ${keys}.`, // REUSED
  },

  /** Permission descriptions as migration 0074 writes them (C9); `copy.test.ts` parses 0074 against these. */
  permissionDescriptions: {
    "reimbursement.request_for_others": "Enter a reimbursement request on behalf of another member",
    "reimbursement.view": "View every reimbursement request, receipt and history, and export them",
    "reimbursement.pay":
      "Record and reverse reimbursement payments, waive a receipt, send a request back, void it, or approve it when no one else can",
    "reimbursement.manage":
      "Choose which groups can receive reimbursement requests, manage categories and the treasury team",
  },

  // ---------------------------------------------------------------------------
  // Gate boilerplate. REUSED verbatim from src/lib/giving/action-gate.ts (the
  // house strings every actions.ts gate returns); Copy names no reimbursement
  // wording for "signed out", "no access to the organization", "no permission"
  // or "the access check failed", so none is invented here.
  // ---------------------------------------------------------------------------
  gate: {
    signedOut: "You must be signed in to do that.", // REUSED
    noOrgAccess: "You don't have access to that organization.", // REUSED
    notPermitted: "You don't have permission to do that.", // REUSED
    accessCheckFailed: "We couldn't check your access just now. Try again in a moment.", // REUSED
    twoFactorRequired: "Please confirm your two-factor code to continue.", // C4
  },
} as const;

/** The status keys in `COPY.statusLabels` are the request statuses; the map type pins that. */
export type StatusLabels = typeof COPY.statusLabels.requester;
