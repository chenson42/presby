/**
 * Extracts an organization slug from an already-sanitized `callbackUrl` —
 * `/o/<slug>` or `/o/<slug>/...` only. Called ONLY on the output of
 * `sanitizeCallbackUrl()` (src/lib/auth/safe-callback.ts), never on raw
 * `searchParams`: that function is what handles the open-redirect class (a
 * pure string check on scheme/host), and this one adds nothing to that
 * defense — it only decides whether the already-safe path happens to look
 * like an org route worth a brand lookup for.
 *
 * PURE STRING FUNCTION, zero imports — same discipline `safe-callback.ts`
 * itself documents and this file deliberately mirrors. A non-matching shape
 * (bare `/o`, a non-`/o/` path, `/launch`) returns `null`; the caller's own
 * `getPublishedSiteBrand()` gate is what actually decides whether a brand
 * renders, so a false-positive parse here just costs one extra lookup that
 * resolves to `null`, never a wrong brand.
 *
 * The regex is the DNS-label CHECK `organizations_slug_format` enforces at
 * the database (drizzle/0014_presby_org_router.sql:
 * `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`), reused verbatim so this parser can
 * never accept a shape the database itself would reject as a slug — matching
 * a malformed-looking slug here just means `getPublishedSiteBrand()`'s query
 * finds no row and collapses to `null`, same as any other miss.
 */
const ORG_SLUG_FROM_CALLBACK_RE =
  /^\/o\/([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\/|$)/;

export function parseOrgSlugFromCallbackUrl(callbackUrl: string): string | null {
  const match = ORG_SLUG_FROM_CALLBACK_RE.exec(callbackUrl);
  return match ? match[1] : null;
}
