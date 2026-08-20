/**
 * Magic-byte content sniffing for ticket attachments (support tickets,
 * 2026-08-20 commit 2/3, DECISION-071/073). Never trust the browser's
 * reported MIME type — sniff the bytes.
 *
 * PNG/JPEG/WEBP signatures mirror
 * `src/app/(admin)/admin/organizations/[id]/actions.ts`'s
 * `sniffImageContentType()` exactly (same three formats, same byte
 * sequences) plus a `%PDF-` magic-byte check for the ticket-attachment path's
 * new PDF support. Not imported from that file and duplicated here instead:
 * that function lives inside an `(admin)` `actions.ts` (app-tree code), and
 * `src/lib/` modules do not import from `src/app/` — the dependency only
 * ever runs the other direction in this codebase. SVG stays rejected by
 * construction (G7: no magic-byte signature recognized here falls through to
 * `null`), same reasoning as the logo path.
 *
 * PDF is always sniffed and accepted here, but never rendered inline
 * regardless of who uploaded it — DECISION-073, enforced by the attachment
 * route handlers' `Content-Disposition`, not by this function.
 */

export type TicketAttachmentContentType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "application/pdf";

export function sniffTicketAttachmentContentType(
  bytes: Buffer,
): TicketAttachmentContentType | null {
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
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 5 && bytes.toString("ascii", 0, 5) === "%PDF-") {
    return "application/pdf";
  }
  return null;
}
