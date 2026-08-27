import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { listPermissionCatalog, listTemplateRoles } from "@/lib/role-definitions";
import { OrgAccessDenied, OrgAccessEnded } from "../../../org-states";
import {
  RoleDefinitionForbidden,
  RoleDefinitionLoadError,
  RolesFlagOff,
} from "../roles-states";
import { CreateRoleForm } from "./create-role-form";

/**
 * `/o/<slug>/admin/roles/new` — create a custom role, or adopt a stock
 * template (docs/work-log/2026-08-26-role-permissions-admin.md, Phase 3
 * design). Same auth/flag/gate pattern as `../page.tsx`, repeated in full for
 * the same reason (see that file's header): the auth check lives in the
 * page, not the layout, because a layout can't see the pathname to build a
 * correct `callbackUrl`.
 *
 * `listTemplateRoles()` DOUBLES AS THIS PAGE'S `roles.manage` GATE — it runs
 * the same internal check `listPermissionCatalog()` does not (that one is a
 * plain global read, no org scoping), and this page needs the template list
 * regardless, so there is no separate round trip spent only to check the
 * permission and throw the answer away.
 */
export default async function NewRolePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/roles/new`)}`,
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

  let templatesResult;
  try {
    templatesResult = await listTemplateRoles(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <RoleDefinitionLoadError slug={slug} />;
  }

  if (templatesResult.kind === "forbidden") {
    return <RoleDefinitionForbidden name={resolved.org.name} />;
  }

  const catalog = await listPermissionCatalog();

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Create a role</h1>
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
      <CreateRoleForm
        slug={slug}
        catalog={catalog}
        templates={templatesResult.templates}
      />
    </section>
  );
}
