import { Fragment, type ReactNode } from "react";
import { FormattedDate } from "./formatted-date";

/**
 * A sentence from a pure copy module with its dates rendered by
 * `<FormattedDate>`, so the visible text is timezone-safe (CLAUDE.md, Key
 * Invariants; ESLint bans `toLocale*()`) and the sentence itself is never
 * retyped in a component.
 *
 * The copy modules take dates as already-formatted strings. `DatedText` hands
 * `render` one private-use placeholder per date, takes back the finished
 * sentence, and splits it on the placeholders, putting a `<FormattedDate>`
 * where each one stood. A server component and a client component can both use
 * it: it holds no state and runs no effect (only `FormattedDate` does).
 *
 *   <DatedText dates={[sentAt]} render={(sent) => marker(sent)} />
 */
const OPEN = "";
const CLOSE = "";
const PLACEHOLDER = new RegExp(`${OPEN}(\\d+)${CLOSE}`);

export function DatedText({
  dates,
  render,
  mode = "date",
}: {
  dates: ReadonlyArray<Date | string>;
  render: (...placeholders: string[]) => string;
  mode?: "date" | "datetime";
}): ReactNode {
  const text = render(...dates.map((_, i) => `${OPEN}${i}${CLOSE}`));
  const parts = text.split(PLACEHOLDER);
  return (
    <>
      {parts.map((part, i) => {
        // `split` with one capture group alternates text, index, text, index...
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        const value = dates[Number(part)];
        return value === undefined ? null : <FormattedDate key={i} value={value} mode={mode} />;
      })}
    </>
  );
}
