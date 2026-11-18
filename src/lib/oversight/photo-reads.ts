import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { OrgTx } from "@/lib/authz";
import { oversightBuildingPhotos, oversightBuildings } from "@/lib/db/domain/oversight";
import { getBlobStore, RESOLVE_MANY_MAX } from "@/lib/storage/blob-store";
import { LIMITS, OVERSIGHT_MANAGE_KEY, type OversightRead, type OversightViewer } from "./contract";
import { pickCover } from "./derive";
import { readUnder } from "./reads";

/**
 * THE READ SIDE of building photos, and the only file with the photo blob read
 * (`resolveMany`, audience `"private"`, a literal; `audience-callsites.test.ts`
 * pins it). docs/work-log/2026-11-17-congregation-profile.md, Phase 3 "API
 * Contract: Reads", T10; DECISION-344, 346.
 *
 * Every reader is `congregation_oversight.manage` (photos are tier 1) and its
 * own `withOrgContext()` transaction through `readUnder`: the key, then the
 * congregation, then the rows. It returns `{ kind: "ok", data } | { kind:
 * "forbidden" } | { kind: "not_found" }`. A congregation that is not ours, a
 * building of another congregation, another presbytery's building and a removed
 * building are the same `not_found`.
 *
 * PICTURES are inlined as `data:` URIs (the CSP has no `blob:` and a route would
 * be a new enumerable surface, DECISION-040): thumbnails for a grid or a cover,
 * and exactly one master, the one `?view=` names. `viewPhotoId` is honoured only
 * if it names a LIVE photo of THIS building (it is looked up among the building's
 * own rows, never fetched by a client-supplied key). A blob read that fails logs
 * one fixed line and the tile renders without its picture: the rows still load.
 *
 * COVER: the photo carrying the cover mark, else the oldest ("the first photo is
 * the cover"), so a building whose marked cover was removed still has one.
 *
 * Reads are not audited (DECISION-345). No write is made here.
 */

export interface PhotoTileView {
  id: string;
  caption: string | null;
  /** The cover (marked, or the oldest when none is marked). At most one tile is true. */
  isCover: boolean;
  /** The 160 px thumbnail as a `data:` URI; null if its blob could not be read. */
  thumbSrc: string | null;
  width: number;
  height: number;
}

export interface PhotoViewedView {
  id: string;
  caption: string | null;
  /** The master (at most 1,200 px) as a `data:` URI. */
  src: string;
  width: number;
  height: number;
}

export interface BuildingPhotosView {
  buildingId: string;
  buildingName: string;
  /** Live photos, oldest first. */
  photos: PhotoTileView[];
  count: number;
  /** `LIMITS.photoCap`, for "{n} of 10" and to hide the add button. */
  cap: number;
  atCap: boolean;
  /** The master `?view=` named, when it is a live photo of this building. */
  viewed: PhotoViewedView | null;
}

/** One building's cover and how many photos it holds, for the record page's building cards and the building page's Photos block. */
export interface BuildingCoverView {
  buildingId: string;
  photoId: string;
  caption: string | null;
  thumbSrc: string | null;
  count: number;
}

type Blob = { bytes: Buffer; contentType: string };

const dataUri = (blob: Blob | undefined): string | null =>
  blob ? `data:${blob.contentType};base64,${blob.bytes.toString("base64")}` : null;

/** One read per chunk of the store's key limit; a failure logs a fixed line and returns what it has. */
async function resolveBlobs(organizationId: string, keys: string[]): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  for (let i = 0; i < keys.length; i += RESOLVE_MANY_MAX) {
    try {
      const got = await getBlobStore().resolveMany({
        organizationId,
        keys: keys.slice(i, i + RESOLVE_MANY_MAX),
        audience: "private",
      });
      for (const [key, blob] of got) out.set(key, blob);
    } catch {
      console.error("[oversight] building photo read failed; showing the page without its pictures");
    }
  }
  return out;
}

const photoColumns = {
  id: oversightBuildingPhotos.id,
  buildingId: oversightBuildingPhotos.buildingId,
  caption: oversightBuildingPhotos.caption,
  isCover: oversightBuildingPhotos.isCover,
  thumbKey: oversightBuildingPhotos.thumbAssetKey,
  imageKey: oversightBuildingPhotos.imageAssetKey,
  width: oversightBuildingPhotos.width,
  height: oversightBuildingPhotos.height,
};

const livePhotos = (viewer: OversightViewer, aboutOrgId: string) =>
  and(
    eq(oversightBuildingPhotos.organizationId, viewer.organizationId),
    eq(oversightBuildingPhotos.aboutOrgId, aboutOrgId),
    isNull(oversightBuildingPhotos.removedAt),
  );

/** The grid for one building, plus the one master `?view=` names. */
export function readBuildingPhotos(
  viewer: OversightViewer,
  aboutOrgId: string,
  buildingId: string,
  options: { viewPhotoId?: string | null } = {},
): Promise<OversightRead<BuildingPhotosView>> {
  return readUnder(viewer, OVERSIGHT_MANAGE_KEY, aboutOrgId, async (tx: OrgTx) => {
    const [building] = await tx
      .select({ id: oversightBuildings.id, name: oversightBuildings.name })
      .from(oversightBuildings)
      .where(
        and(
          eq(oversightBuildings.id, buildingId),
          eq(oversightBuildings.organizationId, viewer.organizationId),
          eq(oversightBuildings.aboutOrgId, aboutOrgId),
          isNull(oversightBuildings.removedAt),
        ),
      );
    if (!building) return null;

    const rows = await tx
      .select(photoColumns)
      .from(oversightBuildingPhotos)
      .where(and(livePhotos(viewer, aboutOrgId), eq(oversightBuildingPhotos.buildingId, buildingId)))
      .orderBy(asc(oversightBuildingPhotos.createdAt), asc(oversightBuildingPhotos.id));

    const cover = pickCover(rows);
    const viewed = options.viewPhotoId ? rows.find((r) => r.id === options.viewPhotoId) : undefined;
    const blobs = await resolveBlobs(viewer.organizationId, [...rows.map((r) => r.thumbKey), ...(viewed ? [viewed.imageKey] : [])]);

    const viewedSrc = viewed ? dataUri(blobs.get(viewed.imageKey)) : null;
    return {
      buildingId: building.id,
      buildingName: building.name,
      photos: rows.map((r) => ({
        id: r.id,
        caption: r.caption,
        isCover: cover?.id === r.id,
        thumbSrc: dataUri(blobs.get(r.thumbKey)),
        width: r.width,
        height: r.height,
      })),
      count: rows.length,
      cap: LIMITS.photoCap,
      atCap: rows.length >= LIMITS.photoCap,
      viewed: viewed && viewedSrc ? { id: viewed.id, caption: viewed.caption, src: viewedSrc, width: viewed.width, height: viewed.height } : null,
    } satisfies BuildingPhotosView;
  });
}

/**
 * The cover and photo count of every live building of the congregation that has
 * a photo (a building with none is simply absent), keyed by building id. One
 * query and one blob read however many buildings there are.
 */
export function readBuildingCovers(
  viewer: OversightViewer,
  aboutOrgId: string,
): Promise<OversightRead<Record<string, BuildingCoverView>>> {
  return readUnder(viewer, OVERSIGHT_MANAGE_KEY, aboutOrgId, (tx) => coversOf(tx, viewer, aboutOrgId, null));
}

/** One building's cover and count, for the building page's Photos block: `data` is null when the building has no photo. */
export function readBuildingPhotoSummary(
  viewer: OversightViewer,
  aboutOrgId: string,
  buildingId: string,
): Promise<OversightRead<BuildingCoverView | null>> {
  return readUnder(viewer, OVERSIGHT_MANAGE_KEY, aboutOrgId, async (tx) => {
    const [building] = await tx
      .select({ id: oversightBuildings.id })
      .from(oversightBuildings)
      .where(
        and(
          eq(oversightBuildings.id, buildingId),
          eq(oversightBuildings.organizationId, viewer.organizationId),
          eq(oversightBuildings.aboutOrgId, aboutOrgId),
          isNull(oversightBuildings.removedAt),
        ),
      );
    if (!building) return null;
    const covers = await coversOf(tx, viewer, aboutOrgId, buildingId);
    // `readUnder` reads null as not_found; a live building with no photo is a real answer, so wrap it.
    return { cover: covers[buildingId] ?? null };
  }).then((read) => (read.kind === "ok" ? { kind: "ok", data: read.data.cover } : read));
}

async function coversOf(
  tx: OrgTx,
  viewer: OversightViewer,
  aboutOrgId: string,
  onlyBuildingId: string | null,
): Promise<Record<string, BuildingCoverView>> {
  const liveBuildings = tx
    .select({ id: oversightBuildings.id })
    .from(oversightBuildings)
    .where(
      and(
        eq(oversightBuildings.organizationId, viewer.organizationId),
        eq(oversightBuildings.aboutOrgId, aboutOrgId),
        isNull(oversightBuildings.removedAt),
      ),
    );
  const rows = await tx
    .select(photoColumns)
    .from(oversightBuildingPhotos)
    .where(
      and(
        livePhotos(viewer, aboutOrgId),
        inArray(oversightBuildingPhotos.buildingId, liveBuildings),
        ...(onlyBuildingId ? [eq(oversightBuildingPhotos.buildingId, onlyBuildingId)] : []),
      ),
    )
    .orderBy(asc(oversightBuildingPhotos.createdAt), asc(oversightBuildingPhotos.id));

  const byBuilding = new Map<string, typeof rows>();
  for (const row of rows) byBuilding.set(row.buildingId, [...(byBuilding.get(row.buildingId) ?? []), row]);

  const covers = [...byBuilding.entries()].map(([buildingId, photos]) => ({ buildingId, cover: pickCover(photos)!, count: photos.length }));
  const blobs = await resolveBlobs(viewer.organizationId, covers.map((c) => c.cover.thumbKey));

  const out: Record<string, BuildingCoverView> = {};
  for (const { buildingId, cover, count } of covers) {
    out[buildingId] = { buildingId, photoId: cover.id, caption: cover.caption, thumbSrc: dataUri(blobs.get(cover.thumbKey)), count };
  }
  return out;
}
