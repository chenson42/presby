import "server-only";
import { and, eq, desc, sql } from "drizzle-orm";
import { db, getPlatformDb } from "@/lib/db";
import { withOrgContext } from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { organizations } from "@/lib/db/domain/org";
import { organizationSites, siteContactMessages } from "@/lib/db/domain/sites";
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
