import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  hasPermission,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getStaffFormOptions, listStaffRoster } from "@/lib/staff";
import { isFlagEnabled } from "@/lib/flags";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import { StaffFlagOff, StaffForbidden, StaffLoadError } from "./staff-states";
import { StaffRoster } from "./staff-roster";
import { AddStaffPositionForm } from "./add-staff-position-form";

/**
 * `/o/<slug>/admin/staff` — the roster/recording surface for who holds a
 * paid, non-ordained position at a congregation or presbytery (staff-and-
 * personnel Phase 3 design, `docs/work-log/2026-08-27-staff-and-
 * personnel.md`, ux-developer slice).
 *
 * REPEATS THE `(org)` AUTH PATTERN IN FULL, on purpose, same as
 * `admin/officers/page.tsx` — see that file's header for the fuller
 * rationale on why the auth check lives in the page rather than the layout.
 *
 * THE FLAG CHECK RUNS BEFORE `listStaffRoster()`/`getStaffFormOptions()` ARE
 * EVER CALLED — `org_portal.staff` answers "is this feature on at all" and
 * `staff.manage` answers "may THIS person administer staff here", two
 * different questions (DECISION-003), identical ordering to
 * `admin/officers/page.tsx`.
 *
 * `listStaffRoster()`/`getStaffFormOptions()` THROW on genuine failure
 * rather than returning a result variant for it, specifically so this page
 * can tell "denied" apart from "broken" (same contract `src/lib/staff.ts`
 * documents). `OrgAccessError` is RE-THROWN, not swallowed — `[slug]/
 * error.tsx` already has the correct copy for that case, one level up.
 * Anything else (a real DB failure) renders the load-error state inline.
 *
 * `canCreatePeople` (`hasPermission(..., "people.manage")`) IS COMPUTED
 * HERE AND PASSED DOWN, not inferred inside the client form — mirrors
 * `admin/members/page.tsx`'s own `canCreate` shape for the identical
 * permission key. This is what makes the architect's Phase 2/3 ruling
 * ("`staff.manage` alone must not reach the inline 'add a new person'
 * affordance") visible in the UI rather than merely enforced silently by
 * `createStaffPersonAction`'s own server-side gate.
 *
 * `?includeEnded=1` is a plain query-string toggle (zero client JS needed
 * for the roster itself) — mirrors `admin/members/page.tsx`'s own
 * `search`/`status`/`page` query-param shape, not a new client-state
 * mechanism. `listStaffRoster()`'s `includeEnded` option already exists on
 * the read contract (Phase 3's API table); this page is the only caller.
 */
export default async function StaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ includeEnded?: string }>;
}) {
  const { slug } = await params;
  const { includeEnded: rawIncludeEnded } = await searchParams;
  const includeEnded = rawIncludeEnded === "1";

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/staff`)}`,
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

  // The authoritative gate — see `../../page.tsx`'s identical call for the
  // full rationale. Every `(org)` page calls it, including this one.
  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const staffEnabled = await isFlagEnabled("org_portal.staff");
  if (!staffEnabled) {
    return <StaffFlagOff name={resolved.org.name} />;
  }

  let rosterResult;
  try {
    rosterResult = await listStaffRoster(
      resolved.org.personId,
      resolved.org.organizationId,
      { includeEnded },
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <StaffLoadError slug={slug} />;
  }

  if (rosterResult.kind !== "ok") {
    // `listStaffRoster()` only ever returns "ok" or "forbidden" in
    // practice — `invalid_target`/`invalid_input`/`overlap` exist on the
    // shared `StaffResult<T>` type because the mutation functions
    // (`startStaffPosition`/`endStaffPosition`) share it, not because this
    // read path produces them. Handled defensively rather than assumed
    // unreachable, same discipline `admin/officers/page.tsx` documents.
    if (rosterResult.kind === "forbidden") {
      return <StaffForbidden name={resolved.org.name} />;
    }
    return <StaffLoadError slug={slug} />;
  }

  let optionsResult;
  try {
    optionsResult = await getStaffFormOptions(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <StaffLoadError slug={slug} />;
  }

  if (optionsResult.kind !== "ok") {
    // Unreachable in practice — `listStaffRoster()` already confirmed the
    // same `staff.manage` gate above via the identical check. Handled
    // anyway rather than assumed, same as `admin/officers/page.tsx`.
    if (optionsResult.kind === "forbidden") {
      return <StaffForbidden name={resolved.org.name} />;
    }
    return <StaffLoadError slug={slug} />;
  }

  // Independent awaited call, not merged into the roster/options
  // Promise chain — a `people.manage` check failing has nothing to do with
  // whether `staff.manage` reads succeeded, same "don't cross-contaminate
  // independent checks" discipline `admin/members/page.tsx`'s own header
  // documents for its analogous `canCreate`/`canViewChildrenRoster` pair.
  const canCreatePeople = await hasPermission(
    resolved.org.personId,
    resolved.org.organizationId,
    "people.manage",
  );

  const toggleHref = includeEnded
    ? `/o/${slug}/admin/staff`
    : `/o/${slug}/admin/staff?includeEnded=1`;

  return (
    <section className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Staff</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-semibold">Current roster</h2>
          <Link
            href={toggleHref}
            className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {includeEnded ? "Hide ended positions" : "Show ended positions"}
          </Link>
        </div>
        <StaffRoster entries={rosterResult.data} slug={slug} />
      </div>

      <div className="max-w-md space-y-4">
        <h2 className="text-xl font-semibold">Add a staff position</h2>
        <p className="text-sm text-muted-foreground">
          This records who holds the position. Granting software access
          (Administration → Roles) is done separately — recording someone
          here does not, by itself, change what they can do in the app.
        </p>
        <AddStaffPositionForm
          slug={slug}
          options={optionsResult.data}
          canCreatePeople={canCreatePeople}
        />
      </div>
    </section>
  );
}
