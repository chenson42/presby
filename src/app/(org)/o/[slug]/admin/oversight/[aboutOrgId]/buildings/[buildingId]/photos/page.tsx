import { notFound } from "next/navigation";
import { BackLink } from "@/components/oversight/back-link";
import { LockedPage } from "@/components/oversight/locked-page";
import { PhotoGrid } from "@/components/oversight/photo-grid";
import { PhotoUploadIsland } from "@/components/oversight/photo-upload-island";
import { PhotoViewed } from "@/components/oversight/photo-viewed";
import { isUuid } from "@/lib/is-uuid";
import { PHOTO_COPY, PHOTO_REFUSAL } from "@/lib/oversight/copy";
import { readBuildingPhotos } from "@/lib/oversight/photo-reads";
import { gateOversightPage } from "@/lib/presbytery-reports/gate";
import { OversightGateStateView } from "../../../../oversight-gate-state";
import { OversightLoadError } from "../../../../oversight-states";
import { openRecord, settle } from "../../../../record-front-door";

/**
 * `.../oversight/<aboutOrgId>/buildings/<buildingId>/photos`: a building's photos
 * (C14, tier 1, `congregation_oversight.manage`): a two-column grid of thumbnails
 * (oldest first), "Add a photo", and, for `?view=<photoId>`, one photo's master
 * with its caption, "Edit caption", "Make this the cover" and "Remove photo".
 *
 * ORDER, as everywhere in this tree: `gateOversightPage`, `isUuid` on every id
 * segment (`openRecord`), the either-key front door, then the one reader. A
 * `?view=` that is not a UUID is ignored; one that is a UUID is only honoured
 * when the reader finds it among THIS building's live photos. At the cap the
 * upload is replaced by the cap sentence. NO `loading.tsx` here: the page calls
 * `notFound()`.
 */
export default async function BuildingPhotosPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; aboutOrgId: string; buildingId: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { slug, aboutOrgId, buildingId } = await params;
  const { view } = await searchParams;
  const viewPhotoId = typeof view === "string" && isUuid(view) ? view : null;
  const buildingHref = `/o/${slug}/admin/oversight/${aboutOrgId}/buildings/${buildingId}`;
  const photosHref = `${buildingHref}/photos`;

  const gate = await gateOversightPage({ slug, path: viewPhotoId ? `${photosHref}?view=${viewPhotoId}` : photosHref });
  if (!gate.ok) return <OversightGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  const opened = await openRecord(identity, slug, [aboutOrgId, buildingId]);
  if (!opened.ok) return opened.view;
  const recordHref = `/o/${slug}/admin/oversight/${aboutOrgId}`;

  const settled = await settle(readBuildingPhotos(identity, aboutOrgId, buildingId, { viewPhotoId }));
  if (!settled.ok) return <OversightLoadError slug={slug} />;
  if (settled.value.kind === "forbidden") {
    return <LockedPage title="Photos" need="manage" backHref={recordHref} backLabel={`Back to ${opened.congregation.name}`} />;
  }
  if (settled.value.kind === "not_found") notFound();
  const photos = settled.value.data;

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <BackLink href={buildingHref}>{PHOTO_COPY.backToBuilding(photos.buildingName)}</BackLink>
        <h1 className="mt-3 break-words text-2xl font-semibold">{PHOTO_COPY.pageTitle(photos.buildingName)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{identity.organizationName}&apos;s own oversight record for this congregation.</p>
      </div>

      {photos.viewed ? (
        <PhotoViewed
          slug={slug}
          aboutOrgId={aboutOrgId}
          buildingId={buildingId}
          photosHref={photosHref}
          viewed={photos.viewed}
          isCover={photos.photos.some((p) => p.id === photos.viewed?.id && p.isCover)}
        />
      ) : null}

      <section aria-labelledby="photo-grid-heading" className="space-y-3">
        <h2 id="photo-grid-heading" className="text-base font-medium">
          {PHOTO_COPY.allPhotos(photos.count)}
        </h2>
        {photos.photos.length > 0 ? <PhotoGrid photosHref={photosHref} photos={photos.photos} /> : null}
      </section>

      {photos.atCap ? (
        <p role="status" className="text-sm text-muted-foreground">
          {PHOTO_REFUSAL.cap_reached}
        </p>
      ) : (
        <PhotoUploadIsland slug={slug} aboutOrgId={aboutOrgId} buildingId={buildingId} />
      )}
    </section>
  );
}
