import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getStaffHistory } from "@/lib/staff";
import { isFlagEnabled } from "@/lib/flags";
import { OrgAccessDenied, OrgAccessEnded } from "../../../org-states";
import { StaffFlagOff, StaffForbidden, StaffLoadError } from "../staff-states";
import { StaffHistory } from "../staff-history";

/**
 * `/o/<slug>/admin/staff/<personId>` — one person's full staff history.
 * Mirrors `admin/officers/[personId]/page.tsx` exactly, per Phase 3's
 * Component/Page Plan, and repeats the `(org)` auth pattern in full for the
 * same reason every page under `(org)` does.
 *
 * `?name=` IS UI-ONLY CONTEXT, NOT PART OF THE STAFF API CONTRACT.
 * `getStaffHistory()` deliberately returns no display name (Phase 3's API
 * Contract table) — a person can have real staff history after their
 * membership has ended, so a name lookup scoped to CURRENT members
 * (`getStaffFormOptions()`'s own F21-shaped list) would fail exactly the
 * case this page most needs to handle. The roster page already has the
 * display name in hand when it links here (`StaffRoster`), so it is passed
 * through the URL — same shape `admin/officers/[personId]/page.tsx`'s
 * identical header documents. A direct visit with no `name` (or an empty
 * one) falls back to generic copy rather than fetching a second, wider
 * query just to word a heading.
 *
 * `getStaffHistory()`'s `{ kind: "invalid_target" }` (the personId has never
 * had a membership at this org) is a real 404, not a load error — same as
 * `getOfficerHistory()`'s identical branch.
 */
export default async function StaffHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; personId: string }>;
  searchParams: Promise<{ name?: string }>;
}) {
  const { slug, personId } = await params;
  const { name } = await searchParams;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/staff/${personId}`)}`,
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

  const staffEnabled = await isFlagEnabled("org_portal.staff");
  if (!staffEnabled) {
    return <StaffFlagOff name={resolved.org.name} />;
  }

  let historyResult;
  try {
    historyResult = await getStaffHistory(
      resolved.org.personId,
      resolved.org.organizationId,
      personId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <StaffLoadError slug={slug} />;
  }

  if (historyResult.kind !== "ok") {
    if (historyResult.kind === "forbidden") {
      return <StaffForbidden name={resolved.org.name} />;
    }
    if (historyResult.kind === "invalid_target") {
      notFound();
    }
    // `invalid_input`/`overlap` — unreachable from `getStaffHistory()` in
    // practice; see `page.tsx`'s identical defensive-handling comment.
    return <StaffLoadError slug={slug} />;
  }

  const displayName = name && name.trim().length > 0 ? name : "This person";

  return (
    <section className="space-y-6">
      <div>
        <Link
          href={`/o/${slug}/admin/staff`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to staff
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">
          {displayName}&apos;s staff history
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
      </div>
      <StaffHistory entries={historyResult.data} />
    </section>
  );
}
