import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { assertOrgAccess, OrgAccessError, resolveOrgContext } from "@/lib/authz";
import { PAGE_COPY } from "@/lib/person-photos/copy";
import { readPhotoSet, type ReadPhotoSetResult } from "@/lib/person-photos/reader";
import { OrgAccessDenied, OrgAccessEnded } from "../../../../../org-states";
import { MembersForbidden, MembersLoadError } from "../../../members-states";
import { PhotoGrid } from "./photo-grid";
import { PhotosOff } from "./photo-states";
import { UploadIsland } from "./upload-island";
import { WherePhotosShow } from "./where-photos-show";

/**
 * `/o/<slug>/admin/community/<id>/edit/photos` (docs/work-log/
 * 2026-10-26-person-photos-inc1.md, Phase 3 "Component / Page Plan"; DECISION-
 * 285..289). A linked sub-screen, shaped like `edit/guardians/page.tsx`: its own
 * route, its own off / forbidden / not-found / error states.
 *
 * ONE read, `readPhotoSet()`, carries the whole gate: it checks the org toggle,
 * then `people.manage`, then that the person belongs to this organization, all in
 * one transaction, and answers `feature_off`, `forbidden`, `not_found` or the
 * set. This page does not repeat those checks (a second copy is a place to
 * disagree). A thrown error is the load-error state, except `OrgAccessError`,
 * which is rethrown to the (org) boundary like every sibling page.
 *
 * `?view=<photo id>` renders one photo's master larger; the reader ignores
 * anything that is not one of THIS person's live photos.
 *
 * NO `loading.tsx` in this segment: the page calls `notFound()`, and a
 * `loading.tsx` would flush a 200 before it resolves (CLAUDE.md, the (org)
 * contract).
 */
export default async function PersonPhotosPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { slug, id } = await params;
  const { view } = await searchParams;
  const viewPhotoId = typeof view === "string" ? view : null;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/community/${id}/edit/photos`)}`);
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  switch (resolved.kind) {
    case "not-found":
      notFound();
    case "forbidden":
      return <OrgAccessDenied name={resolved.name} organizationType={resolved.organizationType} slug={slug} />;
    case "ended":
      return <OrgAccessEnded name={resolved.name} endedOn={resolved.endedOn} slug={slug} />;
    case "ok":
      break;
  }

  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  let result: ReadPhotoSetResult;
  try {
    result = await readPhotoSet(
      { organizationId: resolved.org.organizationId, actorPersonId: resolved.org.personId },
      id,
      { viewPhotoId },
    );
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <MembersLoadError backHref={`/o/${slug}/admin/community/${id}/edit`} heading={PAGE_COPY.heading} />;
  }

  if (result.kind === "feature_off") return <PhotosOff name={resolved.org.name} />;
  if (result.kind === "forbidden") return <MembersForbidden name={resolved.org.name} heading={PAGE_COPY.heading} />;
  if (result.kind === "not_found") notFound();

  const { set } = result;
  const photosHref = `/o/${slug}/admin/community/${id}/edit/photos`;

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{PAGE_COPY.heading}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{PAGE_COPY.subheading(set.displayName, set.organizationName)}</p>
        <Link
          href={`/o/${slug}/admin/community/${id}/edit`}
          className="mt-2 inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-2"
        >
          {PAGE_COPY.backToEdit}
        </Link>
      </div>

      {set.isMinor && (
        <p role="status" className="rounded-lg border bg-muted/40 p-4 text-sm">
          {PAGE_COPY.minorNotice(set.firstName)}
        </p>
      )}

      <WherePhotosShow lines={set.lines} />

      {set.viewed && (
        <section className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI of the stored master; next/image would proxy it */}
          <img
            src={set.viewed.src}
            alt={PAGE_COPY.tileAlt(
              set.displayName,
              Math.max(1, set.photos.findIndex((p) => p.id === set.viewed?.photoId) + 1),
            )}
            className="max-h-[70vh] max-w-full rounded-md border bg-muted object-contain"
          />
          <Link href={photosHref} className="inline-flex min-h-11 items-center text-sm underline underline-offset-2">
            {PAGE_COPY.backToAll}
          </Link>
        </section>
      )}

      <section aria-label={PAGE_COPY.heading} className="space-y-3">
        <p className="text-sm text-muted-foreground">{PAGE_COPY.counter(set.count)}</p>
        {set.photos.length === 0 ? (
          <div role="status" className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <p className="text-sm font-medium">{PAGE_COPY.emptyTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">{PAGE_COPY.emptyBody}</p>
          </div>
        ) : (
          <PhotoGrid slug={slug} set={set} />
        )}
      </section>

      <UploadIsland slug={slug} personId={id} firstName={set.firstName} disabled={set.isMinor} />
    </section>
  );
}
