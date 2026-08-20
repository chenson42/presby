import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { resolveOrgContext, withOrgContext } from "@/lib/authz";
import { ticketMessages } from "@/lib/db/domain/support";
import { hasTicketsFile } from "@/lib/tickets";
import { getBlobStore } from "@/lib/storage/blob-store";

/**
 * `GET /o/<slug>/tickets/[id]/attachments/[key]` — tenant-scoped attachment
 * bytes. See docs/work-log/2026-08-20-support-tickets.md Phase 3, "Route
 * handlers — attachment bytes".
 *
 * Defense in depth: `key` must actually be referenced by a `ticket_messages`
 * row on THIS `ticketId` (a join, not a bare `blobStore.resolve()`) before
 * bytes are ever served — guards against a role-holder fetching an unrelated
 * blob at their own org by guessing a UUID under a ticket URL that has
 * nothing to do with it.
 *
 * PDF is never rendered inline, regardless of who uploaded it (DECISION-073) —
 * `Content-Disposition: attachment` for `application/pdf`, `inline` for
 * everything else this path can ever store (image/*).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; id: string; key: string }> },
): Promise<NextResponse> {
  const { slug, id, key } = await params;

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return withOrgContext(resolved.org.personId, resolved.org.organizationId, async (tx) => {
    if (!(await hasTicketsFile(tx, resolved.org.personId, resolved.org.organizationId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [message] = await tx
      .select({ id: ticketMessages.id })
      .from(ticketMessages)
      .where(
        and(
          eq(ticketMessages.ticketId, id),
          eq(ticketMessages.organizationId, resolved.org.organizationId),
          eq(ticketMessages.attachmentAssetKey, key),
        ),
      )
      .limit(1);
    if (!message) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const blob = await getBlobStore().resolve({
      organizationId: resolved.org.organizationId,
      key,
    });
    if (!blob) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const disposition =
      blob.contentType === "application/pdf"
        ? 'attachment; filename="attachment.pdf"'
        : "inline";

    return new NextResponse(new Uint8Array(blob.bytes), {
      headers: {
        "Content-Type": blob.contentType,
        "Content-Disposition": disposition,
        "Cache-Control": "private, max-age=3600",
      },
    });
  });
}
