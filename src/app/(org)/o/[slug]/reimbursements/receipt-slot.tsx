"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { COPY } from "@/lib/reimbursement/copy";
import { MAX_RECEIPTS, MAX_RECEIPT_BODY_BYTES, MAX_RECEIPT_BYTES } from "@/lib/reimbursement/limits";
import { detachReceiptAction } from "./actions";
import { downsizeForUpload } from "./receipt-downsize";

/**
 * THE RECEIPT SLOT - the picker, the upload and the list on the request form
 * (Treasury Increment 1, Batch 2b; docs/work-log/2026-10-25-treasury-inc1.md,
 * Phase 3 "Receipts and the F289 audience API", Copy C3 and C4).
 *
 * The form (`request-form.tsx`) renders this inside its Receipts section; the
 * `I can't attach a receipt` box and the C3 hint are the form's own. The contract
 * it honours:
 *  - `ensureDraft()` saves the form's entries and resolves the request's `{
 *    requestId, revision }`, or `null` when the save failed or the form is busy
 *    (the form has already shown why). A receipt belongs to a request, so it is
 *    called before the first upload on a brand-new form. Idempotent.
 *  - Every attach and every detach moves the request's `revision` by exactly one
 *    (P3-8). `onChange` reports the whole current list AND the revision the
 *    database now holds (the upload route and `detachReceiptAction` both return
 *    it), so the form's next save is not stale.
 *  - `onBusyChange(true)` for the whole of an upload or a removal, so the form can
 *    refuse Save and Send meanwhile (a save carrying the old revision while an
 *    attach lands would answer `changed_since_viewed`).
 *  - `error` is the form's message for the receipts field; it renders next to the
 *    `I can't attach a receipt` box, not here.
 *  - NO `capture` attribute on the file input (tripwire T3): the phone offers its
 *    own choice of camera, photo library or files.
 *
 * WORDING. The upload route answers a `kind`, never a sentence; the sentence is
 * Copy C4 with the name the person's own device gave the file. A failure that is
 * not the person's doing (the server, the network) is the form's own `saveFailed`
 * sentence. Nothing here says a file is safe or scanned.
 */

export const RECEIPTS_AVAILABLE = true;

export interface ReceiptItem {
  id: string;
  displayName: string;
  contentType: "image/jpeg" | "application/pdf";
  byteSize: number;
}

export interface ReceiptSlotProps {
  slug: string;
  /** The request's id once it exists; null on a brand-new form. */
  requestId: string | null;
  receipts: ReceiptItem[];
  disabled: boolean;
  error?: string;
  /** Saves the form's entries if needed and returns the request's id and revision, or null on failure. */
  ensureDraft: () => Promise<{ requestId: string; revision: number } | null>;
  /** Report the whole current list and the revision the database now holds. */
  onChange: (next: { receipts: ReceiptItem[]; revision: number }) => void;
  /** True for the whole of an upload or a removal. */
  onBusyChange?: (busy: boolean) => void;
}

export const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp,application/pdf";

interface UploadFailure {
  kind?: string;
  error?: string;
  redirectTo?: string;
}

/** A route `kind` becomes a Copy C4 sentence naming the file. Pure; exported for the tests. */
export function uploadFailureMessage(failure: UploadFailure | null, fileName: string): string {
  switch (failure?.kind) {
    case "too_large":
      return COPY.receipts.tooLarge(fileName);
    case "not_allowed":
      return COPY.receipts.notAllowed(fileName);
    case "unreadable":
      return COPY.receipts.unreadable(fileName);
    case "too_many":
      return COPY.receipts.tooMany;
    case "duplicate":
      return COPY.receipts.duplicate;
    case "not_editable":
      return COPY.receipts.notEditable;
    case "rate_limited":
      return COPY.receipts.rateLimited;
    case "two_factor_required":
      return COPY.receipts.twoFactorRequired;
    case "refused":
      return typeof failure.error === "string" && failure.error !== "" ? failure.error : COPY.form.saveFailed;
    default:
      return COPY.form.saveFailed;
  }
}

function isAttached(value: unknown): value is { attachmentId: string; displayName: string; byteSize: number; contentType: ReceiptItem["contentType"]; revision: number } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.attachmentId === "string" &&
    typeof v.displayName === "string" &&
    typeof v.byteSize === "number" &&
    (v.contentType === "image/jpeg" || v.contentType === "application/pdf") &&
    typeof v.revision === "number"
  );
}

export function ReceiptSlot({ slug, requestId, receipts, disabled, ensureDraft, onChange, onBusyChange }: ReceiptSlotProps) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const latest = useRef(receipts);
  useEffect(() => {
    latest.current = receipts;
  }, [receipts]);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const atCap = receipts.length >= MAX_RECEIPTS;

  /** One thing at a time: a second pick or tap while one is under way does nothing. */
  async function exclusive(kind: "upload" | "remove", work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(kind);
    onBusyChange?.(true);
    setMessage(null);
    try {
      await work();
    } finally {
      inFlight.current = false;
      setBusy(null);
      onBusyChange?.(false);
    }
  }

  function upload(original: File) {
    return exclusive("upload", async () => {
      const name = original.name;
      if (original.type === "application/pdf" && original.size > MAX_RECEIPT_BYTES) {
        setMessage(COPY.receipts.tooLarge(name));
        return;
      }
      const draft = await ensureDraft();
      if (!draft) return;

      const file = await downsizeForUpload(original, MAX_RECEIPT_BYTES);
      if (file.size > MAX_RECEIPT_BODY_BYTES - 10_000) {
        setMessage(COPY.receipts.tooLarge(name));
        return;
      }

      const body = new FormData();
      body.append("file", file, file.name);
      let response: Response;
      try {
        response = await fetch(`/o/${slug}/reimbursements/${draft.requestId}/receipts`, {
          method: "POST",
          body,
          credentials: "same-origin",
          // The proxy answers a signed-out or not-yet-verified session with a redirect (to /signin or
          // /totp) before this route runs. Following it would re-POST the file to a sign-in page.
          redirect: "manual",
        });
      } catch {
        setMessage(COPY.form.saveFailed);
        return;
      }
      if (response.type === "opaqueredirect") {
        // The draft is saved; the request's own page does the redirect properly, with the way back.
        router.push(`/o/${slug}/reimbursements/${draft.requestId}/edit`);
        return;
      }
      const json: unknown = await response.json().catch(() => null);

      if (response.ok && isAttached(json)) {
        onChange({
          receipts: [
            ...latest.current,
            { id: json.attachmentId, displayName: json.displayName, contentType: json.contentType, byteSize: json.byteSize },
          ],
          revision: json.revision,
        });
        return;
      }
      const failure = (typeof json === "object" && json !== null ? json : null) as UploadFailure | null;
      setMessage(uploadFailureMessage(failure, name));
      if (failure?.kind === "two_factor_required" && failure.redirectTo) router.push(failure.redirectTo);
    });
  }

  function remove(item: ReceiptItem) {
    return exclusive("remove", async () => {
      if (!requestId) return;
      let result: Awaited<ReturnType<typeof detachReceiptAction>>;
      try {
        result = await detachReceiptAction(slug, { requestId, attachmentId: item.id });
      } catch {
        setMessage(COPY.form.saveFailed);
        return;
      }
      if (!result.ok) {
        if (result.kind === "two_factor_required" && result.redirectTo) router.push(result.redirectTo);
        setMessage(result.error);
        return;
      }
      onChange({ receipts: latest.current.filter((r) => r.id !== item.id), revision: result.data.revision });
    });
  }

  const locked = disabled || busy !== null;

  return (
    <div className="mt-1 space-y-2" data-testid="receipt-slot">
      {receipts.length > 0 && (
        <ul className="space-y-1" data-testid="receipt-list">
          {receipts.map((item) => (
            <li key={item.id} className="flex items-center gap-2" data-testid="receipt-row">
              <a
                href={requestId ? `/o/${slug}/reimbursements/${requestId}/receipts/${item.id}` : undefined}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-11 min-w-0 flex-1 items-center text-base underline underline-offset-2 [overflow-wrap:anywhere]"
              >
                {item.displayName}
              </a>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 shrink-0"
                disabled={locked}
                aria-label={COPY.receipts.removeAccessibleName(item.displayName)}
                onClick={() => remove(item)}
                data-testid="receipt-remove"
              >
                {COPY.receipts.remove}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {atCap ? (
        <p className="text-base" data-testid="receipt-cap">
          {COPY.receipts.tooMany}
        </p>
      ) : (
        <>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={locked}
            aria-busy={busy === "upload" ? true : undefined}
            onClick={() => input.current?.click()}
            data-testid="receipt-add"
          >
            {busy === "upload" ? COPY.form.saving : COPY.form.addReceipt}
          </Button>
          <input
            ref={input}
            type="file"
            accept={ACCEPTED_TYPES}
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="receipt-input"
            onChange={(event) => {
              const picked = event.currentTarget.files?.[0];
              // Clear first: picking the same file again must fire `change` again.
              event.currentTarget.value = "";
              if (picked) void upload(picked);
            }}
          />
        </>
      )}

      {message && (
        <p role="alert" className="text-base text-destructive" data-testid="receipt-error">
          {message}
        </p>
      )}
    </div>
  );
}
