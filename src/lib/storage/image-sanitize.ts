import "server-only";
import sharp from "sharp";

/**
 * The image sanitizer: decode, apply the EXIF orientation, drop every metadata
 * segment, bound the size, re-encode as JPEG (docs/work-log/2026-10-25-treasury-
 * inc1.md, Phase 3 "Receipts and the F289 audience API"; DECISION-270).
 *
 * THE ONLY IMPORTER OF `sharp` (treasury boundary T5, `npm run
 * check:treasury-boundaries`, exactly one). A second consumer calls THIS
 * function; it does not import the library.
 *
 * WHAT IT GUARANTEES, in the order a reader of a receipt cares:
 *   - Location and device data in EXIF/XMP/IPTC never reach the stored bytes: the
 *     output carries no metadata at all (`.withMetadata()` is never called, and a
 *     test reads the output back to prove it).
 *   - The picture is the right way up: `.rotate()` with no argument applies the
 *     EXIF orientation and clears the tag, so the viewer does not have to.
 *   - An image/HTML or image/script polyglot (valid image bytes with a payload
 *     appended or tucked into a chunk) is destroyed: the output is a fresh JPEG
 *     written by the encoder, not a copy of the input.
 *   - A decompression bomb is refused: `limitInputPixels` bounds the decoder, so
 *     a 40 KB file that declares 60,000 x 60,000 pixels is `unreadable`, not an
 *     allocation.
 *   - The output is at most `maxBytes` (default 4,000,000, the receipt cap), or
 *     the result says `too_large`.
 *
 * PDFs are NOT passed through here (they are not images); they are an accepted
 * residual of DECISION-270, mitigated at serve time.
 *
 * `failOn: "error"` (sharp's own default is the stricter "warning"): a phone photo
 * with harmless trailing bytes or a benign decoder warning should still be
 * usable; only an image libvips cannot decode at all is `unreadable`. Nothing
 * about the safety properties above depends on the stricter setting, because the
 * output is always a fresh encode.
 *
 * Transparent images (a PNG screenshot) are flattened onto white: JPEG has no
 * alpha, and the default would make the transparent area black.
 */

/** Longest edge of the stored image, in pixels. A receipt is read, not printed at poster size. */
export const SANITIZED_MAX_EDGE = 1800;
/** Decoder bound: refuse an input that declares more than this many pixels. */
export const SANITIZER_MAX_INPUT_PIXELS = 64_000_000;
/** The default output cap (the receipt cap, `MAX_RECEIPT_BYTES`). */
export const SANITIZED_DEFAULT_MAX_BYTES = 4_000_000;
/** Tried in order until the output fits; the first that fits wins. */
export const SANITIZER_QUALITIES = [80, 70, 60, 50] as const;

export type SanitizeFailure = "unreadable" | "too_large";

export type SanitizeResult =
  | { ok: true; bytes: Buffer; contentType: "image/jpeg"; width: number; height: number }
  | { ok: false; reason: SanitizeFailure };

// A serverless function handles one upload at a time; libvips' operation cache
// would only hold the last image's pixels.
sharp.cache(false);

async function encode(input: Buffer, quality: number, maxInputPixels: number): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(input, {
    limitInputPixels: maxInputPixels,
    failOn: "error",
  })
    .rotate()
    .resize({ width: SANITIZED_MAX_EDGE, height: SANITIZED_MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Re-encode `input` (bytes already sniffed as png, jpeg or webp by the caller)
 * as a metadata-free JPEG. Never throws for a bad image: a decode failure is
 * `{ ok: false, reason: "unreadable" }`.
 */
export async function sanitizeImage(
  input: Buffer,
  options: { maxBytes?: number; maxInputPixels?: number } = {},
): Promise<SanitizeResult> {
  const maxBytes = options.maxBytes ?? SANITIZED_DEFAULT_MAX_BYTES;
  const maxInputPixels = options.maxInputPixels ?? SANITIZER_MAX_INPUT_PIXELS;
  for (const quality of SANITIZER_QUALITIES) {
    let out: { data: Buffer; width: number; height: number };
    try {
      out = await encode(input, quality, maxInputPixels);
    } catch {
      return { ok: false, reason: "unreadable" };
    }
    if (out.data.byteLength > 0 && out.data.byteLength <= maxBytes) {
      return { ok: true, bytes: out.data, contentType: "image/jpeg", width: out.width, height: out.height };
    }
  }
  return { ok: false, reason: "too_large" };
}
