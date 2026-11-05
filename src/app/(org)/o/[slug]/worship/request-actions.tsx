"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, SELECT_CLASSES, SelectBox } from "@/components/worship/form-bits";
import { ACTION_COPY, MEMBER_COPY, NAV_COPY } from "@/lib/worship/copy";
import { REASONS, type Reason } from "@/lib/worship/vocab";
import { respondToRequestAction } from "./actions";

/**
 * Accept or Decline MY request - Copy G6. A waiting request shows Accept and
 * Decline; a confirmed one shows only Decline; a declined one shows "I can serve
 * after all". Decline opens a reason choice (a closed list, never free text) with
 * its own confirming button, so a stray tap on "Decline" changes nothing.
 *
 * The action derives the person from the session; this component sends only the
 * assignment id, the answer and the reason. It is idempotent on the client too: a
 * second tap while a request is in flight is ignored (the store treats the same
 * answer as a no-op anyway). The result is toasted from here; the page re-reads
 * with `router.refresh()`.
 */
export function RequestActions({
  slug,
  assignmentId,
  status,
  positionName,
  whenLabel,
  idPrefix,
}: {
  slug: string;
  assignmentId: string;
  status: "requested" | "confirmed" | "declined";
  positionName: string;
  whenLabel: string;
  /** Distinguishes the reason select's id when several cards render on one page. */
  idPrefix: string;
}) {
  const router = useRouter();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<Reason | "">("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function answer(answerValue: "accepted" | "declined") {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const result = await respondToRequestAction(slug, {
        assignmentId,
        answer: answerValue,
        reason: answerValue === "declined" && reason ? reason : null,
      });
      if (result.ok) {
        toast.success(
          answerValue === "accepted"
            ? MEMBER_COPY.request.toastConfirmed(positionName, whenLabel)
            : MEMBER_COPY.request.toastDeclined,
        );
        setDeclining(false);
        setReason("");
        router.refresh();
      } else {
        toast.error(result.error);
        router.refresh();
      }
    } catch {
      toast.error(ACTION_COPY.generic);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const reasonId = `${idPrefix}-reason`;

  if (declining) {
    return (
      <div className="space-y-3" data-testid="decline-panel">
        <Field id={reasonId} label={MEMBER_COPY.request.reasonLabel} hint={MEMBER_COPY.request.reasonHelper}>
          <SelectBox>
            <select
              id={reasonId}
              className={SELECT_CLASSES}
              aria-describedby={`${reasonId}-hint`}
              value={reason}
              disabled={pending}
              onChange={(e) => setReason(e.target.value as Reason | "")}
            >
              <option value=""></option>
              {REASONS.map((value) => (
                <option key={value} value={value}>
                  {MEMBER_COPY.request.reasonOptions[value]}
                </option>
              ))}
            </select>
          </SelectBox>
        </Field>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" className="min-h-11" disabled={pending} onClick={() => answer("declined")} data-testid="decline-confirm">
            {MEMBER_COPY.home.decline}
          </Button>
          <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => setDeclining(false)}>
            {NAV_COPY.cancel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {status === "requested" && (
        <Button type="button" className="min-h-11" disabled={pending} onClick={() => answer("accepted")} data-testid="accept">
          {MEMBER_COPY.home.accept}
        </Button>
      )}
      {status !== "declined" && (
        <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => setDeclining(true)} data-testid="decline">
          {MEMBER_COPY.home.decline}
        </Button>
      )}
      {status === "declined" && (
        <Button type="button" className="min-h-11" disabled={pending} onClick={() => answer("accepted")} data-testid="serve-after-all">
          {MEMBER_COPY.home.serveAfterAll}
        </Button>
      )}
    </div>
  );
}
