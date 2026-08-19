import { Card, CardContent } from "@/components/ui/card";
import type { DirectoryEntry } from "@/lib/directory";

/**
 * Single-column card list, not a table — `[slug]/layout.tsx`'s `<main>` is
 * `max-w-4xl`, too narrow for a comfortable multi-column data table, and
 * docs/ui-standards.md's own layout table calls a "simple stacked list" a
 * Constrained-width pattern, which is what this is.
 *
 * NULL FIELDS ARE OMITTED, NEVER SHOWN EMPTY. A field is null because
 * `getDirectory()` nulled it via `person_privacy` (a real preference) or
 * because the person genuinely has no value on file — either way, rendering
 * "Email: —" or an empty label implies a UI bug, not a private field.
 */
export function DirectoryList({ entries }: { entries: DirectoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="mt-6 text-sm text-muted-foreground">
        No one is listed in the directory yet.
      </p>
    );
  }

  return (
    <ul className="mt-6 space-y-3">
      {entries.map((entry) => (
        <li key={entry.personId}>
          <DirectoryCard entry={entry} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One directory-card person. Contact links are sized to the 44×44px touch
 * target floor (`min-h-11` = 2.75rem = 44px) — WCAG 2.5.5, and this repo's
 * own `docs/ui-standards.md` Accessibility section.
 *
 * A bare `<h3>`, never `CardTitle` — docs/ui-standards.md → Page Header &
 * Typography: "Never use CardTitle for listing-card headings; use a bare
 * <h3> at the subhead role so size is controlled explicitly."
 */
function DirectoryCard({ entry }: { entry: DirectoryEntry }) {
  const displayName = `${entry.preferredName ?? entry.firstName} ${entry.lastName}`;
  const address = entry.address;
  const addressLine2 = address
    ? [address.city, address.region, address.postalCode]
        .filter((part): part is string => Boolean(part))
        .join(", ")
    : "";

  return (
    <Card className="py-4">
      <CardContent className="space-y-2">
        <h3 className="text-lg font-medium">{displayName}</h3>
        {(entry.email || entry.phone) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {entry.email && (
              <a
                href={`mailto:${entry.email}`}
                className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {entry.email}
              </a>
            )}
            {entry.phone && (
              <a
                href={`tel:${entry.phone}`}
                className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {entry.phone}
              </a>
            )}
          </div>
        )}
        {address && (
          <p className="text-sm text-muted-foreground">
            {address.line1 && <span className="block">{address.line1}</span>}
            {addressLine2 && <span className="block">{addressLine2}</span>}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
