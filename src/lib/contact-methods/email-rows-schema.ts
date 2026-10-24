import { z } from "zod";
import { EMAIL_COPY } from "./copy";
import { EMAIL_SUBTYPES } from "./normalize";
import type { EmailRowInput } from "./types";

/**
 * The shared zod schema for a posted list of email rows (Phase 3, server
 * actions). Pure. It bounds the RAW input (a hostile post can send anything a
 * Server Action will deserialize) and leaves the real rules, shape, duplicates,
 * the main address, to `planEmailSave()`, which is the one place they live.
 *
 *   - at most 20 raw rows (the planner refuses more than 10 non-blank ones;
 *     the headroom is for blank rows a form leaves behind)
 *   - `value` at most 1000 raw characters, so a megabyte string never reaches
 *     the normalizer
 *   - ids are GUID-shaped (`z.guid()`, never `.uuid()`: not every id is RFC 9562),
 *     the subtype is one of the three labels or null
 */
export const MAX_RAW_EMAIL_ROWS = 20;
export const MAX_RAW_EMAIL_VALUE = 1000;

export const emailRowSchema = z
  .object({
    id: z.guid().optional(),
    value: z.string().max(MAX_RAW_EMAIL_VALUE),
    subtype: z.enum(EMAIL_SUBTYPES).nullable(),
    isPrimary: z.boolean(),
    doNotContact: z.boolean(),
  })
  .strict();

export const emailRowsSchema = z
  .object({
    rows: z.array(emailRowSchema).max(MAX_RAW_EMAIL_ROWS),
    knownIds: z.array(z.guid()).max(MAX_RAW_EMAIL_ROWS),
  })
  .strict();

export const newPersonEmailRowsSchema = z
  .array(emailRowSchema.omit({ id: true }).strict())
  .max(MAX_RAW_EMAIL_ROWS);

// ---------------------------------------------------------------------------
// Server-action parsing. A Server Action's parameter type is not a runtime
// boundary: any caller who knows the action id can post any JSON, so every
// action that takes email rows runs them through here before the library sees
// them, and gets back a REBUILT value (no stray property flows through) or one
// of the Copy strings.
// ---------------------------------------------------------------------------


type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function failureFor(raw: unknown): string {
  const rows =
    Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as { rows?: unknown }).rows : undefined;
  return Array.isArray(rows) && rows.length > MAX_RAW_EMAIL_ROWS
    ? EMAIL_COPY.tooMany
    : EMAIL_COPY.invalidShape;
}

/** `updatePerson`'s `contact.emails`: the rows and the ids the form loaded. */
export function parseUpdateEmails(
  raw: unknown,
): Parsed<{ rows: EmailRowInput[]; knownIds: string[] }> {
  const parsed = emailRowsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: failureFor(raw) };
  return {
    ok: true,
    value: {
      rows: parsed.data.rows.map((row) => ({ ...row })),
      knownIds: [...parsed.data.knownIds],
    },
  };
}

/** `createPerson`'s `contact.emails`: new rows only (no ids). */
export function parseNewPersonEmails(raw: unknown): Parsed<EmailRowInput[]> {
  const parsed = newPersonEmailRowsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: failureFor(raw) };
  return { ok: true, value: parsed.data.map((row) => ({ ...row })) };
}
