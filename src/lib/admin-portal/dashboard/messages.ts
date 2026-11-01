import "server-only";
import { sql } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";
import { readCard, rowsOf, toCount, type CardResult } from "./read-card";

/**
 * Contact messages card: how many rows are `new`. A number only; no name, address
 * or message text (E18). Index `help_contact_status_created_ix`. The table is
 * deny-all to `presby_app`, so this reads on the platform connection like every
 * card here.
 */
export interface ContactMessagesCard {
  newCount: number;
}

export function readContactMessagesCard(): Promise<CardResult<ContactMessagesCard>> {
  return readCard("contact_messages", async () => {
    const result = await getPlatformDb().execute(
      sql`select count(*)::int as new_count from help_contact_messages where status = 'new'`,
    );
    return { newCount: toCount(rowsOf(result)[0]?.new_count) };
  });
}
