"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { InvitationActionResult } from "./actions";

/**
 * The send flow both designation sections share: confirm dialog -> action ->
 * inline result (+ toast). The one wrinkle is the do-not-contact warning
 * (G19): the first send may come back `needsAcknowledgement`, in which case the
 * dialog stays open, swaps its body for that warning, and the next confirm
 * re-submits with `acknowledge = true`. Transactional mail is sent anyway once
 * the operator has seen it.
 */
export function useSendInvitation({
  send,
  successToast,
  onSent,
}: {
  send: (acknowledge: boolean) => Promise<InvitationActionResult>;
  successToast: string;
  onSent: () => void;
}) {
  const [confirmOpen, setConfirmOpenState] = useState(false);
  const [result, setResult] = useState<InvitationActionResult | null>(null);
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function setConfirmOpen(open: boolean) {
    setConfirmOpenState(open);
    if (!open) setAcknowledgement(null);
  }

  function confirm() {
    startTransition(async () => {
      const outcome = await send(acknowledgement !== null);
      if (!outcome.ok && outcome.needsAcknowledgement) {
        setAcknowledgement(outcome.error);
        return;
      }
      setResult(outcome);
      setAcknowledgement(null);
      setConfirmOpenState(false);
      if (outcome.ok) {
        toast.success(successToast);
        onSent();
      } else {
        toast.error(outcome.error);
      }
    });
  }

  return { confirmOpen, setConfirmOpen, result, acknowledgement, isPending, confirm };
}
