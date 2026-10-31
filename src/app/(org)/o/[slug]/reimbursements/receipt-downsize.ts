/**
 * Shrink a photo in the browser before it is uploaded (docs/work-log/2026-10-25-
 * treasury-inc1.md, Phase 3 "Receipts and the F289 audience API", "Client").
 *
 * A phone camera makes a 4 to 12 MB JPEG; the upload cap is 4 MB, and nobody
 * should wait on a cellular connection to send pixels that will be thrown away.
 * This re-draws an image whose long edge is over `DOWNSIZE_MAX_EDGE` (or whose
 * file is over the cap) onto a canvas and encodes it as a JPEG at
 * `DOWNSIZE_QUALITY`. THE SERVER STEP IS THE GUARANTEE, not this: `sanitizeImage`
 * re-encodes every image regardless of what arrives, and a browser that cannot do
 * this (no `createImageBitmap`, no canvas, a decode failure) just sends the
 * original file.
 *
 * Client-only; no `server-only`, no imports from the server modules.
 */

export const DOWNSIZE_MAX_EDGE = 1800;
export const DOWNSIZE_QUALITY = 0.8;

const RESIZABLE = new Set(["image/png", "image/jpeg", "image/webp"]);

/** The size to draw at: the long edge scaled to `max` (never enlarged), aspect ratio kept. PURE. */
export function targetSize(width: number, height: number, max: number = DOWNSIZE_MAX_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max || longest <= 0) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** `photo.png` -> `photo.jpg`; a name with no extension gains one. PURE. */
export function jpegName(name: string): string {
  return /\.[A-Za-z][A-Za-z0-9]{0,4}$/.test(name) ? name.replace(/\.[A-Za-z][A-Za-z0-9]{0,4}$/, ".jpg") : `${name}.jpg`;
}

/**
 * The file to upload: a smaller JPEG when the picture is large, otherwise the
 * file itself. Never throws.
 */
export async function downsizeForUpload(file: File, maxFileBytes: number): Promise<File> {
  if (!RESIZABLE.has(file.type)) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const size = targetSize(bitmap.width, bitmap.height);
      const scaled = size.width !== bitmap.width || size.height !== bitmap.height;
      if (!scaled && file.size <= maxFileBytes) return file;

      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) return file;
      // JPEG has no transparency; a transparent PNG would otherwise come out black.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", DOWNSIZE_QUALITY));
      if (!blob || blob.size === 0) return file;
      // Never make it worse: keep the original when the re-encode is larger and it already fits.
      if (blob.size >= file.size && file.size <= maxFileBytes) return file;
      return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
    } finally {
      bitmap.close?.();
    }
  } catch {
    return file;
  }
}
