import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  hasPermission,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import {
  DIRECTORY_STATUSES,
  getDirectory,
  type DirectoryStatus,
} from "@/lib/directory";
import { isFlagEnabled } from "@/lib/flags";
import { isOrgFeatureEnabled } from "@/lib/org-features";
import { Button } from "@/components/ui/button";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import {
  MembersFlagOff,
  MembersForbidden,
  MembersLoadError,
} from "./members-states";
import { MembersList } from "./members-list";

const MEMBERS_CREATE_FLAG = "org_portal.members_create";
const CHILDREN_MINISTRY_FLAG = "org_portal.children_ministry";

/**
 * `/o/<slug>/admin/members` — the list + "Add Person" entry point
 * (Deliverable B, Increment 1). Gated on BOTH `org_portal.members_create`
 * (the global flag) AND the matching `organization_feature_toggles` row
 * (DECISION-097's third axis) — the flag answers "does this exist
 * anywhere", the toggle answers "does this exist for THIS congregation".
 *
 * REUSES `getDirectory()` FOR ROW DATA (Phase 3's explicit choice) rather
 * than inventing an `admin/members`-specific reader — same privacy-filtered
 * read the public Directory already ships. The "Add Person" CTA is
 * ADDITIONALLY gated on `people.manage`, checked directly here (not inside
 * `getDirectory()`, which knows nothing about that permission) — a KNOWN,
 * NAMED Increment-1 coupling (Phase 3): a `people.manage` holder who lacks
 * `directory.view` sees `getDirectory()`'s own forbidden state on the list
 * even though they could still reach `/new` directly. Not fixed here.
 */
/** Increment 5. Same default `directory/page.tsx` uses — one number, not
 * two independently-tuned constants for the same underlying list shape. */
const MEMBERS_PAGE_SIZE = 25;

function parseStatus(raw: string | undefined): DirectoryStatus | undefined {
  return (DIRECTORY_STATUSES as readonly string[]).includes(raw ?? "")
    ? (raw as DirectoryStatus)
    : undefined;
}

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ search?: string; status?: string; page?: string }>;
}) {
  const { slug } = await params;
  const {
    search: rawSearch,
    status: rawStatus,
    page: rawPage,
  } = await searchParams;
  const search = rawSearch?.trim() ?? "";
  const status = parseStatus(rawStatus);
  const page = parsePage(rawPage);

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/members`)}`,
    );
  }

  const resolved = await resolveOrgContext(session.user.id, slug);

  switch (resolved.kind) {
    case "not-found":
      notFound();
    case "forbidden":
      return (
        <OrgAccessDenied
          name={resolved.name}
          organizationType={resolved.organizationType}
          slug={slug}
        />
      );
    case "ended":
      return (
        <OrgAccessEnded
          name={resolved.name}
          endedOn={resolved.endedOn}
          slug={slug}
        />
      );
    case "ok":
      break;
  }

  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const flagOn = await isFlagEnabled(MEMBERS_CREATE_FLAG);
  const toggleOn = flagOn
    ? await isOrgFeatureEnabled(
        resolved.org.personId,
        resolved.org.organizationId,
        MEMBERS_CREATE_FLAG,
      )
    : false;
  if (!flagOn || !toggleOn) {
    return <MembersFlagOff name={resolved.org.name} heading="Members" />;
  }

  let result;
  try {
    result = await getDirectory(resolved.org.personId, resolved.org.organizationId, {
      search,
      status,
      page,
      pageSize: MEMBERS_PAGE_SIZE,
    });
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return (
      <MembersLoadError
        backHref={`/o/${slug}/admin/members`}
        heading="Members"
      />
    );
  }

  if (result.kind === "forbidden") {
    return <MembersForbidden name={resolved.org.name} heading="Members" />;
  }

  // Independent awaited calls, not merged into one Promise.all — same
  // discipline edit/page.tsx's own two conditional cards follow, so a
  // future ordering bug in one check can't cross-contaminate the other.
  const canCreate = await hasPermission(
    resolved.org.personId,
    resolved.org.organizationId,
    "people.manage",
  );
  const childrenMinistryFlagOn = await isFlagEnabled(CHILDREN_MINISTRY_FLAG);
  const canViewChildrenRoster = childrenMinistryFlagOn
    ? await hasPermission(
        resolved.org.personId,
        resolved.org.organizationId,
        "children.roster",
      )
    : false;

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Members</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {resolved.org.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canViewChildrenRoster && (
            <Button asChild variant="outline" className="min-h-11">
              <Link href={`/o/${slug}/admin/members/children`}>
                Children&apos;s roster
              </Link>
            </Button>
          )}
          {canCreate && (
            <Button asChild className="min-h-11">
              <Link href={`/o/${slug}/admin/members/new`}>Add person</Link>
            </Button>
          )}
        </div>
      </div>

      <MembersList
        slug={slug}
        entries={result.entries}
        canCreate={canCreate}
        canEdit={canCreate}
        search={search}
        status={status ?? ""}
        pagination={result.pagination}
      />
    </section>
  );
}
