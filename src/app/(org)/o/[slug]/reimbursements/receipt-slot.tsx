"use client";

/**
 * THE RECEIPT SLOT - the one bounded place Batch 2b fills in.
 *
 * Receipt upload and serving wait on F289's `store({ audience })` adapter, so
 * this batch ships the request form WITHOUT a picker: `RECEIPTS_AVAILABLE` is
 * false, the form (`request-form.tsx`) renders `<ReceiptSlot>` only when it is
 * true, and everything else about receipts on the form - the `Receipts` label,
 * the `I can't attach a receipt` checkbox and its hint, the "add a receipt or
 * tick the box" check at Send - is live now. Until 2b, then, a request can be
 * sent only with the box ticked (the design makes submission impossible without
 * a receipt or the claim; the claim is the only way to express it today).
 *
 * BATCH 2b: replace this file's body, set `RECEIPTS_AVAILABLE = true`, and keep
 * the props below. Nothing else in the form changes.
 *
 * The contract the form honours:
 *  - `ensureDraft()` saves the form's current entries and resolves the request's
 *    `{ requestId, revision }`, or `null` when the save failed (the form has
 *    already shown why). A receipt belongs to a request, so the picker must call
 *    it before the first upload on a brand-new form. It is idempotent: the same
 *    form's draft is created once.
 *  - Every attach and every detach moves the request's `revision` by exactly
 *    one (P3-8), and the next save must carry the new one. `onChange` reports
 *    the whole current list AND the revision the database now holds; the form
 *    stores both. The upload route's documented response has NO revision
 *    (`{ attachmentId, displayName, byteSize, contentType }`), so 2b must add it
 *    to the response (or the slot must re-read the detail) - otherwise the next
 *    Save answers `changed_since_viewed`.
 *  - `error` is the form's message for the `receipts` field (shown by the form
 *    under the section; the slot need not render it).
 *  - `disabled` is true while the form is saving or sending.
 *  - Upload failures use `COPY.receipts.*` (C4, already in copy.ts).
 *  - NO `capture` attribute on the file input (a tripwire, T3, will check).
 */

export const RECEIPTS_AVAILABLE = false;

export interface ReceiptItem {
  id: string;
  displayName: string;
  contentType: "image/jpeg" | "application/pdf";
  byteSize: number;
}

export interface ReceiptSlotProps {
  slug: string;
  /** The request's id once it exists; null on a brand-new form. */
  requestId: string | null;
  receipts: ReceiptItem[];
  disabled: boolean;
  error?: string;
  /** Saves the form's entries if needed and returns the request's id and revision, or null on failure. */
  ensureDraft: () => Promise<{ requestId: string; revision: number } | null>;
  /** Report the whole current list and the revision the database now holds. */
  onChange: (next: { receipts: ReceiptItem[]; revision: number }) => void;
}

export function ReceiptSlot(_props: ReceiptSlotProps) {
  return null;
}
