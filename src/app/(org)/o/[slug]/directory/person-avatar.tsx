import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getBlobStore } from "@/lib/storage/blob-store";
import { initialsFrom } from "@/lib/initials";

/**
 * Resolves `people.photo_key` (already privacy-nulled upstream by
 * `getDirectory()`'s SQL — this function never re-decides visibility, it
 * only renders what it was handed) to an inline `data:` URI, the same
 * pattern `(admin)/admin/organizations/[id]/page.tsx` and `org-mark.tsx`'s
 * own header already use for the org logo (DECISION-030: `blob_assets` is
 * never queried directly outside `src/lib/storage/`; every caller goes
 * through `resolve()`). No new streaming route — Phase 2 note 3 says to
 * flag one only if payload size becomes a real problem, and it hasn't at a
 * congregation directory's scale.
 *
 * `null` for a null `photoKey` OR a `resolve()` miss (a stale key) — both
 * are ordinary "no photo," not an error, matching `resolve()`'s own "unknown
 * key resolves to null, never a throw" contract.
 *
 * `organizationId` is trusted here, not re-verified: the caller
 * (`directory-grid.tsx`, itself called from `directory/page.tsx`) already
 * ran `getDirectory()` inside `withOrgContext()`, which is where membership
 * was proven. `resolve()` itself sets the org GUC directly (no membership
 * check, by its own module doc) and is scoped to a single key lookup, so
 * nothing here can leak a photo from a different organization even if
 * `photoKey` were somehow forged.
 *
 * A PLAIN async FUNCTION, not an async Server Component — kept separate
 * from `<PersonAvatar>` (below) specifically so the resolution step is
 * unit-testable by mocking `@/lib/storage/blob-store` directly, and so the
 * caller can resolve every card's photo in one `Promise.all()` rather than
 * one async component per card (React's client-render test harness,
 * `@testing-library/react` under jsdom, has no RSC runtime to await a tree
 * of async function components the way Next's real renderer does — the
 * `directory/page.tsx` orchestration tests already establish the "await the
 * async function directly, then hand the resolved element to `render()`"
 * pattern this file follows one level down).
 */
export async function resolvePhotoSrc(
  organizationId: string,
  photoKey: string | null,
): Promise<string | null> {
  if (!photoKey) return null;
  const resolved = await getBlobStore().resolve({
    organizationId,
    key: photoKey,
  });
  if (!resolved) return null;
  return `data:${resolved.contentType};base64,${resolved.bytes.toString("base64")}`;
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
