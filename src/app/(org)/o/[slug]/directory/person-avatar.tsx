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
 * A directory card's avatar. Plain, synchronous, presentational — image if
 * `photoSrc` is set, initials fallback otherwise (shadcn `Avatar`'s own
 * fallback surface, never a broken `<img>` or a name-shaped blank).
 */
export interface PersonAvatarProps {
  photoSrc: string | null;
  /** Used for the initials fallback AND the image's alt text. */
  displayName: string;
  className?: string;
}

export function PersonAvatar({
  photoSrc,
  displayName,
  className,
}: PersonAvatarProps) {
  return (
    <Avatar className={className}>
      {photoSrc && <AvatarImage src={photoSrc} alt={`${displayName}'s photo`} />}
      <AvatarFallback aria-hidden={Boolean(photoSrc)}>
        {initialsFrom(displayName)}
      </AvatarFallback>
    </Avatar>
  );
}
