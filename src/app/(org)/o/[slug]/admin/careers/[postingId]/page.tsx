import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { OrgAccessError } from "@/lib/authz";
import { getPosting } from "@/lib/careers/postings";
import { slugSitePath } from "@/lib/site-urls";
import { resolveCareersAccess } from "../careers-access";
import { CareersFeatureOff, CareersForbidden, CareersLoadError, CareersNotFound } from "../careers-states";
import { PostingForm } from "../posting-form";
import { PostingStatusBadge } from "../postings-list";

/**
 * `/o/<slug>/admin/careers/<postingId>` - edit one opening: the form, its status
 * badge, "View on your website" while the public can read it, and the status controls
 * (inside the form component, which saves unsaved edits before a Publish or Reopen).
 *
 * `postingId` comes from the URL and is validated as a GUID before any query (a malformed
 * one is replaced by the nil GUID, after the gate has run); the result is the same "couldn't be found" state as an id in another organization
 * (RLS keeps that organization's rows out, so the lib returns `not_found` for both).
 * The form is keyed on `id-version`: a save or status change re-renders this page and
 * REMOUNTS the form on the new version with fresh defaults.
 */
const guid = z.guid();
const NIL_GUID = "00000000-0000-0000-0000-000000000000";

export default async function EditPostingPage({
  params,
}: {
  params: Promise<{ slug: string; postingId: string }>;
}) {
  const { slug, postingId } = await params;

  const access = await resolveCareersAccess(slug, `/o/${slug}/admin/careers/${postingId}`);
  if (!access.ok) return access.node;
  const { org } = access;

  let result;
  try {
    // The gate (toggle, then permission) runs first for EVERY id, so a member who may not see
    // careers gets S1/S2 rather than "couldn't be found". A malformed id is swapped for the nil
    // GUID, which no row has: the database never sees the raw text and the answer is not_found.
    result = await getPosting(
      org.personId,
      org.organizationId,
      guid.safeParse(postingId).success ? postingId : NIL_GUID,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <CareersLoadError slug={slug} />;
  }

  if (result.kind === "feature_off") {
    return <CareersFeatureOff name={org.name} slug={slug} canManageFeatures={result.canManageFeatures} />;
  }
  if (result.kind === "forbidden") return <CareersForbidden name={org.name} />;
  if (result.kind === "not_found") return <CareersNotFound slug={slug} />;
  if (result.kind !== "ok") return <CareersLoadError slug={slug} />;

  const { posting, orgToday } = result.data;

  return (
    <section className="max-w-2xl space-y-6">
      <Link
        href={`/o/${slug}/admin/careers`}
        className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ArrowLeft className="mr-1 size-4" aria-hidden />
        Back to job openings
      </Link>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold [overflow-wrap:anywhere]">{posting.title}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <PostingStatusBadge posting={posting} />
          {posting.status === "published" && posting.visibleToPublic && (
            <Link
              href={slugSitePath(slug, `/careers/${encodeURIComponent(posting.slug)}`)}
              className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              View on your website
            </Link>
          )}
        </div>
      </div>
      <PostingForm key={`${posting.id}-${posting.version}`} slug={slug} posting={posting} orgToday={orgToday} />
    </section>
  );
}
