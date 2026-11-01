/**
 * The pure half of the receipt upload (docs/work-log/2026-10-25-treasury-inc1.md,
 * Phase 3 API Contract Layer 4): Origin, declared size, the bounded read, the
 * one-file multipart parse, the sniff and the display name.
 */
import { describe, expect, it } from "vitest";
import { MAX_LENGTH, MAX_RECEIPT_BODY_BYTES } from "./limits";
import {
  declaredTooLarge,
  originRefused,
  parseSingleFile,
  readBoundedBody,
  receiptDisplayName,
  sha256Hex,
  sniffReceipt,
} from "./upload-request";

const ORIGIN = "https://app.example.invalid";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n");

async function multipart(fd: FormData): Promise<{ bytes: Buffer; contentType: string }> {
  const response = new Response(fd);
  return { bytes: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type")! };
}

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

const requestWith = (body: ReadableStream<Uint8Array> | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost/upload", { method: "POST", body, headers, ...(body ? { duplex: "half" } : {}) } as RequestInit);

describe("originRefused", () => {
  it("accepts exactly the platform origin", () => {
    expect(originRefused(new Headers({ origin: ORIGIN }), ORIGIN)).toBe(false);
  });

  it("refuses a missing Origin, a foreign one, a near miss and a trailing-slash form", () => {
    expect(originRefused(new Headers(), ORIGIN)).toBe(true);
    expect(originRefused(new Headers({ origin: "https://evil.example.invalid" }), ORIGIN)).toBe(true);
    expect(originRefused(new Headers({ origin: `${ORIGIN}.evil.example.invalid` }), ORIGIN)).toBe(true);
    expect(originRefused(new Headers({ origin: `${ORIGIN}/` }), ORIGIN)).toBe(true);
    expect(originRefused(new Headers({ origin: "null" }), ORIGIN)).toBe(true);
  });

  it("refuses everything when the platform origin is unknown (a misconfigured production)", () => {
    expect(originRefused(new Headers({ origin: ORIGIN }), null)).toBe(true);
  });
});

describe("declaredTooLarge", () => {
  it("compares the declared length with the route's cap, and ignores a missing or malformed header", () => {
    expect(declaredTooLarge(new Headers({ "content-length": String(MAX_RECEIPT_BODY_BYTES) }))).toBe(false);
    expect(declaredTooLarge(new Headers({ "content-length": String(MAX_RECEIPT_BODY_BYTES + 1) }))).toBe(true);
    expect(declaredTooLarge(new Headers())).toBe(false);
    expect(declaredTooLarge(new Headers({ "content-length": "lots" }))).toBe(false);
  });
});

describe("readBoundedBody", () => {
  it("reads a body that fits, across several chunks", async () => {
    const read = await readBoundedBody(requestWith(streamOf(Buffer.from("abc"), Buffer.from("defg"))), 100);
    expect(read).toEqual({ ok: true, bytes: Buffer.from("abcdefg") });
  });

  it("accepts a body of exactly the cap and refuses one byte more", async () => {
    expect((await readBoundedBody(requestWith(streamOf(Buffer.alloc(10))), 10)).ok).toBe(true);
    expect(await readBoundedBody(requestWith(streamOf(Buffer.alloc(11))), 10)).toEqual({ ok: false, reason: "too_large" });
  });

  it("stops reading at the cap: a body with no Content-Length cannot make the route hold more than it", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(Buffer.alloc(1_000));
        if (pulled >= 10_000) controller.close();
      },
    });
    const read = await readBoundedBody(requestWith(stream), 5_000);
    expect(read).toEqual({ ok: false, reason: "too_large" });
    expect(pulled).toBeLessThan(50);
  });

  it("calls an empty body and a missing body empty", async () => {
    expect(await readBoundedBody(requestWith(streamOf()), 10)).toEqual({ ok: false, reason: "empty" });
    expect(await readBoundedBody(new Request("http://localhost/upload", { method: "POST" }), 10)).toEqual({ ok: false, reason: "empty" });
  });
});

describe("parseSingleFile", () => {
  it("returns the one file part: its name and its bytes", async () => {
    const fd = new FormData();
    fd.append("file", new File([PNG], "Hardware store.png", { type: "image/png" }));
    const { bytes, contentType } = await multipart(fd);
    const parsed = await parseSingleFile(bytes, contentType);
    expect(parsed).toEqual({ ok: true, name: "Hardware store.png", bytes: PNG });
  });

  it("refuses two files, a stray text field beside the file, and a file under another field name", async () => {
    const two = new FormData();
    two.append("file", new File([PNG], "a.png"));
    two.append("file", new File([PNG], "b.png"));
    const extra = new FormData();
    extra.append("file", new File([PNG], "a.png"));
    extra.append("note", "hello");
    const renamed = new FormData();
    renamed.append("attachment", new File([PNG], "a.png"));
    for (const fd of [two, extra, renamed]) {
      const { bytes, contentType } = await multipart(fd);
      expect(await parseSingleFile(bytes, contentType)).toEqual({ ok: false });
    }
  });

  it("refuses a text field named file, an empty form, a non-multipart body and a body that does not parse", async () => {
    const text = new FormData();
    text.append("file", "not a file");
    const t = await multipart(text);
    expect(await parseSingleFile(t.bytes, t.contentType)).toEqual({ ok: false });

    const empty = await multipart(new FormData());
    expect(await parseSingleFile(empty.bytes, empty.contentType)).toEqual({ ok: false });

    expect(await parseSingleFile(PNG, "image/png")).toEqual({ ok: false });
    expect(await parseSingleFile(PNG, null)).toEqual({ ok: false });
    expect(await parseSingleFile(Buffer.from("garbage"), "multipart/form-data; boundary=zzz")).toEqual({ ok: false });
    expect(await parseSingleFile(Buffer.from("garbage"), "multipart/form-data")).toEqual({ ok: false });
  });
});

describe("sniffReceipt (content, not extension or declared type)", () => {
  it("names the four allowed kinds by their bytes", () => {
    expect(sniffReceipt(PNG)).toBe("image/png");
    expect(sniffReceipt(JPEG)).toBe("image/jpeg");
    expect(sniffReceipt(WEBP)).toBe("image/webp");
    expect(sniffReceipt(PDF)).toBe("application/pdf");
  });

  it("names nothing for an SVG, HTML, a script, a GIF, a zip, plain text or nothing", () => {
    const refused = [
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      "<!doctype html><title>x</title>",
      "#!/bin/sh\necho hi",
      "GIF89a",
      "PK\u0003\u0004",
      "just some text",
      "",
    ];
    for (const text of refused) expect(sniffReceipt(Buffer.from(text, "latin1"))).toBeNull();
  });

  it("is not fooled by a PDF whose first bytes are an image header, or the reverse", () => {
    expect(sniffReceipt(Buffer.concat([PNG, Buffer.from("%PDF-1.7")]))).toBe("image/png");
    expect(sniffReceipt(Buffer.concat([Buffer.from(" "), PDF]))).toBeNull();
  });
});

describe("sha256Hex", () => {
  it("is the lowercase hex SHA-256 of the bytes", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex(Buffer.from("abc"))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("receiptDisplayName", () => {
  it("keeps a name whose extension already matches what is stored", () => {
    expect(receiptDisplayName("Hardware store.jpg", "image/jpeg")).toBe("Hardware store.jpg");
    expect(receiptDisplayName("scan.JPEG", "image/jpeg")).toBe("scan.JPEG");
    expect(receiptDisplayName("Invoice 4471.pdf", "application/pdf")).toBe("Invoice 4471.pdf");
  });

  it("shows an image under the extension of what is STORED (a JPEG)", () => {
    expect(receiptDisplayName("screenshot.png", "image/jpeg")).toBe("screenshot.jpg");
    expect(receiptDisplayName("IMG_2041.webp", "image/jpeg")).toBe("IMG_2041.jpg");
    expect(receiptDisplayName("no extension", "image/jpeg")).toBe("no extension.jpg");
    expect(receiptDisplayName("scan.txt", "application/pdf")).toBe("scan.pdf");
  });

  it("does not mistake a decimal for an extension", () => {
    expect(receiptDisplayName("Invoice 10.25", "image/jpeg")).toBe("Invoice 10.25.jpg");
  });

  it("keeps only the last path segment: no separator survives", () => {
    expect(receiptDisplayName("C:\\Users\\fixture\\receipt.png", "image/jpeg")).toBe("receipt.jpg");
    expect(receiptDisplayName("../../etc/passwd", "image/jpeg")).toBe("passwd.jpg");
    expect(receiptDisplayName("a/b/c.pdf", "application/pdf")).toBe("c.pdf");
    expect(receiptDisplayName("trailing/", "application/pdf")).toBe("receipt.pdf");
  });

  it("removes control, bidi and zero-width characters", () => {
    expect(receiptDisplayName("re\u0000ce\u202Eipt\u200B.png", "image/jpeg")).toBe("receipt.jpg");
  });

  it("falls back to a plain word for an empty or dot-only name", () => {
    expect(receiptDisplayName("", "image/jpeg")).toBe("receipt.jpg");
    expect(receiptDisplayName("   ", "application/pdf")).toBe("receipt.pdf");
    expect(receiptDisplayName(".png", "image/jpeg")).toBe("receipt.jpg");
  });

  it("clamps a long name to the database limit, keeping the extension", () => {
    const long = `${"x".repeat(200)}.pdf`;
    const name = receiptDisplayName(long, "application/pdf");
    expect([...name]).toHaveLength(MAX_LENGTH.displayName);
    expect(name.endsWith(".pdf")).toBe(true);
    const emoji = receiptDisplayName(`${"\u{1F9FE}".repeat(200)}.png`, "image/jpeg");
    expect([...emoji].length).toBeLessThanOrEqual(MAX_LENGTH.displayName);
    expect(emoji.endsWith(".jpg")).toBe(true);
  });
});
