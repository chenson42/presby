import "server-only";
import { and, eq, desc, sql } from "drizzle-orm";
import { db, getPlatformDb } from "@/lib/db";
import { withOrgContext } from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { organizations } from "@/lib/db/domain/org";
import {
  organizationSites,
  siteContactMessages,
  organizationProfiles,
  organizationServiceTimes,
} from "@/lib/db/domain/sites";
import { getBlobStore } from "@/lib/storage/blob-store";
import { generateBrandTokens, type BrandTokenSet } from "@/lib/brand/generate";
import type { ResolvedTypePairing } from "@/lib/brand/fonts";
import { TYPE_PAIRINGS, type TypePairingKey } from "@/lib/brand/contract";
import { hasTicketsFile } from "@/lib/tickets";

/**
 * Public organization websites — the tenant/platform query-and-mutation
 * module. See docs/work-log/2026-08-20-public-sites.md Phase 3 "API
 * Contract", DECISION-081 through DECISION-089.
 *
 * THREE CALLER SHAPES IN ONE FILE, deliberately not split further:
 *
 *   1. The anonymous public read (`getPublishedSite`,
 *      `resolvePublishedOrganization`) — no personId, no organizationId
 *      supplied by the caller at all; reads through the plain `db`
 *      connection (presby_app, no org GUC) via `presby_published_site()`,
 *      the narrow SECURITY DEFINER projection commit 1 (database-admin)
 *      shipped. Never `getPlatformDb()` here — this is exactly the kind of
 *      user-facing path the (public) contract forbids it on.
 *
 *   2. Platform-authorized, no-membership callers (`getSiteAdminDetail`,
 *      `provisionSite`, `setSiteStatus`, `listSitesForAdmin`,
 *      `resolveOrganizationByRepo`, `recordSiteIngest`) — a platform
 *      operator (`/admin/organizations`, `FEATURES.ADMIN_ORGANIZATIONS`) or
 *      the OIDC-verified ingest route. Both are "verified, no membership"
 *      callers per Phase 2 Note 2 — `getPlatformDb()` throughout.
 *      `organization_sites` has NO `presby_app` table grant at all
 *      (DECISION-081); a `withOrgContext()`/`db` query against it fails with
 *      a permission error, not a silently-filtered empty result.
 *
 *   3. The anonymous `ContactForm` write (`submitSiteContactMessage`) — a
 *      TRUSTED-ORG-CONTEXT write, the same shape
 *      `src/lib/storage/blob-store.ts`'s own header documents at length: no
 *      `personId` exists to hand `withOrgContext()` that would not be
 *      fabricated, so the org id is trusted directly (resolved from a public
 *      slug, never client-supplied) and gated on "this org's site is live"
 *      (via `resolvePublishedOrganization`, the same enumeration-safe
 *      collapse the public read uses) in place of a membership check.
 *
 *   4. The genuine tenant-member read/write (`listSiteContactMessages`,
 *      `markSiteContactMessageRead`) — `withOrgContext()`, gated on
 *      `tickets.file` (DECISION-089), importing `hasTicketsFile` from
 *      `@/lib/tickets` rather than re-deriving the permission check — this
 *      module is the third consumer of that exported precedent (see
 *      `tickets.ts`'s own header for why it is exported at all).
 *
 * COMMIT 2 ADDITION (docs/work-log/2026-08-21-public-site-org-profile.md
 * Phase 4, DECISION-090/091/092): `getOrganizationProfileAdminDetail`,
 * `setOrganizationProfile`, `listOrganizationServiceTimes`, and
 * `replaceOrganizationServiceTimes` — the platform-admin query/mutation pair
 * for `organization_profiles`/`organization_service_times`, shaped exactly
 * like caller-shape 2 above (`getPlatformDb()`, `FEATURES.ADMIN_ORGANIZATIONS`
 * enforced one layer up in `actions.ts`, never `withOrgContext()` — same "no
 * membership to verify for a platform operator" reasoning). `getPublishedSite`
 * itself widens in place — no fifth caller shape, no second query/function,
 * per Phase 1 Gap 5.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const TYPE_PAIRING_KEYS = new Set<string>(TYPE_PAIRINGS.map((p) => p.key));
function isTypePairingKey(value: string): value is TypePairingKey {
  return TYPE_PAIRING_KEYS.has(value);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sets the org GUC on the RLS-enforced connection for the duration of one
 * transaction, with NO membership check — the anonymous ContactForm write's
 * own trusted-org-context pattern. Deliberately mirrors
 * `src/lib/storage/blob-store.ts`'s private `withTrustedOrgContext` rather
 * than importing it (that function is not exported, and the two trust
 * boundaries are independent — a future change to the blob adapter's own
 * helper should not silently change this module's behaviour). See that
 * file's header comment for the full "why not withOrgContext()" reasoning;
 * it applies here without modification, except the authorizing check ahead
 * of it is "this org's site is live" (`resolvePublishedOrganization`) rather
 * than "the platform operator already passed FEATURES.ADMIN_ORGANIZATIONS".
 */
function withTrustedOrgContext<T>(
  organizationId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_org_id', ${organizationId}, true)`,
    );
    return fn(tx);
  });
}

// ---------------------------------------------------------------------------
// Public render path
// ---------------------------------------------------------------------------

export interface PublishedSiteBundlePage {
  path: string;
  frontMatter: Record<string, unknown>;
  mdxAst: unknown;
}

export interface PublishedSite {
  organizationId: string;
  organizationName: string;
  organizationType: string;
  brand: { tokens: BrandTokenSet; fontPairing: ResolvedTypePairing } | null;
  pages: PublishedSiteBundlePage[];
  /**
   * ADDITION beyond Phase 3's literal `PublishedSite` interface — see this
   * commit's report for the full reasoning. Phase 3's own
   * `renderSiteBundle()` signature takes an `imageUrl: (manifestKey: string)
   * => string` builder, and the asset route
   * (`(public)/site/[slug]/assets/[key]/route.ts`, commit 3) resolves `[key]`
   * as a literal `blob_assets.id` via `getBlobStore().resolve()` — but
   * content only ever references a stable `manifestKey`. Without exposing
   * the manifestKey -> blobKey map the ingest route already builds and
   * stores (`recordSiteIngest`'s own bundle shape: `{ schemaVersion, pages,
   * imageKeys }`), commit 3's `page.tsx` has no way to construct that
   * closure. Adding a field is additive, not a narrowing of anything Phase 3
   * specified.
   */
  imageKeys: Record<string, string>;
  /**
   * ADDITION beyond the parent pipeline's own `PublishedSite` shape — see
   * docs/work-log/2026-08-21-public-site-org-profile.md Phase 3 "API
   * Contract". EVERY leaf here is independently `null`/`[]`-omittable
   * (Phase 1 Gap 6, restated as a hard requirement in Phase 3): a component
   * checks a leaf, never the presence of `profile` itself, which always
   * exists as an object even when no `organization_profiles` row does.
   */
  profile: {
    address: string | null;
    phone: string | null;
    social: {
      facebook: string | null;
      instagram: string | null;
      xTwitter: string | null;
      youtube: string | null;
      other: string | null;
    };
  };
  serviceTimes: OrgServiceTimeEntry[];
  officeHours: OrgServiceTimeEntry[];
}

/**
 * `dayOfWeek`: 0=Sunday..6=Saturday, matching JS `Date.getDay()` — stated
 * here so a presby-site-kit component never has to guess the convention.
 * `startTime`/`endTime`: `"HH:MM:SS"`, the Postgres `time` literal as
 * `jsonb_build_object` serialized it — no timezone conversion, a
 * congregation's own wall-clock time.
 */
export interface OrgServiceTimeEntry {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  label: string | null;
}

export type GetPublishedSiteResult =
  | { kind: "ok"; site: PublishedSite }
  // Collapses: never provisioned, suspended, nonexistent slug, org inactive,
  // flag off, AND a corrupt/unparseable bundle — all render the same 404
  // (Phase 1 Gap 5's enumeration-safety requirement, extended defensively).
  | { kind: "not_found" };

interface PublishedSiteRow {
  organization_id: string;
  organization_name: string;
  organization_type: string;
  content_bundle_key: string | null;
  brand_seed_hex: string | null;
  brand_type_pairing: string | null;
  brand_token_version: number | null;
  profile_address: string | null;
  profile_phone: string | null;
  profile_facebook_url: string | null;
  profile_instagram_url: string | null;
  profile_x_twitter_url: string | null;
  profile_youtube_url: string | null;
  profile_other_url: string | null;
  // `jsonb`, driver-dependent shape — could arrive as a parsed array/object
  // (node-postgres' own default json/jsonb type parser) or as a raw string,
  // hence `unknown` and the defensive parse below rather than trusting either.
  service_times: unknown;
  office_hours: unknown;
}

function isServiceTimeEntryShape(value: unknown): value is {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  label?: string | null;
} {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.dayOfWeek === "number" &&
    typeof v.startTime === "string" &&
    typeof v.endTime === "string"
  );
}

/**
 * `jsonb_agg` over zero matching rows returns SQL `NULL` (the migration's own
 * comment: deliberately not `coalesce`d in SQL). A dangling/malformed value
 * degrades to `[]`, never a 500 — matches `isStoredSiteBundle`'s own
 * degrade-gracefully posture for the content bundle (Phase 3 Edge Cases).
 */
function parseServiceTimeEntries(value: unknown): OrgServiceTimeEntry[] {
  if (value === null || value === undefined) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isServiceTimeEntryShape).map((entry) => ({
      dayOfWeek: entry.dayOfWeek,
      startTime: entry.startTime,
      endTime: entry.endTime,
      label: entry.label ?? null,
    }));
  } catch {
    return [];
  }
}

interface StoredSiteBundle {
  schemaVersion: 1;
  pages: PublishedSiteBundlePage[];
  imageKeys: Record<string, string>;
}

function isStoredSiteBundle(value: unknown): value is StoredSiteBundle {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.schemaVersion === 1 && Array.isArray(v.pages);
}

/**
 * The anonymous public render path's one read. Reads through the plain `db`
 * connection with NO org context set — `presby_published_site()` is
 * SECURITY DEFINER precisely so this works (see the migration's own
 * comment). Every non-`ok` reason — never provisioned, suspended,
 * nonexistent slug, org not active, the render flag off, or a corrupt/
 * dangling bundle — collapses to the same `{ kind: "not_found" }`, never a
 * 500 and never a distinguishable error (Phase 1 Gap 5).
 */
export async function getPublishedSite(
  slug: string,
): Promise<GetPublishedSiteResult> {
  if (!(await isFlagEnabled("sites.public_render"))) {
    return { kind: "not_found" };
  }

  const result = await db.execute(
    sql`select * from presby_published_site(${slug})`,
  );
  const row = (result as unknown as { rows?: PublishedSiteRow[] }).rows?.[0];
  if (!row || !row.content_bundle_key) return { kind: "not_found" };

  const blob = await getBlobStore().resolve({
    organizationId: row.organization_id,
    key: row.content_bundle_key,
  });
  if (!blob) return { kind: "not_found" };

  let bundle: unknown;
  try {
    bundle = JSON.parse(blob.bytes.toString("utf-8"));
  } catch {
    return { kind: "not_found" };
  }
  if (!isStoredSiteBundle(bundle)) return { kind: "not_found" };

  let brand: PublishedSite["brand"] = null;
  if (row.brand_seed_hex && (await isFlagEnabled("ui.brand_theming"))) {
    try {
      const { tokens } = generateBrandTokens(row.brand_seed_hex);
      const pairingKey = isTypePairingKey(row.brand_type_pairing ?? "")
        ? (row.brand_type_pairing as TypePairingKey)
        : "classic";
      // Dynamically imported, deliberately not a static top-level import:
      // src/lib/brand/fonts.ts calls next/font/google at MODULE SCOPE, which
      // only resolves correctly under Next's own compiler (webpack/SWC) —
      // under plain Node (vitest, this module's own integration test) a
      // static import crashes at MODULE LOAD time with "Lora is not a
      // function", before any test body runs, regardless of whether the
      // brand branch is ever exercised. A static import here would also
      // force every OTHER consumer of this file (provisionSiteAction,
      // setSiteStatusAction, markSiteContactMessageReadAction — none of
      // which touch brand at all) to either mock `@/lib/sites` wholesale or
      // pull in next/font/google transitively. Deferred to exactly the one
      // call site that needs it; in the real Next.js server process this
      // resolves through the same compiled module graph either way.
      const { resolveTypePairing } = await import("@/lib/brand/fonts");
      brand = { tokens, fontPairing: resolveTypePairing(pairingKey) };
    } catch {
      // A stored seed that no longer parses degrades to the platform
      // default rather than taking the page down — same posture as
      // read-org-brand.ts's own Reason 3 fallback.
      brand = null;
    }
  }

  return {
    kind: "ok",
    site: {
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      organizationType: row.organization_type,
      brand,
      pages: bundle.pages,
      imageKeys: bundle.imageKeys ?? {},
      profile: {
        address: row.profile_address,
        phone: row.profile_phone,
        social: {
          facebook: row.profile_facebook_url,
          instagram: row.profile_instagram_url,
          xTwitter: row.profile_x_twitter_url,
          youtube: row.profile_youtube_url,
          other: row.profile_other_url,
        },
      },
      serviceTimes: parseServiceTimeEntries(row.service_times),
      officeHours: parseServiceTimeEntries(row.office_hours),
    },
  };
}

/**
 * Cheaper sibling for the asset route — skips the blob fetch + JSON.parse.
 * Same enumeration-safe collapse as `getPublishedSite`: any non-live reason
 * (or the flag being off) returns `null`.
 */
export async function resolvePublishedOrganization(
  slug: string,
): Promise<{ organizationId: string } | null> {
  if (!(await isFlagEnabled("sites.public_render"))) return null;

  const result = await db.execute(
    sql`select organization_id from presby_published_site(${slug})`,
  );
  const row = (
    result as unknown as { rows?: Array<{ organization_id: string }> }
  ).rows?.[0];
  return row ? { organizationId: row.organization_id } : null;
}

// ---------------------------------------------------------------------------
// Admin provisioning — getPlatformDb(), FEATURES.ADMIN_ORGANIZATIONS
// ---------------------------------------------------------------------------

export const SITE_STATUSES = ["provisioning", "live", "suspended"] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

export interface SiteAdminDetail {
  organizationId: string;
  repo: string;
  status: SiteStatus;
  lastIngestedCommitSha: string | null;
  lastIngestedAt: string | null;
  createdAt: string;
}

export async function getSiteAdminDetail(
  organizationId: string,
): Promise<SiteAdminDetail | null> {
  const platformDb = getPlatformDb();
  const [row] = await platformDb
    .select({
      organizationId: organizationSites.organizationId,
      repo: organizationSites.repo,
      status: organizationSites.status,
      lastIngestedCommitSha: organizationSites.lastIngestedCommitSha,
      lastIngestedAt: organizationSites.lastIngestedAt,
      createdAt: organizationSites.createdAt,
    })
    .from(organizationSites)
    .where(eq(organizationSites.organizationId, organizationId))
    .limit(1);
  if (!row) return null;

  return {
    organizationId: row.organizationId,
    repo: row.repo,
    status: row.status as SiteStatus,
    lastIngestedCommitSha: row.lastIngestedCommitSha,
    lastIngestedAt: row.lastIngestedAt ? row.lastIngestedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// "org/repo" — DNS-label-adjacent, not a full GitHub-name validator; a typo
// still 404s every ingest attempt for that org until corrected (named,
// unsolved, in Phase 3's own Edge Cases).
const REPO_FORMAT_RE = /^[\w.-]+\/[\w.-]+$/;

export type ProvisionSiteResult =
  | { kind: "ok" }
  | { kind: "already_provisioned" }
  | { kind: "invalid_input"; error: string };

/**
 * Creates the `organization_sites` row for an org that has none yet.
 * `status` always starts at `'provisioning'` — nothing promotes it to
 * `'live'` except a first successful `recordSiteIngest()` call.
 */
export async function provisionSite(
  organizationId: string,
  repo: string,
  actorUserId: string,
): Promise<ProvisionSiteResult> {
  const trimmedRepo = repo.trim();
  if (!REPO_FORMAT_RE.test(trimmedRepo)) {
    return {
      kind: "invalid_input",
      error: 'Enter a repo as "owner/repo".',
    };
  }

  const platformDb = getPlatformDb();
  const [existing] = await platformDb
    .select({ organizationId: organizationSites.organizationId })
    .from(organizationSites)
    .where(eq(organizationSites.organizationId, organizationId))
    .limit(1);
  if (existing) return { kind: "already_provisioned" };

  try {
    await platformDb.insert(organizationSites).values({
      organizationId,
      repo: trimmedRepo,
      status: "provisioning",
      updatedBy: actorUserId,
    });
  } catch (err) {
    // organization_sites_repo_unique — a different org already claims this
    // repo string. Not named as its own ProvisionSiteResult kind in Phase 3;
    // mapped to invalid_input rather than letting a raw 23505 surface to the
    // caller as an unhandled exception.
    if (isUniqueViolation(err)) {
      return {
        kind: "invalid_input",
        error: "That repository is already provisioned for another organization.",
      };
    }
    throw err;
  }

  return { kind: "ok" };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

export type SetSiteStatusResult = { kind: "ok" } | { kind: "not_found" };

/**
 * Admin-manual status flips only (suspend / reactivate). Ingest
 * (`recordSiteIngest`) sets status itself and never calls this — see that
 * function's own doc comment for why it always writes `'live'`
 * unconditionally rather than preserving a prior `'suspended'` state.
 */
export async function setSiteStatus(
  organizationId: string,
  status: "live" | "suspended",
  actorUserId: string,
): Promise<SetSiteStatusResult> {
  const platformDb = getPlatformDb();
  const updated = await platformDb
    .update(organizationSites)
    .set({ status, updatedBy: actorUserId, updatedAt: new Date() })
    .where(eq(organizationSites.organizationId, organizationId))
    .returning({ organizationId: organizationSites.organizationId });
  if (updated.length === 0) return { kind: "not_found" };
  return { kind: "ok" };
}

export interface SiteAdminListEntry {
  organizationId: string;
  organizationName: string;
  slug: string;
  repo: string;
  status: SiteStatus;
  lastIngestedAt: string | null;
  createdAt: string;
}

export async function listSitesForAdmin(): Promise<SiteAdminListEntry[]> {
  const platformDb = getPlatformDb();
  const rows = await platformDb
    .select({
      organizationId: organizationSites.organizationId,
      organizationName: organizations.name,
      slug: organizations.slug,
      repo: organizationSites.repo,
      status: organizationSites.status,
      lastIngestedAt: organizationSites.lastIngestedAt,
      createdAt: organizationSites.createdAt,
    })
    .from(organizationSites)
    .innerJoin(organizations, eq(organizations.id, organizationSites.organizationId))
    .orderBy(organizations.name);

  return rows.map((row) => ({
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    slug: row.slug,
    repo: row.repo,
    status: row.status as SiteStatus,
    lastIngestedAt: row.lastIngestedAt ? row.lastIngestedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Public-site profile + service times — getPlatformDb(),
// FEATURES.ADMIN_ORGANIZATIONS (enforced one layer up, in actions.ts)
// docs/work-log/2026-08-21-public-site-org-profile.md Phase 3 "API Contract",
// DECISION-090/091/092.
// ---------------------------------------------------------------------------

export interface OrganizationProfileAdminDetail {
  address: string | null;
  phone: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  xTwitterUrl: string | null;
  youtubeUrl: string | null;
  otherUrl: string | null;
  updatedAt: string | null;
}

export async function getOrganizationProfileAdminDetail(
  organizationId: string,
): Promise<OrganizationProfileAdminDetail | null> {
  const platformDb = getPlatformDb();
  const [row] = await platformDb
    .select({
      address: organizationProfiles.address,
      phone: organizationProfiles.phone,
      facebookUrl: organizationProfiles.facebookUrl,
      instagramUrl: organizationProfiles.instagramUrl,
      xTwitterUrl: organizationProfiles.xTwitterUrl,
      youtubeUrl: organizationProfiles.youtubeUrl,
      otherUrl: organizationProfiles.otherUrl,
      updatedAt: organizationProfiles.updatedAt,
    })
    .from(organizationProfiles)
    .where(eq(organizationProfiles.organizationId, organizationId))
    .limit(1);
  if (!row) return null;

  return {
    address: row.address,
    phone: row.phone,
    facebookUrl: row.facebookUrl,
    instagramUrl: row.instagramUrl,
    xTwitterUrl: row.xTwitterUrl,
    youtubeUrl: row.youtubeUrl,
    otherUrl: row.otherUrl,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

// App-level bounds only — no DB CHECK on these text columns (Phase 3 Data
// Model, matching site_contact_messages.body's own precedent: international
// address/phone formats vary too widely for a format CHECK to earn its keep).
const MAX_ADDRESS_LEN = 500;
const MAX_PHONE_LEN = 50;

const SOCIAL_URL_FIELDS = [
  { key: "facebookUrl", label: "Facebook" },
  { key: "instagramUrl", label: "Instagram" },
  { key: "xTwitterUrl", label: "X / Twitter" },
  { key: "youtubeUrl", label: "YouTube" },
  { key: "otherUrl", label: "Other link" },
] as const;

type SocialUrlKey = (typeof SOCIAL_URL_FIELDS)[number]["key"];

/**
 * A `facebookUrl` need not literally contain `facebook.com` (Phase 3 Data
 * Model: "a custom Linktree-style URL in that field is legal") — well-
 * formedness and an `http(s):` protocol are the whole check, never a
 * platform-domain allowlist.
 */
function normalizeSocialUrl(
  label: string,
  raw: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      error: `Enter a valid ${label} URL, or leave it blank.`,
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: `Enter a valid ${label} URL, or leave it blank.`,
    };
  }
  return { ok: true, value: trimmed };
}

export type SetOrganizationProfileResult =
  | { kind: "ok" }
  | { kind: "invalid_input"; error: string };

/**
 * Upserts the one `organization_profiles` row for this org — degenerate PK,
 * matching `organization_brands`' own upsert shape (no history row, per the
 * user's Q6 resolution). Every input field is a plain string (FormData
 * already flattened) — an empty string maps to `null` here, not in the
 * caller, so any future non-FormData caller gets the same behavior for free.
 */
export async function setOrganizationProfile(
  organizationId: string,
  input: {
    address: string;
    phone: string;
    facebookUrl: string;
    instagramUrl: string;
    xTwitterUrl: string;
    youtubeUrl: string;
    otherUrl: string;
  },
  actorUserId: string,
): Promise<SetOrganizationProfileResult> {
  const address = input.address.trim();
  if (address.length > MAX_ADDRESS_LEN) {
    return {
      kind: "invalid_input",
      error: `Address is too long (up to ${MAX_ADDRESS_LEN} characters).`,
    };
  }
  const phone = input.phone.trim();
  if (phone.length > MAX_PHONE_LEN) {
    return {
      kind: "invalid_input",
      error: `Phone is too long (up to ${MAX_PHONE_LEN} characters).`,
    };
  }

  const social: Record<SocialUrlKey, string | null> = {
    facebookUrl: null,
    instagramUrl: null,
    xTwitterUrl: null,
    youtubeUrl: null,
    otherUrl: null,
  };
  for (const { key, label } of SOCIAL_URL_FIELDS) {
    const result = normalizeSocialUrl(label, input[key]);
    if (!result.ok) return { kind: "invalid_input", error: result.error };
    social[key] = result.value;
  }

  const platformDb = getPlatformDb();
  const values: typeof organizationProfiles.$inferInsert = {
    organizationId,
    address: address.length > 0 ? address : null,
    phone: phone.length > 0 ? phone : null,
    facebookUrl: social.facebookUrl,
    instagramUrl: social.instagramUrl,
    xTwitterUrl: social.xTwitterUrl,
    youtubeUrl: social.youtubeUrl,
    otherUrl: social.otherUrl,
    updatedBy: actorUserId,
  };

  await platformDb
    .insert(organizationProfiles)
    .values(values)
    .onConflictDoUpdate({
      target: organizationProfiles.organizationId,
      set: {
        address: values.address,
        phone: values.phone,
        facebookUrl: values.facebookUrl,
        instagramUrl: values.instagramUrl,
        xTwitterUrl: values.xTwitterUrl,
        youtubeUrl: values.youtubeUrl,
        otherUrl: values.otherUrl,
        updatedBy: actorUserId,
        updatedAt: new Date(),
      },
    });

  return { kind: "ok" };
}

export interface ServiceTimeAdminEntry {
  id: string;
  kind: "service" | "office_hours";
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  label: string | null;
}

/**
 * Both kinds, ordered `(kind, day_of_week, start_time)` — the page splits by
 * `kind` for the two independent `TimeRowsEditor` instances.
 */
export async function listOrganizationServiceTimes(
  organizationId: string,
): Promise<ServiceTimeAdminEntry[]> {
  const platformDb = getPlatformDb();
  const rows = await platformDb
    .select({
      id: organizationServiceTimes.id,
      kind: organizationServiceTimes.kind,
      dayOfWeek: organizationServiceTimes.dayOfWeek,
      startTime: organizationServiceTimes.startTime,
      endTime: organizationServiceTimes.endTime,
      label: organizationServiceTimes.label,
    })
    .from(organizationServiceTimes)
    .where(eq(organizationServiceTimes.organizationId, organizationId))
    .orderBy(
      organizationServiceTimes.kind,
      organizationServiceTimes.dayOfWeek,
      organizationServiceTimes.startTime,
    );

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as "service" | "office_hours",
    dayOfWeek: row.dayOfWeek,
    startTime: row.startTime,
    endTime: row.endTime,
    label: row.label,
  }));
}

const DAY_OF_WEEK_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
// "HH:MM" (native <input type="time">'s own format) or "HH:MM:SS".
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const MAX_LABEL_LEN = 100;

export type ReplaceServiceTimesResult =
  | { kind: "ok" }
  | { kind: "invalid_input"; error: string };

/**
 * Whole-list replace per `(organizationId, kind)` — DECISION-092, not
 * per-row diffed CRUD. One transaction: delete every existing row for this
 * `(organizationId, kind)` pair, then insert the submitted rows (skipped
 * entirely if `rows.length === 0` — "save an empty list" is a legal way to
 * clear a kind, per Phase 3 Edge Cases; no confirmation step, matching that
 * same Edge Cases entry).
 *
 * Cross-row overlap is deliberately NOT validated here either — only mirrors
 * the DB's own per-row `end_time > start_time` CHECK, at the app layer, so a
 * malformed row bounces with a readable message instead of a raw constraint
 * violation.
 */
export async function replaceOrganizationServiceTimes(
  organizationId: string,
  kind: "service" | "office_hours",
  rows: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    label: string | null;
  }>,
  actorUserId: string,
): Promise<ReplaceServiceTimesResult> {
  const normalizedRows: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    label: string | null;
  }> = [];

  for (const row of rows) {
    if (
      !Number.isInteger(row.dayOfWeek) ||
      row.dayOfWeek < 0 ||
      row.dayOfWeek > 6
    ) {
      return {
        kind: "invalid_input",
        error: "Choose a day of the week for every row.",
      };
    }
    if (!TIME_RE.test(row.startTime) || !TIME_RE.test(row.endTime)) {
      return {
        kind: "invalid_input",
        error: "Enter a start and end time for every row.",
      };
    }
    if (row.endTime <= row.startTime) {
      return {
        kind: "invalid_input",
        error: `End time must be after start time (${DAY_OF_WEEK_LABELS[row.dayOfWeek]}).`,
      };
    }
    const label = row.label?.trim() || null;
    if (label && label.length > MAX_LABEL_LEN) {
      return {
        kind: "invalid_input",
        error: `Label is too long (up to ${MAX_LABEL_LEN} characters).`,
      };
    }
    normalizedRows.push({
      dayOfWeek: row.dayOfWeek,
      startTime: row.startTime,
      endTime: row.endTime,
      label,
    });
  }

  const platformDb = getPlatformDb();
  await platformDb.transaction(async (tx) => {
    await tx
      .delete(organizationServiceTimes)
      .where(
        and(
          eq(organizationServiceTimes.organizationId, organizationId),
          eq(organizationServiceTimes.kind, kind),
        ),
      );
    if (normalizedRows.length > 0) {
      await tx.insert(organizationServiceTimes).values(
        normalizedRows.map((row) => ({
          organizationId,
          kind,
          dayOfWeek: row.dayOfWeek,
          startTime: row.startTime,
          endTime: row.endTime,
          label: row.label,
          updatedBy: actorUserId,
        })),
      );
    }
  });

  return { kind: "ok" };
}

// ---------------------------------------------------------------------------
// Ingest-internal — getPlatformDb(), called only from the route handler
// ---------------------------------------------------------------------------

export async function resolveOrganizationByRepo(repo: string): Promise<{
  organizationId: string;
  slug: string;
  lastIngestedCommitSha: string | null;
} | null> {
  const platformDb = getPlatformDb();
  const [row] = await platformDb
    .select({
      organizationId: organizationSites.organizationId,
      slug: organizations.slug,
      lastIngestedCommitSha: organizationSites.lastIngestedCommitSha,
    })
    .from(organizationSites)
    .innerJoin(organizations, eq(organizations.id, organizationSites.organizationId))
    .where(eq(organizationSites.repo, repo))
    .limit(1);
  return row ?? null;
}

/**
 * Records a successful ingest. Called ONLY after the route handler's own
 * idempotency short-circuit (`resolveOrganizationByRepo(...).
 * lastIngestedCommitSha === claims.sha` -> skip, never call this) — this
 * function itself performs no such check and always writes.
 *
 * PROMOTES `'provisioning' -> 'live'` ON FIRST SUCCESS, BUT NEVER TOUCHES
 * `'suspended'`. An earlier draft always wrote `status = 'live'`
 * unconditionally, including over a prior `'suspended'` — that meant an
 * admin suspending an abusive tenant's site was undone by the very next
 * routine CI push, with no gate at all: suspension is the one moderation
 * control this table's `status` column exists for, and a control any
 * ordinary content commit can silently reverse isn't a control. Fixed by
 * the orchestrator before this landed, not deferred to a later phase — the
 * conservative reading ("ingest never resurrects a site an admin explicitly
 * suspended, but still promotes a fresh provision on first success") is the
 * obvious, safe interpretation and needs no new rule invented: `suspended`
 * stays exactly where an admin left it until an admin action (`setSiteStatus`)
 * moves it again. The bundle/commit metadata still updates regardless of
 * status — a suspended site's *content* keeps current, only its
 * *visibility* stays admin-controlled, so un-suspending later serves the
 * latest content immediately rather than a stale snapshot from before the
 * suspension.
 */
export async function recordSiteIngest(
  organizationId: string,
  input: { commitSha: string; contentBundleKey: string },
): Promise<void> {
  const platformDb = getPlatformDb();
  await platformDb
    .update(organizationSites)
    .set({
      status: sql`case when ${organizationSites.status} = 'suspended' then 'suspended' else 'live' end`,
      lastIngestedCommitSha: input.commitSha,
      lastIngestedAt: new Date(),
      contentBundleKey: input.contentBundleKey,
      updatedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(organizationSites.organizationId, organizationId));
}

// ---------------------------------------------------------------------------
// ContactForm — trusted-org-context write (DECISION-083 / Phase 2 Note 2)
// ---------------------------------------------------------------------------

export type SubmitContactMessageResult =
  | { kind: "ok" }
  | { kind: "not_live" }
  | { kind: "invalid_input"; error: string };

/**
 * The one anonymous write in this whole feature. `slug` resolves to an
 * `organizationId` through the same enumeration-safe
 * `resolvePublishedOrganization` the public read uses — a suspended,
 * never-provisioned, or nonexistent site all produce the identical
 * `{ kind: "not_live" }`, never a hint about which. See the work-log's Edge
 * Cases for the accepted TOCTOU window between page load and form submit.
 */
export async function submitSiteContactMessage(
  slug: string,
  input: { name: string; email: string; body: string },
): Promise<SubmitContactMessageResult> {
  const org = await resolvePublishedOrganization(slug);
  if (!org) return { kind: "not_live" };

  const name = input.name.trim();
  const email = input.email.trim();
  const body = input.body.trim();

  if (name.length < 1 || name.length > 200) {
    return { kind: "invalid_input", error: "Enter your name." };
  }
  if (!EMAIL_RE.test(email) || email.length > 320) {
    return { kind: "invalid_input", error: "Enter a valid email address." };
  }
  if (body.length < 1 || body.length > 5000) {
    return {
      kind: "invalid_input",
      error: "Enter a message (up to 5,000 characters).",
    };
  }

  await withTrustedOrgContext(org.organizationId, async (tx) => {
    await tx.insert(siteContactMessages).values({
      organizationId: org.organizationId,
      name,
      email,
      body,
    });
  });

  return { kind: "ok" };
}

// ---------------------------------------------------------------------------
// ContactForm read side — withOrgContext(), gated on tickets.file (DECISION-089)
// ---------------------------------------------------------------------------

export interface SiteContactMessageEntry {
  messageId: string;
  name: string;
  email: string;
  body: string;
  status: "new" | "read";
  createdAt: string;
}

export type ListSiteContactMessagesResult =
  | { kind: "ok"; messages: SiteContactMessageEntry[] }
  | { kind: "forbidden" };

/**
 * Every message, newest first, with its `status` — this is a small inbox,
 * not a new-only triage queue like `listPendingFeedback` (`status` is part
 * of `SiteContactMessageEntry` precisely so the page can show read/unread
 * rather than only ever showing unread).
 */
export async function listSiteContactMessages(
  viewerPersonId: string,
  organizationId: string,
): Promise<ListSiteContactMessagesResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasTicketsFile(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const rows = await tx
      .select({
        messageId: siteContactMessages.id,
        name: siteContactMessages.name,
        email: siteContactMessages.email,
        body: siteContactMessages.body,
        status: siteContactMessages.status,
        createdAt: siteContactMessages.createdAt,
      })
      .from(siteContactMessages)
      .where(eq(siteContactMessages.organizationId, organizationId))
      .orderBy(desc(siteContactMessages.createdAt));

    return {
      kind: "ok",
      messages: rows.map((row) => ({
        messageId: row.messageId,
        name: row.name,
        email: row.email,
        body: row.body,
        status: row.status as "new" | "read",
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });
}

export type MarkSiteContactMessageReadResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "not_found" };

export async function markSiteContactMessageRead(
  actingPersonId: string,
  organizationId: string,
  messageId: string,
): Promise<MarkSiteContactMessageReadResult> {
  return withOrgContext(actingPersonId, organizationId, async (tx) => {
    if (!(await hasTicketsFile(tx, actingPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const updated = await tx
      .update(siteContactMessages)
      .set({ status: "read" })
      .where(
        and(
          eq(siteContactMessages.id, messageId),
          eq(siteContactMessages.organizationId, organizationId),
        ),
      )
      .returning({ id: siteContactMessages.id });
    if (updated.length === 0) return { kind: "not_found" };
    return { kind: "ok" };
  });
}
