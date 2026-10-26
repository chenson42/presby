/**
 * U1: the image pipeline (docs/work-log/2026-10-26-person-photos-inc1.md,
 * Phase 3 Test Plan). Real `sharp`, synthetic bytes only: every fixture is
 * generated here, no file on disk and no real photograph.
 */
import { describe, expect, it, vi } from "vitest";
import sharp, { type Sharp, type CreateRaw } from "sharp";

vi.mock("server-only", () => ({}));

import { processPhoto } from "./image";
import { MASTER_MAX_BYTES, MASTER_MAX_EDGE, THUMB_EDGE } from "./limits";

/**
 * A deterministic textured picture: white noise at 1/`cell` resolution, upscaled
 * smoothly. Pure per-pixel noise at camera sizes is several MB of JPEG (it would
 * trip the 1 MB upload ceiling before any pipeline step); a smooth texture is a
 * realistic photo-weight stand-in.
 */
async function textured(width: number, height: number, cell = 4): Promise<Buffer> {
  const w = Math.max(1, Math.ceil(width / cell));
  const h = Math.max(1, Math.ceil(height / cell));
  const raw = Buffer.alloc(w * h * 3);
  let seed = 12345;
  for (let i = 0; i < raw.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = (seed >> 16) & 0xff;
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .resize(width, height, { kernel: "cubic", fit: "fill" })
    .raw()
    .toBuffer();
}

async function jpegOf(
  width: number,
  height: number,
  mutate?: (s: Sharp) => Sharp,
  opts: { cell?: number; quality?: number } = {},
): Promise<Buffer> {
  const raw = await textured(width, height, opts.cell);
  let s = sharp(raw, { raw: { width, height, channels: 3 } });
  if (mutate) s = mutate(s);
  return s.jpeg({ quality: opts.quality ?? 80 }).toBuffer();
}

function ok(result: Awaited<ReturnType<typeof processPhoto>>) {
  if (result.kind !== "ok") throw new Error(`expected ok, got refused: ${result.reason}`);
  return result;
}

describe("processPhoto: what comes out", () => {
  it("strips location and every other metadata (EXIF GPS, ICC) from the master and the thumbnail", async () => {
    const input = await jpegOf(800, 600, (s) =>
      s.withExif({ IFD0: { Copyright: "synthetic" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 0/1 0/1" } }),
    );
    expect((await sharp(input).metadata()).exif).toBeDefined(); // the fixture really carries EXIF
    const out = ok(await processPhoto(input));
    for (const buf of [out.master, out.thumb]) {
      const meta = await sharp(buf).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.iptc).toBeUndefined();
      expect(buf.includes(Buffer.from("GPS"))).toBe(false);
      expect(buf.includes(Buffer.from("synthetic"))).toBe(false);
    }
  });

  it("applies EXIF orientation and drops the tag: a landscape file marked 'rotate 90' comes out portrait and upright", async () => {
    // 400x200 pixels with orientation 6 (rotate 90 CW): displayed 200x400.
    const input = await jpegOf(400, 200, (s) => s.withMetadata({ orientation: 6 }));
    expect((await sharp(input).metadata()).orientation).toBe(6);
    const out = ok(await processPhoto(input));
    const meta = await sharp(out.master).metadata();
    expect([meta.width, meta.height]).toEqual([200, 400]);
    expect(meta.orientation).toBeUndefined();
    expect([out.width, out.height]).toEqual([200, 400]);
  });

  it("converts a Display-P3 image to sRGB and leaves no profile behind", async () => {
    // Saturated sRGB red, then encoded as Display-P3 (the pixel numbers move to roughly
    // 234,51,35 and a P3 profile is attached). A pipeline that ignored the profile would
    // hand those numbers back; a real conversion returns red.
    const red = Buffer.alloc(64 * 64 * 3);
    for (let i = 0; i < red.length; i += 3) red[i] = 255;
    const p3 = await sharp(red, { raw: { width: 64, height: 64, channels: 3 } }).withIccProfile("p3").png().toBuffer();
    expect((await sharp(p3).metadata()).icc).toBeDefined();
    const out = ok(await processPhoto(p3));
    const meta = await sharp(out.master).metadata();
    expect(meta.icc).toBeUndefined();
    expect(meta.space).toBe("srgb");
    const { data } = await sharp(out.master).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThanOrEqual(248);
    expect(data[1]).toBeLessThanOrEqual(12);
    expect(data[2]).toBeLessThanOrEqual(12);
  });

  it("flattens a transparent PNG on white", async () => {
    const png = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
    const out = ok(await processPhoto(png));
    const meta = await sharp(out.master).metadata();
    expect(meta.hasAlpha).toBe(false);
    const { data } = await sharp(out.master).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]].every((v) => v! >= 250)).toBe(true);
    expect(out.thumbContentType).toBe("image/webp");
  });

  it("scales a large master down to the long-edge cap and never enlarges a small one", async () => {
    const big = ok(await processPhoto(await jpegOf(2400, 1600, undefined, { cell: 8, quality: 70 })));
    expect(big.width).toBe(MASTER_MAX_EDGE);
    expect(big.height).toBe(800);
    const small = ok(await processPhoto(await jpegOf(300, 200)));
    expect([small.width, small.height]).toEqual([300, 200]);
  });

  it("keeps a 5:7 portrait's framing in the master (no forced crop)", async () => {
    const out = ok(await processPhoto(await jpegOf(1000, 1400, undefined, { cell: 8, quality: 70 })));
    expect(out.width / out.height).toBeCloseTo(5 / 7, 2);
    expect(Math.max(out.width, out.height)).toBe(MASTER_MAX_EDGE);
  });

  it("keeps the master at or under 400 KB even for a noisy 1200 px picture, by stepping quality then size", async () => {
    // A textured 2400x1800 picture at a low JPEG quality keeps the input under the
    // 1 MB upload ceiling while the 1200 px master at the first quality step is over 400 KB.
    const input = await jpegOf(2400, 1800, undefined, { cell: 4, quality: 45 });
    expect(input.byteLength).toBeLessThan(1_000_000);
    const out = ok(await processPhoto(input));
    expect(out.master.byteLength).toBeLessThanOrEqual(MASTER_MAX_BYTES);
    expect(out.masterContentType).toBe("image/jpeg");
    expect((await sharp(out.master).metadata()).format).toBe("jpeg");
  });

  it("makes a 160 x 160 WebP thumbnail", async () => {
    const out = ok(await processPhoto(await jpegOf(900, 1200)));
    const meta = await sharp(out.thumb).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([THUMB_EDGE, THUMB_EDGE]);
    expect(out.thumb.byteLength).toBeLessThan(40_000);
  });

  it("biases the thumbnail crop toward the top of a portrait (heads, not torsos)", async () => {
    // Top half red, bottom half blue, portrait. A centre crop would be half and half;
    // a top-biased crop is mostly red.
    const w = 400;
    const h = 800;
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 3;
        const top = y < h / 2;
        raw[i] = top ? 255 : 0;
        raw[i + 2] = top ? 0 : 255;
      }
    }
    const png = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    const out = ok(await processPhoto(png));
    const { data, info } = await sharp(out.thumb).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return { r: data[i]!, b: data[i + 2]! };
    };
    // A 400x800 image cropped to a 400x400 square at the top is entirely red.
    expect(px(80, 5).r).toBeGreaterThan(200);
    expect(px(80, 155).r).toBeGreaterThan(200);
    expect(px(80, 155).b).toBeLessThan(60);
  });

  it("re-encodes: a JPEG with a script and a PDF appended outputs neither (polyglot payload does not survive)", async () => {
    const clean = await jpegOf(200, 200);
    const polyglot = Buffer.concat([clean, Buffer.from("\n%PDF-1.4\n<script>alert(1)</script>\n")]);
    const result = await processPhoto(polyglot);
    if (result.kind === "ok") {
      expect(result.master.includes(Buffer.from("<script>"))).toBe(false);
      expect(result.master.includes(Buffer.from("%PDF"))).toBe(false);
      expect(result.thumb.includes(Buffer.from("<script>"))).toBe(false);
    } else {
      expect(result.reason).toBe("unreadable");
    }
  });

  it("accepts PNG and WebP inputs", async () => {
    const src = await textured(300, 300);
    const raw = { raw: { width: 300, height: 300, channels: 3 as const } };
    ok(await processPhoto(await sharp(src, raw).png().toBuffer()));
    ok(await processPhoto(await sharp(src, raw).webp().toBuffer()));
  });
});

describe("processPhoto: what is refused, and why", () => {
  const refused = async (bytes: Buffer) => {
    const r = await processPhoto(bytes);
    if (r.kind !== "refused") throw new Error("expected a refusal");
    return r.reason;
  };

  it("an empty file is `empty`", async () => {
    expect(await refused(Buffer.alloc(0))).toBe("empty");
  });

  it("a file over the upload ceiling is `too_large`, before any decode", async () => {
    expect(await refused(Buffer.alloc(1_000_001, 0xff))).toBe("too_large");
  });

  it("a PDF, an SVG, plain text and a HEIC are `unsupported_type`", async () => {
    expect(await refused(Buffer.from("%PDF-1.7\n1 0 obj\n"))).toBe("unsupported_type");
    expect(await refused(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'))).toBe("unsupported_type");
    expect(await refused(Buffer.from("hello, this is not a picture"))).toBe("unsupported_type");
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(40)]);
    expect(await refused(heic)).toBe("unsupported_type");
  });

  it("an animated WebP is `animated`", async () => {
    // A tall strip of three 64 px frames, encoded as an animated WebP.
    const frames = Buffer.alloc(64 * 192 * 3);
    // Frames must differ or the encoder merges them into one.
    for (let i = 0; i < frames.length; i += 1) frames[i] = (Math.floor(i / (64 * 64 * 3)) * 90 + ((i * 7) & 0x1f)) & 0xff;
    const strip = await sharp(frames, { raw: { width: 64, height: 192, channels: 3, pageHeight: 64 } as CreateRaw })
      .webp({ loop: 0, delay: [100, 100, 100] })
      .toBuffer();
    expect((await sharp(strip, { animated: true }).metadata()).pages).toBe(3); // the fixture really is animated
    expect(await refused(strip)).toBe("animated");
  });

  it("an APNG is `animated`", async () => {
    // A PNG whose chunk list carries acTL before IDAT.
    const base = await sharp(await textured(16, 16), { raw: { width: 16, height: 16, channels: 3 } }).png().toBuffer();
    const ihdrEnd = 8 + 8 + 13 + 4;
    const actl = Buffer.alloc(8 + 8 + 4);
    actl.writeUInt32BE(8, 0);
    actl.write("acTL", 4, "ascii");
    actl.writeUInt32BE(2, 8);
    actl.writeUInt32BE(0, 12);
    const apng = Buffer.concat([base.subarray(0, ihdrEnd), actl, base.subarray(ihdrEnd)]);
    expect(await refused(apng)).toBe("animated");
  });

  it("a PNG pixel bomb is refused from the header (`too_many_pixels`), without decoding it", async () => {
    // 5000 x 5000 = 25 MP of one flat colour: a few KB on the wire, 75 MB decoded.
    const bomb = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "#808080" } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.byteLength).toBeLessThan(1_000_000);
    const started = Date.now();
    expect(await refused(bomb)).toBe("too_many_pixels");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("a picture over 6000 px on a side is `too_many_pixels` even when its area is small", async () => {
    const thin = await sharp({ create: { width: 6001, height: 10, channels: 3, background: "#fff" } }).png().toBuffer();
    expect(await refused(thin)).toBe("too_many_pixels");
  });

  it("a truncated JPEG is `unreadable`", async () => {
    const full = await jpegOf(600, 600);
    expect(await refused(full.subarray(0, Math.floor(full.byteLength / 3)))).toBe("unreadable");
  });

  it("magic bytes that promise a JPEG over a body that is not one are `unreadable`", async () => {
    expect(await refused(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("not really a jpeg at all")]))).toBe("unreadable");
  });

  it("a format that disagrees with the sniff is `unsupported_type` (PNG magic over a JPEG body)", async () => {
    const jpeg = await jpegOf(100, 100);
    const lying = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), jpeg.subarray(2)]);
    const reason = await refused(lying);
    expect(["unsupported_type", "unreadable"]).toContain(reason);
  });
});

describe("processPhoto: it is pure bytes in, bytes out", () => {
  it("takes no filename and returns no filename, dimensions of the thumbnail, or metadata beyond the master's size", async () => {
    const out = ok(await processPhoto(await jpegOf(100, 100)));
    expect(Object.keys(out).sort()).toEqual(["height", "kind", "master", "masterContentType", "thumb", "thumbContentType", "width"]);
  });
});
