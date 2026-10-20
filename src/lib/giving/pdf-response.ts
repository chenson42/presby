/**
 * The response shapes the statement routes share - docs/work-log/
 * 2026-10-15-online-giving.md, Batch 5b/6. PURE (no database, no session), so the
 * treasurer's routes (`admin/giving/statements/route-gate.ts` re-exports these)
 * and the member's download route build their answers from ONE definition. That
 * is what makes "the identical 404" a property of the code, not of two files
 * that happen to agree.
 *
 * Every non-success answer is a plain-text body with `no-store`; the 404 is ONE
 * shape (`notFound()`), reused for "no such organization" and for "no such
 * statement" - so nothing in a response says which of the two it was.
 */

export function plain(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function notFound(): Response {
  return plain(404, "Not found");
}

/** Headers every PDF answer carries: a private, uncacheable attachment the browser may not sniff. */
export function pdfHeaders(filename: string, byteLength: number): HeadersInit {
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": String(byteLength),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
