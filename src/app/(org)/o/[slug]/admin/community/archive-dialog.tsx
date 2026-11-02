"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { archivePersonAction } from "./actions";
import {
  ARCHIVE_COPY,
  ENGAGEMENT_SUCCESS_COPY,
  archiveDialogCopy,
  type ArchiveDialogFacts,
} from "./engagement-copy";
import { ImpactDialog } from "./impact-dialog";

/**
 * "Archive {Name}?" (Copy group D), for a visitor or a person marked inactive
 * or moved away. Controlled; the caller's button opens it. The sign-in line
 * and the open-invitation line are shown only for the facts the caller read
 * (`facts.invitationOpen` is false when the markers did not load, which omits
 * the line and so understates a consequence without stating a falsehood). A
 * refusal (an office held, a roll action waiting, your own record) shows the
 * action's sentence and leaves the dialog open, so the reader sees which
 * person it is about.
 */
export function ArchiveDialog({
  open,
  onOpenChange,
  slug,
  personId,
  personName,
  organization,
  facts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  personId: string;
  personName: string;
  organization: string;
  facts: ArchiveDialogFacts;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const copy = archiveDialogCopy(personName, organization, facts);

  async function confirm() {
    setPending(true);
    try {
      const result = await archivePersonAction(slug, { personId });
      if (result.ok) {
        toast.success(ENGAGEMENT_SUCCESS_COPY.archived(personName));
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(ARCHIVE_COPY.db_error);
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
      variant="destructive"
      onConfirm={confirm}
    />
  );
}
