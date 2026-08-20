"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import {
  fileTicket,
  replyToTicket,
  promoteFeedbackToTicket,
  dismissFeedback,
  type ChangeClass,
  type TicketArea,
  type TicketPriority,
} from "@/lib/tickets";
import {
  notifyOperatorsOfNewTicket,
  notifyOperatorsOfSubmitterReply,
  notifySubmitterOfPromotion,
  resolveOperatorByUserId,
} from "@/lib/tickets-notifications";
import { getBlobStore, BlobValidationError } from "@/lib/storage/blob-store";
import { sniffTicketAttachmentContentType } from "@/lib/storage/sniff";
import { enqueueEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email/escape-html";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/tickets*` — support tickets, Phase 4 commit
 * 2/3 (`docs/work-log/2026-08-20-support-tickets.md` Phase 3, DECISION-069
 * through 077).
 *
 * Same shape as `admin/roles/actions.ts`: `auth()` directly (not
 * `cachedAuth()` — server actions are a separate invocation per call, so
 * `cache()` is a no-op there), a FRESH `resolveOrgContext(session.user.id,
 * slug)` on every call so `organizationId` is always the server's own
 * answer to "what org is this signed-in user allowed to act at, given this
 * slug", never a value a client could forge. All SQL correctness (the
 * permission gate, the enumeration discipline, the promotion's deliberate
 * skip of a current-membership re-check) lives in and is proven by
 * `src/lib/tickets.ts` / `tickets.test.ts` — this file's only job is the
 * auth-in-the-action-body plumbing, the attachment store()-before-mutation
 * ordering, the notification calls, and the audit write.
 */

async function resolveActingIdentity(slug: string): Promise<
  | {
      ok: true;
      userId: string;
      userEmail: string | null;
      userName: string | null;
      personId: string;
      organizationId: string;
      organizationName: string;
    }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  return {
    ok: true,
    userId: session.user.id,
    userEmail: session.user.email ?? null,
    userName: session.user.name ?? null,
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
    organizationName: resolved.org.name,
  };
}

/**
 * E-c1/E-c2 ordering (the org-brand logo path's own convention): sniff magic
 * bytes, validate size via `store()`'s own CHECK-mirroring guard, and store
 * BEFORE the caller ever touches `fileTicket()`/`replyToTicket()`. A failure
 * here never leaves a dangling reference; a success followed by a later
 * `invalid_input` from the query layer leaves a harmless orphaned blob row
 * (accepted — see the work-log's Edge Cases, same as the logo path).
 */
async function storeAttachmentIfPresent(
  formData: FormData,
  organizationId: string,
): Promise<{ ok: true; key: string | undefined } | { ok: false; error: string }> {
  const file = formData.get("attachment");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: true, key: undefined };
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
    const ref = await getBlobStore().store({ organizationId, bytes, contentType: sniffed });
    return { ok: true, key: ref.key };
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

// ---------------------------------------------------------------------------
// fileTicketAction
// ---------------------------------------------------------------------------

export async function fileTicketAction(
  slug: string,
  formData: FormData,
): Promise<ActionResult<{ ticketId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const subject = String(formData.get("subject") ?? "");
  const changeClass = String(formData.get("changeClass") ?? "") as ChangeClass;
  const area = String(formData.get("area") ?? "") as TicketArea;
  const priority = String(formData.get("priority") ?? "normal") as TicketPriority;
  const body = String(formData.get("body") ?? "");

  const attachment = await storeAttachmentIfPresent(formData, identity.organizationId);
  if (!attachment.ok) return { ok: false, error: attachment.error };

  const result = await fileTicket(identity.personId, identity.organizationId, {
    subject,
    changeClass,
    area,
    priority,
    body,
    attachmentKey: attachment.key,
  });

  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to file tickets here." };
    case "invalid_input":
      return { ok: false, error: result.errors.join(" ") };
    case "invalid_attachment":
      return {
        ok: false,
        error: "That attachment couldn't be attached — try uploading it again.",
      };
    case "ok":
      break;
  }

  if (identity.userEmail) {
    await enqueueEmail({
      to: identity.userEmail,
      subject: escapeHtml(`Ticket filed: ${subject.trim()}`),
      html: [
        `<p>Your ticket "${escapeHtml(subject.trim())}" has been filed for ${escapeHtml(identity.organizationName)}. We'll follow up soon.</p>`,
      ].join("\n"),
      templateKey: "ticket_filed_confirmation",
    });
  }

  await notifyOperatorsOfNewTicket({
    ticketId: result.ticketId,
    slug,
    organizationName: identity.organizationName,
    subject: subject.trim(),
    changeClass,
    area,
    priority,
    submitterName: identity.userName ?? "A member",
  });

  await recordAudit({
    action: AUDIT_ACTIONS.TICKET_CREATED,
    resourceType: "ticket",
    resourceId: result.ticketId,
    metadata: {
      organizationId: identity.organizationId,
      changeClass,
      area,
      priority,
      subject: subject.trim(),
    },
  });

  revalidatePath(`/o/${slug}/tickets`);

  return { ok: true, data: { ticketId: result.ticketId } };
}

// ---------------------------------------------------------------------------
// replyToTicketAction
// ---------------------------------------------------------------------------

export async function replyToTicketAction(
  slug: string,
  ticketId: string,
  formData: FormData,
): Promise<ActionResult<{ messageId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const body = String(formData.get("body") ?? "");

  const attachment = await storeAttachmentIfPresent(formData, identity.organizationId);
  if (!attachment.ok) return { ok: false, error: attachment.error };

  const result = await replyToTicket(identity.personId, identity.organizationId, ticketId, {
    body,
    attachmentKey: attachment.key,
  });

  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to reply to tickets here." };
    case "not_found":
      return { ok: false, error: "That ticket no longer exists." };
    case "invalid_input":
      return { ok: false, error: result.error };
    case "invalid_attachment":
      return {
        ok: false,
        error: "That attachment couldn't be attached — try uploading it again.",
      };
    case "ok":
      break;
  }

  // If present, the assignee gets the reply notification; otherwise it
  // falls back to the whole operator pool (notify module's own reasoning).
  const assignee = result.assigneeUserId
    ? await resolveOperatorByUserId(result.assigneeUserId)
    : null;
  await notifyOperatorsOfSubmitterReply({
    ticketId,
    subject: result.ticketSubject,
    submitterName: identity.userName ?? "A member",
    excerpt: body.trim().slice(0, 200),
    assignee,
  });

  // No audit — a reply is conversation, not a security-sensitive mutation.
  revalidatePath(`/o/${slug}/tickets/${ticketId}`);

  return { ok: true, data: { messageId: result.messageId } };
}

// ---------------------------------------------------------------------------
// promoteFeedbackAction
// ---------------------------------------------------------------------------

export async function promoteFeedbackAction(
  slug: string,
  feedbackId: string,
  input: { subject: string; changeClass: ChangeClass; area: TicketArea; priority: TicketPriority },
): Promise<ActionResult<{ ticketId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await promoteFeedbackToTicket(
    identity.personId,
    identity.organizationId,
    feedbackId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to promote feedback here." };
    case "not_found":
      return { ok: false, error: "That feedback no longer exists." };
    case "already_handled":
      return { ok: false, error: "That feedback has already been handled." };
    case "invalid_input":
      return { ok: false, error: result.errors.join(" ") };
    case "ok":
      break;
  }

  // The ORIGINAL feedback submitter, not the promoting role-holder — see
  // promoteFeedbackToTicket()'s own doc comment.
  if (result.submitterEmail) {
    await notifySubmitterOfPromotion({
      ticketId: result.ticketId,
      slug,
      submitterEmail: result.submitterEmail,
      submitterName: result.submitterName,
      subject: input.subject.trim(),
    });
  } else {
    console.warn(
      "[tickets] promoted feedback has no linked user email — skipping submitter notification.",
    );
  }

  // A promoted ticket needs the operator pool's attention exactly as much
  // as a directly-filed one — see notify module's own header note.
  await notifyOperatorsOfNewTicket({
    ticketId: result.ticketId,
    slug,
    organizationName: identity.organizationName,
    subject: input.subject.trim(),
    changeClass: input.changeClass,
    area: input.area,
    priority: input.priority,
    submitterName: result.submitterName,
  });

  await recordAudit({
    action: AUDIT_ACTIONS.TICKET_FEEDBACK_PROMOTED,
    resourceType: "ticket",
    resourceId: result.ticketId,
    metadata: {
      organizationId: identity.organizationId,
      feedbackId,
      changeClass: input.changeClass,
      area: input.area,
      priority: input.priority,
      subject: input.subject.trim(),
    },
  });

  revalidatePath(`/o/${slug}/tickets`);

  return { ok: true, data: { ticketId: result.ticketId } };
}

// ---------------------------------------------------------------------------
// dismissFeedbackAction
// ---------------------------------------------------------------------------

export async function dismissFeedbackAction(
  slug: string,
  feedbackId: string,
): Promise<ActionResult> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await dismissFeedback(identity.personId, identity.organizationId, feedbackId);

  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to dismiss feedback here." };
    case "not_found":
      return { ok: false, error: "That feedback no longer exists." };
    case "already_handled":
      return { ok: false, error: "That feedback has already been handled." };
    case "ok":
      break;
  }

  // audit-exempt: routine triage disposition; matches feedback/actions.ts's
  // identical precedent (updateFeedbackStatus).
  revalidatePath(`/o/${slug}/tickets`);

  return { ok: true };
}
