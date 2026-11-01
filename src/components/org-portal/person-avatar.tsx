import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getBlobStore, type ResolvedBlob } from "@/lib/storage/blob-store";
import { initialsFrom } from "@/lib/initials";

/**
 * The adapter's `RESOLVE_MANY_MAX` (100). Held as a local literal, not imported,
 * so this file stays importable under a test's partial mock of the adapter;
 * `person-avatar.test.tsx` pins the two together against the real module.
 */
const RESOLVE_CHUNK = 100;

/**
 * Resolves a list of directory-photo THUMBNAIL keys (the `photoThumbKey` that
 * `getDirectory()` and its siblings return, already withheld by SQL when the
 * person hid their photo, appears to be under 18, or the org's photos toggle is
 * off: `presby_person_directory_photo()`, drizzle/0078; this function never
 * re-decides visibility, it only renders what it was handed) to inline `data:`
 * URIs, the pattern `(admin)/admin/organizations/[id]/page.tsx` and
 * `org-mark.tsx` use for the org logo (DECISION-030: `blob_assets` is never
 * queried directly outside `src/lib/storage/`). No streaming route: thumbnails
 * are about 8 KB each, and the 500 KB document budget for 25 cards is measured
 * by the directory e2e (docs/work-log/2026-10-26-person-photos-inc1.md, edge
 * case 20, DECISION-289).
 *
 * ONE `resolveMany()` for the whole page (F332), not a transaction per card
 * (one per 100 distinct photos, the adapter's cap, for an unpaged read).
 * Output is ALIGNED with `keys`: `result[i]` is the data URI for `keys[i]`, or
 * `null` for a null key or a key the read did not return (a stale key). A read
 * FAILURE (the database blipping) logs one fixed line and returns all nulls: a
 * photo outage must not take the directory down (the page's own query still
 * fails loudly), and initials are an honest rendering of "no photo here".
 *
 * `organizationId` is trusted, not re-verified: the caller already ran its
 * query inside `withOrgContext()`, which is where membership was proven.
 * `resolveMany()` matches only `private` rows of that organization, so a forged
 * key for another organization's blob returns nothing.
 *
 * A PLAIN async FUNCTION, not an async Server Component, so callers resolve
 * every card in one await and the step is unit-testable by mocking
 * `@/lib/storage/blob-store`.
 */
export async function resolvePhotoSrcs(
  organizationId: string,
  keys: ReadonlyArray<string | null>,
): Promise<Array<string | null>> {
  const wanted = [...new Set(keys.filter((k): k is string => Boolean(k)))];
  if (wanted.length === 0) return keys.map(() => null);
  const found = new Map<string, ResolvedBlob>();
  try {
    // One call per RESOLVE_CHUNK distinct keys: a page is normally one call;
    // an unpaged read of a big congregation is a few, never a silent loss.
    for (let i = 0; i < wanted.length; i += RESOLVE_CHUNK) {
      const chunk = await getBlobStore().resolveMany({
        organizationId,
        keys: wanted.slice(i, i + RESOLVE_CHUNK),
        audience: "private",
      });
      for (const [id, blob] of chunk) found.set(id, blob);
    }
  } catch {
    console.error("[person-photos] thumbnail read failed; showing initials");
    return keys.map(() => null);
  }
  return keys.map((key) => {
    const blob = key ? found.get(key.toLowerCase()) : undefined;
    return blob ? `data:${blob.contentType};base64,${blob.bytes.toString("base64")}` : null;
  });
}

/**
 * The initials-fallback palette (docs/work-log/
 * 2026-08-28-directory-visual-refresh.md, Phase 4, item 1). Every avatar was
 * rendering as one identical `bg-muted` circle — a grid of them read as a
 * single smear rather than a roster of individuals.
 *
 * DELIBERATELY NOT NEW BRAND TOKENS. `src/lib/brand/contract.ts`'s
 * `TOKEN_POLICY` is a closed partition over exactly what `globals.css`
 * declares in `:root` — adding a `--avatar-N` custom property there would
 * require classifying it (brandable/bounded/platform) and would fail
 * `contract.test.ts`'s closure assertion until it did, which is schema-shaped
 * work this Polish-classified pipeline explicitly isn't scoped for. Six
 * literal Tailwind colour-family classes, each with a light AND a dark pair,
 * is the SAME idiom this codebase already uses for decorative,
 * non-brand-fill colour-coding — see `(admin)/admin/feedback/page.tsx`'s
 * `CATEGORY_BADGE`/`STATUS_BADGE` maps (`bg-orange-100 text-orange-700
 * dark:bg-orange-950 dark:text-orange-200`, etc.). Both directory pages this
 * renders on live inside `(org)/o/[slug]`, one of the two brandable route
 * groups (DECISION-047), so nothing here needs to dodge `check:brand-scope`
 * either — these are plain Tailwind utilities, not `*-brand[-*]` classes.
 *
 * Hues chosen to stay clear of this app's existing SEMANTIC colours so an
 * avatar never accidentally reads as a status: no red/rose (destructive), no
 * amber/yellow (warning, 2FA/roll-action banners), no green (the reserved
 * `--success` token family). Six hues spread across the wheel (teal ~175°,
 * cyan ~190°, indigo ~240°, violet ~270°, fuchsia ~300°, rose-adjacent avoided
 * — used a warmer slate instead) so adjacent cards in a 3-column grid rarely
 * share a colour.
 */
const AVATAR_PALETTE = [
  "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100",
  "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-200",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200",
  "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-200",
  "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900 dark:text-fuchsia-200",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-200",
] as const;

/**
 * A deterministic string hash (DJB2-ish: `hash = hash*31 + charCode`,
 * unsigned via `>>> 0`) into an index over `AVATAR_PALETTE`. The SAME
 * `seed` always produces the SAME index — that is the whole point: a
 * person's avatar colour must not shuffle on every render/navigation.
 *
 * ONE REAL CALL SITE (this file) — every caller renders `<PersonAvatar>`,
 * never this function directly, so per Component Rule 5's premature-
 * abstraction discipline this stays a local, non-exported helper rather than
 * a `src/lib/` utility. If a second component ever needs the identical
 * "hash a stable id into N muted colour buckets" behavior independent of
 * `<PersonAvatar>`, THAT is the point to extract it.
 */
function avatarPaletteClassName(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]!;
}

/**
 * A directory card's avatar. Plain, synchronous, presentational — image if
 * `photoSrc` is set, initials fallback otherwise (shadcn `Avatar`'s own
 * fallback surface, never a broken `<img>` or a name-shaped blank).
 */
export interface PersonAvatarProps {
  photoSrc: string | null;
  /** Used for the initials fallback AND the image's alt text. */
  displayName: string;
  /**
   * The stable identifier the fallback's background colour is hashed from
   * (docs/work-log/2026-08-28-directory-visual-refresh.md, Phase 4, item 1).
   * PREFER `person.id` over a name — names collide (two "Sarah Johnson"s in
   * one congregation would otherwise share a colour AND, worse, a colour
   * change on a legal-name edit) and this repo already treats a person's id,
   * not their name, as the stable key everywhere else (`roll_actions`,
   * `withOrgContext()`). `DeaconCard` is the one exception: the deacon-by-
   * office derivation (`deriveDeaconsByOrgUnit()`) returns a name only, no
   * `personId` — extending that query's shape is schema/query work outside
   * this Polish-classified pipeline's scope, so it seeds on `deaconName`
   * instead. Acceptable there specifically because that card renders at most
   * one avatar per page, never a grid where two same-named people could be
   * seen side by side.
   */
  seed: string;
  className?: string;
}

export function PersonAvatar({
  photoSrc,
  displayName,
  seed,
  className,
}: PersonAvatarProps) {
  return (
    <Avatar className={className}>
      {photoSrc && <AvatarImage src={photoSrc} alt={`${displayName}'s photo`} />}
      <AvatarFallback
        aria-hidden={Boolean(photoSrc)}
        className={avatarPaletteClassName(seed)}
      >
        {initialsFrom(displayName)}
      </AvatarFallback>
    </Avatar>
  );
}

// Exported for `person-avatar.test.tsx`'s determinism assertions only — not
// part of the component's public surface (no other file imports this).
export { avatarPaletteClassName as __avatarPaletteClassNameForTest };
