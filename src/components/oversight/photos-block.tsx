import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PHOTO_COPY } from "@/lib/oversight/copy";
import type { BuildingCoverView } from "@/lib/oversight/photo-reads";
import { PhotoThumb } from "./photo-thumb";
import { SectionFrame } from "./section-frame";
import { SectionLoadError } from "./section-load-error";
import type { SectionState } from "./section-state";

/**
 * The "Photos" block on a building's page (C14): the cover and "All photos ({n})",
 * or "Add a photo" when there is none. Both links go to the photos page, where the
 * upload lives. A load error is the section's own error, the rest of the page stays up.
 * (No Locked state: the building itself is tier 1, the same key.)
 */
export function PhotosBlock({
  photosHref,
  pageHref,
  state,
}: {
  photosHref: string;
  /** This page, for "Try again". */
  pageHref: string;
  state: SectionState<BuildingCoverView | null>;
}) {
  const cover = state.kind === "ok" ? state.data : null;
  const action =
    state.kind === "ok" && cover === null ? (
      <Button asChild variant="outline" className="min-h-11">
        <Link href={photosHref}>{PHOTO_COPY.addPhoto}</Link>
      </Button>
    ) : undefined;
  return (
    <SectionFrame id="photos" title={PHOTO_COPY.blockHeading} action={action}>
      {state.kind === "error" ? <SectionLoadError href={pageHref} /> : null}
      {cover ? (
        <div className="flex items-center gap-4">
          <PhotoThumb src={cover.thumbSrc} size="cover" />
          <Link
            href={photosHref}
            className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {PHOTO_COPY.allPhotos(cover.count)}
          </Link>
        </div>
      ) : null}
    </SectionFrame>
  );
}
