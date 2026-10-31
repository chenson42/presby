/**
 * The image sanitizer (docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * "Receipts and the F289 audience API"). Real `sharp`, synthetic images only: the
 * properties that matter are about what the OUTPUT bytes contain, so each test
 * reads the output back.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

import {
  SANITIZED_MAX_EDGE,
  SANITIZER_MAX_INPUT_PIXELS,
  sanitizeImage,
} from "./image-sanitize";

/** A solid-colour image. */
function solid(width: number, height: number, channels: 3 | 4 = 3, rgb = { r: 40, g: 120, b: 200 }) {
  return sharp({ create: { width, height, channels, background: { ...rgb, alpha: channels === 4 ? 0 : 1 } } });
}

/** Deterministic noise (a seeded LCG): incompressible enough that quality changes the size. */
function noise(width: number, height: number): Buffer {
  const raw = Buffer.alloc(width * height * 3);
  let seed = 12345;
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = seed >> 16;
  }
  return raw;
}

const noiseJpeg = (quality: number) =>
  sharp(noise(500, 500), { raw: { width: 500, height: 500, channels: 3 } }).jpeg({ quality }).toBuffer();

describe("sanitizeImage", () => {
  it("re-encodes a PNG as a JPEG and reports the content type and size", async () => {
    const png = await solid(120, 80).png().toBuffer();
    const result = await sanitizeImage(png);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contentType).toBe("image/jpeg");
    expect(result.bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(result).toMatchObject({ width: 120, height: 80 });
    expect((await sharp(result.bytes).metadata()).format).toBe("jpeg");
  });

  it("accepts a WebP and a JPEG too", async () => {
    for (const input of [await solid(64, 64).webp().toBuffer(), await solid(64, 64).jpeg().toBuffer()]) {
      const result = await sanitizeImage(input);
      expect(result.ok).toBe(true);
    }
  });

  it("drops EXIF: a camera make, a copyright line and a GPS block never reach the stored bytes", async () => {
    const withExif = await solid(64, 48)
      .jpeg()
      .withExif({
        IFD0: { Make: "Invented Camera Co", Copyright: "Alder Creek Fixture" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 0/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "83/1 0/1 0/1" },
      })
      .toBuffer();
    // the fixture really carries the data (otherwise this test proves nothing)
    expect(withExif.includes("Invented Camera Co")).toBe(true);
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const result = await sanitizeImage(withExif);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const meta = await sharp(result.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect(result.bytes.includes("Invented Camera Co")).toBe(false);
    expect(result.bytes.includes("Alder Creek Fixture")).toBe(false);
    expect(result.bytes.includes("Exif")).toBe(false);
  });

  it("applies the EXIF orientation and clears the tag (a sideways photo comes out upright)", async () => {
    const sideways = await solid(40, 20).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(sideways).metadata()).orientation).toBe(6);
    const result = await sanitizeImage(sideways);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({ width: 20, height: 40 });
    const meta = await sharp(result.bytes).metadata();
    expect(meta).toMatchObject({ width: 20, height: 40 });
    expect(meta.orientation).toBeUndefined();
  });

  it("destroys an image/HTML polyglot: a payload appended to a JPEG is not in the output", async () => {
    const jpeg = await solid(50, 50).jpeg().toBuffer();
    const payload = Buffer.from("<html><script>alert('fixture')</script></html>");
    const polyglot = Buffer.concat([jpeg, payload]);
    expect(polyglot.includes("<script>")).toBe(true);
    const result = await sanitizeImage(polyglot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes.includes("<script>")).toBe(false);
    expect(result.bytes.includes("<html>")).toBe(false);
  });

  it("destroys a payload tucked into a PNG text chunk", async () => {
    const png = await solid(50, 50).png().withMetadata({ comment: "<script>alert('fixture')</script>" } as never).toBuffer();
    // sharp may or may not write the comment; either way the output must not carry it
    const result = await sanitizeImage(png);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes.includes("<script>")).toBe(false);
  });

  it("scales a large image down so its long edge is the cap, keeping the aspect ratio", async () => {
    const big = await solid(3000, 2000).jpeg().toBuffer();
    const result = await sanitizeImage(big);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({ width: SANITIZED_MAX_EDGE, height: 1200 });
  });

  it("never enlarges a small image", async () => {
    const small = await solid(100, 50).png().toBuffer();
    const result = await sanitizeImage(small);
    expect(result).toMatchObject({ ok: true, width: 100, height: 50 });
  });

  it("flattens transparency onto white rather than black", async () => {
    const transparent = await solid(16, 16, 4).png().toBuffer();
    const result = await sanitizeImage(transparent);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { data } = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(245);
    expect(data[1]).toBeGreaterThan(245);
    expect(data[2]).toBeGreaterThan(245);
  });

  it("says unreadable for bytes that are not an image, an empty buffer and a truncated header", async () => {
    expect(await sanitizeImage(Buffer.from("this is not an image at all"))).toEqual({ ok: false, reason: "unreadable" });
    expect(await sanitizeImage(Buffer.alloc(0))).toEqual({ ok: false, reason: "unreadable" });
    const png = await solid(40, 40).png().toBuffer();
    expect(await sanitizeImage(png.subarray(0, 12))).toEqual({ ok: false, reason: "unreadable" });
  });

  it("refuses a decompression bomb by its declared size, without decoding it", async () => {
    // a real 1x1 PNG whose IHDR is rewritten to declare 60,000 x 60,000 pixels (3.6 billion)
    const png = Buffer.from(await solid(1, 1).png().toBuffer());
    const ihdr = png.indexOf("IHDR");
    png.writeUInt32BE(60_000, ihdr + 4);
    png.writeUInt32BE(60_000, ihdr + 8);
    png.writeUInt32BE(crc32(png.subarray(ihdr, ihdr + 4 + 13)), ihdr + 4 + 13);
    expect(60_000 * 60_000).toBeGreaterThan(SANITIZER_MAX_INPUT_PIXELS);
    const started = Date.now();
    expect(await sanitizeImage(png)).toEqual({ ok: false, reason: "unreadable" });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("bounds the decoder by declared pixels: an image over the limit is unreadable, at the limit it is fine (the production limit is 64 million)", async () => {
    const png = await solid(100, 100).png().toBuffer();
    expect(SANITIZER_MAX_INPUT_PIXELS).toBe(64_000_000);
    expect(await sanitizeImage(png, { maxInputPixels: 9_999 })).toEqual({ ok: false, reason: "unreadable" });
    expect((await sanitizeImage(png, { maxInputPixels: 10_000 })).ok).toBe(true);
  });

  it("steps the quality down until the output fits, then refuses as too_large", async () => {
    // a cap just under the quality-80 size is met by a lower quality
    const input = await noiseJpeg(100);
    const q80 = await sanitizeImage(input);
    expect(q80.ok).toBe(true);
    if (!q80.ok) return;
    const cap = q80.bytes.byteLength - 1;
    const fitted = await sanitizeImage(input, { maxBytes: cap });
    expect(fitted.ok).toBe(true);
    if (fitted.ok) expect(fitted.bytes.byteLength).toBeLessThanOrEqual(cap);

    // a cap nothing reaches
    expect(await sanitizeImage(input, { maxBytes: 100 })).toEqual({ ok: false, reason: "too_large" });
  });
});

describe("T5: sharp has exactly one importer", () => {
  const SRC = join(process.cwd(), "src");
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  it("`src/lib/storage/image-sanitize.ts` imports sharp and no other non-test source file does", () => {
    const importers = walk(SRC)
      .filter((file) => /(^|\n)\s*import[^;]*\bfrom\s+["']sharp["']|\brequire\(\s*["']sharp["']\s*\)|\bimport\(\s*["']sharp["']\s*\)/.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file).split(sep).join("/"));
    expect(importers).toEqual(["src/lib/storage/image-sanitize.ts"]);
  });
});

/** CRC-32 (the PNG chunk checksum), for the bomb fixture only. */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
