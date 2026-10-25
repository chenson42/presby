import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getParishesOverview } from "@/lib/parishes";
import { isFlagEnabled } from "@/lib/flags";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import {
  DirectoryFlagOff,
  DirectoryForbidden,
  DirectoryLoadError,
} from "../directory-states";
import { DirectoryNav } from "../directory-nav";
import { ParishRoster } from "../parish-roster";

/**
 * `/o/<slug>/directory/parishes` - the Parishes page: the district list, and (when
 * the org's `org_portal.parishes` toggle is on) where districts are defined,
 * renamed, archived and restored, and the way in to a district's households and
 * to the households with no district (docs/work-log/2026-10-25-parish-
 * management.md, Phase 3 "Component / Page Plan").
 *
 * REPEATS THE `(org)` AUTH PATTERN IN FULL, same as every sibling page in this
 * tree - see `directory/page.tsx`'s header for the fuller rationale.
 *
 * REACHABILITY rides on the two existing platform flags
 * (`org_portal.directory`, `org_portal.directory_v2`); the new surfaces ALSO sit
 * behind the per-org toggle, read inside `getParishesOverview()`. The ACTUAL gate
 * is that function's own live authority read: with the toggle ON, any of
 * `parishes.assign` (the Moderator seat), `people.manage`, `officers.manage` or
 * `directory.view_hidden`; with it OFF, `directory.view_hidden` alone, exactly as
 * before - a deep link bypasses the nav, so the page never second-guesses it with
 * its own check. `{ kind: "forbidden" }` renders the same `DirectoryForbidden`
 * state every other permission denial in this tree uses (not a 404).
 *
 * NO `loading.tsx` - this segment renders unconditionally once past the
 * flag/permission checks (it never calls `notFound()`).
 */
export default async function ParishesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/directory/parishes`)}`,
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

  const directoryEnabled = await isFlagEnabled("org_portal.directory");
  const directoryV2Enabled = await isFlagEnabled("org_portal.directory_v2");
  if (!directoryEnabled || !directoryV2Enabled) {
    return <DirectoryFlagOff name={resolved.org.name} />;
  }

  let result;
  try {
    result = await getParishesOverview(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <DirectoryLoadError slug={slug} />;
  }

  if (result.kind === "forbidden") {
    return <DirectoryForbidden name={resolved.org.name} />;
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold">Directory</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {resolved.org.name}
      </p>
      <DirectoryNav
        slug={slug}
        view="parishes"
        search=""
        showParishes
      />
      <ParishRoster
        parishes={result.districts}
        orgName={resolved.org.name}
        managed={
          result.managed
            ? {
                slug,
                canDefine: result.authority.canDefine,
                canListHouseholds: result.authority.canListHouseholds,
                archived: result.archived,
                unassignedCount: result.unassignedCount,
                seatFilled: result.seatFilled,
              }
            : undefined
        }
      />
    </section>
  );
}
