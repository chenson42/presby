/**
 * Shared types for the contact-methods module (DECISION-216). NO runtime
 * imports and no values: safe to import from a client component, the server
 * actions, the planner and the tests alike.
 */

/** The email labels a person's address may carry (ER18). A null label is shown as "Email". */
export type EmailSubtype = "personal" | "work" | "other";

/**
 * Which kind of mail an address is being chosen for (ER12):
 *   credential  a sign-in invitation: the active main address
 *   role        staff and officer role mail: an active Work address, else the main
 *   personal    giving, pastoral care, newsletters, events: never a Work address
 */
export type EmailPurpose = "credential" | "role" | "personal";

/** One row of the list an administrator submits. `id` present = an existing row. */
export interface EmailRowInput {
  id?: string;
  value: string;
  subtype: EmailSubtype | null;
  isPrimary: boolean;
  doNotContact: boolean;
}

/**
 * An active (not ended) email row, ALWAYS passed in the canonical order
 * `is_primary desc, created_at, id` as read from SQL (ER1a). The planner and
 * `chooseEmail` rely on array order and never re-sort, so microsecond ordering
 * is decided by Postgres and not by a JavaScript `Date`. `createdAt` is the
 * database's own text rendering, kept only for display and for the client's
 * `sortEmailRows`.
 */
export interface ActiveEmailRow {
  id: string;
  value: string;
  subtype: EmailSubtype | null;
  isPrimary: boolean;
  doNotContact: boolean;
  createdAt: string;
}

export type EmailRefusalReason =
  | "invalid_shape"
  | "too_long"
  | "duplicate"
  | "too_many"
  | "multiple_primary"
  | "bad_subtype"
  | "emails_changed";

export interface EmailRefusal {
  reason: EmailRefusalReason;
  /** The index in the submitted list the refusal is about, when it has one. */
  index?: number;
}

/** "Also on file for {Name}" (ER23b): at most three names, then a count. */
export interface SharedAddressNote {
  address: string;
  names: string[];
  more: number;
}

/** What a save has to tell the administrator beyond "saved". Present only when non-empty. */
export interface PersonSaveNotes {
  /** The main address was removed or replaced and another became the main (Q3). */
  promoted?: { address: string };
  shared?: SharedAddressNote[];
}
