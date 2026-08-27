import Link from "next/link";
import { desc } from "drizzle-orm";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { db } from "@/lib/db";
import { whatsNewEntries } from "@/lib/db/schema";
import {
  getFeedbackPromptState,
  shouldShowFeedbackPrompt,
} from "@/lib/feedback-prompt";
import { FEATURES } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { FormattedDate } from "@/components/shared/formatted-date";
import { FeedbackPromptCard } from "@/components/shared/feedback-prompt-card";

// Number of What's-new entries shown in the home card.
const WHATS_NEW_HOME_LIMIT = 3;

// cachedAuth() is memoized via React cache() — calling it here after the
// layout already called it costs nothing (same request, same cached result).
// Note: auth() directly is NOT memoized in next-auth v5 beta.31; the
// layout+page each calling auth() fired the Tier-A DB SELECT twice. See
// src/lib/auth/cached-auth.ts for the empirical basis.
export default async function HomePage() {
  const session = await cachedAuth();
  const user = session!.user;

  const name = user.name ?? user.email ?? "there";
  const featuresList = user.features ?? [];
  const isAdmin = featuresList.includes(FEATURES.ADMIN_DASHBOARD);

  // Feedback prompt state — query even for no-role users (their signal is valuable).
  const promptState = await getFeedbackPromptState(user.id);
  const showFeedbackPrompt = shouldShowFeedbackPrompt(promptState);

  // What's-new entries — latest WHATS_NEW_HOME_LIMIT only; zero entries → card hidden.
  const recentWhatsNew = await db
    .select({
      id: whatsNewEntries.id,
      emoji: whatsNewEntries.emoji,
      title: whatsNewEntries.title,
      body: whatsNewEntries.body,
      publishedAt: whatsNewEntries.publishedAt,
    })
    .from(whatsNewEntries)
    .orderBy(desc(whatsNewEntries.publishedAt))
    .limit(WHATS_NEW_HOME_LIMIT);

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">
        Welcome, {name}.
      </h1>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Quick links
        </h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href="/account">Account settings</Link>
          </Button>
          {isAdmin && (
            <Button asChild variant="outline">
              <Link href="/admin">Admin dashboard</Link>
            </Button>
          )}
        </div>
      </section>

      {/* What's-new card — hidden when zero entries; shown above feedback card */}
      {recentWhatsNew.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            What&apos;s new
          </h2>
          <ul className="mt-3 space-y-3">
            {recentWhatsNew.map((entry) => (
              <li key={entry.id} className="text-sm">
                {/* XSS invariant: all content rendered as JSX text nodes */}
                {entry.emoji && <span className="mr-1">{entry.emoji}</span>}
                <span className="font-medium">{entry.title}</span>
                <p className="mt-0.5 text-muted-foreground">{entry.body}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <FormattedDate value={entry.publishedAt} mode="date" />
                </p>
              </li>
            ))}
          </ul>
          <Link
            href="/whats-new"
            className="mt-3 inline-block text-xs text-muted-foreground hover:text-foreground"
          >
            See all →
          </Link>
        </section>
      )}

      {/* Daily feedback prompt card — suppressed after snooze/submit/opt-out for today */}
      {showFeedbackPrompt && (
        <section className="mt-8">
          <FeedbackPromptCard />
        </section>
      )}
    </>
  );
}
