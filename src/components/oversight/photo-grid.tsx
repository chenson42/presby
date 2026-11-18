import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PHOTO_COPY } from "@/lib/oversight/copy";
import type { PhotoTileView } from "@/lib/oversight/photo-reads";
import { PhotoThumb } from "./photo-thumb";

/**
 * The building's photos, oldest first: two columns at 360px, each tile a link
 * (`?view=<photoId>`) at least 44px tall whose accessible name is "View larger:
 * {caption or 'photo'}" (C14). The caption shows under the picture when there
 * is one, wrapped so a 200-character caption never scrolls the page sideways. The tile
 * that is the cover wears the word "Cover" (a badge beside the link, so the link's name
 * is unchanged and the word is not colour alone).
 */
export function PhotoGrid({ photosHref, photos }: { photosHref: string; photos: PhotoTileView[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((photo) => (
        <li key={photo.id} className="relative min-w-0">
          <Link
            href={`${photosHref}?view=${photo.id}`}
            aria-label={PHOTO_COPY.viewLarger(photo.caption)}
            className="block min-h-11 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <PhotoThumb src={photo.thumbSrc} />
            {photo.caption ? <span className="mt-1 block break-words text-sm text-muted-foreground">{photo.caption}</span> : null}
          </Link>
          {photo.isCover ? (
            <Badge variant="outline" className="pointer-events-none absolute left-1.5 top-1.5 bg-background text-foreground">
              {PHOTO_COPY.coverBadge}
            </Badge>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
