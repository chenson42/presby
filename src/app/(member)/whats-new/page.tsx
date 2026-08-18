import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { whatsNewEntries } from "@/lib/db/schema";
import { FormattedDate } from "@/components/shared/formatted-date";

// No permission gate — any authenticated user (member layout handles the auth
// redirect via cachedAuth() in (member)/layout.tsx).

export default async function WhatsNewPage() {
  const entries = await db
    .select({
      id: whatsNewEntries.id,
      emoji: whatsNewEntries.emoji,
      title: whatsNewEntries.title,
      body: whatsNewEntries.body,
      publishedAt: whatsNewEntries.publishedAt,
    })
    .from(whatsNewEntries)
    .orderBy(desc(whatsNewEntries.publishedAt));

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">What&apos;s new</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Recent updates and improvements.
      </p>

      {entries.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No updates yet — check back soon.
          </p>
        </div>
      ) : (
        <ul className="mt-8 space-y-6">
          {entries.map((entry) => (
            <li key={entry.id} className="border-b border-border pb-6 last:border-b-0">
              {/* XSS invariant: all content rendered as JSX text nodes — no dangerouslySetInnerHTML */}
              <div className="flex items-center gap-2">
                {entry.emoji && (
                  <span className="text-xl" aria-hidden="true">
                    {entry.emoji}
                  </span>
                )}
                <h2 className="text-base font-semibold">{entry.title}</h2>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{entry.body}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                <FormattedDate value={entry.publishedAt} mode="date" />
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
