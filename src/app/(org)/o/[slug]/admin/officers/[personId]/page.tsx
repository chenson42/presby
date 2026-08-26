import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getOfficerHistory } from "@/lib/officers";
import { isFlagEnabled } from "@/lib/flags";
import { OrgAccessDenied, OrgAccessEnded } from "../../../org-states";
import {
  OfficersFlagOff,
  OfficersForbidden,
  OfficersLoadError,
} from "../officers-states";
import { OfficerHistory } from "../officer-history";

/**
 * `/o/<slug>/admin/officers/<personId>` — one person's full officer history
 * (Flow 3). Groups-and-officers Phase 3 design, commit 3/3. Mirrors
 * `admin/members/[id]/edit/page.tsx`'s existence as a per-person detail
 * route one level below the parent list page, and repeats the `(org)` auth
 * pattern in full for the same reason every page under `(org)` does.
 *
 * `?name=` IS UI-ONLY CONTEXT, NOT PART OF THE OFFICERS API CONTRACT.
 * `getOfficerHistory()` deliberately returns no display name (Phase 3's API
 * Contract table) — a person can have real officer history after their
 * membership has ended, so a name lookup scoped to CURRENT members
 * (`getOfficerFormOptions()`'s own F21-shaped list) would fail exactly the
 * case this page most needs to handle. The roster page already has the
 * display name in hand when it links here (`OfficerRoster`), so it is
 * passed through the URL — the same "receiving page reads its own query
 * param, falls back to a safe default" shape `docs/ui-standards.md`'s Back
 * Navigation section already establishes for `?from=`. A direct visit with
 * no `name` (or an empty one) falls back to generic copy rather than
 * fetching a second, wider query just to word a heading.
 *
 * `getOfficerHistory()`'s `{ kind: "invalid_target" }` (the personId has
 * never had a membership at this org) is a real 404, not a load error — same
 * as `getPersonForEdit()`'s `not_found` branch in
 * `admin/members/[id]/edit/page.tsx`.
 */
export default async function OfficerHistoryPage({
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
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/officers/${personId}`)}`,
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

  const officersEnabled = await isFlagEnabled("org_portal.officers");
  if (!officersEnabled) {
    return <OfficersFlagOff name={resolved.org.name} />;
  }

  let historyResult;
  try {
    historyResult = await getOfficerHistory(
      resolved.org.personId,
      resolved.org.organizationId,
      personId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <OfficersLoadError slug={slug} />;
  }

  if (historyResult.kind !== "ok") {
    if (historyResult.kind === "forbidden") {
      return <OfficersForbidden name={resolved.org.name} />;
    }
    if (historyResult.kind === "invalid_target") {
      notFound();
    }
    // `invalid_input`/`overlap` — unreachable from `getOfficerHistory()` in
    // practice; see `page.tsx`'s identical defensive-handling comment.
    return <OfficersLoadError slug={slug} />;
  }

  const displayName = name && name.trim().length > 0 ? name : "This person";

  return (
    <section className="space-y-6">
      <div>
        <Link
          href={`/o/${slug}/admin/officers`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to officers
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">
          {displayName}&apos;s officer history
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
      </div>
      <OfficerHistory entries={historyResult.data} />
    </section>
  );
}
