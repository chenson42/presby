import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { feedbackPromptState } from "@/lib/db/schema";

/**
 * Shared feedback-prompt suppression logic — commit 2 of docs/work-log/
 * 2026-08-27-product-ia-scaffold.md (Phase 3 §6b, DECISION-117). Extracted
 * from `(member)/home/page.tsx`'s own previously-inline `shouldShowFeedbackPrompt`
 * and `db.query.feedbackPromptState.findFirst(...)` read, because the
 * dismissible daily prompt card now renders in a SECOND location — the org
 * portal home (`/o/<slug>`) — and the suppression rule (opted out /
 * snoozed today / submitted today) must be identical in both places, not
 * independently re-implemented.
 *
 * `feedbackPromptState` IS PLATFORM-WIDE, KEYED BY `users.id`, NOT PER-ORG —
 * deliberately. A user who snoozes the prompt today doesn't see it again at
 * ANY org they visit today either: it's the same nudge, not two. Callers in
 * `(org)` must pass the signed-in user's own `users.id` (the same id
 * `layout.tsx`/`(member)/home/page.tsx` already use), never the org-scoped
 * `people.id` — the two are different id spaces and `feedbackPromptState`
 * only recognizes the former.
 */
export interface FeedbackPromptState {
  optedOut: boolean;
  lastSnoozedDate: string | null;
  lastSubmittedDate: string | null;
}

// Uses UTC "today" for the comparison (known write-local/read-UTC
// imprecision — see DECISION-023). Pure — unit-tested directly, ported
// verbatim from `(member)/home/page.tsx`'s prior inline copy.
export function shouldShowFeedbackPrompt(
  state: FeedbackPromptState | null,
): boolean {
  if (!state) return true; // New user — no row yet. Show the card.
  if (state.optedOut) return false;
  const today = new Date().toISOString().slice(0, 10); // UTC 'YYYY-MM-DD'
  if (state.lastSnoozedDate === today) return false;
  if (state.lastSubmittedDate === today) return false;
  return true;
}

export async function getFeedbackPromptState(
  userId: string,
): Promise<FeedbackPromptState | null> {
  const row = await db.query.feedbackPromptState.findFirst({
    where: eq(feedbackPromptState.userId, userId),
    columns: { optedOut: true, lastSnoozedDate: true, lastSubmittedDate: true },
  });
  return row ?? null;
}
