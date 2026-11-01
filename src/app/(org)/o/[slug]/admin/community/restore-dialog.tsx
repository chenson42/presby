"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { restorePersonAction } from "./actions";
import {
  ENGAGEMENT_SUCCESS_COPY,
  RESTORE_COPY,
  restoreDialogCopy,
  type EngagementListName,
} from "./engagement-copy";
import { ImpactDialog } from "./impact-dialog";

/**
 * "Restore {Name}?" (Copy group D), from a Former row, the edit page's
 * Connection card and the wizard's already-here step. Controlled. `list` is
 * where the person returns to, from the engagement kept on the ended row; the
 * success toast names the list the SERVER says it used (`data.list`), which is
 * the same rule, so a stale page can never claim the wrong one.
 */
export function RestoreDialog({
  open,
  onOpenChange,
  slug,
  personId,
  personName,
  organization,
  list,
  signInConnected,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  personId: string;
  personName: string;
  organization: string;
  list: EngagementListName;
  /** `people.user_id is not null`; null when this screen did not read it, which omits the line. */
  signInConnected: boolean | null;
  /** Runs after a successful restore, before the route refreshes (the wizard navigates instead). */
  onRestored?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const copy = restoreDialogCopy(personName, organization, { list, signInConnected });

  async function confirm() {
    setPending(true);
    try {
      const result = await restorePersonAction(slug, { personId });
      if (result.ok) {
        toast.success(ENGAGEMENT_SUCCESS_COPY.restored(personName, result.data?.list ?? (list === "Visitors" ? "visitors" : "inactive")));
        onOpenChange(false);
        if (onRestored) onRestored();
        else router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(RESTORE_COPY.db_error);
    } finally {
      setPending(false);
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
