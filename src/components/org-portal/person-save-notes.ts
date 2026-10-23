import { toast } from "sonner";
import type { PersonSaveNotes, SharedAddressNote } from "@/lib/contact-methods/types";

/** How long a "Also on file for" toast stays up (Phase 3 Copy: 10 seconds). */
export const SHARED_NOTE_DURATION_MS = 10_000;

/** `Also on file for A`, `A and B`, or `A, B and N others` (at most three names arrive; the rest are `more`). */
export function sharedNoteTitle(note: Pick<SharedAddressNote, "names" | "more">): string {
  const total = note.names.length + note.more;
  if (total <= 1) return `Also on file for ${note.names[0] ?? "someone else"}`;
  if (total === 2 && note.names.length === 2) return `Also on file for ${note.names[0]} and ${note.names[1]}`;
  const rest = total - 2;
  return `Also on file for ${note.names[0]}, ${note.names[1]} and ${rest} ${rest === 1 ? "other" : "others"}`;
}

export function sharedNoteDescription(address: string): string {
  return `${address} is saved on both records. Invitations to a shared address won't go through, because they can't tell the two people apart.`;
}

/** The save-success sentence: "Person updated." plus the promotion when one happened. */
export function savedMessage(base: string, notes: PersonSaveNotes | undefined): string {
  return notes?.promoted ? `${base} Now the main address: ${notes.promoted.address}.` : base;
}

/**
 * Raises the success toast, then one toast per shared address (the server caps
 * the list at three). Call only on an `ok` result.
 */
export function notifySaved(base: string, notes: PersonSaveNotes | undefined): void {
  toast.success(savedMessage(base, notes));
  for (const note of notes?.shared ?? []) {
    toast(sharedNoteTitle(note), {
      description: sharedNoteDescription(note.address),
      duration: SHARED_NOTE_DURATION_MS,
    });
  }
}
