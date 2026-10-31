import Link from "next/link";
import { IndexGroups } from "@/components/help/index-groups";
import { DOCUMENT_LINK_CLASS } from "@/components/shared/markdown-document";
import { HELP_COPY } from "@/lib/help/copy";
import { indexGroups } from "@/lib/help/select";
import { PLANNED_INDEX_HREF } from "@/lib/help/urls";
import { cn } from "@/lib/utils";

// Static and session-free by construction (R3): any auth(), headers(), cookies() or
// searchParams fails `next build`. `?next=` and `?callbackUrl=` are never read.
export const dynamic = "error";

export const metadata = {
  title: HELP_COPY.indexTitle,
  description: HELP_COPY.indexIntro,
  openGraph: { title: HELP_COPY.indexTitle, description: HELP_COPY.indexIntro },
};

export default function HelpIndexPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">{HELP_COPY.indexTitle}</h1>
        <p className="text-base leading-7">{HELP_COPY.indexIntro}</p>
        <p className="text-base leading-7 text-muted-foreground">{HELP_COPY.indexNote}</p>
      </header>
      <IndexGroups groups={indexGroups()} />
      <section className="border-t border-border pt-4">
        <Link href={PLANNED_INDEX_HREF} className={cn("inline-flex min-h-11 items-center text-lg", DOCUMENT_LINK_CLASS)}>
          {HELP_COPY.plannedLinkTitle}
        </Link>
        <p className="text-base leading-7 text-muted-foreground">{HELP_COPY.plannedLinkLine}</p>
      </section>
    </div>
  );
}
