import type { ActiveEmailRow, EmailPurpose } from "./types";

/**
 * Which address a person's mail uses, by purpose (ER11, ER12, DECISION-216).
 * Pure. This file and the SQL function `presby_person_email()` (drizzle/0064)
 * are the same rule in two languages; `matrix.db.test.ts` runs the same rows
 * through both and asserts identical output. SQL is authoritative for any
 * credential (a sign-in invitation's address is read in SQL and never trusted
 * from TypeScript); this file serves UI previews and senders that already hold
 * rows read through RLS.
 */

export const EMAIL_PURPOSES = ["credential", "role", "personal"] as const satisfies readonly EmailPurpose[];

/**
 * The one shared order (ER1a). Display and "first": main first, then oldest.
 * Promotion ("promote the oldest", Q3): oldest first, whatever the label.
 * Mirrored in SQL (`presby_person_email`, the `sql.ts` fragments); a DB test
 * pins that the function body orders by exactly this.
 */
export const EMAIL_DISPLAY_ORDER_SQL = "is_primary desc, created_at, id";
export const EMAIL_PROMOTION_ORDER_SQL = "created_at, id";

/**
 * Chooses one address from `active`, which MUST be in the canonical order
 * (`is_primary desc, created_at, id`); the function never re-sorts.
 *
 *   credential  the active main, EVEN when it is `do_not_contact` (the caller
 *               acknowledges it, as the invitation path does)
 *   role        not `do_not_contact`; an active Work address first, then
 *               canonical order
 *   personal    not `do_not_contact`, label not Work (a null label counts as
 *               non-Work); canonical order
 */
export function chooseEmail(
  active: readonly ActiveEmailRow[],
  purpose: EmailPurpose,
): ActiveEmailRow | null {
  switch (purpose) {
    case "credential":
      return active.find((row) => row.isPrimary) ?? null;
    case "role": {
      const usable = active.filter((row) => !row.doNotContact);
      return usable.find((row) => row.subtype === "work") ?? usable[0] ?? null;
    }
    case "personal":
      return (
        active.find((row) => !row.doNotContact && row.subtype !== "work") ?? null
      );
    default: {
      // An unknown purpose is an error, never a silent fallback (R35).
      const never: never = purpose;
      throw new Error(`chooseEmail: unknown purpose ${String(never)}`);
    }
  }
}

/**
 * The address that becomes the main one when the current main is removed or
 * replaced and none is chosen (Q3): the first row left in canonical order.
 * `activeInOrder` is canonical; the old main is among `removedIds`, so what is
 * left is already ordered `created_at, id`. Null when nothing is left.
 */
export function nextPrimaryAfterRemoval(
  activeInOrder: readonly ActiveEmailRow[],
  removedIds: ReadonlySet<string> | readonly string[],
): ActiveEmailRow | null {
  const removed = removedIds instanceof Set ? removedIds : new Set(removedIds);
  return activeInOrder.find((row) => !removed.has(row.id)) ?? null;
}

/**
 * Orders UNSAVED rows for a client form: epoch-millisecond compare of
 * `createdAt`, then id. Only for rows the database has not ordered yet; saved
 * rows keep the order Postgres returned them in.
 */
export function sortEmailRows<T extends { id?: string; createdAt?: string; isPrimary: boolean }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    const at = a.createdAt ? Date.parse(a.createdAt) : Number.POSITIVE_INFINITY;
    const bt = b.createdAt ? Date.parse(b.createdAt) : Number.POSITIVE_INFINITY;
    if (at !== bt) return at < bt ? -1 : 1;
    return (a.id ?? "") < (b.id ?? "") ? -1 : (a.id ?? "") > (b.id ?? "") ? 1 : 0;
  });
}
