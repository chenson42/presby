import Link from "next/link";
import { DOCUMENT_LINK_CLASS } from "@/components/shared/markdown-document";
import { HELP_COPY } from "@/lib/help/copy";
import { HELP_INDEX_HREF, entryHref } from "@/lib/help/urls";
import { cn } from "@/lib/utils";

interface NavTarget {
  slug: string;
  title: string;
}

const NAV_LINK = cn("inline-flex min-h-11 items-center", DOCUMENT_LINK_CLASS);

/** "Help" > current page title. The current page is plain text with aria-current. */
export function HelpBreadcrumb({ current }: { current?: string }) {
  return (
    <nav aria-label={HELP_COPY.breadcrumbLabel} className="print:hidden">
      <ol className="flex flex-wrap items-center gap-x-2 text-base">
        <li>
          <Link href={HELP_INDEX_HREF} className={NAV_LINK}>
            {HELP_COPY.breadcrumbHelp}
          </Link>
        </li>
        {current ? (
          <li aria-current="page" className="text-muted-foreground">
            <span aria-hidden="true">/ </span>
            {current}
          </li>
        ) : null}
      </ol>
    </nav>
  );
}

/** Previous and next within the page's audience group, then the way back to the index. */
export function PageNav({ previous, next }: { previous: NavTarget | null; next: NavTarget | null }) {
  return (
    <nav aria-label={HELP_COPY.pageNavLabel} className="space-y-2 border-t border-border pt-4 print:hidden">
      {previous || next ? (
        <ul className="flex flex-col gap-1 sm:flex-row sm:justify-between">
          <li>
            {previous ? (
              <Link href={entryHref(previous)} rel="prev" className={NAV_LINK}>
                {HELP_COPY.previous(previous.title)}
              </Link>
            ) : null}
          </li>
          <li>
            {next ? (
              <Link href={entryHref(next)} rel="next" className={NAV_LINK}>
                {HELP_COPY.next(next.title)}
              </Link>
            ) : null}
          </li>
        </ul>
      ) : null}
      <p>
        <Link href={HELP_INDEX_HREF} className={NAV_LINK}>
          {HELP_COPY.backToIndex}
        </Link>
      </p>
    </nav>
  );
}
