import { DOCUMENT_LINK_CLASS } from "@/components/shared/markdown-document";
import { HELP_COPY } from "@/lib/help/copy";
import { extractHeadings } from "@/lib/help/headings";
import { cn } from "@/lib/utils";

/** Shown only when a page has this many h2 or h3 headings (Copy C1). */
export const ON_THIS_PAGE_MIN = 3;

/**
 * A native <details> list of the page's h2 and h3 headings, so it works with JavaScript held.
 * No `display` class on the <summary>: it breaks <details> on iOS (CLAUDE.md, Verify in a
 * Browser). The ids are `extractHeadings`', the same function the renderer's ids come from.
 */
export function OnThisPage({ markdown }: { markdown: string }) {
  const headings = extractHeadings(markdown).filter((h) => h.level === 2 || h.level === 3);
  if (headings.length < ON_THIS_PAGE_MIN) return null;
  return (
    <details className="rounded-md border border-border print:hidden">
      <summary className="min-h-11 cursor-pointer px-4 py-3 text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
        {HELP_COPY.onThisPage}
      </summary>
      <nav aria-label={HELP_COPY.onThisPage} className="px-4 pb-3">
        <ul className="space-y-1">
          {headings.map((h) => (
            <li key={h.id} className={h.level === 3 ? "pl-4" : undefined}>
              <a href={`#${h.id}`} className={cn("inline-flex min-h-11 items-center text-base", DOCUMENT_LINK_CLASS)}>
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}
