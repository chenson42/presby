import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getOrgBrandForEdit } from "@/lib/tenant-branding";
import { isFlagEnabled } from "@/lib/flags";
import { getBlobStore } from "@/lib/storage/blob-store";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import {
  BrandingFlagOff,
  BrandingForbidden,
  BrandingLoadError,
} from "./branding-states";
import { BrandingForm } from "./branding-form";

/**
 * `/o/<slug>/admin/branding` — tenant self-service brand editor (Phase 3,
 * `docs/work-log/2026-08-26-tenant-branding-permission.md`, commit 3/3).
 * Sets the exact same `organization_brands` row the platform operator's
 * `/admin/organizations/[id]` brand form already writes — a second,
 * independently-scoped writer, not a replacement (DECISION-101).
 *
 * REPEATS THE `(org)` AUTH PATTERN IN FULL, same as `admin/features/page.tsx`
 * / `admin/roles/page.tsx` — see those files' headers for why the auth check
 * lives in the page rather than the layout.
 *
 * THE FLAG CHECK RUNS BEFORE `getOrgBrandForEdit()` IS EVER CALLED, same
 * "flag answers 'is this on at all', permission answers 'may THIS person'"
 * split every other `org_portal.*` page in this tree already follows.
 *
 * `getOrgBrandForEdit()` THROWS on genuine failure rather than returning a
 * result variant for it (its own `withOrgContext()` call can throw
 * `OrgAccessError`), matching `listFeatureToggles()`'s contract.
 * `OrgAccessError` is RE-THROWN, not swallowed — `[slug]/error.tsx` already
 * has the correct copy for that case, one level up.
 */
export default async function BrandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/branding`)}`,
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

  // The authoritative gate — see `../../page.tsx`'s identical call for the
  // full rationale. Every `(org)` page calls it, including this one.
  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const brandingEnabled = await isFlagEnabled("org_portal.branding");
  if (!brandingEnabled) {
    return <BrandingFlagOff name={resolved.org.name} />;
  }

  let brandResult;
  try {
    brandResult = await getOrgBrandForEdit(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <BrandingLoadError slug={slug} />;
  }

  if (brandResult.kind === "forbidden") {
    return <BrandingForbidden name={resolved.org.name} />;
  }

  const brand = brandResult.brand;

  // The uploaded mark, if any, is inlined as a base64 data: URI at RENDER
  // TIME rather than served from a URL — same posture as the platform
  // page's own read (the anonymous/public read path, DECISION-056, is
  // explicitly deferred; this is an authenticated server-rendered page).
  let markSrc: string | null = null;
  if (brand?.markAssetKey) {
    const resolvedAsset = await getBlobStore().resolve({
      organizationId: resolved.org.organizationId,
      key: brand.markAssetKey,
    });
    if (resolvedAsset) {
      markSrc = `data:${resolvedAsset.contentType};base64,${resolvedAsset.bytes.toString("base64")}`;
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Branding</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Set {resolved.org.name}&apos;s colour, type pairing, and logo.
        </p>
      </div>

      <BrandingForm
        slug={slug}
        organizationName={resolved.org.name}
        initialSeedHex={brand?.seedHex ?? null}
        initialTypePairing={brand?.typePairing ?? "classic"}
        initialMarkSrc={markSrc}
        initialLightOnly={brand?.lightOnly ?? false}
      />
    </section>
  );
}
