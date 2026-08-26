import { initialsFrom } from "@/lib/initials";
import { cn } from "@/lib/utils";

/**
 * The organization's mark/wordmark — shared by `(admin)`'s operator surface
 * (commit `c3`) and `(org)`'s emission (commit `c4`). Encodes G7 verbatim
 * (docs/work-log/2026-08-19-brand-foundation.md):
 *
 *   - Never composite a supplied logo onto a brand-coloured or dark surface —
 *     it always sits on a fixed, literal near-white plate, in EVERY colour
 *     scheme and in EVERY route group, brandable or not. That is what answers
 *     the "what about a dark variant" question by not needing one, and it is
 *     also why this component takes no `tone`/brand prop: there is nothing
 *     for a caller to vary.
 *   - Two slots: `mark` (square, G3: a rounded square, never a circle — the
 *     person avatar is the circle) and `wordmark` (wide). If only one asset
 *     is supplied, it is used as the wordmark and the mark slot falls back to
 *     initials (`src/lib/initials.ts` — not reimplemented here).
 *   - No image at all: the fallback is TYPOGRAPHIC — the organization's own
 *     name — never a generic building glyph and never a cross (G7: a
 *     denomination with real theological variety about symbols).
 *
 * `displaySrc`/`wordmarkSrc` are plain `<img src>` values (a data: URI on the
 * admin write path today, since the public read path is P3 — the component
 * itself has no opinion on how the byte source was produced).
 */

const MARK_SIZE_CLASSES = {
  sm: "size-8 text-xs",
  md: "size-12 text-sm",
  lg: "size-16 text-base",
} as const;

export type OrgMarkSize = keyof typeof MARK_SIZE_CLASSES;

export interface OrgMarkProps {
  /** The organization's name — used for the initials/typographic fallback
   * and as the image's alt text when a mark exists. */
  name: string;
  /** Square logo asset, if the org has one uploaded. */
  markSrc?: string | null;
  /** Wide logo asset, if the org has one uploaded. Mark upload is the only
   * wired path in commit `c3` (S18's minimal surface); this prop exists so
   * `(org)`'s later emission and a future tenant-facing editor (slice d) can
   * pass a real wordmark without a second component. */
  wordmarkSrc?: string | null;
  size?: OrgMarkSize;
  className?: string;
}

/** The fixed neutral plate — literal, not a token. G7: "always," in every
 * scheme, in every route group. A CSS variable here would let a brand-scoped
 * ancestor repaint it, which is exactly what must never happen. */
const NEUTRAL_PLATE =
  "border border-zinc-200 bg-white text-zinc-700";

/**
 * The square mark. Image if one exists; otherwise initials on the neutral
 * plate — never a building glyph, never a cross (G7).
 */
export function OrgMark({
  name,
  markSrc,
  size = "md",
  className,
}: OrgMarkProps) {
  // Mark missing but a wordmark exists: G7 says use the wordmark AS the
  // wordmark and fall back to initials for the mark slot — the wordmark
  // image is deliberately not squeezed into a square (G7: "never auto-crop a
  // wordmark into a square — it will slice their name in half").
  const hasMarkImage = Boolean(markSrc);

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md",
        NEUTRAL_PLATE,
        MARK_SIZE_CLASSES[size],
        className,
      )}
      aria-hidden={hasMarkImage ? undefined : true}
    >
      {hasMarkImage ? (
        // data: URI on the admin path today; the (public) served-asset path
        // is P3, where a real optimizable URL will exist.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={markSrc ?? undefined}
          alt={`${name} logo`}
          className="size-full object-contain p-1"
        />
      ) : (
        <span className="select-none font-semibold" aria-hidden="true">
          {initialsFrom(name)}
        </span>
      )}
    </div>
  );
}

/**
 * The wide lockup: wordmark image, or the mark image un-cropped, or the
 * organization's name as text (G7's typographic fallback — "not a generic
 * church-building glyph and specifically not a cross").
 *
 * The name's font is the platform default until `src/lib/brand/fonts.ts`
 * (slice e1) resolves a per-org type pairing to a real face; wiring that in
 * is `(org)` emission's job (commit c4), not this component's.
 */
export function OrgWordmark({
  name,
  markSrc,
  wordmarkSrc,
  plate = true,
  className,
}: Omit<OrgMarkProps, "size"> & {
  /**
   * G7's neutral plate, on by default everywhere (the admin surface, and
   * any future dark-context caller, both rely on it being the DEFAULT so a
   * new call site can't forget it). Set `false` only where a caller has
   * explicit product direction that the raw logo belongs directly on the
   * page background — presby-repo header chrome sitting on its own
   * `bg-background`, not a brand-coloured or dark surface, per the
   * 2026-08-26 portal-chrome refinement ("the logo doesn't need to be in a
   * card"). Never flip this for a surface that can be dark or brand-tinted.
   */
  plate?: boolean;
}) {
  const src = wordmarkSrc ?? markSrc ?? null;

  return (
    <div
      className={cn(
        "flex h-10 max-w-[220px] shrink-0 items-center overflow-hidden",
        plate ? cn("rounded-md", NEUTRAL_PLATE, src ? "px-2" : "px-3") : null,
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`${name} logo`}
          className="h-full max-w-full object-contain"
        />
      ) : (
        <span className="truncate text-sm font-semibold" title={name}>
          {name}
        </span>
      )}
    </div>
  );
}
