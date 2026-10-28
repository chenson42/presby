import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { OrgAccessError } from "@/lib/authz";
import { listPostings } from "@/lib/careers/postings";
import { resolveCareersAccess } from "../careers-access";
import { CareersFeatureOff, CareersForbidden, CareersLoadError } from "../careers-states";
import { PostingForm } from "../posting-form";

/**
 * `/o/<slug>/admin/careers/new` - a new job opening, saved as a draft. Same auth
 * pattern and gate as the list: `listPostings()` is called (its data discarded) purely
 * for its toggle-then-permission gate, the events precedent, rather than a second
 * permission-only export. Nothing is public until the person publishes from the edit page.
 */
export default async function NewPostingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const access = await resolveCareersAccess(slug, `/o/${slug}/admin/careers/new`);
  if (!access.ok) return access.node;
  const { org } = access;

  let result;
  try {
    result = await listPostings(org.personId, org.organizationId);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <CareersLoadError slug={slug} />;
  }
  if (result.kind === "feature_off") {
    return <CareersFeatureOff name={org.name} slug={slug} canManageFeatures={result.canManageFeatures} />;
  }
  if (result.kind === "forbidden") return <CareersForbidden name={org.name} />;
  if (result.kind !== "ok") return <CareersLoadError slug={slug} />;

  return (
    <section className="max-w-2xl space-y-6">
      <Link
        href={`/o/${slug}/admin/careers`}
        className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ArrowLeft className="mr-1 size-4" aria-hidden />
        Back to job openings
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">New job opening</h1>
        <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{org.name}</p>
      </div>
      <PostingForm slug={slug} />
    </section>
  );
}
