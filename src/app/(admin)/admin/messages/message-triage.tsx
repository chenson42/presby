"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { HelpContactStatus } from "@/lib/db/domain/help-contact";
import { HELP_CONTACT_INBOX_COPY as COPY } from "@/lib/help-contact/copy";
import { setContactMessageStatus } from "./actions";

/**
 * The status control on a message's detail page: up to three buttons, never the
 * one for the status the message already has. "Move back to new" is hidden once
 * the details were cleared (the action and the database refuse it too; hiding is
 * a courtesy). Each button is a full-width 44px target at 360px.
 *
 * Plain buttons, not a `<select>`: the operator triages on a phone, and a
 * single tap that names its result ("Mark as handled") is harder to get wrong
 * than choosing from a native picker.
 */
const ORDER: readonly HelpContactStatus[] = ["handled", "spam", "new"];

export function MessageTriage({
  id,
  status,
  cleared,
}: {
  id: string;
  status: HelpContactStatus;
  cleared: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<HelpContactStatus | null>(null);

  const targets = ORDER.filter((to) => to !== status && !(to === "new" && cleared));

  async function change(to: HelpContactStatus) {
    setPending(to);
    try {
      const result = await setContactMessageStatus(id, to);
      if (result.ok) {
        toast.success(COPY.statusToasts[to]);
        // revalidatePath() alone does not re-render an already-mounted page
        // (the same note as dismiss-feedback-dialog.tsx).
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(COPY.statusFailure);
    } finally {
      setPending(null);
    }
  }

  if (targets.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {targets.map((to) => (
        <Button
          key={to}
          type="button"
          variant="outline"
          disabled={pending !== null}
          onClick={() => void change(to)}
          className="min-h-11 w-full sm:w-auto"
        >
          {COPY.statusButtons[to]}
        </Button>
      ))}
    </div>
  );
}
