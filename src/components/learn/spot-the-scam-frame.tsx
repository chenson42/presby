import { ScamRulesCard } from "./scam-rules-card";
import { ScamTrainer } from "./scam-trainer";
import { FRAME } from "@/lib/learn/spot-the-scam/copy";

/**
 * The shared frame around the practice, rendered identically by the public route, the
 * live slot and the (org) page (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 "The
 * frame"). Order, top to bottom: lede; made-up-church line; privacy line; leader note;
 * the "Practice" heading; a <noscript> line; the island; the rules card.
 *
 * The rules card is OUTSIDE the island and always rendered (F440). The `<noscript>`
 * line, every sentence and the headings are server-rendered text, so with JavaScript off
 * the first message and the rules still read. The page that hosts the frame owns the
 * `h1` (a slot's host page, the route, the (org) page); the frame starts at `h2`.
 * A Server Component: it names no URL, no organization and no toggle state. The two
 * sections are named with `aria-label` (the heading's own copy), not an id/`aria-labelledby`
 * pair: a site bundle may place the slot twice, and a fixed id would then appear twice
 * (F-QA-1).
 */
export function SpotTheScamFrame() {
  return (
    <div className="space-y-8 text-lg" data-testid="spot-the-scam-frame">
      <div className="space-y-4">
        <p>{FRAME.lede}</p>
        <p>{FRAME.madeUpChurch}</p>
        <p>{FRAME.privacy}</p>
        <p className="print:hidden">{FRAME.leaderNote}</p>
      </div>
      <section aria-label={FRAME.practiceHeading} className="space-y-4">
        <h2 className="text-2xl font-semibold print:hidden">{FRAME.practiceHeading}</h2>
        <noscript>
          <p className="mb-4 rounded-lg border border-input bg-muted p-4 text-muted-foreground">{FRAME.noscript}</p>
        </noscript>
        <ScamTrainer />
      </section>
      <ScamRulesCard />
    </div>
  );
}
