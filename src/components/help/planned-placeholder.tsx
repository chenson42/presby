import Link from "next/link";
import { DOCUMENT_LINK_CLASS } from "@/components/shared/markdown-document";
import { HELP_COPY } from "@/lib/help/copy";
import { plannedEntryHref } from "@/lib/help/urls";
import type { HelpPlannedEntry } from "@/lib/help/types";
import { cn } from "@/lib/utils";

/**
 * A labelled placeholder for something PresbyPortal does not do (Phase 3 "The placeholder list").
 * It states the name, who it is for and what exists today, and nothing else: no screens, no
 * steps, no dates. This is the ONE help file where wording about the future may appear, and
 * check:help does not scan it; every entry carries the fixed label so a reader can never mistake
 * a placeholder for a feature.
 *
 * `asLink` is the list form (the name links to its own page, an h2); without it the name is the
 * page's h1.
 */
export function PlannedPlaceholder({ entry, asLink = false }: { entry: HelpPlannedEntry; asLink?: boolean }) {
  const Heading = asLink ? "h2" : "h1";
  return (
    <article className="space-y-2">
      <Heading className={asLink ? "text-xl font-semibold" : "text-2xl font-semibold"}>
        {asLink ? (
          <Link href={plannedEntryHref(entry)} className={cn("inline-flex min-h-11 items-center", DOCUMENT_LINK_CLASS)}>
            {entry.title}
          </Link>
        ) : (
          entry.title
        )}
      </Heading>
      <p className="inline-block rounded-sm border border-border bg-muted px-2 py-1 text-base">
        {HELP_COPY.plannedLabel}
      </p>
      <p className="text-base leading-7">{HELP_COPY.plannedWho(entry.forWhom)}</p>
      <p className="text-base leading-7">{HELP_COPY.plannedToday(entry.today)}</p>
    </article>
  );
}
