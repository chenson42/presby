import { FormattedDate } from "@/components/shared/formatted-date";

/**
 * A Copy sentence with a calendar date in it, the date rendered by
 * `<FormattedDate>` (never `toLocale*`, which the lint rule bans). Copy builds
 * these sentences as `(date: string) => string`; calling it with a sentinel and
 * splitting on the sentinel keeps the words in `copy.ts` as the single source
 * while the date itself is the timezone-safe component. A missing date renders
 * the sentence with the date left out rather than inventing one.
 *
 * Server-renderable (FormattedDate is the client island).
 */

const SENTINEL = "\u0000";

export function DateSentence({
  make,
  date,
  mode = "date",
}: {
  make: (date: string) => string;
  /** `YYYY-MM-DD` or an ISO instant; null renders the sentence around nothing. */
  date: string | null;
  mode?: "date" | "datetime";
}) {
  if (!date) return <>{make("")}</>;
  const [before = "", after = ""] = make(SENTINEL).split(SENTINEL);
  return (
    <>
      {before}
      <FormattedDate value={date} mode={mode} />
      {after}
    </>
  );
}
