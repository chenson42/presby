import type { HelpContactStatus } from "@/lib/db/domain/help-contact";

/** The status badge colours, shared by the list and the detail page. Never colour alone: the badge always carries the status word. */
export const STATUS_BADGE_CLASS: Record<HelpContactStatus, string> = {
  new: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-200",
  handled: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-200",
  spam: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};
