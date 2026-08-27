import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The three non-data-bearing answers `/o/<slug>/admin/roles` can give (a
 * fourth — an unauthorized org, or a 404 slug — is handled one level up by
 * `org-states.tsx` / `not-found.tsx`, reused as-is rather than duplicated).
 * Modeled directly on `directory/directory-states.tsx`, same three-block
 * structure and copy register.
 *
 * THREE DISTINCT COPY BLOCKS, DELIBERATELY NOT COLLAPSED (Phase 3):
 *   - flag off: a product-not-here message, no permission or error framing.
 *   - forbidden: a permission message, worded so it does NOT read as "your
 *     whole portal access was revoked" — that is `OrgAccessDenied`'s job,
 *     one level up, and the two must not sound alike.
 *   - load error: a broken-right-now message with a retry, not a "you can't"
 *     message.
 * A reader who only skims one of these three should not be able to guess
 * what the other two say.
 */

/** `org_portal.roles` is off. A product-not-here message, not a denial. */
export function RolesFlagOff({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Roles</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Role administration isn&apos;t turned on for {name} yet.
      </p>
    </section>
  );
}

/**
 * `listGrants()`/`getGrantFormOptions()` returned `{ kind: "forbidden" }` —
 * the viewer has an active relationship with the organization (they got past
 * `assertOrgAccess` to reach this page at all) but holds no
 * `role_grants.manage` grant. Worded deliberately unlike `OrgAccessDenied`'s
 * "you don't have access to {org}" — a member reading this should understand
 * ONE capability is unavailable to them, not that their whole portal access
 * was revoked.
 */
export function RolesForbidden({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Roles</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        You don&apos;t have permission to grant or revoke roles at {name}. If
        you think this is a mistake, ask your stated clerk or another
        administrator there.
      </p>
    </section>
  );
}

/**
 * A genuine, non-`OrgAccessError` failure reading role grants (a DB blip,
 * most likely). The retry is a plain `<Link>` to the same path — this stays
 * a Server Component, so there is no client `reset()` to call, unlike
 * `[slug]/error.tsx`.
 */
export function RolesLoadError({ slug }: { slug: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Roles</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We couldn&apos;t load role assignments right now. Try again in a
        moment.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={`/o/${slug}/admin/roles`}>Try again</Link>
      </Button>
    </section>
  );
}

/**
 * `roles.manage`-gated states — shared by the role *definition* surfaces
 * (`/admin/roles`'s third section, `/admin/roles/new`,
 * `/admin/roles/[id]/edit`; docs/work-log/2026-08-26-role-permissions-admin.md,
 * Phase 3 Component Plan). Deliberately distinct copy from `RolesForbidden`
 * above — that state denies role *grants* (`role_grants.manage`); this one
 * denies role *definition* (`roles.manage`), a different, more powerful
 * capability (DECISION-106) — a reader who holds one but not the other must
 * not be told the wrong thing is missing.
 */

/** The viewer has an active relationship with the org but holds no
 * `roles.manage` grant. Reachable from the roles list's third section (which
 * simply omits itself) AND directly, if someone deep-links `/new` or
 * `/[id]/edit` without holding the permission. */
export function RoleDefinitionForbidden({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Roles</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        You don&apos;t have permission to create or edit role definitions at{" "}
        {name}. If you think this is a mistake, ask your stated clerk or
        another administrator there.
      </p>
    </section>
  );
}

/** `getRoleDefinition()` returned `{ kind: "not_found" }` — the role id in
 * the URL doesn't exist at this organization (never existed, or belongs to
 * another org; the two collapse the same way, enumeration-safe). */
export function RoleDefinitionNotFound({ slug }: { slug: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Role not found</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        That role no longer exists at this organization.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={`/o/${slug}/admin/roles`}>Back to roles</Link>
      </Button>
    </section>
  );
}

/** The role exists and the viewer holds `roles.manage`, but
 * `role.isProtected` is true — a constitutional role (`role_admin` itself,
 * and any future seeded role). Read-only, no form: `isProtected` is the gate,
 * not `role_kind` (DECISION-106 ruling 5), and this UI never edits or
 * deactivates a constitutional role, even if reached by a guessed URL —
 * `role-catalog-list.tsx` already omits the "Edit" link for these rows; this
 * is the second, server-side layer of the same rule. */
export function RoleDefinitionProtected({
  slug,
  role,
}: {
  slug: string;
  role: { name: string; key: string; permissionKeys: string[] };
}) {
  return (
    <section className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{role.name}</h1>
      <p className="text-sm text-muted-foreground">
        This is a constitutional role (key: {role.key}) and can&apos;t be
        edited or deactivated here — its permission set is managed by the
        platform. It carries {role.permissionKeys.length}{" "}
        {role.permissionKeys.length === 1 ? "permission" : "permissions"}.
      </p>
      <Button asChild className="min-h-11">
        <Link href={`/o/${slug}/admin/roles`}>Back to roles</Link>
      </Button>
    </section>
  );
}

/** A genuine, non-`OrgAccessError` failure reading a role definition (a DB
 * blip, most likely) — the retry is a plain `<Link>` back to the roles list,
 * same posture as `RolesLoadError` above (this stays a Server Component, so
 * there's no client `reset()` to call). */
export function RoleDefinitionLoadError({ slug }: { slug: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Roles</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We couldn&apos;t load that right now. Try again in a moment.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={`/o/${slug}/admin/roles`}>Back to roles</Link>
      </Button>
    </section>
  );
}
