import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { DirectoryEntry } from "@/lib/directory";
import { resolvePhotoSrc } from "./person-avatar";
import { PersonCard } from "./person-card";

/**
 * `org_portal.directory_v2`'s ON path: a card grid with a search box, in
 * place of `directory-list.tsx`'s single-column list. A plain, unstyled GET
 * `<form>` — no client component, no debounce timer, no fetch. Typing does
 * nothing until Enter/Search is pressed; the browser's native GET-form
 * behavior does the "RSC round trip" the Phase 2 ruling asked for (stay
 * RSC + `searchParams`, no new API route) with zero client JS. `search`
 * itself is executed entirely inside `getDirectory()`'s SQL — this
 * component only renders what it is handed.
 *
 * AN ASYNC SERVER COMPONENT, not a plain function, so every card's photo
 * can resolve through `resolvePhotoSrc()` (DECISION-030) in one
 * `Promise.all()` before the grid ever renders — see `person-avatar.tsx`'s
 * header for why the resolution step is a plain async function rather than
 * one async component per card. Tested the same way `directory/page.tsx`
 * already is: call `await DirectoryGrid(props)` directly, then hand the
 * resolved element to `render()`.
 *
 * TWO DISTINCT EMPTY STATES, deliberately not collapsed (mirrors
 * `directory-states.tsx`'s own "don't collapse" discipline):
 *   - a brand-new/zero-member directory (no search typed): a product-state
 *     message.
 *   - a search that matched nobody: a search-specific message that names
 *     the query back, so the member knows their search WAS applied, not
 *     silently ignored.
 *
 * `PersonCard` (Increment 3) moved to its own file so the exact same card
 * markup can also render inside a household detail page's member list —
 * see `person-card.tsx`'s own header.
 */
export async function DirectoryGrid({
  entries,
  organizationId,
  search,
  orgName,
  slug,
}: {
  entries: DirectoryEntry[];
  organizationId: string;
  search: string;
  orgName: string;
  slug: string;
}) {
  const photoSrcs = await Promise.all(
    entries.map((entry) => resolvePhotoSrc(organizationId, entry.photoKey)),
  );

  return (
    <div className="mt-6 space-y-6">
      <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="directory-search" className="text-sm">
            Search the directory
          </Label>
          <Input
            id="directory-search"
            name="search"
            type="search"
            defaultValue={search}
            placeholder="Name, email, or phone"
            className="mt-1 min-h-11"
          />
        </div>
        <Button type="submit" className="min-h-11 sm:w-auto">
          Search
        </Button>
      </form>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        Showing {entries.length} {entries.length === 1 ? "member" : "members"}
      </p>

      {entries.length === 0 ? (
        <EmptyState search={search} orgName={orgName} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((entry, i) => (
            <PersonCard
              key={entry.personId}
              entry={entry}
              photoSrc={photoSrcs[i] ?? null}
              slug={slug}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ search, orgName }: { search: string; orgName: string }) {
  if (search) {
    return (
      <p className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
        No matches for &ldquo;{search}&rdquo;. Try a different name, email,
        or phone number.
      </p>
    );
  }

  return (
    <p className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
      No one is listed in {orgName}&apos;s directory yet.
    </p>
  );
}
