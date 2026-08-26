import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getOfficerFormOptions, listOfficerRoster } from "@/lib/officers";
import { isFlagEnabled } from "@/lib/flags";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import {
  OfficersFlagOff,
  OfficersForbidden,
  OfficersLoadError,
} from "./officers-states";
import { OfficerRoster } from "./officer-roster";
import { AddOfficerTermForm } from "./add-officer-term-form";

/**
 * `/o/<slug>/admin/officers` — the roster/recording surface for who holds
 * ordained/administrative office at a congregation. Groups-and-officers
 * Phase 3 design (`docs/work-log/2026-08-26-groups-and-officers.md`),
 * commit 3/3.
 *
 * REPEATS THE `(org)` AUTH PATTERN IN FULL, on purpose, same as
 * `admin/roles/page.tsx` — see that file's header for the fuller rationale
 * on why the auth check lives in the page rather than the layout.
 *
 * THE FLAG CHECK RUNS BEFORE `listOfficerRoster()`/`getOfficerFormOptions()`
 * ARE EVER CALLED. `org_portal.officers` answers "is this feature on at all"
 * and `officers.manage` answers "may THIS person administer officer terms
 * here" — two different questions (Phase 2/3), and checking the flag first
 * means a congregation with the feature off never pays for a
 * permission-resolver round trip only to throw the answer away. Identical
 * ordering to `admin/roles/page.tsx`.
 *
 * `listOfficerRoster()`/`getOfficerFormOptions()` THROW on genuine failure
 * rather than returning a result variant for it, specifically so this page
 * can tell "denied" apart from "broken" (same contract `src/lib/officers.ts`
 * documents, mirroring `src/lib/role-grants.ts`). `OrgAccessError` — the
 * relationship vanishing between `resolveOrgContext` and the transaction —
 * is RE-THROWN, not swallowed: `[slug]/error.tsx` already has the correct
 * copy for that case, one level up. Anything else (a real DB failure)
 * renders the load-error state inline.
 */
export default async function OfficersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/officers`)}`,
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

  const officersEnabled = await isFlagEnabled("org_portal.officers");
  if (!officersEnabled) {
    return <OfficersFlagOff name={resolved.org.name} />;
  }

  let rosterResult;
  try {
    rosterResult = await listOfficerRoster(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <OfficersLoadError slug={slug} />;
  }

  if (rosterResult.kind !== "ok") {
    // `listOfficerRoster()` only ever returns "ok" or "forbidden" in
    // practice — `invalid_target`/`invalid_input`/`overlap` exist on the
    // shared `OfficersResult<T>` type because the mutation functions
    // (`startOfficerTerm`/`endOfficerTerm`) share it, not because this read
    // path produces them. Handled defensively rather than assumed
    // unreachable, same discipline `admin/roles/page.tsx` documents for its
    // own redundant `optionsResult.kind === "forbidden"` check below.
    if (rosterResult.kind === "forbidden") {
      return <OfficersForbidden name={resolved.org.name} />;
    }
    return <OfficersLoadError slug={slug} />;
  }

  let optionsResult;
  try {
    optionsResult = await getOfficerFormOptions(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <OfficersLoadError slug={slug} />;
  }

  if (optionsResult.kind !== "ok") {
    // Unreachable in practice — `listOfficerRoster()` already confirmed the
    // same `officers.manage` gate above via the identical check. Handled
    // anyway rather than assumed, same as `admin/roles/page.tsx`.
    if (optionsResult.kind === "forbidden") {
      return <OfficersForbidden name={resolved.org.name} />;
    }
    return <OfficersLoadError slug={slug} />;
  }

  return (
    <section className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Officers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Current roster</h2>
        <OfficerRoster entries={rosterResult.data} slug={slug} />
      </div>

      <div className="max-w-md space-y-4">
        <h2 className="text-xl font-semibold">Add an officer term</h2>
        <p className="text-sm text-muted-foreground">
          This records who holds the office. Granting software access
          (Administration → Roles) is done separately — recording someone
          here does not, by itself, change what they can do in the app.
        </p>
        <AddOfficerTermForm slug={slug} options={optionsResult.data} />
      </div>
    </section>
  );
}
