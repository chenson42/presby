import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getGrantFormOptions, listGrants } from "@/lib/role-grants";
import {
  listRoleDefinitions,
  type RoleDefinitionsListResult,
} from "@/lib/role-definitions";
import { isFlagEnabled } from "@/lib/flags";
import { Button } from "@/components/ui/button";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import { RolesFlagOff, RolesForbidden, RolesLoadError } from "./roles-states";
import { RolesList } from "./roles-list";
import { GrantRoleForm } from "./grant-role-form";
import { RoleCatalogList } from "./role-catalog-list";

/**
 * `/o/<slug>/admin/roles` — grant, revoke, and view role assignments (P9,
 * `docs/work-log/2026-08-19-tenant-administration.md`).
 *
 * REPEATS THE `(org)` AUTH PATTERN IN FULL, on purpose, same as
 * `directory/page.tsx` — see that file's header for the fuller rationale on
 * why the auth check lives in the page rather than the layout.
 *
 * THE FLAG CHECK RUNS BEFORE `listGrants()`/`getGrantFormOptions()` ARE EVER
 * CALLED. `org_portal.roles` answers "is this feature on at all" and
 * `role_grants.manage` answers "may THIS person administer role grants" —
 * two different questions (Phase 2), and checking the flag first means a
 * congregation with the feature off never pays for a permission-resolver
 * round trip only to throw the answer away.
 *
 * `listGrants()`/`getGrantFormOptions()` THROW on genuine failure rather than
 * returning a result variant for it, specifically so this page can tell
 * "denied" apart from "broken" — same contract as `src/lib/directory.ts`.
 * `OrgAccessError` — the relationship vanishing between `resolveOrgContext`
 * and the transaction — is RE-THROWN, not swallowed: `[slug]/error.tsx`
 * already has the correct copy for that case, one level up. Anything else (a
 * real DB failure) renders the load-error state inline.
 */
export default async function RolesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/roles`)}`,
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

  // The authoritative gate — see `../../page.tsx`'s identical call for the
  // full rationale. Every `(org)` page calls it, including this one.
  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const rolesEnabled = await isFlagEnabled("org_portal.roles");
  if (!rolesEnabled) {
    return <RolesFlagOff name={resolved.org.name} />;
  }

  let grantsResult;
  try {
    grantsResult = await listGrants(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <RolesLoadError slug={slug} />;
  }

  if (grantsResult.kind === "forbidden") {
    return <RolesForbidden name={resolved.org.name} />;
  }

  let optionsResult;
  try {
    optionsResult = await getGrantFormOptions(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <RolesLoadError slug={slug} />;
  }

  if (optionsResult.kind === "forbidden") {
    // Unreachable in practice — `listGrants()` already confirmed the same
    // `role_grants.manage` gate above via the identical check. Handled
    // anyway rather than assumed, since the two are separate calls.
    return <RolesForbidden name={resolved.org.name} />;
  }

  // THE THIRD SECTION — "Role catalog," rendered ONLY when the viewer holds
  // `roles.manage` (a permission distinct from `role_grants.manage`, which
  // gates everything above — DECISION-106). `listRoleDefinitions()` runs its
  // own gate and returns `{ kind: "forbidden" }` for a viewer who doesn't
  // hold it; that result simply omits the section below rather than
  // rendering a denial banner — this is an ADDITIONAL capability on a page
  // whose primary function (grant/revoke) the viewer already has, not a
  // second copy of the whole-page gate. A genuine load failure (anything
  // other than `OrgAccessError`, which is re-thrown like every other call on
  // this page) degrades to a small inline notice rather than losing the
  // rest of an already-successful page render.
  let roleDefsResult: RoleDefinitionsListResult | null = null;
  try {
    roleDefsResult = await listRoleDefinitions(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    roleDefsResult = null;
  }

  return (
    <section className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Roles</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Who holds what</h2>
        <RolesList grants={grantsResult.grants} slug={slug} />
      </div>

      <div className="max-w-md space-y-4">
        <h2 className="text-xl font-semibold">Grant a role</h2>
        <GrantRoleForm slug={slug} options={optionsResult.options} />
      </div>

      {roleDefsResult?.kind === "ok" && (
        <div className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-semibold">Role catalog</h2>
            <Button asChild size="sm" className="min-h-11 sm:min-h-9">
              <Link href={`/o/${slug}/admin/roles/new`}>Create role</Link>
            </Button>
          </div>
          <RoleCatalogList roles={roleDefsResult.roles} slug={slug} />
        </div>
      )}

      {roleDefsResult === null && (
        <p className="max-w-md text-sm text-muted-foreground">
          We couldn&apos;t load the role catalog right now. Refresh the page
          to try again.
        </p>
      )}
    </section>
  );
}
