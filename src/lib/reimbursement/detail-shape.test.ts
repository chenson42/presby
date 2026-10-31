import { describe, expect, it } from "vitest";
import {
  formOptionsSchema,
  memberDetailSchema,
  requestDetailSchema,
  settingsSchema,
  treasuryDetailSchema,
} from "./detail-shape";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const member = {
  id: id(1),
  level: "member",
  status: "submitted",
  kind: "reimburse",
  origin: "app",
  revision: 2,
  amountCents: 4150,
  currency: "usd",
  expenseDate: "2026-10-20",
  purpose: "Paint",
  preApprovedByName: null,
  noReceiptClaimed: false,
  createdAt: "2026-10-21T10:00:00.123456+00:00",
  firstSubmittedAt: "2026-10-21T10:05:00+00:00",
  submittedAt: "2026-10-21T10:05:00+00:00",
  updatedAt: "2026-10-21T10:05:00+00:00",
  group: { id: id(2), name: "Property Committee" },
  category: { id: id(3), name: "Supplies", retired: false },
  payee: { kind: "person", name: "Pat Quill", personId: id(4) },
  enteredOnBehalf: false,
  receipts: [{ id: id(5), displayName: "receipt.jpg", contentType: "image/jpeg", byteSize: 1234, createdAt: "2026-10-21T10:01:00+00:00" }],
  receiptWaived: false,
  approvedOn: null,
  decidedOn: null,
  latestReason: null,
  route: "seat",
  paidOn: null,
  duplicateReceipt: null,
  viewer: { relation: "creator", canEdit: false, canWithdraw: true, canDecide: false },
  history: [{ kind: "created", toStatus: "draft", on: "2026-10-21", at: "2026-10-21T10:00:00+00:00" }],
};

const treasury = {
  ...member,
  level: "treasury",
  creatorName: "Pat Quill",
  approval: null,
  waiver: null,
  duplicateRequestIds: [],
  payments: [],
  treasuryViewer: {
    holdsPay: true,
    holdsManage: false,
    isApprover: false,
    isRequesterSide: false,
    seatHolderExists: true,
    secondPayerExists: false,
    anotherPayerExists: false,
  },
};

describe("the detail shape (strict, pinned as built; Batch 1a ruling 5)", () => {
  it("accepts a member-level and a treasury-level detail", () => {
    expect(memberDetailSchema.safeParse(member).success).toBe(true);
    expect(treasuryDetailSchema.safeParse(treasury).success).toBe(true);
    expect(requestDetailSchema.parse(member).level).toBe("member");
    expect(requestDetailSchema.parse(treasury).level).toBe("treasury");
  });

  it("an UNKNOWN key fails the parse: a column added to the definer cannot reach a page unreviewed", () => {
    expect(requestDetailSchema.safeParse({ ...member, bankAccount: "x" }).success).toBe(false);
    expect(requestDetailSchema.safeParse({ ...treasury, internalNote: "x" }).success).toBe(false);
    expect(requestDetailSchema.safeParse({ ...member, viewer: { ...member.viewer, isAdmin: true } }).success).toBe(false);
  });

  it("the member level carries none of the treasury blocks (a requester never gets actor names or payments)", () => {
    for (const key of ["creatorName", "approval", "waiver", "duplicateRequestIds", "payments", "treasuryViewer"]) {
      expect(requestDetailSchema.safeParse({ ...member, [key]: key === "payments" ? [] : null }).success, key).toBe(false);
    }
  });

  it("a missing key fails too", () => {
    const { purpose: _purpose, ...withoutPurpose } = member;
    void _purpose;
    expect(requestDetailSchema.safeParse(withoutPurpose).success).toBe(false);
  });

  it("an unknown status, kind, relation or content type fails", () => {
    expect(requestDetailSchema.safeParse({ ...member, status: "pending" }).success).toBe(false);
    expect(requestDetailSchema.safeParse({ ...member, viewer: { ...member.viewer, relation: "admin" } }).success).toBe(false);
    expect(
      requestDetailSchema.safeParse({ ...member, receipts: [{ ...member.receipts[0], contentType: "text/html" }] }).success,
    ).toBe(false);
  });

  it("a vendor payee has a name and no person id", () => {
    expect(requestDetailSchema.safeParse({ ...member, kind: "vendor", payee: { kind: "vendor", name: "Hardware Co" } }).success).toBe(true);
    expect(
      requestDetailSchema.safeParse({ ...member, kind: "vendor", payee: { kind: "vendor", name: "Hardware Co", personId: id(9) } }).success,
    ).toBe(false);
  });

  it("history items may carry only the optional keys the definer strips nulls from", () => {
    const withNote = { ...member, history: [{ kind: "returned", fromStatus: "submitted", toStatus: "returned", on: "2026-10-22", at: "2026-10-22T09:00:00+00:00", note: "Wrong receipt" }] };
    expect(requestDetailSchema.safeParse(withNote).success).toBe(true);
    const withStray = { ...member, history: [{ kind: "returned", on: "2026-10-22", at: "2026-10-22T09:00:00+00:00", ip: "1.2.3.4" }] };
    expect(requestDetailSchema.safeParse(withStray).success).toBe(false);
  });
});

describe("form options and settings", () => {
  it("form options", () => {
    expect(formOptionsSchema.safeParse({ mayFile: true, groups: [{ id: id(1), name: "G" }], categories: [], canRequestForOthers: false }).success).toBe(true);
    expect(formOptionsSchema.safeParse({ mayFile: true, groups: [], categories: [], canRequestForOthers: false, extra: 1 }).success).toBe(false);
  });

  it("settings", () => {
    const ok = {
      groups: [{ id: id(1), name: "Session", membershipSource: "derived", chargeable: true, approverCount: 0 }],
      categories: [{ id: id(2), name: "Supplies", sortOrder: 0 }],
      payHolderCount: 1,
    };
    expect(settingsSchema.safeParse(ok).success).toBe(true);
    expect(settingsSchema.safeParse({ ...ok, payHolderCount: -1 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...ok, groups: [{ ...ok.groups[0], secret: 1 }] }).success).toBe(false);
  });
});
