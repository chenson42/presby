/**
 * Server-side validation for the /help/contact form (Phase 3 "Validation",
 * CA12). PURE: it imports only the lifted text-hygiene helpers and the contract,
 * so the client island may also walk it (H19). The client's checks are advisory;
 * this is the check.
 *
 * Overlong input is REJECTED, never truncated. Controls (NUL included),
 * bidirectional overrides and zero-width characters are stripped on save and NFC
 * applied, so what is stored is what the operator reads. The email is checked
 * for SHAPE only: no MX or deliverability lookup, never lower-cased (it is shown
 * as typed), never matched against any account (C4).
 *
 * The email regex mirrors 0083's `help_contact_email_shape` CHECK
 * (`^[^@]+@[^@]+\.[^@]+$`, no whitespace), so `x@a.` and `x@.invalid` are
 * `bad_format` here instead of surfacing as a database refusal (Batch 1 note 1).
 */
import { charCount, cleanText, normalizeMultiline } from "@/lib/text-hygiene";
import {
  HELP_CONTACT_LIMITS as LIMITS,
  HELP_CONTACT_TOPIC_KEYS,
  type FieldCode,
  type HelpContactField,
  type HelpContactTopic,
} from "./contract";

export interface ValidHelpContact {
  topic: HelpContactTopic;
  /** Null when left blank. */
  name: string | null;
  email: string;
  /** Null when left blank. */
  congregation: string | null;
  message: string;
}

export type ValidationResult =
  | { ok: true; value: ValidHelpContact }
  | { ok: false; fieldErrors: Partial<Record<HelpContactField, FieldCode>> };

/** One `@`, a non-empty local part, a dot inside the domain with text on both sides, no whitespace. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * A guard against normalizing a megabyte before refusing it. Anything this long
 * is over every limit even after hygiene strips characters out of it.
 */
const RAW_CEILING = 50_000;

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

export function isHelpContactTopic(value: unknown): value is HelpContactTopic {
  return typeof value === "string" && (HELP_CONTACT_TOPIC_KEYS as readonly string[]).includes(value);
}

/** Raw field values as they arrive (strings, or anything else a crafted request sends). */
export function validateHelpContact(raw: Readonly<Record<string, unknown>>): ValidationResult {
  const errors: Partial<Record<HelpContactField, FieldCode>> = {};

  const topicRaw = asString(raw.topic);
  const topic = isHelpContactTopic(topicRaw) ? topicRaw : null;
  if (topic === null) errors.topic = "required";

  const optional = (field: "name" | "congregation"): string | null => {
    const input = asString(raw[field]);
    if (input.length > RAW_CEILING) {
      errors[field] = "too_long";
      return null;
    }
    const cleaned = cleanText(input);
    if (cleaned === "") return null;
    if (charCount(cleaned) > LIMITS[field]) {
      errors[field] = "too_long";
      return null;
    }
    return cleaned;
  };
  const name = optional("name");
  const congregation = optional("congregation");

  let email = "";
  const emailInput = asString(raw.email);
  if (emailInput.length > RAW_CEILING) {
    errors.email = "too_long";
  } else {
    email = cleanText(emailInput);
    if (email === "") errors.email = "required";
    else if (charCount(email) > LIMITS.email) errors.email = "too_long";
    else if (!EMAIL_SHAPE.test(email)) errors.email = "bad_format";
  }

  let message = "";
  const messageInput = asString(raw.message);
  if (messageInput.length > RAW_CEILING) {
    errors.message = "too_long";
  } else {
    message = normalizeMultiline(messageInput).trim();
    const length = charCount(message);
    if (message === "") errors.message = "required";
    else if (length < LIMITS.messageMin) errors.message = "too_short";
    else if (length > LIMITS.messageMax) errors.message = "too_long";
  }

  if (Object.keys(errors).length > 0 || topic === null) return { ok: false, fieldErrors: errors };
  return { ok: true, value: { topic, name, email, congregation, message } };
}
