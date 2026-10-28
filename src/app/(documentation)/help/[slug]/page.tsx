import { notFound } from "next/navigation";
import { NeedsBlock } from "@/components/help/needs-block";
import { OnThisPage } from "@/components/help/on-this-page";
import { HelpBreadcrumb, PageNav } from "@/components/help/page-nav";
import { MarkdownDocument } from "@/components/shared/markdown-document";
import { HELP_COPY } from "@/lib/help/copy";
import { loadHelpPage } from "@/lib/help/content";
import { linkContext, resolveLink } from "@/lib/help/links";
import { pageMetadata } from "@/lib/help/metadata";
import { HELP_PAGES } from "@/lib/help/registry";
import { resolveShot } from "@/lib/help/screenshots";
import { neighbours, publishedPages } from "@/lib/help/select";

// Static lock (R3): any auth(), headers(), cookies() or searchParams fails the build; a slug
// outside generateStaticParams (unknown, pending, planned, retired) is the help 404.
export const dynamic = "error";
export const dynamicParams = false;

export function generateStaticParams() {
  return publishedPages().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = publishedPages().find((p) => p.slug === slug);
  return entry ? pageMetadata(entry) : {};
}

export default async function HelpPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = loadHelpPage(slug);
  if (!page) notFound();
  const { entry, markdown } = page;
  const context = linkContext(HELP_PAGES);
  const { previous, next } = neighbours(entry.slug);

  return (
    <article className="space-y-6">
      <HelpBreadcrumb current={entry.title} />
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">{entry.title}</h1>
        <p className="text-base leading-7 text-muted-foreground">{entry.summary}</p>
      </header>
      {entry.needs ? <NeedsBlock needs={entry.needs} /> : null}
      <OnThisPage markdown={markdown} />
      <MarkdownDocument
        markdown={markdown}
        resolveLink={(href) => resolveLink(href, context)}
        resolveImage={resolveShot}
        headingBase={2}
      />
      {entry.verifiedIn ? (
        <p className="text-base leading-7 text-muted-foreground">{HELP_COPY.lastChecked(entry.verifiedIn)}</p>
      ) : null}
      <PageNav previous={previous} next={next} />
    </article>
  );
}
