import { RULES } from "@/lib/learn/spot-the-scam/content";
import { FRAME } from "@/lib/learn/spot-the-scam/copy";

/**
 * The six rules to keep (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 Copy G7).
 * A Server Component: static text, always rendered, OUTSIDE the practice island, so a
 * JavaScript failure still teaches something (F440) and so the page prints without the
 * practice (the island is `print:hidden`; this card carries no print utility and prints).
 * Nothing below `text-lg` (F441). Named with `aria-label`, not an id/`aria-labelledby` pair,
 * so a page that places the slot twice has no duplicate id (F-QA-1).
 */
export function ScamRulesCard() {
  return (
    <section aria-label={FRAME.rulesHeading} className="space-y-3 text-lg" data-testid="rules-card">
      <h2 className="text-2xl font-semibold">{FRAME.rulesHeading}</h2>
      <ol className="list-decimal space-y-3 rounded-lg border border-input bg-card py-4 pr-4 pl-10 text-card-foreground [overflow-wrap:anywhere]">
        {RULES.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ol>
    </section>
  );
}
