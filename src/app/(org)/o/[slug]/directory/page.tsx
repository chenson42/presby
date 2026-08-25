import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  hasPermission,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getDirectory, getHouseholds } from "@/lib/directory";
import { isFlagEnabled } from "@/lib/flags";
import { OrgAccessDenied, OrgAccessEnded } from "../org-states";
import {
  DirectoryFlagOff,
  DirectoryForbidden,
  DirectoryLoadError,
} from "./directory-states";
import { DirectoryList } from "./directory-list";
import { DirectoryGrid } from "./directory-grid";
import { HouseholdsGrid } from "./households-grid";
import { DirectoryNav } from "./directory-nav";

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
 *
 * `org_portal.directory_v2` (Phase 3 Increment 2) is checked AFTER
 * `org_portal.directory` and AFTER `getDirectory()` has already run — it
 * decides which UI renders the SAME result, not whether the read happens at
 * all. OFF renders today's `DirectoryList` (the regression floor); ON
 * renders `DirectoryGrid` with `?search=` passed through from
 * `searchParams` into the SAME `getDirectory()` call via `opts.search`, so
 * there is exactly one privacy-filtered read either way, never two.
 *
 * `?view=households` (Phase 3 Increment 3) is a FILTER within this same
 * page, per the architect's Phase 2 ruling — not a second route — and is
 * only reachable when `directoryV2Enabled`: the v1 regression floor never
 * sees a `view` param at all, matching the v1 flat list's existing shape
 * byte-for-byte. `getHouseholds()` runs INSTEAD of `getDirectory()` for this
 * branch (not in addition to it) — one privacy-filtered read either way, the
 * same discipline the members/grid split already established.
 */
export default async function DirectoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ search?: string; view?: string }>;
}) {
  const { slug } = await params;
  const { search: rawSearch, view: rawView } = await searchParams;
  const search = rawSearch?.trim() ?? "";

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

  const directoryV2Enabled = await isFlagEnabled("org_portal.directory_v2");
  const view = directoryV2Enabled && rawView === "households"
    ? ("households" as const)
    : ("members" as const);

  // Increment 4: checked DIRECTLY (not a flag) — reachability of the
  // Parishes tab and of `includeHidden` both ride on this ONE call, never a
  // second hand-copied check. `getDirectory()`/`getHouseholds()` re-verify
  // it themselves before honoring `includeHidden`, so a stale `true` here
  // (a grant revoked mid-request) can never widen what a caller actually
  // sees — only whether the tab/opt-in is offered at all.
  const canViewHidden = directoryV2Enabled
    ? await hasPermission(
        resolved.org.personId,
        resolved.org.organizationId,
        "directory.view_hidden",
      )
    : false;

  if (view === "households") {
    // The exact `{ search }` shape Increment 3 shipped is preserved when
    // `canViewHidden` is false — the regression floor its own tests pin.
    const householdsOpts = canViewHidden
      ? { search, includeHidden: true }
      : { search };
    let householdsResult;
    try {
      householdsResult = await getHouseholds(
        resolved.org.personId,
        resolved.org.organizationId,
        householdsOpts,
      );
    } catch (err) {
      if (err instanceof OrgAccessError) {
        throw err;
      }
      return <DirectoryLoadError slug={slug} />;
    }

    if (householdsResult.kind === "forbidden") {
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
          view={view}
          search={search}
          canViewHidden={canViewHidden}
        />
        <HouseholdsGrid
          households={householdsResult.households}
          search={search}
          orgName={resolved.org.name}
          slug={slug}
        />
      </section>
    );
  }

  let result;
  try {
    const directoryOpts = canViewHidden
      ? { search, includeHidden: true }
      : { search };
    result = await getDirectory(
      resolved.org.personId,
      resolved.org.organizationId,
      directoryV2Enabled ? directoryOpts : undefined,
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

  if (directoryV2Enabled) {
    // `DirectoryGrid` is AWAITED HERE, not embedded as `<DirectoryGrid ... />`
    // JSX — it is an async function with no async descendants of its own
    // (every card's photo resolves via `Promise.all()` inside it before it
    // returns), so calling and awaiting it here produces one fully resolved
    // element, the same "await the async function directly" shape this
    // page's own tests already rely on for `DirectoryPage` itself.
    const grid = await DirectoryGrid({
      entries: result.entries,
      organizationId: resolved.org.organizationId,
      search,
      orgName: resolved.org.name,
      slug,
    });
    return (
      <section>
        <h1 className="text-2xl font-semibold">Directory</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
        <DirectoryNav
          slug={slug}
          view={view}
          search={search}
          canViewHidden={canViewHidden}
        />
        {grid}
      </section>
    );
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
