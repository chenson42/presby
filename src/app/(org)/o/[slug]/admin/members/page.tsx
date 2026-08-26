import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  hasPermission,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getDirectory } from "@/lib/directory";
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
export default async function MembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

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
    result = await getDirectory(
      resolved.org.personId,
      resolved.org.organizationId,
    );
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

  const canCreate = await hasPermission(
    resolved.org.personId,
    resolved.org.organizationId,
    "people.manage",
  );

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Members</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {resolved.org.name}
          </p>
        </div>
        {canCreate && (
          <Button asChild className="min-h-11">
            <Link href={`/o/${slug}/admin/members/new`}>Add person</Link>
          </Button>
        )}
      </div>

      <MembersList
        slug={slug}
        entries={result.entries}
        canCreate={canCreate}
      />
    </section>
  );
}
