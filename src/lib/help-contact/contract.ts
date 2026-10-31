/**
 * The /help/contact contract: topic keys, length bounds, field names and the
 * outcome union the island and the action share. PURE and client-safe: zero
 * imports, because the client island walks this file (H19, DECISION-304) and a
 * server import here would put the database in the browser bundle.
 *
 * docs/work-log/2026-10-31-help-contact.md, Phase 3 "API Contract".
 *
 * The topic keys repeat 0083's `help_contact_topic_allowed` CHECK and the bounds
 * repeat `help_contact_bounds`; boundaries.test.ts pins that the TypeScript and
 * the SQL agree.
 */

export const HELP_CONTACT_TOPIC_KEYS = [
  "starting_a_congregation",
  "signing_in",
  "help_page_wrong",
  "something_else",
] as const;
export type HelpContactTopic = (typeof HELP_CONTACT_TOPIC_KEYS)[number];

export type HelpContactField = "topic" | "name" | "email" | "congregation" | "message";
export type FieldCode = "required" | "too_short" | "too_long" | "bad_format";

/** Counted in characters (code points), never bytes or UTF-16 units. */
export const HELP_CONTACT_LIMITS = {
  name: 100,
  congregation: 150,
  email: 254,
  messageMin: 10,
  messageMax: 2000,
} as const;

/** The names of the form's fields. The client never supplies a status, a timestamp or an id. */
export const HELP_CONTACT_FIELDS = {
  topic: "topic",
  name: "name",
  email: "email",
  congregation: "congregation",
  message: "message",
  /** The honeypot: the DECISION-083 name, off-screen, never filled by a person. */
  honeypot: "_hp",
  turnstileToken: "turnstileToken",
} as const;

export type HelpContactOutcome =
  | { kind: "sent" }
  | { kind: "invalid"; fieldErrors: Partial<Record<HelpContactField, FieldCode>> }
  /** Turnstile refused the token. */
  | { kind: "check_failed" }
  /** Per-IP, global or database ceiling: one neutral state for all three. */
  | { kind: "busy" }
  /** Database, limiter or unexpected error. */
  | { kind: "not_sent" }
  /** A custom host, an unconfigured deployment, or EXECUTE revoked. */
  | { kind: "unavailable" };
