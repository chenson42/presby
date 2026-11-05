"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ACTION_COPY, NAV_COPY, SERVICES_COPY } from "@/lib/worship/copy";
import { retireServiceTypeAction } from "../actions";

/** "Retire {name}?" (Copy G4): services already added stay as they are. */
export function RetireServiceTypeDialog({ slug, serviceTypeId, name }: { slug: string; serviceTypeId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function retire() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const result = await retireServiceTypeAction(slug, { serviceTypeId });
      if (result.ok) {
        toast.success(SERVICES_COPY.types.retireDialog.toast);
        setOpen(false);
        router.push(`/o/${slug}/admin/worship/service-types`);
        router.refresh();
      } else {
        toast.error(result.error);
        setOpen(false);
      }
    } catch {
      toast.error(ACTION_COPY.generic);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(true)} data-testid="retire-type-open">
        {SERVICES_COPY.types.retireDialog.confirm}
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="[overflow-wrap:anywhere]">{SERVICES_COPY.types.retireDialog.title(name)}</AlertDialogTitle>
            <AlertDialogDescription>{SERVICES_COPY.types.retireDialog.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={pending}>
              {NAV_COPY.cancel}
            </AlertDialogCancel>
            <Button type="button" className="min-h-11" disabled={pending} onClick={retire} data-testid="retire-type-confirm">
              {SERVICES_COPY.types.retireDialog.confirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
