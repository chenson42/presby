import Link from "next/link";
import { PlatformWordmark } from "@/components/brand/platform-mark";
import { Button } from "@/components/ui/button";
import { HELP_COPY } from "@/lib/help/copy";
import { HELP_INDEX_HREF } from "@/lib/help/urls";

/**
 * The public documentation shell (DECISION-293): chrome only, in the platform palette. It reads
 * no session, no headers, no cookies and no search params, so every page under it can be
 * static (`dynamic = "error"`) and the same for every reader. That is also why a signed-in
 * reader sees "Sign in": the shell cannot tell. "Open PresbyPortal" (/launch) works for both.
 * The header row wraps at 360px rather than hiding a link.
 */
// ui-ok: skip link, visible only on focus
const SKIP_LINK_CLASS = "sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:ring-2 focus:ring-ring";

export default function DocumentationLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="relative border-b border-border print:hidden">
        <a href="#help-main" className={SKIP_LINK_CLASS}>
          {HELP_COPY.skipLink}
        </a>
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
          <Link
            href="/"
            aria-label={HELP_COPY.wordmarkLabel}
            className="inline-flex min-h-11 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <PlatformWordmark heightPx={24} />
          </Link>
          <nav aria-label={HELP_COPY.headerNavLabel} className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" className="min-h-11">
              <Link href={HELP_INDEX_HREF}>{HELP_COPY.headerHelp}</Link>
            </Button>
            <Button asChild variant="outline" className="min-h-11">
              <Link href="/signin">{HELP_COPY.headerSignIn}</Link>
            </Button>
            <Button asChild className="min-h-11">
              <Link href="/launch" prefetch={false}>
                {HELP_COPY.headerOpen}
              </Link>
            </Button>
          </nav>
        </div>
      </header>
      <main
        id="help-main"
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 outline-none sm:px-6"
      >
        {children}
      </main>
    </div>
  );
}
