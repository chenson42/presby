/**
 * A building photo's 160 px thumbnail (a `data:` URI the reader inlined; the CSP
 * has no `blob:`). A `thumbSrc` of null (its blob could not be read) renders a
 * neutral plate of the same size, so the tile and the controls beside it stay
 * usable and the page never shows an error for a missing picture.
 */
export function PhotoThumb({ src, size = "full" }: { src: string | null; size?: "full" | "cover" }) {
  const box = size === "cover" ? "size-24 shrink-0" : "aspect-square w-full";
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- a data: URI of a 160 px thumbnail; next/image would proxy it
    <img src={src} alt="" width={160} height={160} className={`${box} rounded-md border bg-muted object-cover`} />
  ) : (
    <div aria-hidden className={`${box} rounded-md border bg-muted`} />
  );
}
