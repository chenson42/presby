import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getPlatformDb } from "@/lib/db";
import { organizations, organizationBrands } from "@/lib/db/domain/org";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { getBlobStore } from "@/lib/storage/blob-store";
import { generateBrandTokens } from "@/lib/brand/generate";
import type { TypePairingKey } from "@/lib/brand/contract";
import {
  BrandPreviewSwatch,
  platformSchemeTokens,
} from "@/components/brand/brand-preview-swatch";
import { OrgMark } from "@/components/brand/org-mark";
import {
  getSiteAdminDetail,
  getOrganizationProfileAdminDetail,
  listOrganizationServiceTimes,
} from "@/lib/sites";
import { BrandForm } from "./brand-form";
import { NeutralizeDialog } from "./neutralize-dialog";
import { SiteSection } from "./site-section";
import { ProfileForm } from "./profile-form";
import { ServiceTimesSection } from "./service-times-section";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Organization brand detail — S18's minimal `(admin)` operator surface
 * (P0.5 slice c, commit `c3`). Sets one congregation's seed colour, type
 * pairing and logo; neutralises an abusive tenant's brand.
 *
 * getPlatformDb() throughout, never withOrgContext() — see
 * `actions.ts`'s header comment ("Two Hierarchies Intersect Nowhere": a
 * platform operator holds no congregational membership to verify).
 *
 * The uploaded mark, if any, is inlined as a base64 data: URI at RENDER TIME
 * rather than served from a URL — the anonymous/public read path
 * (DECISION-056) is explicitly deferred to P3, and this is an authenticated
 * server-rendered page, so there is nothing to gain from inventing an
 * `(admin)`-only asset route this commit doesn't otherwise need.
 */
export default async function OrganizationBrandDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth();
  if (!hasFeature(session?.user?.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Organization</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          You don&apos;t have permission to manage organization branding.
        </p>
      </div>
    );
  }

  if (!UUID_RE.test(id)) notFound();

  const platformDb = getPlatformDb();

  const [org] = await platformDb
    .select({
      id: organizations.id,
      name: organizations.name,
      organizationType: organizations.organizationType,
      platformStatus: organizations.platformStatus,
    })
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);

  if (!org) notFound();

  const siteDetail = await getSiteAdminDetail(id);
  const profileDetail = await getOrganizationProfileAdminDetail(id);
  const serviceTimes = await listOrganizationServiceTimes(id);
  const serviceEntries = serviceTimes.filter((entry) => entry.kind === "service");
  const officeHoursEntries = serviceTimes.filter(
    (entry) => entry.kind === "office_hours",
  );

  const [brand] = await platformDb
    .select({
      seedHex: organizationBrands.seedHex,
      typePairing: organizationBrands.typePairing,
      markAssetKey: organizationBrands.markAssetKey,
      updatedAt: organizationBrands.updatedAt,
      lightOnly: organizationBrands.lightOnly,
    })
    .from(organizationBrands)
    .where(eq(organizationBrands.organizationId, id))
    .limit(1);

  let markSrc: string | null = null;
  if (brand?.markAssetKey) {
    const resolved = await getBlobStore().resolve({
      organizationId: id,
      key: brand.markAssetKey,
    });
    if (resolved) {
      markSrc = `data:${resolved.contentType};base64,${resolved.bytes.toString("base64")}`;
    }
  }

  // "Current brand" is rendered exactly as it looks today — the platform
  // default when there is no row (G10: not a "no branding configured"
  // sentence, the default AS IT ACTUALLY RENDERS), or the org's own tokens.
  const currentTokens = brand
    ? generateBrandTokens(brand.seedHex).tokens
    : { light: platformSchemeTokens("light"), dark: platformSchemeTokens("dark") };

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <Link
          href="/admin/organizations"
          className="text-sm text-muted-foreground underline"
        >
          ← Back to organizations
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <OrgMark name={org.name} markSrc={markSrc} size="lg" />
          <div>
            <h1 className="text-2xl font-semibold">{org.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {org.organizationType.replace(/_/g, " ")} ·{" "}
              {org.platformStatus}
            </p>
          </div>
        </div>
        {brand && (
          <NeutralizeDialog organizationId={id} organizationName={org.name} />
        )}
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Current brand
        </h2>
        {!brand && (
          <p className="mt-1 text-sm text-muted-foreground">
            This organization is on the platform default palette.
          </p>
        )}
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <BrandPreviewSwatch
            tokens={currentTokens.light}
            scheme="light"
            organizationName={org.name}
          />
          <BrandPreviewSwatch
            tokens={currentTokens.dark}
            scheme="dark"
            organizationName={org.name}
          />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Set brand
        </h2>
        <div className="mt-3">
          <BrandForm
            organizationId={id}
            organizationName={org.name}
            initialSeedHex={brand?.seedHex ?? null}
            initialTypePairing={(brand?.typePairing as TypePairingKey) ?? "classic"}
            initialMarkSrc={markSrc}
            initialLightOnly={brand?.lightOnly ?? false}
          />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Profile
        </h2>
        <div className="mt-3">
          <ProfileForm
            organizationId={id}
            initialAddress={profileDetail?.address ?? null}
            initialPhone={profileDetail?.phone ?? null}
            initialFacebookUrl={profileDetail?.facebookUrl ?? null}
            initialInstagramUrl={profileDetail?.instagramUrl ?? null}
            initialXTwitterUrl={profileDetail?.xTwitterUrl ?? null}
            initialYoutubeUrl={profileDetail?.youtubeUrl ?? null}
            initialOtherUrl={profileDetail?.otherUrl ?? null}
          />
        </div>
      </section>

      <ServiceTimesSection
        organizationId={id}
        serviceEntries={serviceEntries}
        officeHoursEntries={officeHoursEntries}
      />

      <SiteSection
        organizationId={id}
        organizationName={org.name}
        site={siteDetail}
      />
    </div>
  );
}
