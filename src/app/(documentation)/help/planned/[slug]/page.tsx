import { notFound } from "next/navigation";
import Link from "next/link";
import { HelpBreadcrumb } from "@/components/help/page-nav";
import { PlannedPlaceholder } from "@/components/help/planned-placeholder";
import { DOCUMENT_LINK_CLASS } from "@/components/shared/markdown-document";
import { HELP_COPY } from "@/lib/help/copy";
import { plannedMetadata } from "@/lib/help/metadata";
import { plannedPages } from "@/lib/help/select";
import { PLANNED_INDEX_HREF } from "@/lib/help/urls";
import { cn } from "@/lib/utils";

export const dynamic = "error";
export const dynamicParams = false;

export function generateStaticParams() {
  return plannedPages().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = plannedPages().find((p) => p.slug === slug);
  return entry ? plannedMetadata(entry) : {};
}

export default async function PlannedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = plannedPages().find((p) => p.slug === slug);
  if (!entry) notFound();
  return (
    <div className="space-y-6">
      <HelpBreadcrumb current={entry.title} />
      <PlannedPlaceholder entry={entry} />
      <p>
        <Link href={PLANNED_INDEX_HREF} className={cn("inline-flex min-h-11 items-center", DOCUMENT_LINK_CLASS)}>
          {HELP_COPY.plannedAllLink}
        </Link>
      </p>
    </div>
  );
}
