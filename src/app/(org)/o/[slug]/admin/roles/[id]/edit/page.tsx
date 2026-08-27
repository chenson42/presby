import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { getRoleDefinition, listPermissionCatalog } from "@/lib/role-definitions";
import { OrgAccessDenied, OrgAccessEnded } from "../../../../org-states";
import {
  RoleDefinitionForbidden,
  RoleDefinitionLoadError,
  RoleDefinitionNotFound,
  RoleDefinitionProtected,
  RolesFlagOff,
} from "../../roles-states";
import { EditRoleForm } from "./edit-role-form";
import { DeactivateRoleDialog } from "./deactivate-role-dialog";

/**
 * `/o/<slug>/admin/roles/[id]/edit` — edit an existing custom role's
 * permission set, or deactivate it (docs/work-log/
 * 2026-08-26-role-permissions-admin.md, Phase 3 design). Same auth/flag/gate
 * pattern as `../../page.tsx` and `../../new/page.tsx`.
 *
 * `getRoleDefinition()` RETURNS `ok | forbidden | not_found` — there is no
 * `protected_role` result variant on this read (that's a `setRolePermissions`/
 * `deactivateRole` write-time concern). Whether the role is constitutional is
 * a PROPERTY OF THE `ok` RESULT (`role.isProtected`), checked here, in the
 * page, before rendering the editable form — `isProtected` is the gate, not
 * `role_kind` (DECISION-106 ruling 5), matching every other check in this
 * feature.
 */
export default async function EditRolePage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(
        `/o/${slug}/admin/roles/${id}/edit`,
      )}`,
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

  const rolesEnabled = await isFlagEnabled("org_portal.roles");
  if (!rolesEnabled) {
    return <RolesFlagOff name={resolved.org.name} />;
  }

  let result;
  try {
    result = await getRoleDefinition(
      resolved.org.personId,
      resolved.org.organizationId,
      id,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <RoleDefinitionLoadError slug={slug} />;
  }

  if (result.kind === "forbidden") {
    return <RoleDefinitionForbidden name={resolved.org.name} />;
  }
  if (result.kind === "not_found") {
    return <RoleDefinitionNotFound slug={slug} />;
  }

  if (result.role.isProtected) {
    return <RoleDefinitionProtected slug={slug} role={result.role} />;
  }

  const catalog = await listPermissionCatalog();

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit role</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
        <Link
          href={`/o/${slug}/admin/roles`}
          className="mt-2 inline-block text-sm text-muted-foreground underline underline-offset-2"
        >
          Back to roles
        </Link>
      </div>

      <EditRoleForm slug={slug} role={result.role} catalog={catalog} />

      <div className="border-t border-border pt-6">
        <h2 className="mb-2 text-sm font-semibold text-destructive">
          Danger zone
        </h2>
        <DeactivateRoleDialog
          slug={slug}
          roleId={result.role.id}
          roleName={result.role.name}
          holderCount={result.role.holderCount}
        />
      </div>
    </section>
  );
}
