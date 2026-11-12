import { DatedText } from "@/components/shared/dated-text";
import { HelpLink } from "@/components/help/help-link";
import { helpHref } from "@/lib/help/urls";
import type { LeaderLink } from "@/lib/learn/leader-link";
import { LAST_REVIEWED } from "@/lib/learn/spot-the-scam/content";
import { LEADER } from "@/lib/learn/spot-the-scam/copy";

/**
 * The leader panel on the `(org)` page (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3
 * Copy G8): where the practice can be used outside the portal. A Server Component and
 * `print:hidden`. It is read by EVERY member, so it gives no instruction a member cannot
 * follow: "whoever maintains your website" is a fact, not a request. Whether the public
 * address is live comes from `readLeaderLink` (the public route's own two steps, F442);
 * the address is `SiteUrls`-built, never a request value. The date is the content module's
 * own `LAST_REVIEWED`, rendered through `<FormattedDate>`.
 */
export function LeaderPanel({ link }: { link: LeaderLink }) {
  return (
    <section
      aria-labelledby="learn-leader-heading"
      className="space-y-3 rounded-lg border border-input bg-card p-4 text-base text-card-foreground print:hidden"
      data-testid="leader-panel"
    >
      <h2 id="learn-leader-heading" className="text-xl font-semibold">
        {LEADER.heading}
      </h2>
      {link.kind === "live" ? (
        <p data-testid="leader-live" className="[overflow-wrap:anywhere]">
          {LEADER.live(link.address)}{" "}
          <a
            href={link.href}
            className="inline-flex min-h-11 items-center text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {LEADER.openLink}
          </a>
        </p>
      ) : link.kind === "not_live" ? (
        <p data-testid="leader-not-live">{LEADER.notLive}</p>
      ) : (
        <p data-testid="leader-unknown">{LEADER.unknown}</p>
      )}
      <p>{LEADER.maintainer}</p>
      <p className="text-muted-foreground">
        <DatedText dates={[LAST_REVIEWED]} render={(date) => LEADER.lastReviewed(date)} />
      </p>
      <HelpLink href={helpHref("spot-the-scam")} className="text-foreground">
        {LEADER.helpLink}
      </HelpLink>
    </section>
  );
}
