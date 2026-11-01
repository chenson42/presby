import type { ReactNode } from "react";
import { HELP_COPY } from "@/lib/help/copy";
import { HELP_REPOSITORY_URL } from "@/lib/help/contact";
import { HELP_CONTACT_EXIT_COPY as EXIT } from "@/lib/help-contact/copy";
import { cn } from "@/lib/utils";

/**
 * The shared exit block (Phase 3 Copy C, FC9). Presentational: no hooks, no state, so the static
 * page (`page.tsx`, a Server Component) and the client island both render it. It is the way out
 * when the form cannot be used, so a visitor is never left at a dead end: under the unavailable
 * heading, under the "check didn't load" note, under the busy outcome, and inside `<noscript>`.
 *
 * Imports the pure help strings and `HELP_REPOSITORY_URL` only. It does NOT import
 * `DOCUMENT_LINK_CLASS` from markdown-document.tsx, because the client island renders this file
 * and that module would drag react-markdown into the browser bundle. The class is repeated
 * here and `contact-exit.test.tsx` pins that it equals the original.
 */
export const EXIT_LINK_CLASS =
  "rounded-sm font-medium text-primary underline underline-offset-4 outline-none hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function ContactExit({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-2 text-base leading-7", className)} data-testid="contact-exit">
      <p>{EXIT.line1}</p>
      <p>
        {EXIT.line2Lead}
        <a href={HELP_REPOSITORY_URL} target="_blank" rel="noreferrer noopener" className={cn("inline-block min-h-6", EXIT_LINK_CLASS)}>
          {EXIT.line2LinkText}
          <span className="sr-only">{HELP_COPY.externalCue}</span>
        </a>
        {EXIT.line2Tail}
      </p>
    </div>
  );
}

/** A status block with a visible heading, used for the unavailable state. Never colour alone. */
export function ContactUnavailable(): ReactNode {
  return (
    <section aria-labelledby="contact-unavailable-heading" className="space-y-3 rounded-lg border border-border p-4" data-testid="contact-unavailable">
      <h2 id="contact-unavailable-heading" className="text-xl font-semibold">
        {EXIT.unavailableHeading}
      </h2>
      <p className="text-base leading-7">{EXIT.unavailableBody}</p>
      <ContactExit />
    </section>
  );
}
