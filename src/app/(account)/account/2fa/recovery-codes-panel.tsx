/**
 * The amber block that shows a set of recovery codes, shared by the first-enrolment
 * hand-off (`enrolment-handoff.tsx`) and the regenerate form so the two cannot drift.
 * Presentational only: it holds no state and reads nothing. The codes it is given
 * live in client memory and nowhere else (F166, DECISION-292).
 */
export function RecoveryCodesPanel({
  heading,
  headingLevel,
  intro,
  codes,
  footnote,
}: {
  heading: string;
  headingLevel: 2 | 3;
  intro: string;
  codes: string[];
  footnote?: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4">
      <Heading className="text-sm font-semibold text-amber-700 dark:text-amber-300">
        {heading}
      </Heading>
      <p className="mt-1 text-xs">{intro}</p>
      <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((c) => (
          <li key={c} className="rounded bg-background px-2 py-1">
            {c}
          </li>
        ))}
      </ul>
      {footnote && <p className="mt-3 text-xs text-muted-foreground">{footnote}</p>}
    </div>
  );
}
