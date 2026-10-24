/**
 * Fund input validation - docs/work-log/2026-10-15-online-giving.md, G23 and
 * the `giving_funds` CHECKs. PURE; shared by the fund form and the actions.
 *
 * Rules that bind: a name is trimmed 1-80; a fund offered online needs a public
 * display name (the DB CHECK `giving_funds_online_shape`) because fund names
 * offered online are public and nothing is offered online by default.
 */
import { z } from "zod";
import { CONTROL_CHARS } from "./field-errors";

export const RESTRICTION_CLASSES = [
  "unrestricted",
  "temporarily_restricted",
  "permanently_restricted",
] as const;
export type RestrictionClass = (typeof RESTRICTION_CLASSES)[number];

export const RESTRICTION_LABELS: Record<RestrictionClass, string> = {
  unrestricted: "Unrestricted",
  temporarily_restricted: "Temporarily restricted",
  permanently_restricted: "Permanently restricted",
};

const name80 = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter ${label}`)
    .max(80, "That is longer than 80 characters")
    .refine((v) => !CONTROL_CHARS.test(v), "That has a character we can't store");

export const fundSchema = z
  .object({
    name: name80("a name for the fund"),
    onlineDisplayName: z
      .string()
      .trim()
      .max(80, "That is longer than 80 characters")
      .refine((v) => !CONTROL_CHARS.test(v), "That has a character we can't store")
      .nullish()
      .transform((v) => (v === undefined || v === null || v === "" ? null : v)),
    description: z
      .string()
      .trim()
      .max(500, "A description must be 500 characters or fewer")
      .nullish()
      .transform((v) => (v === undefined || v === null || v === "" ? null : v)),
    restrictionClass: z.enum(RESTRICTION_CLASSES),
    offeredOnline: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.offeredOnline && value.onlineDisplayName === null) {
      ctx.addIssue({
        code: "custom",
        path: ["onlineDisplayName"],
        message: "Enter the name donors will see to offer this fund online",
      });
    }
  });
export type FundInput = z.input<typeof fundSchema>;
export type FundValues = z.output<typeof fundSchema>;

export const updateFundSchema = z.object({ fundId: z.guid() }).and(fundSchema);
