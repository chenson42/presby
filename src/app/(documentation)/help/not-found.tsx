import Link from "next/link";
import { DOCUMENT_LINK_CLASS } from "@/components/shared/markdown-document";
import { HELP_COPY } from "@/lib/help/copy";
import { HELP_INDEX_HREF } from "@/lib/help/urls";
import { cn } from "@/lib/utils";

/**
 * The one 404 for every help URL that is not a published page: unknown, typo'd, retired,
 * pending and planned-under-/help/<x> all end here with the same body (a pending page must not
 * be distinguishable from a page that never existed).
 */
export default function HelpNotFound() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">{HELP_COPY.notFoundTitle}</h1>
      <p className="text-base leading-7">{HELP_COPY.notFoundBody}</p>
      <p>
        <Link href={HELP_INDEX_HREF} className={cn("inline-flex min-h-11 items-center", DOCUMENT_LINK_CLASS)}>
          {HELP_COPY.notFoundLink}
        </Link>
      </p>
    </div>
  );
}
