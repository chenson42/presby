import { HELP_CONTACT_LINE } from "@/lib/help/contact";
import { HELP_COPY, appliesToText, switchedOnText, turnOnText } from "@/lib/help/copy";
import type { HelpNeeds } from "@/lib/help/types";

/**
 * The "What you need" block at the top of an administrator page (Copy C1). Every value comes
 * from the entry; `coverage.test.ts` pins the toggle name, the default, the org-type scope and
 * `operatorEnabled` to the catalog, so this component states nothing the catalog can contradict.
 */
export function NeedsBlock({ needs }: { needs: HelpNeeds }) {
  const rows: { label: string; value: string }[] = [{ label: HELP_COPY.needsWho, value: needs.who }];
  if (needs.turnOn) {
    rows.push(
      needs.operatorEnabled
        ? { label: HELP_COPY.needsSwitchedOn, value: switchedOnText(needs.turnOn.name, HELP_CONTACT_LINE) }
        : { label: HELP_COPY.needsTurnOn, value: turnOnText(needs.turnOn.name, needs.turnOn.defaultOn) },
    );
  }
  if (needs.appliesTo) rows.push({ label: HELP_COPY.needsAppliesTo, value: appliesToText(needs.appliesTo) });

  return (
    <section aria-labelledby="help-needs-heading" className="rounded-md border border-border bg-muted/50 p-4">
      <h2 id="help-needs-heading" className="text-lg font-semibold">
        {HELP_COPY.needsHeading}
      </h2>
      <dl className="mt-3 space-y-3 text-base leading-7">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="font-semibold">{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
