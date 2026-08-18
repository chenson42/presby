"use client";

import { useEffect, useState } from "react";

type FormattedDateProps = {
  value: Date | string | number;
  mode?: "date" | "datetime";
  className?: string;
};

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
 */
export function FormattedDate({ value, mode = "datetime", className }: FormattedDateProps) {
  const date = new Date(value);

  // Guard against invalid inputs (e.g. empty string, malformed ISO, NaN).
  // new Date("") and new Date("bad") produce Invalid Date; toISOString() throws
  // on them. We compute a safe isoString and ssrFallback before hooks run.
  const isValid = !isNaN(date.getTime());
  const isoString = isValid ? date.toISOString() : "";
  const ssrFallback = isValid ? isoString.slice(0, 10) : "—"; // YYYY-MM-DD or dash

  const [formatted, setFormatted] = useState<string>(ssrFallback);

  useEffect(() => {
    if (!isValid) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    // Intentional post-hydration TZ swap: setState inside useEffect is correct
    // here because we need to replace the ISO SSR fallback with the viewer's
    // locale-formatted string. This is the canonical pattern for hydration-safe
    // client-only rendering.
    if (mode === "date") {
      setFormatted(date.toLocaleDateString());
    } else {
      setFormatted(date.toLocaleString());
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isoString, mode, isValid]);

  return (
    <time dateTime={isoString} suppressHydrationWarning className={className}>
      {formatted}
    </time>
  );
}
