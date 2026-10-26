import Link from "next/link";
import { OrgAccessError } from "@/lib/authz";
import { listPostings } from "@/lib/careers/postings";
import { readPlacement } from "@/lib/careers/placement-read";
import { platformSiteAddress } from "@/lib/domains/site-address";
import { Button } from "@/components/ui/button";
import { resolveCareersAccess } from "./careers-access";
import { CareersFeatureOff, CareersForbidden, CareersLoadError } from "./careers-states";
import { PlacementLine } from "./placement-line";
import { PostingsList } from "./postings-list";

/**
 * `/o/<slug>/admin/careers` - the staff list of job openings (docs/work-log/
 * 2026-10-25-careers-inc1.md, Phase 3; Copy S1-S7). Repeats the `(org)` auth pattern
 * through `resolveCareersAccess` (the page, not the layout, so the deep link survives).
 *
 * THE GATE RUNS INSIDE `listPostings()`, in its first transaction: the per-org toggle
 * first, THEN `careers.manage`. So with the toggle off EVERY member sees "not turned on"
 * (S1, with the Features link only for someone who holds `org_features.manage`), and
 * only with it on does a member without the permission see S2. A database failure is the
 * load-error state (S3), never a fall-through to an empty list that would invite a
 * first posting against a database that is down. `OrgAccessError` is re-thrown so
 * `[slug]/error.tsx` shows its own copy.
 *
 * The placement line reads the PUBLISHED bundle and says what it contains - or that it
 * could not check. No `loading.tsx` (CLAUDE.md -> The (org) contract; this segment
 * `redirect()`s and `notFound()`s).
 */
export default async function CareersAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const access = await resolveCareersAccess(slug, `/o/${slug}/admin/careers`);
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

  const placement = await readPlacement(slug);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Job openings</h1>
          <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{org.name}</p>
        </div>
        <Button asChild className="min-h-11">
          <Link href={`/o/${slug}/admin/careers/new`}>New job opening</Link>
        </Button>
      </div>

      <PlacementLine input={placement} careersAddress={`${platformSiteAddress(slug)}/careers`} />

      <PostingsList slug={slug} postings={result.data.postings} orgToday={result.data.orgToday} />
    </section>
  );
}
