"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EditableEngagement, Engagement } from "@/lib/membership-standing";
import {
  engagementDialogCopy,
  type EngagementImpact,
} from "./engagement-copy";
import { ImpactDialog } from "./impact-dialog";
import { submitEngagementChange } from "./submit-engagement";

/**
 * The confirmation for an engagement change that moves a person into or out of
 * the member directory (Copy group B), shared by the list rows and the edit
 * page's Engagement card. Controlled by its caller, who decides whether a
 * dialog is needed at all (`engagementImpact(...).opensDialog`) and passes the
 * impact it computed, so the lines it shows are the lines the rule produced.
 *
 * `from` is the engagement the page rendered and goes to the server as
 * `expectedFrom` (see `submit-engagement.ts`). After a save, or after any
 * refusal (the page it was opened from is then stale), it closes and refreshes
 * the route; only a thrown error leaves it open so the click can be retried.
 */
export function EngagementDialog({
  open,
  onOpenChange,
  slug,
  personId,
  personName,
  from,
  to,
  impact,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  personId: string;
  personName: string;
  from: Engagement;
  to: EditableEngagement;
  impact: EngagementImpact;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const copy = engagementDialogCopy(personName, to, impact);

  async function confirm() {
    setPending(true);
    const outcome = await submitEngagementChange({ slug, personId, personName, from, to });
    setPending(false);
    if (outcome.kind !== "thrown") {
      onOpenChange(false);
      router.refresh();
    }
  }

  return (
    <ImpactDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.title}
      body={copy.body}
      lines={copy.lines}
      cancel={copy.cancel}
      confirm={copy.confirm}
      pending={copy.pending}
      isPending={pending}
      onConfirm={confirm}
    />
  );
}
