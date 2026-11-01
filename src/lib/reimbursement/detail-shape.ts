import { z } from "zod";
import { EVENT_KINDS, REQUEST_STATUSES } from "./states";

/**
 * The shape of `presby_reimbursement_detail(request, actor, level)` and of the
 * other jsonb-returning read definers - docs/work-log/2026-10-25-treasury-
 * inc1.md, Phase 3 ("pinned by a zod schema and a golden test") and the
 * orchestrator's Batch 1a ruling 5: the field names are FROZEN AS BUILT in
 * drizzle/0073 section 8g; this file pins them, it does not rename them. PURE.
 *
 * `z.strictObject` on purpose: an UNKNOWN key fails the parse as loudly as a
 * missing one, so a column added to the definer cannot reach a page unreviewed
 * (a stray field would be a leak waiting for a template to print it).
 * `detail-shape.golden.test.ts` and `detail-shape.db.test.ts` run real rows
 * through it.
 *
 * Two levels. `member` is the requester projection: no actor names, no
 * payments, no notes, no duplicate flag for the requester. `treasury` (needs
 * `reimbursement.view`) adds the `creatorName`, `approval`, `waiver`,
 * `duplicateRequestIds`, `payments` and `treasuryViewer` blocks.
 *
 * Wire formats: dates are `YYYY-MM-DD` strings (cast in SQL: the driver would
 * hand a computed date back as a string anyway, `check:sql-date`); timestamps
 * are ISO-8601 strings with an offset, as Postgres renders `timestamptz` into
 * jsonb. Money is integer cents.
 */

const id = z.guid();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().min(10);

export const VIEWER_RELATIONS = ["creator", "beneficiary", "seat", "treasury"] as const;
export type ViewerRelation = (typeof VIEWER_RELATIONS)[number];

const status = z.enum(REQUEST_STATUSES);
const eventKind = z.enum(EVENT_KINDS);

const historyItem = z.strictObject({
  kind: eventKind,
  fromStatus: status.optional(),
  toStatus: status.optional(),
  on: ymd,
  at: timestamp,
  /** A return/not-approved reason at member level; any note at treasury level. */
  note: z.string().optional(),
  /** Treasury level only. */
  actorName: z.string().optional(),
  paymentId: id.optional(),
});

const receipt = z.strictObject({
  id,
  displayName: z.string(),
  contentType: z.enum(["image/jpeg", "application/pdf"]),
  byteSize: z.number().int().min(1),
  createdAt: timestamp,
});

const payee = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("vendor"), name: z.string().nullable() }),
  z.strictObject({
    kind: z.literal("person"),
    name: z.string().nullable(),
    /** Only the creator and the treasury team get the payee's person id. */
    personId: id.nullable(),
  }),
]);

const base = {
  id,
  status,
  kind: z.enum(["reimburse", "vendor"]),
  origin: z.enum(["app", "import"]),
  revision: z.number().int().min(1),
  amountCents: z.number().int().nullable(),
  currency: z.literal("usd"),
  expenseDate: ymd.nullable(),
  purpose: z.string().nullable(),
  preApprovedByName: z.string().nullable(),
  noReceiptClaimed: z.boolean(),
  createdAt: timestamp,
  firstSubmittedAt: timestamp.nullable(),
  submittedAt: timestamp.nullable(),
  updatedAt: timestamp,
  group: z.strictObject({ id, name: z.string() }).nullable(),
  category: z.strictObject({ id, name: z.string(), retired: z.boolean() }).nullable(),
  payee,
  enteredOnBehalf: z.boolean(),
  receipts: z.array(receipt),
  receiptWaived: z.boolean(),
  approvedOn: ymd.nullable(),
  decidedOn: ymd.nullable(),
  /** The reason on the latest `returned` / `not_approved` event, while in that status. */
  latestReason: z.string().nullable(),
  /** Where a submitted request waits, computed live; null outside `submitted`. */
  route: z.enum(["seat", "treasurer", "nobody"]).nullable(),
  paidOn: ymd.nullable(),
  /** Seat approvers and the treasury team: whether a receipt was seen before. Never the requester (null). */
  duplicateReceipt: z.boolean().nullable(),
  viewer: z.strictObject({
    relation: z.enum(VIEWER_RELATIONS),
    canEdit: z.boolean(),
    canWithdraw: z.boolean(),
    canDecide: z.boolean(),
  }),
  history: z.array(historyItem),
};

export const memberDetailSchema = z.strictObject({ ...base, level: z.literal("member") });

const payment = z.strictObject({
  id,
  kind: z.enum(["payment", "reversal"]),
  method: z.enum(["check", "ach", "cash", "other"]).nullable(),
  reference: z.string().nullable(),
  paidOn: ymd.nullable(),
  amountCents: z.number().int(),
  byName: z.string().nullable(),
  selfPaid: z.boolean(),
  note: z.string().nullable(),
  offsetsPaymentId: id.nullable(),
  reason: z.string().nullable(),
  createdAt: timestamp,
  reversed: z.boolean(),
});

export const treasuryDetailSchema = z.strictObject({
  ...base,
  level: z.literal("treasury"),
  creatorName: z.string().nullable(),
  approval: z
    .strictObject({
      path: z.enum(["seat", "override"]),
      byName: z.string().nullable(),
      revision: z.number().int().min(1),
      at: timestamp,
    })
    .nullable(),
  waiver: z
    .strictObject({ at: timestamp, byName: z.string().nullable(), note: z.string().nullable() })
    .nullable(),
  duplicateRequestIds: z.array(id),
  payments: z.array(payment),
  treasuryViewer: z.strictObject({
    holdsPay: z.boolean(),
    holdsManage: z.boolean(),
    /** The viewer approved this request (they may not also pay it). */
    isApprover: z.boolean(),
    /** The viewer created it or is paid by it. */
    isRequesterSide: z.boolean(),
    seatHolderExists: z.boolean(),
    /** Another pay holder exists besides the viewer (override needs one). */
    secondPayerExists: z.boolean(),
    /** Another pay holder exists who could actually pay THIS request (self-pay needs none). */
    anotherPayerExists: z.boolean(),
  }),
});

export const requestDetailSchema = z.discriminatedUnion("level", [memberDetailSchema, treasuryDetailSchema]);

export type MemberDetail = z.infer<typeof memberDetailSchema>;
export type TreasuryDetail = z.infer<typeof treasuryDetailSchema>;
export type RequestDetail = z.infer<typeof requestDetailSchema>;
export type DetailLevel = RequestDetail["level"];

// ---------------------------------------------------------------------------
// presby_reimbursement_form_options(actor)
// ---------------------------------------------------------------------------

export const formOptionsSchema = z.strictObject({
  mayFile: z.boolean(),
  groups: z.array(z.strictObject({ id, name: z.string() })),
  categories: z.array(z.strictObject({ id, name: z.string() })),
  canRequestForOthers: z.boolean(),
});
export type FormOptions = z.infer<typeof formOptionsSchema>;

// ---------------------------------------------------------------------------
// presby_reimbursement_settings(actor)
// ---------------------------------------------------------------------------

export const settingsSchema = z.strictObject({
  groups: z.array(
    z.strictObject({
      id,
      name: z.string(),
      membershipSource: z.string(),
      chargeable: z.boolean(),
      /** Seats that can approve now. Derived groups (Session, Diaconate) have none, by design. */
      approverCount: z.number().int().min(0),
    }),
  ),
  categories: z.array(z.strictObject({ id, name: z.string(), sortOrder: z.number().int() })),
  payHolderCount: z.number().int().min(0),
});
export type ReimbursementSettings = z.infer<typeof settingsSchema>;
