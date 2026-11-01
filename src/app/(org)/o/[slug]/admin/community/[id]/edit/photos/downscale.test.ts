/**
 * U9: the client downscale (docs/work-log/2026-10-26-person-photos-inc1.md,
 * Phase 3 Test Plan U9; F336). A fake `DownscaleEnv` stands in for the browser's
 * decoder and canvas, so the dimension math, the quality and edge stepping, the
 * fixed output name, the refusal kinds, and the choice between a reduced and a
 * full decode are all provable without a browser. The real decode, orientation,
 * flatten and 900 KB result are proven in the e2e spec and the browser walk.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DownscaleError,
  EDGE_STEPS,
  FULL_DECODE_MAX_BYTES,
  OUTPUT_NAME,
  QUALITY_STEPS,
  downscaleToJpeg,
  fitWithin,
  type DownscaleEnv,
} from "./downscale";
import { CLIENT_MAX_EDGE, CLIENT_TARGET_BYTES } from "@/lib/person-photos/limits";

const SOURCE = readFileSync(path.resolve(__dirname, "downscale.ts"), "utf8");

function fakeFile(size: number): Blob {
  return new Blob([new Uint8Array(size)], { type: "image/png" });
}

/** An env whose encoder returns a blob of the size `sizeFor(width, quality)` says. */
function envWith(
  bitmap: { width: number; height: number },
  sizeFor: (width: number, quality: number) => number,
) {
  const drawn: Array<{ width: number; height: number }> = [];
  const qualities: number[] = [];
  const close = vi.fn();
  const createBitmap = vi.fn(async () => ({ ...bitmap, close }));
  const env: DownscaleEnv = {
    createBitmap,
    makeCanvas: (width, height) => ({
      draw: () => drawn.push({ width, height }),
      toBlob: async (quality) => {
        qualities.push(quality);
        return new Blob([new Uint8Array(sizeFor(width, quality))], { type: "image/jpeg" });
      },
    }),
  };
  return { env, drawn, qualities, close, createBitmap };
}

describe("fitWithin", () => {
  it("keeps the aspect ratio and puts the long edge at the limit", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });
  it("never enlarges", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });
  it("never produces a zero side", () => {
    expect(fitWithin(10000, 1, 1600).height).toBe(1);
  });
});

describe("downscaleToJpeg", () => {
  it("returns a JPEG File with the fixed name, never the original's name", async () => {
    const { env } = envWith({ width: 1600, height: 1200 }, () => 100_000);
    const original = new File([new Uint8Array(500)], "Grandma Beach Trip 2019.PNG", { type: "image/png" });
    const out = await downscaleToJpeg(original, env);
    expect(out.name).toBe(OUTPUT_NAME);
    expect(OUTPUT_NAME).toBe("photo.jpg");
    expect(out.type).toBe("image/jpeg");
  });

  it("steps quality down until the result is at most the 900 KB target", async () => {
    const { env, qualities } = envWith({ width: 1600, height: 1200 }, (_w, q) => (q > 0.7 ? 1_500_000 : 800_000));
    const out = await downscaleToJpeg(fakeFile(2_000_000), env);
    expect(out.size).toBeLessThanOrEqual(CLIENT_TARGET_BYTES);
    expect(qualities).toEqual([0.9, 0.8, 0.7]);
  });

  it("falls to the smaller edge when no quality fits at the first", async () => {
    const { env, drawn } = envWith({ width: 1600, height: 1200 }, (w) => (w > 1200 ? 2_000_000 : 300_000));
    const out = await downscaleToJpeg(fakeFile(2_000_000), env);
    expect(out.size).toBe(300_000);
    expect(drawn.map((d) => d.width)).toEqual([1600, 1200]);
    expect(EDGE_STEPS).toEqual([CLIENT_MAX_EDGE, 1200]);
  });

  it("fits a portrait picture by its long edge", async () => {
    const { env, drawn } = envWith({ width: 3000, height: 4000 }, () => 10_000);
    await downscaleToJpeg(fakeFile(2_000_000), env);
    expect(drawn[0]).toEqual({ width: 1200, height: 1600 });
  });

  it("refuses with too_big when nothing fits, after trying every step", async () => {
    const { env, qualities } = envWith({ width: 1600, height: 1200 }, () => 5_000_000);
    await expect(downscaleToJpeg(fakeFile(9_000_000), env)).rejects.toMatchObject({ kind: "too_big" });
    expect(qualities).toHaveLength(QUALITY_STEPS.length * EDGE_STEPS.length);
  });

  it("an undecodable file (HEIC off Apple platforms, a corrupt file) is 'undecodable', not a raw error", async () => {
    const env: DownscaleEnv = {
      createBitmap: async () => {
        throw new DOMException("The source image could not be decoded.", "InvalidStateError");
      },
      makeCanvas: () => {
        throw new Error("must not be reached");
      },
    };
    await expect(downscaleToJpeg(fakeFile(100), env)).rejects.toMatchObject({ kind: "undecodable" });
  });

  it("a canvas that cannot encode is 'undecodable'", async () => {
    const env: DownscaleEnv = {
      createBitmap: async () => ({ width: 10, height: 10 }),
      makeCanvas: () => ({ draw: () => {}, toBlob: async () => null }),
    };
    await expect(downscaleToJpeg(fakeFile(100), env)).rejects.toBeInstanceOf(DownscaleError);
  });

  it("decodes a camera-sized file at a reduced width, so a 48 MP original is never decoded in full", async () => {
    const { env, createBitmap } = envWith({ width: 1600, height: 1200 }, () => 1000);
    await downscaleToJpeg(fakeFile(FULL_DECODE_MAX_BYTES + 1), env);
    expect(createBitmap).toHaveBeenCalledWith(expect.anything(), { resizeWidth: CLIENT_MAX_EDGE });
  });

  it("decodes a small file as is, so a small picture is never enlarged", async () => {
    const { env, createBitmap } = envWith({ width: 400, height: 400 }, () => 1000);
    await downscaleToJpeg(fakeFile(FULL_DECODE_MAX_BYTES), env);
    expect(createBitmap).toHaveBeenCalledWith(expect.anything());
    expect(createBitmap.mock.calls[0]).toHaveLength(1);
  });

  it("releases the decoded bitmap, on success and on failure", async () => {
    const ok = envWith({ width: 100, height: 100 }, () => 10);
    await downscaleToJpeg(fakeFile(10), ok.env);
    expect(ok.close).toHaveBeenCalledTimes(1);
    const bad = envWith({ width: 100, height: 100 }, () => 5_000_000);
    await downscaleToJpeg(fakeFile(10), bad.env).catch(() => {});
    expect(bad.close).toHaveBeenCalledTimes(1);
  });
});

describe("source scan (the CSP has no blob: in img-src, F336)", () => {
  const code = SOURCE.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  it("never creates an object URL or names a blob: image", () => {
    expect(code).not.toMatch(/createObjectURL/);
    expect(code).not.toMatch(/["'`]blob:/);
  });
  it("decodes with createImageBitmap, honouring EXIF orientation, and flattens transparency on white", () => {
    expect(code).toMatch(/createImageBitmap/);
    expect(code).toMatch(/imageOrientation: "from-image"/);
    expect(code).toMatch(/fillStyle = "#ffffff"/);
    expect(code).toMatch(/fillRect/);
  });
});
