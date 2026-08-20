/**
 * Renders a message's attachment. Images inline (`<img>` against the
 * tenant-scoped route handler URL); `application/pdf` is ALWAYS a plain
 * download link, never an `<iframe>`/`<embed>` viewer — DECISION-073, same
 * reasoning G7 gives for excluding SVG (a format able to carry executable
 * content stays opaque, regardless of who uploaded it).
 */
export function AttachmentDisplay({
  slug,
  ticketId,
  attachment,
}: {
  slug: string;
  ticketId: string;
  attachment: { key: string; contentType: string };
}) {
  const href = `/o/${slug}/tickets/${ticketId}/attachments/${attachment.key}`;

  if (attachment.contentType === "application/pdf") {
    return (
      <a
        href={href}
        className="mt-2 inline-flex items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Download attachment (PDF)
      </a>
    );
  }

  // Bytes come from an authenticated route handler (session-gated), not a
  // static asset next/image can optimize. Mirrors
  // components/brand/org-mark.tsx's identical exemption.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={href}
      alt="Attached image"
      className="mt-2 h-auto max-w-full rounded-md border border-border"
    />
  );
}
