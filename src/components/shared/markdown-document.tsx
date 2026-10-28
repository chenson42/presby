import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HELP_COPY } from "@/lib/help/copy";
import { scanMarkdown } from "@/lib/help/markdown-scan";
import { extractHeadings } from "@/lib/help/headings";
import { cn } from "@/lib/utils";

/**
 * The shared markdown renderer (Phase 3 renderer contract, R4; /docs and the developer portal
 * reuse it). A Server Component: no I/O, no registry import. What makes it safe is what it
 * does NOT accept:
 *
 *   - no `rehypePlugins` prop and no `rehype-raw`, so raw HTML in a document renders as text;
 *   - react-markdown's default URL transform stays for every link (`javascript:` and `data:`
 *     become an empty href), and `resolveLink` is the second gate: a link it does not admit
 *     renders its text and no anchor;
 *   - an image renders only when `resolveImage` admits its source. A `shot:<id>` source is not
 *     a URL scheme the default transform would keep, so `src` alone passes through the
 *     transform untouched; `resolveImage` is then its only gate and renders nothing for a
 *     source it does not recognise (a remote or tracking-pixel source never loads).
 *
 * The type scale is the platform's own (no `prose` classes: the typography plugin would set a
 * 14px body; no `text-xs`; tokens only). Heading ids come from the same slugger as
 * `extractHeadings`, so the on-this-page list and the anchors cannot disagree.
 */
export interface MarkdownDocumentProps {
  markdown: string;
  /** null renders the link's text and no anchor. */
  resolveLink: (href: string) => { kind: "internal" | "external" | "email"; href: string } | null;
  /** null renders nothing. */
  resolveImage: (src: string) => { src: string; width: number; height: number } | null;
  /** The lowest heading level rendered: markdown "#" clamps to this; "##".."######" render h2..h6. */
  headingBase: 1 | 2;
}

// The inline text-link treatment (the platform focus-ring pattern, ui-standards.md Accessibility).
export const DOCUMENT_LINK_CLASS =
  "rounded-sm font-medium text-primary underline underline-offset-4 outline-none hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const HEADING_CLASS: Record<number, string> = {
  1: "text-2xl font-semibold",
  2: "text-xl font-semibold",
  3: "text-lg font-semibold",
  4: "text-base font-semibold",
  5: "text-base font-semibold",
  6: "text-base font-semibold",
};

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

function Heading({
  mdLevel,
  base,
  ids,
  line,
  children,
}: {
  mdLevel: number;
  base: 1 | 2;
  ids: ReadonlyMap<number, string>;
  line: number | undefined;
  children?: ReactNode;
}) {
  const level = Math.min(6, Math.max(mdLevel, base));
  const Tag = `h${level}` as HeadingTag;
  return (
    <Tag id={line === undefined ? undefined : ids.get(line)} className={cn("scroll-mt-4 pt-2", HEADING_CLASS[level])}>
      {children}
    </Tag>
  );
}

export function MarkdownDocument({ markdown, resolveLink, resolveImage, headingBase }: MarkdownDocumentProps) {
  // Heading ids by source line: both lists come from the same scan, so they align one to one.
  const scanned = scanMarkdown(markdown).headings;
  const extracted = extractHeadings(markdown);
  const idByLine = new Map<number, string>();
  scanned.forEach((h, i) => idByLine.set(h.line, extracted[i].id));

  return (
    <div className="min-w-0 space-y-4 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url, key) => (key === "src" ? url : defaultUrlTransform(url))}
        components={{
          h1: ({ node, children }) => (
            <Heading mdLevel={1} base={headingBase} ids={idByLine} line={node?.position?.start?.line}>
              {children}
            </Heading>
          ),
          h2: ({ node, children }) => (
            <Heading mdLevel={2} base={headingBase} ids={idByLine} line={node?.position?.start?.line}>
              {children}
            </Heading>
          ),
          h3: ({ node, children }) => (
            <Heading mdLevel={3} base={headingBase} ids={idByLine} line={node?.position?.start?.line}>
              {children}
            </Heading>
          ),
          h4: ({ node, children }) => (
            <Heading mdLevel={4} base={headingBase} ids={idByLine} line={node?.position?.start?.line}>
              {children}
            </Heading>
          ),
          h5: ({ node, children }) => (
            <Heading mdLevel={5} base={headingBase} ids={idByLine} line={node?.position?.start?.line}>
              {children}
            </Heading>
          ),
          h6: ({ node, children }) => (
            <Heading mdLevel={6} base={headingBase} ids={idByLine} line={node?.position?.start?.line}>
              {children}
            </Heading>
          ),
          p: ({ children }) => <p className="text-base leading-7">{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-2 pl-6 text-base leading-7">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-2 pl-6 text-base leading-7">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="space-y-2 border-l-4 border-border bg-muted/50 py-2 pl-4 pr-3 text-base leading-7">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-6 border-border" />,
          code: ({ children }) => (
            <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-sm break-words">{children}</code>
          ),
          pre: ({ children }) => (
            <pre
              tabIndex={0}
              className="overflow-x-auto rounded-md bg-muted p-4 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&>code]:bg-transparent [&>code]:p-0"
            >
              {children}
            </pre>
          ),
          a: ({ href, children }) => {
            const resolved = href ? resolveLink(href) : null;
            if (!resolved) return <>{children}</>;
            if (resolved.kind === "internal") {
              return (
                <Link href={resolved.href} className={DOCUMENT_LINK_CLASS}>
                  {children}
                </Link>
              );
            }
            if (resolved.kind === "email") {
              return (
                <a href={resolved.href} className={DOCUMENT_LINK_CLASS}>
                  {children}
                </a>
              );
            }
            return (
              <a href={resolved.href} target="_blank" rel="noreferrer noopener" className={DOCUMENT_LINK_CLASS}>
                {children}
                <span className="sr-only">{HELP_COPY.externalCue}</span>
                <ExternalLink aria-hidden="true" className="ml-1 inline size-4 align-text-bottom" />
              </a>
            );
          },
          img: ({ src, alt }) => {
            const image = typeof src === "string" ? resolveImage(src) : null;
            if (!image) return null;
            return (
              // eslint-disable-next-line @next/next/no-img-element -- never next/image: the Image SSRF advisory is open (R4)
              <img
                src={image.src}
                width={image.width}
                height={image.height}
                alt={alt ?? ""}
                loading="lazy"
                decoding="async"
                className="h-auto max-w-full rounded-md border border-border"
              />
            );
          },
          table: ({ children }) => (
            <Table
              className="text-base"
              containerProps={{
                tabIndex: 0,
                role: "region",
                "aria-label": HELP_COPY.tableLabel,
                className:
                  "rounded-md border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              }}
            >
              {children}
            </Table>
          ),
          thead: ({ children }) => <TableHeader>{children}</TableHeader>,
          tbody: ({ children }) => <TableBody>{children}</TableBody>,
          tr: ({ children }) => <TableRow>{children}</TableRow>,
          th: ({ children, style }) => (
            <TableHead style={style} className="h-auto min-w-32 py-2 align-top whitespace-normal">
              {children}
            </TableHead>
          ),
          td: ({ children, style }) => (
            <TableCell style={style} className="min-w-32 py-2 align-top whitespace-normal">
              {children}
            </TableCell>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
