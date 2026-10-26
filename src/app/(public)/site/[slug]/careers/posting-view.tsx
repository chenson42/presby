import { ArrowLeft } from "lucide-react";
import { PostingDescription } from "@/components/careers/posting-description";
import { PostingMeta } from "@/components/careers/posting-meta";
import type { PublicPosting } from "@/lib/careers/contract";
import type { SiteUrls } from "@/lib/site-urls";

/**
 * One opening, as a visitor reads it (Copy P5-P7). A platform page shaped like
 * `/give` (docs/work-log/2026-10-25-careers-inc1.md, D2): the church's brand colours
 * and fonts through the cascade, a back link, and NO site menu or footer.
 *
 * `backHref` is the "All job openings" target, chosen by `careersBackTarget`
 * (the first page carrying the slot, else the platform list, else the site home);
 * the caller computes it so this component stays a pure function of its props.
 * Every href is `urls.*()` or `backHref` - no id, no query string.
 *
 * There is no apply form in this increment: an open posting says how to contact
 * the church, and the phone clause appears only when the profile has a phone. A
 * closed posting shows its title and nothing else the definer returned (it
 * projects `slug` and `title` only).
 */

const LINK =
  "inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function BackToSite({ organizationName, urls }: { organizationName: string; urls: Pick<SiteUrls, "home"> }) {
  return (
    <a href={urls.home()} className={LINK}>
      <ArrowLeft className="mr-1 size-4" aria-hidden />
      Back to {organizationName}
    </a>
  );
}

export function OpenPostingView({
  organizationName,
  contactPhone,
  posting,
  urls,
  backHref,
}: {
  organizationName: string;
  contactPhone: string | null;
  posting: PublicPosting;
  urls: Pick<SiteUrls, "home">;
  backHref: string;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <nav aria-label="Job openings" className="flex flex-col sm:flex-row sm:flex-wrap sm:gap-x-6">
        <BackToSite organizationName={organizationName} urls={urls} />
        <a href={backHref} className={LINK}>
          All job openings
        </a>
      </nav>

      <article className="space-y-6">
        <header className="space-y-3">
          <h1 className="text-3xl font-semibold [overflow-wrap:anywhere]">{posting.title}</h1>
          <PostingMeta posting={posting} />
        </header>

        <PostingDescription body={posting.descriptionMd} />

        <section aria-labelledby="how-to-apply" data-testid="how-to-apply" className="space-y-2 border-t border-border pt-6">
          <h2 id="how-to-apply" className="text-2xl font-semibold">
            How to apply
          </h2>
          <p className="text-base [overflow-wrap:anywhere]">
            To apply, please contact {organizationName}.{" "}
            {contactPhone ? (
              <>
                You can reach us at {contactPhone}, or through the contact details on{" "}
                <a href={urls.home()} className="text-primary underline underline-offset-4">
                  our website
                </a>
                .
              </>
            ) : (
              <>
                You can reach us through the contact details on{" "}
                <a href={urls.home()} className="text-primary underline underline-offset-4">
                  our website
                </a>
                .
              </>
            )}
          </p>
        </section>
      </article>
    </div>
  );
}

export function ClosedPostingView({
  organizationName,
  title,
  urls,
  backHref,
}: {
  organizationName: string;
  title: string;
  urls: Pick<SiteUrls, "home">;
  backHref: string;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <BackToSite organizationName={organizationName} urls={urls} />
      <section data-testid="posting-closed" className="space-y-3">
        <h1 className="text-3xl font-semibold [overflow-wrap:anywhere]">{title}</h1>
        <p className="text-base">This position is no longer accepting applications.</p>
        <a
          href={backHref}
          className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          See other job openings
        </a>
      </section>
    </div>
  );
}
