import { ACTIVITY_WHO_LABEL, type ActivityItem } from "@/lib/domains/activity";
import { FormattedDate } from "@/components/shared/formatted-date";

/**
 * Recent activity: what happened to this organization's domains and who did it
 * (your team, PresbyPortal support, or an automatic check). Hostnames and a
 * category only, never an email address. An automatic primary-address change
 * reads "Primary address set automatically" (tech-lead follow-up B).
 */
export function ActivityList({ items }: { items: readonly ActivityItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="domains-activity" className="space-y-3">
      <h2 id="domains-activity" className="text-xl font-semibold">
        Recent activity
      </h2>
      <ul className="divide-y divide-border rounded-md border border-border">
        {items.map((a) => (
          <li key={a.id} className="px-3 py-3">
            <p className="text-base">{a.text}</p>
            <p className="text-sm text-muted-foreground">
              {ACTIVITY_WHO_LABEL[a.who]} · <FormattedDate value={a.at} />
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
