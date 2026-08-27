import { z } from "zod";

/**
 * Client-side validation for the per-capita rate and payment forms —
 * Increment 3b. Same "not the only gate" discipline every schema file
 * under `(org)` documents.
 */
export const perCapitaRateSchema = z.object({
  billingYear: z.string().refine((v) => /^\d{4}$/.test(v), "Enter a 4-digit year"),
  basisYear: z
    .string()
    .refine((v) => v === "" || /^\d{4}$/.test(v), "Enter a 4-digit year"),
  ratePerMember: z
    .string()
    .refine((v) => v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0, "Enter a non-negative rate"),
});
export type PerCapitaRateFormValues = z.infer<typeof perCapitaRateSchema>;

export const recordPaymentSchema = z.object({
  recordId: z.string().min(1, "Choose a congregation"),
  paidAmount: z
    .string()
    .refine((v) => v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0, "Enter a non-negative amount"),
  paidAt: z.string().min(1, "Payment date is required"),
});
export type RecordPaymentFormValues = z.infer<typeof recordPaymentSchema>;
