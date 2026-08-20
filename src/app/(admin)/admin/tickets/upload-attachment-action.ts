"use server";
import "server-only";

import { auth } from "@/auth";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { getBlobStore, BlobValidationError } from "@/lib/storage/blob-store";
import { sniffTicketAttachmentContentType } from "@/lib/storage/sniff";
import type { ActionResult } from "@/types/actions";

/**
 * A small, NEW upload helper for the operator-reply attachment path. Phase 3
 * deliberately left this as "a separate store-then-reply flow... is
 * ux-developer's call to design" — `replyToTicketAsOperatorAction`
 * (commit 2, `./actions.ts`) takes an already-`store()`'d `attachmentKey`,
 * not a `File`/`FormData`, on purpose (`AdminReplyForm` calls this action
 * FIRST, then passes the resulting key into `replyToTicketAsOperatorAction`
 * — two calls, not one, same E-c1/E-c2 store-before-mutate ordering the
 * tenant-side `storeAttachmentIfPresent()` in `(org)/tickets/actions.ts`
 * uses; duplicated here rather than imported because that helper isn't
 * exported and this file sits in a different `"use server"` module).
 *
 * Gated on the SAME `FEATURES.ADMIN_TICKETS` session check every other
 * `(admin)/tickets` action uses — this file does not touch
 * `replyToTicketAsOperatorAction` or any other commit-2 business logic; it
 * only produces the `attachmentKey` that action already knew how to accept.
 */
export async function uploadTicketAttachmentAction(
  organizationId: string,
  formData: FormData,
): Promise<ActionResult<{ key: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Not signed in." };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_TICKETS)) {
    return { ok: false, error: "Forbidden." };
  }

  const file = formData.get("attachment");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file selected." };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffTicketAttachmentContentType(bytes);
  if (!sniffed) {
    return {
      ok: false,
      error: "That file isn't a PNG, JPEG, WEBP, or PDF we can accept.",
    };
  }

  try {
    const ref = await getBlobStore().store({
      organizationId,
      bytes,
      contentType: sniffed,
    });
    return { ok: true, data: { key: ref.key } };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof BlobValidationError
          ? err.message
          : "We couldn't store that attachment right now — try again in a moment.",
    };
  }
}
