import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getPlatformDb } from "@/lib/db";
import { ticketMessages } from "@/lib/db/domain/support";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { getBlobStore } from "@/lib/storage/blob-store";

/**
 * `GET /admin/tickets/[id]/attachments/[key]` — platform-scoped attachment
 * bytes, the `(admin)` counterpart of the tenant route handler at
 * `(org)/o/[slug]/tickets/[id]/attachments/[key]/route.ts`. Same defense in
 * depth: `key` must be referenced by a `ticket_messages` row on THIS
 * `ticketId` before bytes are ever served.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; key: string }> },
): Promise<NextResponse> {
  const { id, key } = await params;

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasFeature(session.user.features, FEATURES.ADMIN_TICKETS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const platformDb = getPlatformDb();
  const [message] = await platformDb
    .select({ id: ticketMessages.id, organizationId: ticketMessages.organizationId })
    .from(ticketMessages)
    .where(and(eq(ticketMessages.ticketId, id), eq(ticketMessages.attachmentAssetKey, key)))
    .limit(1);
  if (!message) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const blob = await getBlobStore().resolve({
    organizationId: message.organizationId,
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
}
