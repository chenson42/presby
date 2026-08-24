/**
 * Reserved organization slugs — words no admin may pick for
 * `organizations.slug` when creating an org, because the slug is IMMUTABLE
 * forever (see the `(org)` contract in CLAUDE.md) and (P5) becomes a real DNS
 * label at `<slug>.presby.app`. Picking a reserved word today creates
 * permanent debt with no correction mechanism until a future
 * `organization_slug_aliases` table exists.
 *
 * Zero runtime imports, deliberately — mirrors `src/lib/brand/contract.ts`'s
 * own "zero runtime imports" posture, per
 * docs/work-log/2026-08-24-admin-org-create.md Phase 2. This makes the set
 * importable from anywhere, including a future Edge-side consumer
 * (`src/proxy.ts`, P5 subdomain routing) without pulling in a server-action
 * or database module.
 *
 * This is a `paper` invariant (architect's own labeling, Phase 2 "Invariants
 * Touched"): nothing in the schema enforces it. `organizations_slug_format`
 * is the DB-backed CHECK (shape only); this list is pure application logic,
 * owned today by the one write path that creates a slug
 * (`src/lib/org-provisioning.ts`). A future second write path must remember
 * to call `isReservedSlug()` too — nothing at the schema level enforces that.
 *
 * The list has two parts:
 *   1. Every live top-level URL segment in `src/app` today — both bare
 *      top-level directories and every route group's own child segments
 *      (route groups add no URL segment, so e.g. `(auth)`'s `signin` is a
 *      live top-level path). Pulled from the actual route tree
 *      (`find src/app -maxdepth 2 -type d`), not reconstructed from memory.
 *   2. Infrastructure labels that are not live routes today but are reserved
 *      for P5's `<slug>.presby.app` subdomain scheme (`www`, `api`, `app`,
 *      `admin`, `auth`, `mail`, `ftp`, `staging`, `dev`) — some of these
 *      overlap group 1 (e.g. `admin`, `api`), which is fine; the set
 *      de-duplicates.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // Live top-level route segments (src/app, all route groups flattened).
  "account",
  "admin",
  "developer",
  "signin",
  "totp",
  "feedback",
  "home",
  "orgs",
  "whats-new",
  "o",
  "forgot-password",
  "reset-password",
  "site",
  "access-pending",
  "api",
  "launch",
  "no-organization",
  // Infra labels reserved for P5's <slug>.presby.app subdomain scheme, not
  // yet live app routes.
  "www",
  "app",
  "auth",
  "mail",
  "ftp",
  "staging",
  "dev",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}
