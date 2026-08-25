import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  hasPermission,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getHouseholdDetail } from "@/lib/directory";
import { isFlagEnabled } from "@/lib/flags";
import { DeaconCard } from "@/components/org-portal/deacon-card";
import { OrgAccessDenied, OrgAccessEnded } from "../../../org-states";
import {
  DirectoryFlagOff,
  DirectoryForbidden,
  DirectoryLoadError,
} from "../../directory-states";
import { resolvePhotoSrc } from "../../person-avatar";
import { PersonCard } from "../../person-card";

/**
 * `/o/<slug>/directory/households/<householdId>` — one household's detail
 * (Phase 3 Increment 3).
 *
 * A DISTINCT ROUTE SEGMENT, not `?household=` on the households grid — the
 * Phase 2 architectural ruling: it needs its own 404 for a bad id, which a
 * query param on the list page couldn't give cleanly. `directory/[personId]`
 * is this page's sibling in every structural respect (auth pattern, flag
 * gating, `not-found.tsx`, no `loading.tsx`) — see that file's header for the
 * shared rationale, not repeated here.
 *
 * `getHouseholdDetail()`'s three outcomes map identically to
 * `getPersonDetail()`'s: `"forbidden"` → `DirectoryForbidden`, `"not-found"`
 * → `notFound()` (covers nonexistent id, another org's id, AND a household
 * with zero currently-visible members — all indistinguishable per the Phase
 * 3 design), any other thrown error → `DirectoryLoadError`.
 */
export default async function HouseholdDetailPage({
  params,
}: {
  params: Promise<{ slug: string; householdId: string }>;
}) {
  const { slug, householdId } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/directory/households/${householdId}`)}`,
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

  const directoryEnabled = await isFlagEnabled("org_portal.directory");
  const directoryV2Enabled = await isFlagEnabled("org_portal.directory_v2");
  if (!directoryEnabled || !directoryV2Enabled) {
    return <DirectoryFlagOff name={resolved.org.name} />;
  }

  // Increment 4: checked DIRECTLY (not a flag) — see `directory/page.tsx`'s
  // identical pattern. Threaded into `getHouseholdDetail()` as a REQUEST,
  // re-verified there before being honored.
  const canViewHidden = await hasPermission(
    resolved.org.personId,
    resolved.org.organizationId,
    "directory.view_hidden",
  );

  let result;
  try {
    // Ordinary callers keep the exact 3-argument call shape Increment 3
    // shipped — the regression floor its own tests pin.
    result = canViewHidden
      ? await getHouseholdDetail(
          resolved.org.personId,
          resolved.org.organizationId,
          householdId,
          { includeHidden: true },
        )
      : await getHouseholdDetail(
          resolved.org.personId,
          resolved.org.organizationId,
          householdId,
        );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <DirectoryLoadError slug={slug} />;
  }

  if (result.kind === "forbidden") {
    return <DirectoryForbidden name={resolved.org.name} />;
  }
  if (result.kind === "not-found") {
    notFound();
  }

  const { household } = result;
  const cityState = household.address
    ? [
        household.address.city,
        household.address.region,
        household.address.postalCode,
      ]
        .filter((part): part is string => Boolean(part))
        .join(", ")
    : "";

  const photoSrcs = await Promise.all(
    household.members.map((member) =>
      resolvePhotoSrc(resolved.org.organizationId, member.photoKey),
    ),
  );

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <Link
          href={`/o/${slug}/directory?view=households`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to households
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">{household.name}</h1>
        {household.address && (
          <p className="mt-1 text-sm text-muted-foreground">
            {household.address.line1 && (
              <span className="block">{household.address.line1}</span>
            )}
            {cityState && <span className="block">{cityState}</span>}
          </p>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-xl font-semibold">
          {household.memberCount}{" "}
          {household.memberCount === 1 ? "member" : "members"}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {household.members.map((member, i) => (
            <PersonCard
              key={member.personId}
              entry={member}
              photoSrc={photoSrcs[i] ?? null}
              slug={slug}
            />
          ))}
        </div>
      </div>

      {/* Increment 4: rendered LAST (Phase 1's Flow 5) — see
          `DeaconCard`'s own header for the null-covers-two-causes rule. */}
      <DeaconCard deaconName={household.deaconName} />
    </section>
  );
}
