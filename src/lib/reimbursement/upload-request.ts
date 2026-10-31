import { createHash } from "node:crypto";
import { sniffTicketAttachmentContentType, type TicketAttachmentContentType } from "@/lib/storage/sniff";
import { MAX_LENGTH, MAX_RECEIPT_BODY_BYTES } from "./limits";
import { cleanText, textLength } from "./text";

/**
 * The pieces of the receipt upload route that are pure functions of the request
 * (docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 API Contract Layer 4):
 * the Origin rule, the Content-Length precheck, the bounded body read, the
 * one-file multipart parse, the magic-byte sniff and the display name. No
 * database, no blob store, no session: `receipts.route.test.ts` drives the route
 * around them; `upload-request.test.ts` drives these.
 *
 * NOTHING HERE TRUSTS THE CLIENT'S WORDS ABOUT THE FILE. The type is sniffed from
 * the bytes (never the extension or the declared `Content-Type`), the size is
 * counted as bytes arrive (never the `Content-Length` header alone: a chunked
 * body has none), and the name is cleaned and clamped to what the database
 * accepts.
 */

export type ReceiptUploadType = Extract<TicketAttachmentContentType, "image/png" | "image/jpeg" | "image/webp" | "application/pdf">;

/** What the sniffer may call a receipt: png, jpeg, webp, pdf. The sniffer has no other answers. */
export function sniffReceipt(bytes: Buffer): ReceiptUploadType | null {
  return sniffTicketAttachmentContentType(bytes);
}

/**
 * The Origin rule: a POST that changes state is answered only when the browser
 * names the platform's own origin. A missing Origin and a foreign one are both
 * refused (a same-origin `fetch` POST always carries it), and when the platform
 * origin cannot be determined (a misconfigured production) nothing matches.
 */
export function originRefused(headers: Headers, platformOrigin: string | null): boolean {
  if (platformOrigin === null) return true;
  return headers.get("origin") !== platformOrigin;
}

/** True when the request DECLARES a body larger than the route accepts (a chunked body declares none; the read bounds it). */
export function declaredTooLarge(headers: Headers, max: number = MAX_RECEIPT_BODY_BYTES): boolean {
  const raw = headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw.trim())) return false;
  return Number(raw.trim()) > max;
}

export type BoundedRead = { ok: true; bytes: Buffer } | { ok: false; reason: "too_large" | "empty" };

/**
 * Read the body, counting bytes as they arrive, and stop at `max`: the rest is
 * cancelled unread, so a lying or absent `Content-Length` cannot make this route
 * hold more than `max` bytes.
 */
export async function readBoundedBody(request: Request, max: number = MAX_RECEIPT_BODY_BYTES): Promise<BoundedRead> {
  const stream = request.body;
  if (!stream) return { ok: false, reason: "empty" };
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "too_large" };
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  if (total === 0) return { ok: false, reason: "empty" };
  return { ok: true, bytes: Buffer.concat(chunks, total) };
}

export type SingleFile = { ok: true; name: string; bytes: Buffer } | { ok: false };

/**
 * The body must be multipart with EXACTLY ONE part, named `file`, and that part
 * must be a file. A second part (a stray field, a second file), a text field
 * named `file`, a missing boundary or a body that does not parse at all are all
 * the same refusal, so the route has one thing to say about a malformed upload.
 */
export async function parseSingleFile(bytes: Buffer, contentType: string | null): Promise<SingleFile> {
  if (!contentType || !/^multipart\/form-data\s*;/i.test(contentType)) return { ok: false };
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(bytes), { headers: { "content-type": contentType } }).formData();
  } catch {
    return { ok: false };
  }
  const entries = [...form.entries()];
  if (entries.length !== 1) return { ok: false };
  const [field, value] = entries[0]!;
  if (field !== "file" || typeof value === "string") return { ok: false };
  return { ok: true, name: value.name, bytes: Buffer.from(await value.arrayBuffer()) };
}

/** Lowercase hex SHA-256: of the bytes AS RECEIVED, which is what the duplicate flag compares. */
export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A file extension: a dot and a short run starting with a letter (so "Invoice 10.25" keeps its ".25"). */
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,4}$/;

/**
 * The name the receipt is shown under: the last path segment of what the
 * device called the file, cleaned (`cleanText`: control, bidi and zero-width
 * characters out), with an extension that matches what is STORED (an image is
 * stored as a JPEG, so `scan.png` is shown as `scan.jpg`), clamped to the
 * database's own limit with the extension kept. Never empty, never contains a
 * path separator (the definer refuses both).
 */
export function receiptDisplayName(raw: string, stored: "image/jpeg" | "application/pdf"): string {
  const ext = stored === "image/jpeg" ? ".jpg" : ".pdf";
  const segment = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = cleanText(segment) ?? "";
  const keepsExtension = stored === "image/jpeg" ? /\.jpe?g$/i.test(cleaned) : /\.pdf$/i.test(cleaned);
  let base = cleaned.replace(EXTENSION, "");
  if (base === "" || base === ".") base = "receipt";
  const suffix = keepsExtension ? (cleaned.match(EXTENSION)?.[0] ?? ext) : ext;
  const room = MAX_LENGTH.displayName - suffix.length;
  const points = [...base];
  if (points.length > room) base = points.slice(0, room).join("").trimEnd();
  const name = `${base === "" ? "receipt" : base}${suffix}`;
  return textLength(name) <= MAX_LENGTH.displayName ? name : `receipt${ext}`;
}
