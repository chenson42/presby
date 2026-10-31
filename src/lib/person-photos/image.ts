import "server-only";
import sharp from "sharp";
import {
  MASTER_MAX_BYTES,
  MASTER_MAX_EDGE,
  MAX_INPUT_EDGE,
  MAX_INPUT_PIXELS,
  THUMB_EDGE,
  UPLOAD_MAX_BYTES,
} from "./limits";
import type { ImageRefusal } from "./types";

/**
 * ONE OF THE TWO FILES IN `src/` THAT IMPORT `sharp`, the other being
 * `src/lib/storage/image-sanitize.ts` (DECISION-312: a closed list of two; a
 * source scan in `scan.test.ts` fails on any third importer). Pure bytes in,
 * bytes out: no database, no filename, no request.
 * docs/work-log/2026-10-26-person-photos-inc1.md, R6/R7.
 *
 * THE ORDER IS THE SECURITY PROPERTY. Everything that can refuse a hostile or
 * oversized file runs BEFORE a single pixel is decoded:
 *
 *   1. size (`empty`, `too_large`);
 *   2. our own magic-byte sniff, JPEG / PNG / WebP only (a PDF, an SVG, a HEIC,
 *      plain text all stop here as `unsupported_type`; the browser's reported
 *      type and the filename are never read);
 *   3. an APNG marker scan (`animated`);
 *   4. the image HEADER via `sharp().metadata()`, which decodes no pixels:
 *      the format sharp sees must agree with the sniff, an animated WebP is
 *      refused (`animated`), and the pixel count and longest side are checked
 *      (`too_many_pixels`), so a 5000 x 5000 flat PNG (a few KB on the wire, 75 MB
 *      decoded) never allocates. `limitInputPixels` is the backstop inside sharp.
 *
 * Only then is the picture decoded, and it is ALWAYS re-encoded: the output
 * carries pixels and nothing else. Auto-orient (EXIF rotation applied, the tag
 * dropped), colour converted to sRGB with no profile retained, transparency
 * flattened on white, and every metadata block (EXIF including GPS, XMP, IPTC,
 * ICC) stripped, because sharp keeps none unless asked and nothing here asks.
 * A polyglot's trailing payload does not survive re-encoding.
 *
 *   - master: a JPEG, long edge at most MASTER_MAX_EDGE, never enlarged, no
 *     forced crop (a 5:7 portrait stays 5:7), at most MASTER_MAX_BYTES (quality
 *     steps down, then the size does);
 *   - thumbnail: THUMB_EDGE square WebP, `position: "top"` so a portrait keeps
 *     the head rather than the torso.
 */

export type ProcessedPhoto =
  | {
      kind: "ok";
      master: Buffer;
      masterContentType: "image/jpeg";
      thumb: Buffer;
      thumbContentType: "image/webp";
      /** The master's pixel size, after orientation and resize. */
      width: number;
      height: number;
    }
  | { kind: "refused"; reason: ImageRefusal };

type Sniffed = "jpeg" | "png" | "webp";

function sniff(bytes: Buffer): Sniffed | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
    return "webp";
  }
  return null;
}

/**
 * An APNG announces itself with an `acTL` chunk before the first `IDAT`. Walks
 * the chunk list (length, type, data, crc) without decoding anything.
 */
function isAnimatedPng(bytes: Buffer): boolean {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    offset += 12 + length;
  }
  return false;
}

const QUALITY_STEPS = [85, 78, 70, 62, 54, 46] as const;
const EDGE_STEPS = [MASTER_MAX_EDGE, 1000, 800, 640] as const;

const FLATTEN_BACKGROUND = "#ffffff";

export async function processPhoto(bytes: Buffer): Promise<ProcessedPhoto> {
  if (bytes.byteLength === 0) return { kind: "refused", reason: "empty" };
  if (bytes.byteLength > UPLOAD_MAX_BYTES) return { kind: "refused", reason: "too_large" };

  const sniffed = sniff(bytes);
  if (sniffed === null) return { kind: "refused", reason: "unsupported_type" };
  if (sniffed === "png" && isAnimatedPng(bytes)) return { kind: "refused", reason: "animated" };

  const open = () =>
    sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false });

  try {
    // Header only: no pixel is decoded by metadata().
    const meta = await sharp(bytes, { limitInputPixels: false, animated: true, failOn: "error" }).metadata();
    if (meta.format !== sniffed) return { kind: "refused", reason: "unsupported_type" };
    if ((meta.pages ?? 1) > 1) return { kind: "refused", reason: "animated" };
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w < 1 || h < 1) return { kind: "refused", reason: "unreadable" };
    if (w * h > MAX_INPUT_PIXELS || w > MAX_INPUT_EDGE || h > MAX_INPUT_EDGE) {
      return { kind: "refused", reason: "too_many_pixels" };
    }

    // One oriented, sRGB, opaque base; both derivatives are cloned from it.
    const base = open().autoOrient().toColourspace("srgb").flatten({ background: FLATTEN_BACKGROUND });

    let master: Buffer | null = null;
    let width = 0;
    let height = 0;
    search: for (const edge of EDGE_STEPS) {
      for (const quality of QUALITY_STEPS) {
        const { data, info } = await base
          .clone()
          .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality, mozjpeg: true, progressive: true })
          .toBuffer({ resolveWithObject: true });
        master = data;
        width = info.width;
        height = info.height;
        if (data.byteLength <= MASTER_MAX_BYTES) break search;
      }
    }
    if (master === null || master.byteLength > MASTER_MAX_BYTES) {
      // Not reachable for any picture within the input caps, but never store an oversized master.
      return { kind: "refused", reason: "too_large" };
    }

    const thumb = await base
      .clone()
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "cover", position: "top" })
      .webp({ quality: 72 })
      .toBuffer();

    return {
      kind: "ok",
      master,
      masterContentType: "image/jpeg",
      thumb,
      thumbContentType: "image/webp",
      width,
      height,
    };
  } catch {
    // Truncated, corrupt, or a decoder error. No detail leaves this function.
    return { kind: "refused", reason: "unreadable" };
  }
}
