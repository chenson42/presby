import Link from "next/link";
import { PHOTO_COPY } from "@/lib/oversight/copy";
import type { PhotoViewedView } from "@/lib/oversight/photo-reads";
import { PhotoControls } from "./photo-controls";

/** The larger view (`?view=<photoId>`): the master, its caption, the three controls, and "Back to all photos". */
export function PhotoViewed({
  slug,
  aboutOrgId,
  buildingId,
  photosHref,
  viewed,
  isCover,
}: {
  slug: string;
  aboutOrgId: string;
  buildingId: string;
  photosHref: string;
  viewed: PhotoViewedView;
  isCover: boolean;
}) {
  return (
    <section aria-label={viewed.caption ?? "Photo"} className="space-y-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI of the stored master; next/image would proxy it */}
      <img
        src={viewed.src}
        alt={viewed.caption ?? "Photo"}
        width={viewed.width}
        height={viewed.height}
        className="h-auto max-h-[70vh] w-full rounded-md border bg-muted object-contain"
      />
      {viewed.caption ? <p className="break-words text-sm">{viewed.caption}</p> : null}
      <PhotoControls
        slug={slug}
        aboutOrgId={aboutOrgId}
        buildingId={buildingId}
        photoId={viewed.id}
        caption={viewed.caption}
        isCover={isCover}
        photosHref={photosHref}
      />
      <Link
        href={photosHref}
        className="inline-flex min-h-11 items-center text-sm underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {PHOTO_COPY.backToAll}
      </Link>
    </section>
  );
}
