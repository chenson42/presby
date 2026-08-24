import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getDirectory } from "@/lib/directory";
import { isFlagEnabled } from "@/lib/flags";
import { OrgAccessDenied, OrgAccessEnded } from "../org-states";
import {
  DirectoryFlagOff,
  DirectoryForbidden,
  DirectoryLoadError,
} from "./directory-states";
import { DirectoryList } from "./directory-list";

/**
 * `/o/<slug>/directory` — the congregation directory (P1 / DECISION-061).
 *
 * REPEATS THE `/o/<slug>` AUTH PATTERN IN FULL, on purpose — the `(org)`
 * contract says every page resolves its own slug and reads through
 * `withOrgContext()`; it does not say every page EXCEPT the first one. See
 * `../page.tsx`'s header for why the auth check lives in the page rather than
 * the layout (a layout cannot see the pathname, so it would have to guess a
 * `callbackUrl` and lose the deep link).
 *
 * THE FLAG CHECK RUNS BEFORE `getDirectory()` IS EVER CALLED. `org_portal.
 * directory` answers "is this feature on at all" and `directory.view`
 * answers "may THIS person see it" — two different questions (Phase 2), and
 * checking the flag first means a congregation with the feature off never
 * pays for a permission-resolver round trip only to throw the answer away.
 *
 * `getDirectory()` THROWS on genuine failure rather than returning a result
 * variant, specifically so this page can tell "denied" apart from "broken".
 * `OrgAccessError` — the relationship vanishing between `resolveOrgContext`
 * and the transaction — is RE-THROWN, not swallowed: `[slug]/error.tsx`
 * already has the correct copy for that case, one level up. Anything else
 * (a real DB failure) renders the load-error state inline.
 */
export default async function DirectoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/directory`)}`,
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
        <OrgAccessEnded name={resolved.name} endedOn={resolved.endedOn} slug={slug} />
      );
    case "ok":
      break;
  }

  // The authoritative gate — see ../page.tsx's identical call for the full
  // rationale. Every `(org)` page calls it, including this one.
  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const directoryEnabled = await isFlagEnabled("org_portal.directory");
  if (!directoryEnabled) {
    return <DirectoryFlagOff name={resolved.org.name} />;
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
    return <DirectoryLoadError slug={slug} />;
  }

  if (result.kind === "forbidden") {
    return <DirectoryForbidden name={resolved.org.name} />;
  }

  return (
    <section className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Directory</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {resolved.org.name}
      </p>
      <DirectoryList entries={result.entries} />
    </section>
  );
}
