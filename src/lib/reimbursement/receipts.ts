import "server-only";
import { sql } from "drizzle-orm";
import { AUDIT_ACTIONS } from "@/lib/audit-tx";
import { withOrgContext } from "@/lib/authz";
import { getBlobStore } from "@/lib/storage/blob-store";
import { auditReimbursement } from "./audit";
import { isNotPermitted, rowsOf } from "./db-util";
import type { OutcomeOf } from "./outcomes";
import { memberDetailInTx, type RequestActor } from "./requests";

/**
 * Receipts: the ONLY file in `src/lib/reimbursement/` that touches the blob store
 * (docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 "Receipts and the F289
 * audience API"; DECISION-270, DECISION-277). Nothing else in this increment names
 * `getBlobStore()` and nothing imports `blob_assets`; `audience-callsites.test.ts`
 * pins this file's two calls (`store:private`, then `resolve:private`, literal).
 *
 * THE ORDER, AND WHY. A receipt is two writes in two transactions: `store()` (the
 * blob, its own transaction in the blob adapter) and `presby_reimbursement_
 * attach_receipt` (the attachment row). So:
 *   1. `preflightReceipt` BEFORE the bytes are read or stored: may this creator add
 *      a receipt to this request now (editable, under the cap)? A refused upload
 *      never writes a blob.
 *   2. `storeAndAttachReceipt`: `store()`, then attach. If the attach is refused
 *      (the request changed in between, a duplicate, the cap), the blob stays: an
 *      unreferenced private row no route can reach. That is the recorded residual
 *      (the hourly rate limit and the preflight bound it).
 *
 * WHAT ATTACH IS GIVEN. The key, type and size of what `store()` RETURNED (for an
 * image: the re-encoded JPEG's own size, not the upload's), and the SHA-256 of the
 * bytes AS RECEIVED, which is what the duplicate flag compares. The definer checks
 * the type and size against the stored row, so a mismatch is `invalid_shape`.
 * A raw 23503 from attach cannot be a normal outcome (the definer pre-checks the
 * blob and the audience is immutable): it is a bug and propagates as a throw, for
 * the route to answer as a generic failure, never worded for the member.
 *
 * NOTHING THAT IS REFERENCED IS EVER DELETED, detached or not: the foreign key is
 * NO ACTION and receipt rows are never removed, so a detached receipt keeps its
 * blob. Detach only sets `detached_at`.
 *
 * NOT AUDITED: attach, detach and preflight (the events table is the record, Phase 3
 * "Not audited"). A VIEW of a receipt by anyone other than its uploader IS audited
 * (`REIMBURSEMENT_RECEIPT_VIEWED`, ids only), in the same transaction as the lookup
 * and before the bytes are read.
 */

export type ReceiptContentType = "image/jpeg" | "application/pdf";

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

export type PreflightRefusal = Exclude<OutcomeOf<"receiptPreflight">, "ok">;

export type PreflightResult =
  | { kind: "ok"; liveCount: number }
  | { kind: "refused"; outcome: PreflightRefusal }
  | { kind: "denied" };

/** May the creator add a receipt to this request now? Called before the file is read or stored. */
export async function preflightReceipt(actor: RequestActor, requestId: string): Promise<PreflightResult> {
  try {
    return await withOrgContext(actor.personId, actor.organizationId, async (tx): Promise<PreflightResult> => {
      const out = rowsOf(
        await tx.execute(sql`
          select * from presby_reimbursement_receipt_preflight(${requestId}::uuid, ${actor.userId}::uuid)`),
      )[0]!;
      if (out.outcome === "ok") return { kind: "ok", liveCount: Number(out.live_count) };
      return { kind: "refused", outcome: out.outcome as PreflightRefusal };
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Store, then attach
// ---------------------------------------------------------------------------

export type AttachRefusal = Exclude<OutcomeOf<"attachReceipt">, "ok">;

export interface AttachedReceipt {
  attachmentId: string;
  displayName: string;
  byteSize: number;
  contentType: ReceiptContentType;
  /** The request's revision AFTER the attach (it moves by one), so the form's next save carries it. */
  revision: number;
}

export type AttachReceiptResult =
  | { kind: "ok"; receipt: AttachedReceipt }
  | { kind: "refused"; outcome: AttachRefusal }
  | { kind: "denied" };

/**
 * Store the (already sanitized) bytes as a PRIVATE blob of this organization, then
 * attach them to the request. `receivedSha256` is the hash of the bytes the
 * browser sent, before any re-encoding.
 */
export async function storeAndAttachReceipt(
  actor: RequestActor,
  input: {
    requestId: string;
    bytes: Buffer;
    contentType: ReceiptContentType;
    receivedSha256: string;
    displayName: string;
  },
): Promise<AttachReceiptResult> {
  const blob = await getBlobStore().store({
    organizationId: actor.organizationId,
    bytes: input.bytes,
    contentType: input.contentType,
    audience: "private",
  });
  const storedType = blob.contentType as ReceiptContentType;

  try {
    return await withOrgContext(actor.personId, actor.organizationId, async (tx): Promise<AttachReceiptResult> => {
      const out = rowsOf(
        await tx.execute(sql`
          select * from presby_reimbursement_attach_receipt(
            ${input.requestId}::uuid, ${blob.key}::uuid, ${input.receivedSha256}::text, ${storedType}::text,
            ${blob.byteSize}::integer, ${input.displayName}::text, ${actor.userId}::uuid)`),
      )[0]!;
      if (out.outcome !== "ok") return { kind: "refused", outcome: out.outcome as AttachRefusal };
      const detail = await memberDetailInTx(tx, input.requestId, actor.userId);
      return {
        kind: "ok",
        receipt: {
          attachmentId: String(out.attachment_id),
          displayName: input.displayName,
          byteSize: blob.byteSize,
          contentType: storedType,
          revision: detail?.revision ?? 0,
        },
      };
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Detach
// ---------------------------------------------------------------------------

export type DetachRefusal = Exclude<OutcomeOf<"detachReceipt">, "ok">;

export type DetachReceiptResult =
  | { kind: "ok"; revision: number }
  | { kind: "refused"; outcome: DetachRefusal }
  | { kind: "denied" };

/** Take a receipt off a request the creator may still edit (a soft detach: the blob and the row stay). */
export async function detachReceipt(
  actor: RequestActor,
  input: { requestId: string; attachmentId: string },
): Promise<DetachReceiptResult> {
  try {
    return await withOrgContext(actor.personId, actor.organizationId, async (tx): Promise<DetachReceiptResult> => {
      const out = rowsOf(
        await tx.execute(sql`
          select * from presby_reimbursement_detach_receipt(
            ${input.requestId}::uuid, ${input.attachmentId}::uuid, ${actor.userId}::uuid)`),
      )[0]!;
      if (out.outcome !== "ok") return { kind: "refused", outcome: out.outcome as DetachRefusal };
      const detail = await memberDetailInTx(tx, input.requestId, actor.userId);
      return { kind: "ok", revision: detail?.revision ?? 0 };
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Look up and read
// ---------------------------------------------------------------------------

export type LookupReceiptResult =
  | { kind: "ok"; blobKey: string; contentType: ReceiptContentType; displayName: string }
  /** Missing, detached, foreign and forbidden are the same answer. */
  | { kind: "not_found" };

/**
 * Which blob is behind this live receipt, for a viewer of its request. The
 * database decides who may see it (the request-viewer rule); a view by anyone
 * other than the uploader writes `REIMBURSEMENT_RECEIPT_VIEWED` in the same
 * transaction, before any byte is read. Metadata is ids only.
 */
export async function lookupReceipt(
  actor: RequestActor,
  input: { requestId: string; attachmentId: string },
): Promise<LookupReceiptResult> {
  try {
    return await withOrgContext(actor.personId, actor.organizationId, async (tx): Promise<LookupReceiptResult> => {
      const row = rowsOf(
        await tx.execute(sql`
          select * from presby_reimbursement_attachment_lookup(
            ${input.requestId}::uuid, ${input.attachmentId}::uuid, ${actor.userId}::uuid)`),
      )[0];
      if (!row) return { kind: "not_found" };
      if (row.viewer_is_creator !== true) {
        await auditReimbursement(tx, {
          action: AUDIT_ACTIONS.REIMBURSEMENT_RECEIPT_VIEWED,
          actor,
          organizationId: actor.organizationId,
          resourceType: "reimbursement_request",
          resourceId: input.requestId,
          metadata: { requestId: input.requestId, attachmentId: input.attachmentId },
        });
      }
      return {
        kind: "ok",
        blobKey: String(row.blob_key),
        contentType: row.content_type as ReceiptContentType,
        displayName: String(row.display_name),
      };
    });
  } catch (err) {
    // An identity refusal (no live person here) reads as the same miss as a forbidden request.
    if (isNotPermitted(err)) return { kind: "not_found" };
    throw err;
  }
}

/** The bytes of a looked-up receipt, from this organization's PRIVATE blobs only (null: the blob is gone). */
export async function readReceiptBytes(
  organizationId: string,
  blobKey: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  return getBlobStore().resolve({ organizationId, key: blobKey, audience: "private" });
}
