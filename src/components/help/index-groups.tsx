import Link from "next/link";
import { DOCUMENT_LINK_CLASS } from "@/components/shared/markdown-document";
import { entryHref } from "@/lib/help/urls";
import type { IndexGroup } from "@/lib/help/select";
import { cn } from "@/lib/utils";

/** The index: published pages grouped by audience. A group with no published page is not passed in. */
export function IndexGroups({ groups }: { groups: readonly IndexGroup[] }) {
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.audience} aria-labelledby={`help-group-${group.audience}`}>
          <h2 id={`help-group-${group.audience}`} className="text-xl font-semibold">
            {group.label}
          </h2>
          <ul className="mt-3 divide-y divide-border rounded-md border border-border">
            {group.pages.map((page) => (
              <li key={page.slug} className="p-4">
                <Link
                  href={entryHref(page)}
                  className={cn("inline-flex min-h-11 items-center text-lg", DOCUMENT_LINK_CLASS)}
                >
                  {page.title}
                </Link>
                <p className="mt-1 text-base leading-7 text-muted-foreground">{page.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
