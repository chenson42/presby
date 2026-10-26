import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COPY } from "./copy";
import { MAX_AMOUNT_CENTS, MAX_OPEN_DRAFTS, MAX_RECEIPTS, MAX_RECEIPT_BYTES } from "./limits";
import { formatMoney } from "./amount-input";

/**
 * Every string is pinned byte for byte to the Copy section of docs/work-log/
 * 2026-10-25-treasury-inc1.md (C2 to C9), so a drive-by edit to a sentence is a
 * deliberate edit here too. Numbers inside sentences are also checked against
 * `limits.ts`, the constants the upload route and the database enforce
 * (Copy checks C3 and C4: "limits come from limits.ts").
 */

describe("C2 member page", () => {
  it("states", () => {
    expect(COPY.page.heading).toBe("Reimbursements");
    expect(COPY.page.lead("Alder Creek Church")).toBe(
      "Ask Alder Creek Church to pay you back for something you bought for the church, or to pay a vendor.",
    );
    expect(COPY.page.newRequest).toBe("New request");
    expect(COPY.page.treasurerView).toBe("Treasurer view");
    expect(COPY.page.waitingHeading(3)).toBe("Waiting for your approval (3)");
    expect(COPY.page.yourRequests).toBe("Your requests");
    expect(COPY.page.nothingWaiting).toBe("Nothing is waiting.");
    expect(COPY.page.noRequestsYet).toBe("You haven't made a request yet.");
    expect(COPY.page.cannotFile("Alder Creek Church")).toBe(
      "Requests can be started by members, regular attenders and staff of Alder Creek Church. If you think you should be able to, tell the church office.",
    );
    expect(COPY.page.toggleOff("Alder Creek Church")).toBe("Reimbursements aren't turned on for Alder Creek Church.");
    expect(COPY.page.toggleOffCanManage).toBe("You can turn them on under Features.");
    expect(COPY.page.toggleOffAsk).toBe("Ask an administrator who manages your organization's features to turn it on.");
    expect(COPY.page.notApplicable).toBe("Reimbursements aren't available for this kind of organization.");
    expect(COPY.page.loadError).toBe("We couldn't load your requests. Try again in a moment.");
  });

  it("status labels: requester wording, and staff lists say 'Sent back' only", () => {
    expect(COPY.statusLabels.requester).toEqual({
      draft: "Draft",
      submitted: "Waiting for approval",
      returned: "Sent back to you",
      not_approved: "Not approved",
      approved: "Approved, waiting for payment",
      paid: "Paid",
      withdrawn: "Withdrawn",
      voided: "Closed",
    });
    expect({ ...COPY.statusLabels.staff, returned: "Sent back to you" }).toEqual(COPY.statusLabels.requester);
    expect(COPY.statusLabels.staff.returned).toBe("Sent back");
  });
});

describe("C3 the request form", () => {
  it("labels and buttons", () => {
    expect(COPY.form.createHeading).toBe("New reimbursement request");
    expect(COPY.form.editHeading).toBe("Edit your request");
    expect(COPY.form.kindLabel).toBe("What is this for?");
    expect(COPY.form.kindOptions).toEqual({ reimburse: "Pay me back", reimburseOther: "Pay someone else back", vendor: "Pay a vendor" });
    expect(COPY.form.groupLabel).toBe("Charge to");
    expect(COPY.form.groupPlaceholder).toBe("Choose a group");
    expect(COPY.form.noChargeableGroup).toBe("No groups can be charged yet. Ask your treasurer to set them up.");
    expect(COPY.form.categoryLabel).toBe("Category");
    expect(COPY.form.categoryPlaceholder).toBe("Choose a category");
    expect(COPY.form.beneficiaryLabel).toBe("Who are we paying back?");
    expect(COPY.form.beneficiaryPlaceholder).toBe("Search by name");
    expect(COPY.form.beneficiaryNoMatch).toBe("No match.");
    expect(COPY.form.beneficiaryHint).toBe("Only people who appear in the directory can be chosen.");
    // Phase 3 amendment, T3
    expect(COPY.form.searchFound(1)).toBe("1 person found.");
    expect(COPY.form.searchFound(2)).toBe("2 people found.");
    expect(COPY.form.searchFound(8)).toBe("8 people found.");
    expect(COPY.form.searchFailed).toBe("We couldn't search just now. Try again.");
    expect(COPY.form.changeBeneficiary).toBe("Change");
    expect(COPY.form.changeBeneficiaryLabel).toBe("Change who we are paying back");
    expect(COPY.form.vendorLabel).toBe("Vendor name");
    expect(COPY.form.amountLabel).toBe("Amount");
    expect(COPY.form.dateLabel).toBe("Date of the expense");
    expect(COPY.form.purposeLabel).toBe("What was it for?");
    expect(COPY.form.preApproverLabel).toBe("Who approved this before you spent it? (optional)");
    expect(COPY.form.receiptsLabel).toBe("Receipts");
    expect(COPY.form.addReceipt).toBe("Add a receipt or invoice");
    expect(COPY.form.noReceiptLabel).toBe("I can't attach a receipt");
    expect(COPY.form.noReceiptHint).toBe("The treasurer decides whether that's okay before paying.");
    expect([COPY.form.saveDraft, COPY.form.send, COPY.form.cancel, COPY.form.saving, COPY.form.sending]).toEqual([
      "Save draft",
      "Send request",
      "Cancel",
      "Saving…",
      "Sending…",
    ]);
  });

  it("the receipt hint is derived from limits.ts and reads as the Copy section says", () => {
    expect(COPY.form.receiptsHint).toBe("Photos and PDFs. Each file can be up to 4 MB, and you can add up to 5.");
    expect(MAX_RECEIPT_BYTES).toBe(4_000_000);
    expect(MAX_RECEIPTS).toBe(5);
  });

  it("field errors", () => {
    expect(COPY.fieldErrors.amount).toBe("Enter an amount between $0.01 and $100,000.00.");
    expect(formatMoney(MAX_AMOUNT_CENTS)).toBe("$100,000.00");
    expect(COPY.fieldErrors.date).toBe("Choose a date that isn't in the future or more than a year ago.");
    expect(COPY.fieldErrors.purpose).toBe("Tell us what this was for.");
    expect(COPY.fieldErrors.tooLong(500)).toBe("Use 500 characters or fewer.");
    expect(COPY.fieldErrors.vendor).toBe("Enter the vendor's name.");
    expect(COPY.fieldErrors.group).toBe("Choose a group to charge this to.");
    expect(COPY.fieldErrors.groupUnavailable).toBe("That group can't receive requests right now. Choose another.");
    expect(COPY.fieldErrors.category).toBe("Choose a category.");
    expect(COPY.fieldErrors.beneficiary).toBe("Choose who to pay back.");
    expect(COPY.fieldErrors.beneficiaryUnavailable).toBe("We couldn't use that person. Search again and pick someone from the list.");
    expect(COPY.fieldErrors.receipt).toBe("Add a receipt, or tick “I can't attach a receipt”.");
    expect(COPY.fieldErrors.forOthers).toBe("You don't have permission to enter a request for someone else.");
  });

  it("results", () => {
    expect(COPY.form.saveFailed).toBe("We couldn't save that. Your entries are still here. Try again.");
    expect(COPY.form.changedInAnotherWindow).toBe("This request changed in another window. Reload to see the latest.");
    expect(COPY.form.tooManyDrafts).toBe("You have 20 unfinished drafts. Send or withdraw one first.");
    expect(MAX_OPEN_DRAFTS).toBe(20);
    expect(COPY.form.draftSaved).toBe("Draft saved.");
  });

  it("after Send, by route: it claims no one has been notified (Copy check C3)", () => {
    expect(COPY.form.sent.seat("Property Committee")).toBe("Sent to Property Committee for approval.");
    expect(COPY.form.sent.treasurer("Property Committee")).toBe(
      "No one in Property Committee is able to approve this, so it was sent to the treasurer.",
    );
    expect(COPY.form.sent.nobody("Property Committee")).toBe(
      "No one in Property Committee is able to approve this, and no one can record payments yet. It's saved and waiting. Let your church office know.",
    );
    for (const text of [COPY.form.sent.seat("G"), COPY.form.sent.treasurer("G"), COPY.form.sent.nobody("G")]) {
      expect(text).not.toMatch(/notif/i);
    }
  });
});

describe("C4 receipts", () => {
  it("errors", () => {
    expect(COPY.receipts.notAllowed("lunch.heic")).toBe("lunch.heic isn't a photo or PDF we can use.");
    expect(COPY.receipts.tooLarge("scan.pdf")).toBe("scan.pdf is larger than 4 MB. Try a photo of it, or a smaller scan.");
    expect(COPY.receipts.unreadable("a.jpg")).toBe("a.jpg couldn't be read. Try a different photo.");
    expect(COPY.receipts.tooMany).toBe("You've added the most receipts allowed (5).");
    expect(COPY.receipts.duplicate).toBe("That receipt is already on this request.");
    expect(COPY.receipts.notEditable).toBe("Receipts can't be changed on this request now.");
    expect(COPY.receipts.rateLimited).toBe("Too many uploads just now. Wait a few minutes and try again.");
    expect(COPY.receipts.twoFactorRequired).toBe("Please confirm your two-factor code to continue.");
    expect(COPY.receipts.remove).toBe("Remove");
    expect(COPY.receipts.removeAccessibleName("a.jpg")).toBe("Remove a.jpg");
    expect(COPY.receipts.none).toBe("No receipt attached.");
    expect(COPY.receipts.unavailable).toBe("Receipt not available.");
    expect(COPY.receipts.notFoundBody).toBe("Not found");
  });

  it("no string says files are safe or scanned (accepted residual 1)", () => {
    const all = JSON.stringify(COPY.receipts) + COPY.form.receiptsHint;
    expect(all).not.toMatch(/safe|scan(ned)? for|virus|malware|secure/i);
  });
});

describe("C5 request detail", () => {
  it("labels, flags and buttons", () => {
    expect(COPY.detail.labels).toEqual({
      amount: "Amount",
      date: "Date of the expense",
      chargedTo: "Charged to",
      category: "Category",
      payTo: "Pay to",
      preApprover: "Who approved it beforehand",
      purpose: "What it was for",
      receipts: "Receipts",
      history: "History",
    });
    expect(COPY.detail.enteredForYou).toBe("Someone entered this request on your behalf.");
    expect(COPY.detail.enteredOnBehalf).toBe("Entered on someone's behalf.");
    expect(COPY.detail.duplicateReceipt).toBe("A receipt on this request was also attached to an earlier request.");
    expect(COPY.detail.viewDuplicate).toBe("View that request");
    expect(COPY.detail.noReceiptClaimed).toBe("The requester says they can't attach a receipt.");
    expect(COPY.detail.receiptWaived).toBe("Receipt waived.");
    expect(COPY.detail.buttons).toEqual({
      editDraft: "Edit draft",
      editAndSendAgain: "Edit and send again",
      withdraw: "Withdraw request",
      print: "Print the form",
    });
    expect(COPY.detail.unavailable).toBe("This request isn't available.");
    expect(COPY.detail.back).toBe("Back to reimbursements");
  });

  it("history labels", () => {
    expect(COPY.detail.history).toEqual({
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
    });
  });

  it("banners by status", () => {
    const b = COPY.detail.banner;
    expect(b.draft).toBe("This is a draft. Only you can see it.");
    expect(b.submitted.seat).toBe("Waiting for approval.");
    expect(b.submitted.treasurer).toBe("Waiting for the treasurer to approve it.");
    expect(b.submitted.nobody).toBe("Waiting for approval. No one is able to approve it yet, so let the church office know.");
    expect(b.returned("Wrong receipt", "requester")).toBe("Sent back to you. Reason: Wrong receipt");
    expect(b.returned("Wrong receipt", "staff")).toBe("Sent back. Reason: Wrong receipt");
    expect(b.notApproved("Out of budget")).toBe("Not approved. Reason: Out of budget");
    expect(b.approved("Oct 25, 2026")).toBe("Approved on Oct 25, 2026. Waiting for payment.");
    expect(b.paid("Oct 26, 2026")).toBe("Paid on Oct 26, 2026.");
    expect(b.withdrawn).toBe("This request was withdrawn.");
    expect(b.voided).toBe("This request was closed. Ask the treasurer if you have questions.");
  });
});

describe("C6 decide and withdraw", () => {
  it("strings", () => {
    const d = COPY.decision;
    expect(d.approveTitle).toBe("Approve this request?");
    expect(d.approveBody("$41.50", "Pat Quill", "Property Committee")).toBe(
      "$41.50 to Pat Quill, charged to Property Committee. Once approved it goes to the treasurer for payment.",
    );
    expect(d.sendBackTitle).toBe("Send this request back?");
    expect(d.needsChanges).toBe("Needs changes");
    expect(d.needsChangesHint).toBe("The requester can fix it and send it again.");
    expect(d.notApproved).toBe("Not approved");
    expect(d.notApprovedHint).toBe("The request ends here unless the requester withdraws it.");
    expect(d.reasonLabel).toBe("Reason (the requester will see this)");
    expect([d.approved, d.sentBack, d.markedNotApproved, d.reasonRequired]).toEqual([
      "Approved.",
      "Sent back.",
      "Marked not approved.",
      "Give a reason.",
    ]);
    expect(d.alreadyApproved("Oct 25, 2026")).toBe("This was already approved on Oct 25, 2026.");
    expect(d.alreadySentBack("Oct 25, 2026")).toBe("This was already sent back on Oct 25, 2026.");
    expect(d.changedAfterOpened).toBe("This request changed after you opened it. Review it again.");
    expect(d.withdrawTitle).toBe("Withdraw this request?");
    expect(d.withdrawBody).toBe("It will be closed. You can start a new one any time.");
    expect([d.withdrawConfirm, d.withdrawKeep]).toEqual(["Withdraw", "Keep it"]);
    expect(d.withdrawn).toBe("Request withdrawn.");
    expect(d.withdrawAlreadyPaid).toBe("This request was already paid, so it can't be withdrawn. Ask the treasurer.");
  });
});

describe("C7 to C9 treasurer queue, detail, settings and team", () => {
  it("queue", () => {
    const q = COPY.queue;
    expect(q.heading).toBe("Reimbursement requests");
    expect(q.tabs).toEqual({
      pay: "Waiting for payment",
      override: "Needs treasurer approval",
      progress: "In progress",
      paid: "Paid",
      all: "All",
    });
    expect(q.overrideTabNote).toBe("No one in the group is able to approve these, so they wait for a treasurer.");
    expect(q.approvedOn("Oct 25")).toBe("Approved Oct 25");
    expect(q.sentOn("Oct 25")).toBe("Sent Oct 25");
    expect(q.enteredOnBehalfBadge).toBe("Entered on someone's behalf");
    expect(q.noPayHolder).toBe(
      "No one can record payments yet. Your church office can ask PresbyPortal support to set up a treasurer.",
    );
    expect(q.exportCsv).toBe("Export CSV");
    expect(q.exportTooLarge).toBe("Narrow the date range: that export is more than 20,000 requests.");
    expect(q.forbidden("Alder Creek Church")).toBe(
      "This page is for the people who handle reimbursements at Alder Creek Church. If you think you should be one of them, ask your treasurer or another administrator there.",
    );
    expect(q.loadError).toBe("We couldn't load the requests. Try again in a moment.");
    // Amendment S7: nothingWaiting is gone (wrong on Paid, All and under a filter).
    expect("nothingWaiting" in q).toBe(false);
    expect(q.empty).toEqual({
      pay: "Nothing is waiting for payment.",
      override: "Nothing needs a treasurer's approval.",
      progress: "Nothing is in progress.",
      paid: "Nothing has been paid yet.",
      all: "No one has sent in a request yet.",
      filtered: "No requests match those filters.",
    });
    expect(q.filter).toEqual({
      groupAll: "All groups",
      groupSelected: "This group",
      submittedFrom: "Submitted from",
      submittedTo: "Submitted to",
      datesHint: "Dates are the day each request was last submitted.",
      apply: "Filter",
      clear: "Clear",
      groupsTruncated: "Only groups with one of the 2,000 most recent requests are listed.",
    });
  });

  it("treasury verbs", () => {
    const t = COPY.treasury;
    expect(t.buttons).toEqual({
      recordPayment: "Record payment",
      reversePayment: "Reverse payment",
      waiveReceipt: "Waive receipt",
      sendBack: "Send back to requester",
      void: "Void request",
      approveAsTreasurer: "Approve as treasurer",
      addNote: "Add a note",
    });
    expect(t.paymentForm.methods).toEqual({ check: "Check", ach: "ACH", cash: "Cash", other: "Other" });
    expect(t.paymentForm.hint).toBe("PresbyPortal records the payment. It doesn't send money or ask for bank details.");
    expect(t.blocks.approverCannotPay).toBe("A different person must record this payment.");
    expect(t.blocks.anotherPayer).toBe(
      "Another person who can record payments should do this, because you entered this request or are being paid by it.",
    );
    expect(t.blocks.receiptNeeded).toBe("Add a receipt or waive it before paying.");
    expect(t.blocks.notWaitingForPayment).toBe("This request isn't waiting for payment.");
    expect(t.blocks.alreadyPaid).toBe("This payment was already recorded.");
    expect(t.reverse.body).toBe("The request goes back to “Approved, waiting for payment”. Both entries stay on record.");
    expect(t.void.body).toBe("It will be closed and can't be paid. Nothing is deleted.");
    expect(t.waive.body).toBe("The request can be paid without one. This is recorded.");
    expect(t.override.body("Property Committee")).toBe(
      "No one in Property Committee is able to approve this. Once approved, a different person who can record payments must pay it.",
    );
    expect(t.override.seatHolderExists("Property Committee")).toBe(
      "Someone in Property Committee can approve this, so it needs their approval.",
    );
    expect(t.override.needsSecondPayer + t.override.addOneUnderTeam).toBe(
      "This needs a second person who can record payments before you can approve it. Whoever approves can't also pay. Add one under Treasury team.",
    );
    expect(t.note.hint).toBe("Only the treasury team can see notes.");
    // Amendment S1, S3, S4.
    expect(t.results.noteRequired).toBe("Write a note.");
    expect(t.results.dateOutOfRange).toBe("Choose a date between the day of the expense and today.");
    expect("dateNotFuture" in t.results).toBe(false);
    expect(t.refusals).toEqual({
      notWaivable: "A receipt can't be waived on this request. Reload the page to see where it stands.",
      receiptPresent: "This request already has a receipt, so there is nothing to waive.",
      notVoidable: "This request can't be voided. Reload the page to see where it stands.",
      notReversible: "This request has no payment that can be reversed. Reload the page to see where it stands.",
      notApprovable: "You can't approve this request as treasurer. Reload the page to see where it stands.",
      notReturnable: "You can't send this request back. Reload the page to see where it stands.",
    });
    expect(t.sendBack).toEqual({
      title: "Send this request back?",
      body: "The requester can fix it and send it again.",
      bodyApproved: "The requester can fix it and send it again. It will need approval again.",
    });
    expect(t.extras.approvedBy("Pat Quill", "Oct 25", false)).toBe("Approved by Pat Quill on Oct 25");
    expect(t.extras.approvedBy("Pat Quill", "Oct 25", true)).toBe("Approved by Pat Quill on Oct 25 as treasurer");
    expect(t.extras.selfPaid).toBe("Marked as paid by the person who entered or is paid by the request.");
  });

  it("settings and team", () => {
    const s = COPY.settings;
    expect(s.heading).toBe("Reimbursement settings");
    expect(s.approverNote(1)).toBe("1 chair or leader can approve.");
    expect(s.approversNote(2)).toBe("2 chairs or leaders can approve.");
    expect(s.noApproverManaged).toBe("No chair or leader right now: requests go to the treasurer.");
    expect(s.noApproverDerived).toBe("No chair or leader: requests go to the treasurer.");
    expect(s.noGroups).toBe("No group can receive requests yet. Choose at least one so people can make requests.");
    expect(s.categoriesHint).toBe("Retired categories stay on old requests.");
    expect(s.categoryNameInvalid).toBe("Use 1 to 60 characters.");
    expect(s.categoryNameTaken).toBe("You already have a category with that name.");
    expect(s.categoryGone).toBe("That category isn't in the list any more. Reload the page to see the current list.");
    const t = COPY.team;
    expect(t.heading).toBe("Treasury team");
    expect(t.intro("Alder Creek Church")).toBe(
      "Who can handle reimbursements and giving at Alder Creek Church. Anyone who can view, pay or manage requests signs in with two-factor authentication.",
    );
    expect([t.setUpTreasurer, t.setUpClerk]).toEqual(["Set up the Treasurer role", "Set up the Reimbursement Clerk role"]);
    expect(t.clerkDescription).toBe("Can enter requests on behalf of members who don't use the portal.");
    expect(t.notTreasuryOnly).toBe(
      "That role includes permissions outside Giving and Reimbursements. An administrator can grant it from Roles.",
    );
    expect(t.ensureNotTreasuryOnly).toBe(
      "That role already exists with permissions outside Giving and Reimbursements. An administrator can fix it under Roles.",
    );
    expect(t.lastManager).toBe("That would leave no one able to manage reimbursements. Give the role to someone else first.");
    expect(t.escalation("a, b")).toBe("You can't grant permissions you don't hold yourself: a, b.");
    expect(t.alreadyGranted).toBe("That person already has this role.");
    expect(t.notAMember).toBe("That person doesn't have a current membership here.");
    expect(t.forbidden).toBe("You don't have permission to manage the treasury team.");
  });
});

describe("the team page chrome (Batch 6 Copy gaps: REUSED from the giving team page, two ADAPTED)", () => {
  it("is pinned byte for byte", () => {
    const p = COPY.team.panel;
    expect(p.since).toBe("since");
    expect(p.groupSuffix).toBe("(group)");
    expect(p.endButton).toBe("End this role");
    expect(p.endTitle("Pat Quill", "Treasurer")).toBe("End Pat Quill's Treasurer role?");
    expect(p.endBody).toBe(
      "They will lose this role's permissions right away. Anything they have already recorded stays. You can give the role again later.",
    );
    expect(p.keepRole).toBe("Keep the role");
    expect(p.endConfirm).toBe("End role");
    expect(p.roleEnded("Pat Quill")).toBe("Pat Quill no longer has this role.");
    expect(p.managedUnderRoles).toBe(
      "This one is managed under Roles, because it is given to a group or includes permissions outside Giving and Reimbursements.",
    );
    expect(p.setupIntroOne).toBe("This role isn't set up for your church yet, so it can't be given to anyone.");
    expect(p.setupIntroMany).toBe("These roles aren't set up for your church yet, so they can't be given to anyone.");
    expect(p.settingUp).toBe("Setting up…");
    expect(p.roleSetUp).toBe("Role set up.");
    expect(p.roleSetUpWithout("reimbursement.pay", false)).toBe("Role set up, without reimbursement.pay (you don't hold it yourself).");
    expect(p.roleSetUpWithout("a, b", true)).toBe("Role set up, without a, b (you don't hold them yourself).");
    expect(p.giveHeading).toBe("Give a role");
    expect(p.roleLabel).toBe("Role");
    expect(p.personLabel).toBe("Person");
    expect(p.chooseRole).toBe("Choose a role");
    expect(p.choosePerson).toBe("Choose a person");
    expect(p.giveButton).toBe("Give role");
    expect(p.roleGiven).toBe("Role given.");
    expect(p.noMembers).toBe("Nobody has a current membership here yet.");
    expect(p.noRoleToGive).toBe("There is no role to hand out yet. Set one up above, then come back.");
  });

  it("the plain-text REUSED ones still appear on the giving team page they are borrowed from", () => {
    const dir = path.resolve(__dirname, "../../app/(org)/o/[slug]/admin/giving/team");
    const source = ["team-list.tsx", "grant-form.tsx", "setup-role-button.tsx", "page.tsx"]
      .map((file) => readFileSync(path.join(dir, file), "utf8"))
      .join("\n");
    for (const text of ["End this role", "Keep the role", "End role", "Setting up…", "Role set up.", "Give a role", "Choose a role", "Choose a person", "Give role", "Role given.", "Nobody has a current membership here yet."]) {
      expect(source, text).toContain(text);
    }
  });
});

describe("the REUSED team answers", () => {
  it("appear in the giving team actions, the place they are borrowed from", () => {
    const giving = readFileSync(
      path.resolve(__dirname, "../../app/(org)/o/[slug]/admin/giving/team/actions.ts"),
      "utf8",
    );
    for (const text of [
      COPY.team.invalidRole,
      COPY.team.assignmentEnded,
      COPY.team.endFromRoles,
      COPY.team.templateUnavailable,
      COPY.team.ensureEscalation("${result.missingPermissions.join(\", \")}"),
    ]) {
      expect(giving, text).toContain(text);
    }
  });
});

describe("the REUSED gate boilerplate", () => {
  it("appears in src/lib/giving/action-gate.ts, the place it is borrowed from", () => {
    const giving = readFileSync(path.resolve(__dirname, "../giving/action-gate.ts"), "utf8");
    for (const key of ["signedOut", "noOrgAccess", "notPermitted", "accessCheckFailed", "twoFactorRequired"] as const) {
      expect(giving, key).toContain(COPY.gate[key]);
    }
  });

  it("is the giving gate's own text, verbatim", () => {
    expect(COPY.gate).toEqual({
      signedOut: "You must be signed in to do that.",
      noOrgAccess: "You don't have access to that organization.",
      notPermitted: "You don't have permission to do that.",
      accessCheckFailed: "We couldn't check your access just now. Try again in a moment.",
      twoFactorRequired: "Please confirm your two-factor code to continue.",
    });
  });
});
