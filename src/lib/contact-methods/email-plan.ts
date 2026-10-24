import { EMAIL_MAX, MAX_ACTIVE_EMAILS, isEmailSubtype, isValidEmailShape, normalizeEmail } from "./normalize";
import { nextPrimaryAfterRemoval } from "./email-routing";
import type { ActiveEmailRow, EmailRefusal, EmailRowInput, EmailSubtype } from "./types";

/**
 * The pure planner (D3): turns "the list the administrator submitted" into the
 * minimal set of writes, so every rule about which row ends, relabels, inserts,
 * demotes or is promoted is exhaustively testable without a database.
 * `store.ts` only EXECUTES a plan.
 *
 * Rules (ER1e, ER19a, D5):
 *   - A blank NEW row is dropped; a blank EXISTING row is `invalid_shape` (the
 *     Remove button is the way to remove).
 *   - An existing row with the same normalized value changes in place, and only
 *     its label, its `do_not_contact` flag and whether it is the main one.
 *   - An existing row with a DIFFERENT value is ended and a new row is inserted
 *     carrying what the form submitted for that row (label, flag, main state).
 *     `verified_at` never travels: the store never writes it.
 *   - An existing id that is not submitted is ended.
 *   - Two or more submitted mains is `multiple_primary`. With none flagged, the
 *     old main stays if it is kept; otherwise the oldest remaining existing row
 *     becomes the main (`nextPrimaryAfterRemoval`), else the first new row.
 *     That is `automatic: true`.
 *
 * `active` is the person's active rows in the canonical order (ER1a).
 */

export interface EmailPlanEnd {
  id: string;
  subtype: EmailSubtype | null;
  wasPrimary: boolean;
  /** Index into `insert` of the row that replaces this one, if it is a replacement. */
  replacedByInsert?: number;
}

export interface EmailPlanInsert {
  value: string;
  subtype: EmailSubtype | null;
  isPrimary: boolean;
  doNotContact: boolean;
  /** The ended row this one replaces (a changed address), if any. */
  replacesId?: string;
}

export interface EmailPlanRelabel {
  id: string;
  subtype: EmailSubtype | null;
  doNotContact: boolean;
  fields: Array<"subtype" | "doNotContact">;
}

export interface EmailPlanPrimary {
  /** The old main's row id; null when the person had no active main. */
  fromId: string | null;
  /** The final main when it is an existing row (kept, relabelled or promoted). */
  toExistingId: string | null;
  /** The final main when it is a NEW row: its index in `insert`. */
  toInsertIndex: number | null;
  /** True when the planner chose it (Q3), false when the administrator flagged it. */
  automatic: boolean;
}

export interface EmailPlan {
  end: EmailPlanEnd[];
  /** Kept rows that lose the main flag. */
  demote: string[];
  relabel: EmailPlanRelabel[];
  insert: EmailPlanInsert[];
  /** Zero or one existing row that gains the main flag. */
  promote: string[];
  /** Null when no address remains active. */
  primary: EmailPlanPrimary | null;
  changed: boolean;
}

export type EmailPlanResult =
  | { kind: "plan"; plan: EmailPlan }
  | { kind: "refused"; refusal: EmailRefusal };

interface Kept {
  /** Position in the submitted list. */
  index: number;
  id?: string;
  value: string;
  subtype: EmailSubtype | null;
  isPrimary: boolean;
  doNotContact: boolean;
}

function refuse(reason: EmailRefusal["reason"], index?: number): EmailPlanResult {
  return { kind: "refused", refusal: index === undefined ? { reason } : { reason, index } };
}

export function planEmailSave(
  active: readonly ActiveEmailRow[],
  submitted: readonly EmailRowInput[],
): EmailPlanResult {
  const byId = new Map(active.map((row) => [row.id, row]));
  const kept: Kept[] = [];
  const seenIds = new Set<string>();

  // --- per-row validation, in submitted order --------------------------------
  for (let index = 0; index < submitted.length; index += 1) {
    const row = submitted[index]!;
    const value = normalizeEmail(typeof row.value === "string" ? row.value : "");
    const existing = row.id !== undefined ? byId.get(row.id) : undefined;
    if (row.id !== undefined && !existing) return refuse("emails_changed", index);
    if (row.id !== undefined) {
      if (seenIds.has(row.id)) return refuse("duplicate", index);
      seenIds.add(row.id);
    }
    if (value === "") {
      if (existing) return refuse("invalid_shape", index);
      continue; // a blank new row is dropped
    }
    if (value.length > EMAIL_MAX) return refuse("too_long", index);
    if (!isValidEmailShape(value)) return refuse("invalid_shape", index);
    if (row.subtype !== null && !isEmailSubtype(row.subtype)) return refuse("bad_subtype", index);
    kept.push({
      index,
      id: row.id,
      value,
      subtype: row.subtype,
      isPrimary: row.isPrimary === true,
      doNotContact: row.doNotContact === true,
    });
  }

  if (kept.length > MAX_ACTIVE_EMAILS) return refuse("too_many");

  const seenValues = new Set<string>();
  for (const row of kept) {
    if (seenValues.has(row.value)) return refuse("duplicate", row.index);
    seenValues.add(row.value);
  }

  const flagged = kept.filter((row) => row.isPrimary);
  if (flagged.length > 1) return refuse("multiple_primary", flagged[1]!.index);

  // --- classify -------------------------------------------------------------
  const end: EmailPlanEnd[] = [];
  const insert: EmailPlanInsert[] = [];
  const relabelDraft: EmailPlanRelabel[] = [];
  /** Per kept row: which final-state identity it has. */
  type Final = { type: "existing"; id: string } | { type: "insert"; index: number };
  const finalOf = new Map<Kept, Final>();

  for (const row of kept) {
    const old = row.id !== undefined ? byId.get(row.id) : undefined;
    if (old && old.value === row.value) {
      finalOf.set(row, { type: "existing", id: old.id });
      const fields: EmailPlanRelabel["fields"] = [];
      if (old.subtype !== row.subtype) fields.push("subtype");
      if (old.doNotContact !== row.doNotContact) fields.push("doNotContact");
      if (fields.length > 0) {
        relabelDraft.push({ id: old.id, subtype: row.subtype, doNotContact: row.doNotContact, fields });
      }
    } else {
      const insertIndex = insert.length;
      insert.push({
        value: row.value,
        subtype: row.subtype,
        isPrimary: false, // settled below
        doNotContact: row.doNotContact,
        ...(old ? { replacesId: old.id } : {}),
      });
      finalOf.set(row, { type: "insert", index: insertIndex });
      if (old) {
        end.push({ id: old.id, subtype: old.subtype, wasPrimary: old.isPrimary, replacedByInsert: insertIndex });
      }
    }
  }
  // Existing rows not submitted at all are removed.
  for (const old of active) {
    if (!seenIds.has(old.id)) {
      end.push({ id: old.id, subtype: old.subtype, wasPrimary: old.isPrimary });
    }
  }

  // --- the main address -----------------------------------------------------
  const oldMain = active.find((row) => row.isPrimary) ?? null;
  const endedIds = new Set(end.map((e) => e.id));

  let finalMain: Final | null = null;
  let automatic = false;
  if (kept.length > 0) {
    if (flagged.length === 1) {
      finalMain = finalOf.get(flagged[0]!)!;
    } else {
      automatic = true;
      if (oldMain && !endedIds.has(oldMain.id)) {
        finalMain = { type: "existing", id: oldMain.id };
      } else {
        const keptExistingIds = new Set(
          kept.flatMap((row) => {
            const f = finalOf.get(row)!;
            return f.type === "existing" ? [f.id] : [];
          }),
        );
        const removedOrReplaced = new Set(active.filter((row) => !keptExistingIds.has(row.id)).map((row) => row.id));
        const next = nextPrimaryAfterRemoval(active, removedOrReplaced);
        if (next) {
          finalMain = { type: "existing", id: next.id };
        } else {
          // No existing row survives: the first NEW row, in submitted order.
          finalMain = kept.map((row) => finalOf.get(row)!).find((f) => f.type === "insert") ?? null;
        }
      }
    }
  }

  const demote: string[] = [];
  const promote: string[] = [];
  if (finalMain?.type === "insert") insert[finalMain.index]!.isPrimary = true;
  if (oldMain && !endedIds.has(oldMain.id)) {
    // The old main is kept; it stays the main only if it is the final main.
    if (!(finalMain?.type === "existing" && finalMain.id === oldMain.id)) demote.push(oldMain.id);
  }
  if (finalMain?.type === "existing" && !(oldMain && finalMain.id === oldMain.id)) {
    promote.push(finalMain.id);
  }

  const primary: EmailPlanPrimary | null = finalMain
    ? {
        fromId: oldMain?.id ?? null,
        toExistingId: finalMain.type === "existing" ? finalMain.id : null,
        toInsertIndex: finalMain.type === "insert" ? finalMain.index : null,
        automatic,
      }
    : null;

  const plan: EmailPlan = {
    end,
    demote,
    relabel: relabelDraft,
    insert,
    promote,
    primary,
    changed:
      end.length > 0 ||
      demote.length > 0 ||
      relabelDraft.length > 0 ||
      insert.length > 0 ||
      promote.length > 0,
  };
  return { kind: "plan", plan };
}

/**
 * Whether the plan changes WHICH row is the main one in a way that deserves a
 * `primary_changed` audit row: there was a main, there is one now, and it is a
 * different row (ER20; a replaced main counts, because the row id changed).
 */
export function primaryChanged(plan: EmailPlan): boolean {
  const p = plan.primary;
  if (!p || p.fromId === null) return false;
  return p.toInsertIndex !== null || p.toExistingId !== p.fromId;
}
