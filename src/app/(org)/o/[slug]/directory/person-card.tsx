import Link from "next/link";
import { ChevronRight, Lock, Mail, MapPin, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { DirectoryEntry } from "@/lib/directory";
import { PersonAvatar } from "./person-avatar";

/**
 * One member's card. Extracted from `directory-grid.tsx` in Increment 3 so
 * the SAME card markup can also appear inside a household detail page's
 * member list — a single component, not two hand-copied renderings that can
 * drift apart.
 *
 * THE NAME LINKS TO `/o/<slug>/directory/<personId>` (Increment 3): the
 * members grid was the one entry point into the new person-detail route
 * that Increment 2 shipped without, since the route didn't exist yet. Only
 * the name is wrapped in a `<Link>` — the avatar stays presentational and
 * the mailto/tel links stay siblings, never nested inside another `<a>`
 * (invalid HTML; also ambiguous click targeting) — one link per card,
 * always present, distinct from the (optional) contact links.
 *
 * Contact links keep `directory-list.tsx`'s existing 44px touch-target
 * discipline (`min-h-11`); `city` is the only address fragment shown here —
 * the full street address stays the flat list's job (and the person-detail
 * page's). Household name and deacon are deliberately NOT rendered here —
 * a card's own household membership is one click away on the detail page,
 * and a household's deacon is `DeaconCard`'s job on that page, not this
 * card's.
 *
 * INCREMENT 4: `entry.isHidden` drives a lock badge, never color alone
 * (Phase 3's own UI note). Safe to check unconditionally — `entry.isHidden`
 * can only be `true` in a result set an elevated (`directory.view_hidden`)
 * caller actually requested and was granted; an ordinary caller's entries
 * never carry a hidden row at all, so no separate permission prop is needed
 * here.
 *
 * CARD HOVER TREATMENT (docs/work-log/2026-08-26-portal-fpcw-directory-ux.md
 * Phase 3, Increment 1): `hover:shadow-md transition-shadow` on the outer
 * `<Card>` — the shadow-lift ONLY, deliberately no `cursor-pointer` and no
 * full-card `hover:bg-accent` color flood. This card holds MULTIPLE
 * independent link targets (the name, `mailto:`, `tel:`) plus inert text
 * (city) — unlike `TileGrid`'s single whole-card link, `cursor-pointer` here
 * would misrepresent hovering over inert whitespace as clickable, and an
 * accent-color flood would fight the `Badge`'s own background (Phase 3 Edge
 * Cases, DECISION-099).
 *
 * CHEVRON AFFORDANCE (docs/work-log/2026-08-26-portal-ux-fixes.md, Wave 1B,
 * finding L1): a real navigable card with no visual "this goes somewhere"
 * cue read as inert. The name `<Link>` grows a trailing `ChevronRight` that
 * nudges right on hover — the SAME `group`/`group-hover:translate-x-0.5`
 * pattern `TileGrid` already established, scoped to the name's own `<Link>`
 * (not the whole `<Card>`) since this card, unlike a tile, holds sibling
 * link targets the chevron must not imply are also part of one big link.
 */
export function PersonCard({
  entry,
  photoSrc,
  slug,
}: {
  entry: DirectoryEntry;
  photoSrc: string | null;
  slug: string;
}) {
  const displayName = `${entry.preferredName ?? entry.firstName} ${entry.lastName}`;
  const city = entry.address?.city ?? null;

  return (
    <Card className="py-4 transition-shadow hover:shadow-md">
      <CardContent className="flex items-start gap-3">
        <PersonAvatar
          photoSrc={photoSrc}
          displayName={displayName}
          className="size-12"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <Link
            href={`/o/${slug}/directory/${entry.personId}`}
            className="group flex items-center gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <h3 className="min-w-0 break-words text-lg font-medium hover:underline">
              {displayName}
            </h3>
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
          {entry.isHidden && (
            <Badge variant="outline" className="gap-1">
              <Lock className="size-3" aria-hidden />
              Hidden from the directory
            </Badge>
          )}
          {entry.email && (
            <a
              href={`mailto:${entry.email}`}
              className="flex min-h-11 max-w-full items-center gap-1.5 truncate text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Mail className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              {entry.email}
            </a>
          )}
          {entry.phone && (
            <a
              href={`tel:${entry.phone}`}
              className="flex min-h-11 max-w-full items-center gap-1.5 truncate text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Phone className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              {entry.phone}
            </a>
          )}
          {city && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="size-3 shrink-0" aria-hidden />
              {city}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
