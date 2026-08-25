import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getParishRoster } from "@/lib/directory";
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
 * `/o/<slug>/directory/parishes` — the deacon roster (Phase 3 Increment 4).
 *
 * REPEATS THE `(org)` AUTH PATTERN IN FULL, same as every sibling page in
 * this tree — see `directory/page.tsx`'s header for the fuller rationale.
 *
 * REACHABILITY rides on `org_portal.directory_v2` alone (no new flag — the
 * Phase 3 design's own text: "reachability rides on `org_portal.
 * directory_v2` (already on)"). The ACTUAL gate is `getParishRoster()`'s own
 * `directory.view_hidden` re-check, one layer down — this page never
 * second-guesses it with its own `hasPermission()` call; `DirectoryNav`
 * (rendered by `directory/page.tsx`) already only offers this route's link
 * to a viewer who holds the permission, but a deep link bypasses that, so
 * `getParishRoster()` returning `{ kind: "forbidden" }` is what actually
 * protects this page — mapped to the SAME `DirectoryForbidden`-shaped state
 * every other permission denial in this tree uses (Phase 3 design: "renders
 * the existing `DirectoryForbidden`-shaped state, not a 404").
 *
 * NO `loading.tsx` — this segment renders unconditionally once past the
 * flag/permission checks (it never calls `notFound()`), so this is a
 * stylistic consistency choice with its siblings, not a correctness one.
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
    result = await getParishRoster(
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
        canViewHidden
      />
      <ParishRoster parishes={result.parishes} orgName={resolved.org.name} />
    </section>
  );
}
