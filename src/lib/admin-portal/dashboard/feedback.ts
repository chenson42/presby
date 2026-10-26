import "server-only";
import { sql } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";
import { readCard, rowsOf, toCount, type CardResult } from "./read-card";

/** Feedback card: how many rows are new. A number only; no body, category or author (E18). Index `ix_feedback_status_created`. */
export interface FeedbackCard {
  newCount: number;
}

export function readFeedbackCard(): Promise<CardResult<FeedbackCard>> {
  return readCard("feedback", async () => {
    const result = await getPlatformDb().execute(
      sql`select count(*)::int as new_count from feedback where status = 'new'`,
    );
    return { newCount: toCount(rowsOf(result)[0]?.new_count) };
  });
}
