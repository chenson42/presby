import Link from "next/link";
import { auth } from "@/auth";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { CreateOrganizationForm } from "./create-organization-form";

/**
 * Create organization — the one write path for `organizations`
 * (docs/work-log/2026-08-24-admin-org-create.md). A dedicated route, not a
 * dialog (Phase 2 ruling): this is the first-ever *permanent* write in the
 * app (the slug is immutable forever), and a cramped `Dialog` is the wrong
 * affordance for a screen that needs room for an explicit "this cannot be
 * changed" warning.
 *
 * Auth/feature gate rendered INLINE, matching `page.tsx`/`[id]/page.tsx`'s
 * "You don't have permission..." pattern verbatim — not a redirect(). No data
 * fetch: a blank form has nothing to hydrate from.
 */
export default async function NewOrganizationPage() {
  const session = await auth();
  if (!hasFeature(session?.user?.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">New organization</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          You don&apos;t have permission to manage organization branding.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <Link
          href="/admin/organizations"
          className="text-sm text-muted-foreground underline"
        >
          ← Back to organizations
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">New organization</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Creates the org row with the minimum fields needed to onboard a
          congregation, presbytery, synod, or new worshiping community.
        </p>
      </div>

      <CreateOrganizationForm />
    </div>
  );
}
