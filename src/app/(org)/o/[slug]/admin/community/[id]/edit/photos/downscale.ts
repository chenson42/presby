import { CLIENT_MAX_EDGE, CLIENT_TARGET_BYTES } from "@/lib/person-photos/limits";

/**
 * The client-side downscale that runs BEFORE an upload (docs/work-log/
 * 2026-10-26-person-photos-inc1.md, Phase 3 "Component / Page Plan"; F336,
 * edge cases 2 and 26). A 12 MP phone JPEG is 3 to 6 MB and the Server Action
 * body limit is 1 MiB (F330), so the island shrinks the picture to at most
 * `CLIENT_TARGET_BYTES` first. The server is still the authority: it re-decodes,
 * strips, and re-encodes whatever arrives; this file is only courtesy.
 *
 * NO `URL.createObjectURL` AND NO `blob:` IMAGE, anywhere in this file: the CSP
 * is `img-src 'self' data:` (F336), so a blob URL would be blocked and, worse,
 * invites a preview the policy forbids. The picture is decoded with
 * `createImageBitmap`, drawn to a canvas, and read back with `toBlob`;
 * `downscale.test.ts` scans this source for the forbidden call.
 *
 * A LARGE file is decoded at a reduced size (`resizeWidth`), so a 48 MP camera
 * original is never decoded at full size (iOS Safari's canvas-area limit); a
 * SMALL file (at most `FULL_DECODE_MAX_BYTES`, which cannot be a camera
 * original) is decoded as is, because `resizeWidth` would otherwise ENLARGE a
 * small picture. The canvas then fits the long edge, flattens transparency on
 * white (a JPEG has no alpha) and steps quality, then the edge, down until the
 * result fits. The original filename never leaves the browser: the output is
 * always named `photo.jpg`.
 */

/** A file this small cannot be a full-resolution camera original: decode it unscaled. */
export const FULL_DECODE_MAX_BYTES = 1_500_000;
/** The JPEG qualities tried at each edge, best first. */
export const QUALITY_STEPS = [0.9, 0.8, 0.7, 0.6, 0.5] as const;
/** The long edges tried, widest first. */
export const EDGE_STEPS = [CLIENT_MAX_EDGE, 1200] as const;
/** The fixed name of the uploaded file. */
export const OUTPUT_NAME = "photo.jpg";

/** Why the picture could not be prepared: the browser could not decode it, or could not reach the size. */
export class DownscaleError extends Error {
  constructor(readonly kind: "undecodable" | "too_big") {
    super(kind);
    this.name = "DownscaleError";
  }
}

/** The scale that brings the long edge to at most `maxEdge`, never above 1 (never enlarged). */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const scale = maxEdge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The pieces of the browser this needs, injectable so a test needs no real decoder. */
export interface DownscaleEnv {
  createBitmap: (file: Blob, options?: { resizeWidth?: number }) => Promise<{ width: number; height: number; close?: () => void }>;
  makeCanvas: (width: number, height: number) => {
    draw: (bitmap: unknown, width: number, height: number) => void;
    toBlob: (quality: number) => Promise<Blob | null>;
  };
}

/** The real browser's implementation. */
export const browserEnv: DownscaleEnv = {
  createBitmap: (file, options) =>
    createImageBitmap(file, {
      imageOrientation: "from-image",
      ...(options?.resizeWidth ? { resizeWidth: options.resizeWidth, resizeQuality: "medium" as const } : {}),
    }),
  makeCanvas: (width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    return {
      draw: (bitmap, w, h) => {
        if (!ctx) throw new DownscaleError("undecodable");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);
      },
      toBlob: (quality) => new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality)),
    };
  },
};

/** Decodes, fits, and re-encodes `file` as a JPEG of at most `CLIENT_TARGET_BYTES`, or throws a `DownscaleError`. */
export async function downscaleToJpeg(file: Blob, env: DownscaleEnv = browserEnv): Promise<File> {
  let bitmap: Awaited<ReturnType<DownscaleEnv["createBitmap"]>>;
  try {
    bitmap =
      file.size <= FULL_DECODE_MAX_BYTES
        ? await env.createBitmap(file)
        : await env.createBitmap(file, { resizeWidth: CLIENT_MAX_EDGE });
  } catch {
    // A browser that cannot decode the file (HEIC off Apple platforms, a corrupt or non-image file).
    throw new DownscaleError("undecodable");
  }
  try {
    for (const edge of EDGE_STEPS) {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, edge);
      const canvas = env.makeCanvas(width, height);
      canvas.draw(bitmap, width, height);
      for (const quality of QUALITY_STEPS) {
        const blob = await canvas.toBlob(quality);
        if (!blob) throw new DownscaleError("undecodable");
        if (blob.size <= CLIENT_TARGET_BYTES) return new File([blob], OUTPUT_NAME, { type: "image/jpeg" });
      }
    }
    throw new DownscaleError("too_big");
  } finally {
    bitmap.close?.();
  }
}
