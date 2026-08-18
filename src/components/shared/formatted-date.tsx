"use client";

import { useEffect, useState } from "react";

type FormattedDateProps = {
  value: Date | string | number;
  mode?: "date" | "datetime";
  className?: string;
};

/**
 * A bare calendar date: 'YYYY-MM-DD', no time and no zone.
 *
 * Postgres `date` columns mean exactly this, and src/lib/authz.ts casts them to
 * text in SQL so they arrive here as this shape rather than as a Date the
 * driver invented a midnight for.
 */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Renders a date in the viewer's local timezone.
 *
 * SSR output is the ISO date slice (YYYY-MM-DD) inside a <time> element with
 * suppressHydrationWarning, so the server and client renders never mismatch.
 * After mount, useEffect replaces the visible text with the browser-local
 * formatted string via toLocaleDateString / toLocaleString.
 *
 * Use this component any time you need to display a timestamp. Never call
 * toLocale*() directly in components — an ESLint rule enforces this.
 *
 * TWO KINDS OF VALUE, AND THE DIFFERENCE IS NOT COSMETIC.
 *
 *   An INSTANT (Date, epoch, full ISO timestamp) happened at one moment
 *   everywhere, and which calendar day that was legitimately depends on where
 *   the viewer is standing. Shifting it is the point.
 *
 *   A CALENDAR DATE ('YYYY-MM-DD') has no time and no zone. "Your access ended
 *   on 31 March" is the same 31 March in Anchorage and in Berlin. Shifting it
 *   is a bug — and it was one: `new Date("2026-03-31")` parses as UTC midnight,
 *   so this component used to render "3/30/2026" for every viewer west of UTC,
 *   on the one page whose whole job is to state a date correctly. Slice A of
 *   the P0 router fixed the same defect one layer down, in SQL; this is the
 *   layer above it.
 *
 * A calendar date is therefore parsed as LOCAL midnight and always formatted
 * date-only, whatever `mode` says — there is no time in the value to render.
 */
export function FormattedDate({ value, mode = "datetime", className }: FormattedDateProps) {
  const isCalendarDate = typeof value === "string" && CALENDAR_DATE.test(value);

  let date: Date;
  if (isCalendarDate) {
    const [year, month, day] = value.split("-").map(Number);
    date = new Date(year, month - 1, day);
    // new Date(99, ...) means 1999. Years are four digits here, so re-assert.
    date.setFullYear(year);
  } else {
    date = new Date(value);
  }

  // Guard against invalid inputs (e.g. empty string, malformed ISO, NaN).
  // new Date("") and new Date("bad") produce Invalid Date; toISOString() throws
  // on them. We compute a safe isoString and ssrFallback before hooks run.
  const isValid = !isNaN(date.getTime());
  // <time datetime> accepts a bare date, and for a calendar date that is the
  // honest machine-readable value — a UTC timestamp would re-add the zone the
  // value does not have.
  const isoString = isCalendarDate
    ? value
    : isValid
      ? date.toISOString()
      : "";
  const ssrFallback = isValid ? (isCalendarDate ? value : isoString.slice(0, 10)) : "—";

  const [formatted, setFormatted] = useState<string>(ssrFallback);

  useEffect(() => {
    if (!isValid) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    // Intentional post-hydration TZ swap: setState inside useEffect is correct
    // here because we need to replace the ISO SSR fallback with the viewer's
    // locale-formatted string. This is the canonical pattern for hydration-safe
    // client-only rendering.
    if (mode === "date" || isCalendarDate) {
      setFormatted(date.toLocaleDateString());
    } else {
      setFormatted(date.toLocaleString());
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isoString, mode, isValid, isCalendarDate]);

  return (
    <time dateTime={isoString} suppressHydrationWarning className={className}>
      {formatted}
    </time>
  );
}
