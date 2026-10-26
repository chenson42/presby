import "server-only";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { personPhotoDesignations, personPhotos } from "@/lib/db/domain/person-photos";
import { getBlobStore } from "@/lib/storage/blob-store";
import { parseBlobKey } from "@/lib/storage/blob-key";
import type { PhotoStateSnapshot } from "./consequences";
import { statusLines } from "./status-lines";
import type {
  DirectoryStatus,
  ListingKind,
  PhotoSetView,
  PhotoTileView,
  WebsiteStatus,
  Withheld,
} from "./types";

/**
 * THE READ SIDE of person photos: the admin photo set with its effective-state
 * answers, the toggle, the listing lookup, and the toggle-off warning count.
 * Together with `store.ts` the only importer of `person_photos` and
 * `person_photo_designations` (`scan.test.ts`). docs/work-log/
 * 2026-10-26-person-photos-inc1.md, Phase 3 "Library".
 *
 * IT DECIDES NOTHING ABOUT VISIBILITY. "Is this photo shown in the directory,
 * and on the website?" is answered by SQL: `presby_person_directory_photo()` for
 * the directory and `presby_person_public_photo_status()` for the website, the
 * latter a thin definer wrapper over the SAME core the public roster functions
 * project, so the page and the public site cannot drift (DECISION-289; the
 * parity is pinned by `public-photo.db.test.ts`). The wrapper takes no
 * organization argument: it derives it from `presby_current_org()`, so it is not
 * an oracle for another organization's photo, and only this file names it.
 *
 * AUTHORIZATION is inside the transaction: the toggle, then `people.manage`
 * (RLS enforces tenancy, not authorization), then the target is a membership of
 * this organization. A forbidden caller never reaches a photo row, a thumbnail
 * or a status answer.
 *
 * THUMBNAILS are inlined as `data:` URIs (the CSP has no `blob:` and a route
 * would be a new enumerable surface, DECISION-040), read with ONE `resolveMany()`
 * for the whole page; the single master of `?view=` rides in the same call. A
 * read failure logs one fixed line and the tile renders without its image: the
 * set itself still loads.
 */

export interface ReadCtx {
  organizationId: string;
  /** The acting person (`resolveOrgContext().org.personId`). */
  actorPersonId: string;
}

type Rows = Array<Record<string, unknown>>;
const rowsOf = (result: unknown): Rows =>
  Array.isArray(result) ? (result as Rows) : ((result as { rows?: Rows }).rows ?? []);

const asNullableString = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The per-organization toggle, from the one SQL definition every surface uses. */
export async function personPhotosEnabled(ctx: ReadCtx): Promise<boolean> {
  return withOrgContext(ctx.actorPersonId, ctx.organizationId, async (tx) => {
    const [row] = rowsOf(await tx.execute(sql`select presby_person_photos_enabled(${ctx.organizationId}::uuid) as enabled`));
    return row?.enabled === true;
  });
}

/**
 * How many photos are currently CHOSEN for the directory or the website in the
 * current organization (active designations on live photos). Worded "chosen for",
 * never "shown": the toggle, a minor or a hidden photo may still withhold one.
 * Called by `org-feature-warnings.ts` so that module never imports the tables.
 * Counts under the transaction's organization (RLS); the Features page already
 * holds that transaction.
 */
export async function countPhotoDesignations(tx: OrgTx): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(personPhotoDesignations)
    .innerJoin(
      personPhotos,
      and(
        eq(personPhotos.id, personPhotoDesignations.photoId),
        eq(personPhotos.organizationId, personPhotoDesignations.organizationId),
      ),
    )
    .where(and(isNull(personPhotoDesignations.endedAt), isNull(personPhotos.removedAt)));
  return Number(row?.n ?? 0);
}

export type ReadPhotoSetResult =
  | { kind: "ok"; set: PhotoSetView }
  | { kind: "feature_off" }
  | { kind: "forbidden" }
  | { kind: "not_found" };

/** Open public listings of the person: staff, officer terms and managed committees (the roster functions' own predicates). */
async function listingsOf(tx: OrgTx, organizationId: string, personId: string): Promise<ListingKind[]> {
  const [row] = rowsOf(
    await tx.execute(sql`
      select
        exists (select 1 from staff_positions sp
                 where sp.organization_id = ${organizationId}::uuid and sp.person_id = ${personId}::uuid
                   and sp.public_listed and sp.ends_on is null) as staff,
        exists (select 1 from officer_terms ot
                 where ot.organization_id = ${organizationId}::uuid and ot.person_id = ${personId}::uuid
                   and ot.public_listed and ot.ends_on is null) as officer,
        exists (select 1 from group_memberships gm
                  join groups g on g.id = gm.group_id and g.organization_id = gm.organization_id
                 where gm.organization_id = ${organizationId}::uuid and gm.person_id = ${personId}::uuid
                   and g.membership_source = 'managed' and gm.public_listed and gm.ends_on is null) as committee`),
  );
  const out: ListingKind[] = [];
  if (row?.staff === true) out.push("staff");
  if (row?.officer === true) out.push("officer");
  if (row?.committee === true) out.push("committee");
  return out;
}

const dataUri = (blob: { bytes: Buffer; contentType: string } | undefined): string | null =>
  blob ? `data:${blob.contentType};base64,${blob.bytes.toString("base64")}` : null;

/**
 * The whole page's data for one person. `viewPhotoId` (the page's `?view=`) is
 * honoured only if it names one of THIS person's live photos; anything else is
 * ignored (never a lookup by a client-supplied key).
 */
export async function readPhotoSet(
  ctx: ReadCtx,
  rawPersonId: string,
  options: { viewPhotoId?: string | null } = {},
): Promise<ReadPhotoSetResult> {
  const personId = parseBlobKey(rawPersonId);
  if (personId === null) return { kind: "not_found" };
  const viewPhotoId = options.viewPhotoId ? parseBlobKey(options.viewPhotoId) : null;

  // Everything that touches the database for authorization or SQL answers is one transaction.
  const loaded = await withOrgContext(ctx.actorPersonId, ctx.organizationId, async (tx) => {
    const [gate] = rowsOf(
      await tx.execute(sql`
        select presby_person_photos_enabled(${ctx.organizationId}::uuid) as enabled,
               presby_has_permission(${ctx.actorPersonId}::uuid, ${ctx.organizationId}::uuid, 'people.manage') as allowed`),
    );
    if (gate?.enabled !== true) return { kind: "feature_off" } as const;
    if (gate?.allowed !== true) return { kind: "forbidden" } as const;

    const [person] = rowsOf(
      await tx.execute(sql`
        select coalesce(p.preferred_name, p.first_name) as first_name,
               coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as display_name,
               (select o.name from organizations o where o.id = ${ctx.organizationId}::uuid) as organization_name
          from memberships m
          join people p on p.id = m.person_id
         where m.person_id = ${personId}::uuid and m.organization_id = ${ctx.organizationId}::uuid`),
    );
    if (!person) return { kind: "not_found" } as const;

    const photos = await tx
      .select({
        id: personPhotos.id,
        thumbKey: personPhotos.thumbAssetKey,
        imageKey: personPhotos.imageAssetKey,
        width: personPhotos.width,
        height: personPhotos.height,
        createdAt: sql<string>`to_char(${personPhotos.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(personPhotos)
      .where(
        and(
          eq(personPhotos.organizationId, ctx.organizationId),
          eq(personPhotos.personId, personId),
          isNull(personPhotos.removedAt),
        ),
      )
      .orderBy(asc(personPhotos.createdAt), asc(personPhotos.id));

    const designations = await tx
      .select({
        photoId: personPhotoDesignations.photoId,
        purpose: personPhotoDesignations.purpose,
        attested: personPhotoDesignations.publicAttestedAt,
      })
      .from(personPhotoDesignations)
      .where(
        and(
          eq(personPhotoDesignations.organizationId, ctx.organizationId),
          eq(personPhotoDesignations.personId, personId),
          isNull(personPhotoDesignations.endedAt),
        ),
      );

    const [dirRow] = rowsOf(
      await tx.execute(sql`select photo_id, thumb_key, withheld from presby_person_directory_photo(${ctx.organizationId}::uuid, ${personId}::uuid)`),
    );
    const [webRow] = rowsOf(
      await tx.execute(sql`select image_key, source, withheld from presby_person_public_photo_status(${personId}::uuid)`),
    );
    const [minorRow] = rowsOf(
      await tx.execute(sql`select presby_photo_subject_is_minor(${ctx.organizationId}::uuid, ${personId}::uuid) as minor`),
    );
    const listings = await listingsOf(tx, ctx.organizationId, personId);

    return {
      kind: "ok",
      person,
      photos,
      designations,
      dirRow,
      webRow,
      isMinor: minorRow?.minor === true,
      listings,
    } as const;
  });

  if (loaded.kind !== "ok") return loaded;
  const { person, photos, designations, dirRow, webRow, isMinor, listings } = loaded;

  const directoryActive = designations.find((d) => d.purpose === "directory") ?? null;
  const websiteActive = designations.find((d) => d.purpose === "website") ?? null;

  const directory: DirectoryStatus = {
    photoId: asNullableString(dirRow?.photo_id),
    thumbKey: asNullableString(dirRow?.thumb_key),
    withheld: (asNullableString(dirRow?.withheld) as DirectoryStatus["withheld"]) ?? null,
  };
  const website: WebsiteStatus = {
    imageKey: asNullableString(webRow?.image_key),
    source: (asNullableString(webRow?.source) as WebsiteStatus["source"]) ?? null,
    withheld: (asNullableString(webRow?.withheld) as Withheld | null) ?? null,
    unattestedDirectoryOnly: websiteActive === null && directoryActive !== null && directoryActive.attested === null,
  };

  const first = String(person.first_name);

  // ONE read for every thumbnail, and the one master `?view=` asked for.
  const viewed = viewPhotoId ? photos.find((p) => p.id === viewPhotoId) : undefined;
  const keys = [...photos.map((p) => p.thumbKey), ...(viewed ? [viewed.imageKey] : [])];
  let blobs = new Map<string, { bytes: Buffer; contentType: string }>();
  if (keys.length > 0) {
    try {
      blobs = await getBlobStore().resolveMany({ organizationId: ctx.organizationId, keys, audience: "private" });
    } catch {
      console.error("[person-photos] thumbnail read failed; showing initials");
    }
  }

  const tiles: PhotoTileView[] = photos.map((p) => ({
    id: p.id,
    thumbSrc: dataUri(blobs.get(p.thumbKey)),
    width: p.width,
    height: p.height,
    createdAt: p.createdAt,
    isDirectory: directoryActive?.photoId === p.id,
    isWebsite: websiteActive?.photoId === p.id,
    directoryAttested: directoryActive?.photoId === p.id && directoryActive.attested !== null,
  }));

  const state: PhotoStateSnapshot = {
    first,
    listed: listings.length > 0,
    website: websiteActive ? { photoId: websiteActive.photoId } : null,
    directory: directoryActive ? { photoId: directoryActive.photoId, attested: directoryActive.attested !== null } : null,
  };

  const viewedSrc = viewed ? dataUri(blobs.get(viewed.imageKey)) : null;

  return {
    kind: "ok",
    set: {
      personId,
      displayName: String(person.display_name),
      firstName: first,
      organizationName: String(person.organization_name ?? ""),
      photos: tiles,
      count: tiles.length,
      isMinor,
      directory,
      website,
      listings,
      lines: statusLines({ first, directory, website, listings }),
      state,
      viewed: viewed && viewedSrc ? { photoId: viewed.id, src: viewedSrc } : null,
    },
  };
}
