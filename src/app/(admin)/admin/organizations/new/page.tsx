import Link from "next/link";
import { inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getPlatformDb } from "@/lib/db";
import { organizations } from "@/lib/db/domain/org";
import { FEATURES, hasFeature } from "@/lib/permissions";
import {
  CreateOrganizationForm,
  type EligibleParentsByType,
} from "./create-organization-form";

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
 * fetch for the form's own fields; the one read is the list of councils that
 * can receive a new organization (parent picker, docs/work-log/
 * 2026-09-28-organization-parent-picker.md). Its predicate is TYPE-ONLY —
 * never `platform_status`: `presby_assert_council_authority()` checks type
 * only, and an `invited`/`unmanaged` presbytery is a valid parent (PSV's own
 * onboarding order depends on it). The org tree is public (DECISION-040), so
 * listing councils leaks nothing. A fetch failure degrades to `null` — the
 * rest of the form (name/slug/type) stays usable.
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

  let eligibleParents: EligibleParentsByType = null;
  try {
    const rows = await getPlatformDb()
      .select({
        id: organizations.id,
        name: organizations.name,
        organizationType: organizations.organizationType,
      })
      .from(organizations)
      .where(
        inArray(organizations.organizationType, [
          "presbytery",
          "synod",
          "general_assembly",
        ]),
      )
      .orderBy(organizations.name);
    const grouped = { presbytery: [], synod: [], general_assembly: [] } as NonNullable<EligibleParentsByType>;
    for (const r of rows) {
      if (
        r.organizationType === "presbytery" ||
        r.organizationType === "synod" ||
        r.organizationType === "general_assembly"
      ) {
        grouped[r.organizationType].push({ id: r.id, name: r.name });
      }
    }
    eligibleParents = grouped;
  } catch {
    eligibleParents = null;
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

      <CreateOrganizationForm eligibleParents={eligibleParents} />
    </div>
  );
}
