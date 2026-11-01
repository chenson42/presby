// @vitest-environment jsdom
/**
 * The browser-side photo shrink (docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * "Receipts and the F289 audience API", "Client"). It is a convenience; the server
 * re-encodes every image regardless, so what matters here is that it never makes a
 * file worse and never throws.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DOWNSIZE_MAX_EDGE, DOWNSIZE_QUALITY, downsizeForUpload, jpegName, targetSize } from "./receipt-downsize";

const CAP = 4_000_000;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("targetSize", () => {
  it("scales the long edge to the cap and keeps the aspect ratio", () => {
    expect(targetSize(4000, 3000)).toEqual({ width: 1800, height: 1350 });
    expect(targetSize(3000, 4000)).toEqual({ width: 1350, height: 1800 });
    expect(targetSize(1800, 5400)).toEqual({ width: 600, height: 1800 });
  });

  it("never enlarges, and never returns a zero side", () => {
    expect(targetSize(1800, 1200)).toEqual({ width: 1800, height: 1200 });
    expect(targetSize(300, 200)).toEqual({ width: 300, height: 200 });
    expect(targetSize(100_000, 10)).toEqual({ width: 1800, height: 1 });
  });
});

describe("jpegName", () => {
  it("swaps the extension for .jpg, or adds one", () => {
    expect(jpegName("receipt.png")).toBe("receipt.jpg");
    expect(jpegName("IMG_2041.webp")).toBe("IMG_2041.jpg");
    expect(jpegName("scan")).toBe("scan.jpg");
    expect(jpegName("Invoice 10.25")).toBe("Invoice 10.25.jpg");
  });
});

function fakeCanvas(blob: Blob | null) {
  const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((cb: (b: Blob | null) => void) => cb(blob)),
  };
  const original = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => (tag === "canvas" ? canvas : original(tag))) as typeof document.createElement);
  return { canvas, context };
}

const pngFile = (bytes = 10, name = "photo.png") => new File([new Uint8Array(bytes)], name, { type: "image/png" });

describe("downsizeForUpload", () => {
  it("returns a PDF and any other type untouched, without looking for a decoder", async () => {
    const createImageBitmap = vi.fn();
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    const pdf = new File(["%PDF-"], "bill.pdf", { type: "application/pdf" });
    expect(await downsizeForUpload(pdf, CAP)).toBe(pdf);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("returns the original when the browser cannot decode (no createImageBitmap)", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const file = pngFile();
    expect(await downsizeForUpload(file, CAP)).toBe(file);
  });

  it("returns the original when decoding throws", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("bad image")));
    const file = pngFile();
    expect(await downsizeForUpload(file, CAP)).toBe(file);
  });

  it("re-draws a large photo at the capped size and uploads a JPEG named .jpg", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 4000, height: 3000, close }));
    const { canvas, context } = fakeCanvas(new Blob([new Uint8Array(500)], { type: "image/jpeg" }));
    const file = pngFile(6_000_000, "kitchen.png");
    const out = await downsizeForUpload(file, CAP);
    expect(out).not.toBe(file);
    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("kitchen.jpg");
    expect(out.size).toBe(500);
    expect(canvas.width).toBe(DOWNSIZE_MAX_EDGE);
    expect(canvas.height).toBe(1350);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", DOWNSIZE_QUALITY);
    // painted white first, so a transparent PNG is not black
    expect(context.fillStyle).toBe("#ffffff");
    expect(context.fillRect).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("leaves a picture that is already small and under the cap alone", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 1200, height: 800, close: vi.fn() }));
    const file = pngFile(300_000);
    expect(await downsizeForUpload(file, CAP)).toBe(file);
  });

  it("shrinks a small-dimension file that is over the byte cap", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 1200, height: 800, close: vi.fn() }));
    fakeCanvas(new Blob([new Uint8Array(200_000)], { type: "image/jpeg" }));
    const out = await downsizeForUpload(pngFile(4_500_000), CAP);
    expect(out.size).toBe(200_000);
  });

  it("never makes it worse: a re-encode larger than a file that already fits keeps the original", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() }));
    fakeCanvas(new Blob([new Uint8Array(900)], { type: "image/jpeg" }));
    const file = pngFile(800);
    expect(await downsizeForUpload(file, CAP)).toBe(file);
  });

  it("returns the original when the canvas gives no context or no blob", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() }));
    fakeCanvas(null);
    const file = pngFile(6_000_000);
    expect(await downsizeForUpload(file, CAP)).toBe(file);
  });
});
