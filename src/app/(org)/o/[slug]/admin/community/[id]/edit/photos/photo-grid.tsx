import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PAGE_COPY } from "@/lib/person-photos/copy";
import type { PhotoSetView, PhotoTileView } from "@/lib/person-photos/types";
import { TileControls } from "./tile-controls";

/**
 * The person's photos as tiles (Copy C2): the 160 px thumbnail (inlined as a
 * `data:` URI by `reader.ts`; the CSP has no `blob:`), the chips that say what
 * the photo is chosen for, a "View larger" link (`?view=<photo id>`, the master
 * rendered by the page), and the client buttons (`TileControls`). A thumbnail
 * that could not be read renders a neutral plate that still carries the alt
 * text, so the tile and its buttons stay usable.
 *
 * The chips say "chosen for", never "showing": whether the photo is shown now
 * is the status lines' job (and the SQL's).
 */
function Chips({ photo }: { photo: PhotoTileView }) {
  if (!photo.isDirectory && !photo.isWebsite) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {photo.isDirectory && (
        <Badge variant="secondary">{photo.directoryAttested ? PAGE_COPY.chipDirectoryCleared : PAGE_COPY.chipDirectory}</Badge>
      )}
      {photo.isWebsite && <Badge variant="secondary">{PAGE_COPY.chipWebsite}</Badge>}
    </div>
  );
}

export function PhotoGrid({ slug, set }: { slug: string; set: PhotoSetView }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {set.photos.map((photo, index) => {
        const alt = PAGE_COPY.tileAlt(set.displayName, index + 1);
        return (
          <li key={photo.id} className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
            {photo.thumbSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- a data: URI of a 160 px thumbnail; next/image would proxy it
              <img
                src={photo.thumbSrc}
                alt={alt}
                width={160}
                height={160}
                className="size-40 rounded-md border bg-muted object-cover"
              />
            ) : (
              <div role="img" aria-label={alt} className="size-40 rounded-md border bg-muted" />
            )}
            <Chips photo={photo} />
            <Link
              href={`/o/${slug}/admin/community/${set.personId}/edit/photos?view=${photo.id}`}
              className="inline-flex min-h-11 items-center text-sm underline underline-offset-2"
            >
              {PAGE_COPY.viewLarger}
            </Link>
            <TileControls
              slug={slug}
              personId={set.personId}
              photoId={photo.id}
              label={alt}
              isDirectory={photo.isDirectory}
              isWebsite={photo.isWebsite}
              name={set.displayName}
              state={set.state}
            />
          </li>
        );
      })}
    </ul>
  );
}
