import { HelpBreadcrumb } from "@/components/help/page-nav";
import { PlannedPlaceholder } from "@/components/help/planned-placeholder";
import { HELP_COPY } from "@/lib/help/copy";
import { plannedPages } from "@/lib/help/select";

export const dynamic = "error";

// Planned pages are never a search result (R11): permanent noindex, not just the inherited one.
export const metadata = {
  title: HELP_COPY.plannedTitle,
  description: HELP_COPY.plannedIntro,
  openGraph: { title: HELP_COPY.plannedTitle, description: HELP_COPY.plannedIntro },
  robots: { index: false, follow: false },
};

export default function PlannedIndexPage() {
  const entries = [...plannedPages()].sort((a, b) => a.order - b.order);
  return (
    <div className="space-y-6">
      <HelpBreadcrumb current={HELP_COPY.plannedTitle} />
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">{HELP_COPY.plannedTitle}</h1>
        <p className="text-base leading-7">{HELP_COPY.plannedIntro}</p>
      </header>
      {entries.length === 0 ? (
        <p className="text-base leading-7">{HELP_COPY.plannedEmpty}</p>
      ) : (
        <ul className="space-y-6">
          {entries.map((entry) => (
            <li key={entry.slug} className="border-t border-border pt-4">
              <PlannedPlaceholder entry={entry} asLink />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
