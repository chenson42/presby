/**
 * Offline-gift input validation - docs/work-log/2026-10-15-online-giving.md,
 * Flow 8 and the `presby_giving_record_offline_gift` contract. PURE; shared by
 * the offline-gift form (React Hook Form + zodResolver) and the server action,
 * which re-parses the same schema.
 *
 * What is checked here and what is NOT. Checked: shapes (a real calendar date,
 * an amount through `parseAmountToCents(.., "offline")`, a check number only on
 * a check, stock needs a description). NOT checked here and decided by the
 * database in the org's own time zone: whether the date is in the future, and
 * whether the fund and donor are still usable - the function raises
 * `date_out_of_range`, `fund_unavailable`, `donor_unavailable`, and the action
 * turns those into inline errors. A future date is a database fact because
 * "today" depends on the organization's zone, not the browser's or the server's.
 */
import { z } from "zod";
import { parseAmountToCents } from "./money";
import { CONTROL_CHARS, isRealIsoDate } from "./field-errors";
import { createDonorSchema, donorContactFields, donorDisplayNameSchema } from "./donor-input";

export const OFFLINE_METHODS = ["cash", "check", "stock", "other"] as const;
export type OfflineMethod = (typeof OFFLINE_METHODS)[number];

export const OFFLINE_METHOD_LABELS: Record<OfflineMethod, string> = {
  cash: "Cash",
  check: "Check",
  stock: "Stock",
  other: "Other",
};

/** Plain-language reasons for an unusable amount. */
export const AMOUNT_REASON_COPY = {
  empty: "Enter the amount",
  format: "Enter an amount like 25 or 25.00 (no $ sign or commas)",
  too_small: "The amount must be at least one cent",
  too_large: "That is more than we can record ($1,000,000.00 at most)",
} as const;

const optionalShortText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .refine((v) => !CONTROL_CHARS.test(v), "That has a character we can't store")
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v));

const donorChoice = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("existing"), donorId: z.string().uuid("Choose a donor") }),
  z.object({
    mode: z.literal("new"),
    displayName: donorDisplayNameSchema,
    ...donorContactFields,
  }),
  z.object({ mode: z.literal("unidentified") }),
]);
export type DonorChoice = z.input<typeof donorChoice>;

export const offlineGiftSchema = z
  .object({
    donor: donorChoice,
    fundId: z.string().uuid("Choose a fund"),
    occurredOn: z
      .string()
      .refine(isRealIsoDate, "Enter the date as year-month-day, like 2026-04-12"),
    method: z.enum(OFFLINE_METHODS),
    amount: z.string(),
    checkNumber: optionalShortText(30, "A check number can be 30 characters at most"),
    stockDescription: optionalShortText(200, "Describe the stock in 200 characters or fewer"),
    stockQuantity: z
      .string()
      .trim()
      .nullish()
      .transform((v) => (v === undefined || v === null || v === "" ? null : v)),
    memo: optionalShortText(500, "A note can be 500 characters at most"),
    acknowledgeDuplicate: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const parsed = parseAmountToCents(value.amount, "offline");
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: AMOUNT_REASON_COPY[parsed.reason] });
    }
    if (value.checkNumber !== null && value.method !== "check") {
      ctx.addIssue({
        code: "custom",
        path: ["checkNumber"],
        message: "A check number only goes with a check",
      });
    }
    if (value.method === "stock" && value.stockDescription === null) {
      ctx.addIssue({
        code: "custom",
        path: ["stockDescription"],
        message: "Describe the stock (for example, 20 shares of an index fund)",
      });
    }
    if (value.method !== "stock" && (value.stockDescription !== null || value.stockQuantity !== null)) {
      ctx.addIssue({
        code: "custom",
        path: ["stockDescription"],
        message: "Stock details only go with a stock gift",
      });
    }
    if (value.stockQuantity !== null && !/^\d{1,12}(\.\d{1,6})?$/.test(value.stockQuantity)) {
      ctx.addIssue({
        code: "custom",
        path: ["stockQuantity"],
        message: "Enter the number of shares as a plain number, like 20 or 12.5",
      });
    } else if (value.stockQuantity !== null && Number(value.stockQuantity) <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["stockQuantity"],
        message: "The number of shares must be more than zero",
      });
    }
    if (value.donor.mode === "unidentified" && value.method !== "cash") {
      ctx.addIssue({
        code: "custom",
        path: ["method"],
        message: "Only cash can be recorded without a donor (a plate offering)",
      });
    }
  });

export type OfflineGiftInput = z.input<typeof offlineGiftSchema>;
export type OfflineGiftValues = z.output<typeof offlineGiftSchema>;

/** The amount of a parsed form, in cents (the schema already proved it parses). */
export function offlineAmountCents(amount: string): number {
  const parsed = parseAmountToCents(amount, "offline");
  if (!parsed.ok) throw new Error("offlineAmountCents: amount did not parse");
  return parsed.cents;
}

/** Voiding a gift: a reason of 3-200 characters (the DB trims; this bounds). */
export const voidGiftSchema = z.object({
  giftId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(3, "Give a reason of at least a few words")
    .max(200, "A reason can be 200 characters at most")
    .refine((v) => !CONTROL_CHARS.test(v), "That has a character we can't store"),
});
export type VoidGiftInput = z.input<typeof voidGiftSchema>;

/** The unused-here re-export keeps `createDonorSchema` reachable from one place for the form. */
export { createDonorSchema };

// ---------------------------------------------------------------------------
// Gift list filters (URL state)
// ---------------------------------------------------------------------------

export const GIFT_STATUSES = ["succeeded", "pending", "failed"] as const;
export const GIFT_SOURCES = ["online", "offline"] as const;

export interface GiftFilters {
  from?: string;
  to?: string;
  fundId?: string;
  status?: (typeof GIFT_STATUSES)[number];
  source?: (typeof GIFT_SOURCES)[number];
  donorId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lenient URL -> filters: an unusable value is DROPPED (never an error page),
 * because a filter comes from a query string anyone can edit. Used by the
 * list page and the CSV route so both read the same params identically.
 */
export function parseGiftFilters(raw: Record<string, string | string[] | undefined>): GiftFilters {
  const one = (key: string): string | undefined => {
    const v = raw[key];
    return typeof v === "string" ? v.trim() : Array.isArray(v) ? v[0]?.trim() : undefined;
  };
  const out: GiftFilters = {};
  const from = one("from");
  const to = one("to");
  if (from && isRealIsoDate(from)) out.from = from;
  if (to && isRealIsoDate(to)) out.to = to;
  const fund = one("fund");
  if (fund && UUID.test(fund)) out.fundId = fund;
  const donor = one("donor");
  if (donor && UUID.test(donor)) out.donorId = donor;
  const status = one("status");
  if (status && (GIFT_STATUSES as readonly string[]).includes(status)) {
    out.status = status as GiftFilters["status"];
  }
  const source = one("source");
  if (source && (GIFT_SOURCES as readonly string[]).includes(source)) {
    out.source = source as GiftFilters["source"];
  }
  return out;
}
