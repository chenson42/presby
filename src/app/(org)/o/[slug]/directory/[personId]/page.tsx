import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  hasPermission,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getHouseholdDetail, getPersonDetail } from "@/lib/directory";
import { isFlagEnabled } from "@/lib/flags";
import { Badge } from "@/components/ui/badge";
import { DeaconCard } from "@/components/org-portal/deacon-card";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import {
  DirectoryFlagOff,
  DirectoryForbidden,
  DirectoryLoadError,
} from "../directory-states";
import { PersonAvatar, resolvePhotoSrc } from "../person-avatar";
import { PersonCard } from "../person-card";
import { formatBirthdayMonthDay } from "../format-birthday";

/**
 * `/o/<slug>/directory/<personId>` — one person's detail (Phase 3
 * Increment 3).
 *
 * REPEATS THE `/o/<slug>` AUTH PATTERN IN FULL, same as every `(org)` page —
 * see `directory/page.tsx`'s own header for why. GATED ON BOTH
 * `org_portal.directory` AND `org_portal.directory_v2`: this route is only
 * ever linked to from the v2 grid/find-a-person, so a congregation with
 * either flag off gets the SAME `DirectoryFlagOff` copy the flat directory
 * itself renders — a member who somehow reaches this URL directly sees "not
 * available yet", not a broken half-built page.
 *
 * `getPersonDetail()`'s three outcomes map onto three DIFFERENT responses,
 * same discipline as `directory/page.tsx`:
 *   - `"forbidden"` (no `directory.view` grant) → `DirectoryForbidden`.
 *   - `"not-found"` → `notFound()`, rendered by this segment's own
 *     `not-found.tsx`. Per DECISION-040's non-disclosure discipline,
 *     extended to this surface by the Phase 3 design: a `personId` that
 *     doesn't exist, belongs to another organization, or is currently
 *     ineligible/hidden are ALL indistinguishable — the SAME `not-found.tsx`
 *     copy either way.
 *   - a genuine thrown error (not `OrgAccessError`, which re-throws to
 *     `[slug]/error.tsx`) → `DirectoryLoadError`.
 *
 * NO `loading.tsx` ON THIS SEGMENT (CLAUDE.md: a segment whose job can
 * `notFound()` must not open a Suspense boundary that flushes a 200 first).
 *
 * The household-members section is a SECOND, best-effort read
 * (`getHouseholdDetail()`) — if it fails for any reason other than
 * `OrgAccessError`, the section is simply omitted rather than crashing a
 * page whose primary content (the person) already loaded successfully.
 */
export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ slug: string; personId: string }>;
}) {
  const { slug, personId } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/directory/${personId}`)}`,
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
  // identical pattern for the nav link. Threaded into `getPersonDetail()`/
  // `getHouseholdDetail()` as a REQUEST; both re-verify it themselves before
  // honoring it, so a stale/optimistic `true` here can never widen what a
  // caller actually sees.
  const canViewHidden = await hasPermission(
    resolved.org.personId,
    resolved.org.organizationId,
    "directory.view_hidden",
  );

  let result;
  try {
    // `canViewHidden` is threaded as a FOURTH argument only when true — an
    // ordinary caller's call shape is byte-identical to Increment 3's own
    // (no options object at all), the regression floor Increment 1–3's own
    // tests already pin.
    result = canViewHidden
      ? await getPersonDetail(
          resolved.org.personId,
          resolved.org.organizationId,
          personId,
          { includeHidden: true },
        )
      : await getPersonDetail(
          resolved.org.personId,
          resolved.org.organizationId,
          personId,
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

  const { entry } = result;
  const displayName = `${entry.preferredName ?? entry.firstName} ${entry.lastName}`;
  const formalNameParts = [entry.firstName, entry.middleName, entry.lastName]
    .filter((part): part is string => Boolean(part))
    .join(" ");
  const formalName = entry.suffix
    ? `${formalNameParts}, ${entry.suffix}`
    : formalNameParts;
  const showFormalName =
    (entry.middleName || entry.suffix) && formalName !== displayName;

  const photoSrc = await resolvePhotoSrc(
    resolved.org.organizationId,
    entry.photoKey,
  );

  let household = null;
  if (entry.householdId) {
    try {
      const householdResult = canViewHidden
        ? await getHouseholdDetail(
            resolved.org.personId,
            resolved.org.organizationId,
            entry.householdId,
            { includeHidden: true },
          )
        : await getHouseholdDetail(
            resolved.org.personId,
            resolved.org.organizationId,
            entry.householdId,
          );
      if (householdResult.kind === "ok") {
        household = householdResult.household;
      }
    } catch (err) {
      if (err instanceof OrgAccessError) {
        throw err;
      }
      // Best-effort secondary read — see this file's own header.
    }
  }

  const otherMembers =
    household?.members.filter((m) => m.personId !== entry.personId) ?? [];
  const otherMemberPhotoSrcs = await Promise.all(
    otherMembers.map((member) =>
      resolvePhotoSrc(resolved.org.organizationId, member.photoKey),
    ),
  );

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <Link
          href={`/o/${slug}/directory`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to directory
        </Link>
      </div>

      <div className="flex items-start gap-4">
        <PersonAvatar
          photoSrc={photoSrc}
          displayName={displayName}
          seed={entry.personId}
          className="size-20"
        />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{displayName}</h1>
            {entry.isHidden && (
              <Badge variant="outline" className="gap-1">
                <Lock className="size-3" aria-hidden />
                Hidden from the directory
              </Badge>
            )}
          </div>
          {showFormalName && (
            <p className="mt-1 text-sm text-muted-foreground">{formalName}</p>
          )}
        </div>
      </div>

      {(entry.email || entry.phone || entry.address || entry.dateOfBirth) && (
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Contact</h2>
          <div className="space-y-1">
            {entry.email && (
              <a
                href={`mailto:${entry.email}`}
                className="flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {entry.email}
              </a>
            )}
            {entry.phone && (
              <a
                href={`tel:${entry.phone}`}
                className="flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {entry.phone}
              </a>
            )}
            {entry.address && (
              <p className="text-sm text-muted-foreground">
                {entry.address.line1 && (
                  <span className="block">{entry.address.line1}</span>
                )}
                <span className="block">
                  {[
                    entry.address.city,
                    entry.address.region,
                    entry.address.postalCode,
                  ]
                    .filter((part): part is string => Boolean(part))
                    .join(", ")}
                </span>
              </p>
            )}
            {entry.dateOfBirth && (
              <p className="text-sm text-muted-foreground">
                Birthday: {formatBirthdayMonthDay(entry.dateOfBirth)}
              </p>
            )}
          </div>
        </div>
      )}

      {household && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-semibold">Household</h2>
            <Link
              href={`/o/${slug}/directory/households/${household.householdId}`}
              className="text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              View household →
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">{household.name}</p>
          {otherMembers.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {otherMembers.map((member, i) => (
                <PersonCard
                  key={member.personId}
                  entry={member}
                  photoSrc={otherMemberPhotoSrcs[i] ?? null}
                  slug={slug}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Increment 4: rendered LAST, identically to household detail's own
          placement — Phase 1's Flow 5. Sourced from the household's own
          deacon derivation, never a second copy. Omitted (not a neutral
          card) when the person has no household at all to source a district
          from — a household WITH no district still renders the neutral
          "no deacon assigned" state, via `household.deaconName === null`;
          see `DeaconCard`'s own header. */}
      {household && <DeaconCard deaconName={household.deaconName} />}
    </section>
  );
}
