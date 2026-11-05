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
import { ACTION_COPY, SERVICES_COPY } from "@/lib/worship/copy";
import { cancelServiceAction } from "../../actions";

/**
 * "Cancel this service?" (Copy G4): an AlertDialog whose body says exactly what the
 * cancel hook does - marked Cancelled, leaves the calendar, the people asked or
 * scheduled are emailed where there is an address, open requests are closed, the
 * schedule stays on record. "Keep it" is the safe default and the first button.
 */
export function CancelServiceDialog({ slug, eventId }: { slug: string; eventId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function cancel() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const result = await cancelServiceAction(slug, { eventId });
      if (result.ok) {
        toast.success(SERVICES_COPY.cancelDialog.toast);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
        setOpen(false);
        router.refresh();
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
      <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(true)} data-testid="cancel-service-open">
        {SERVICES_COPY.page.cancelService}
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{SERVICES_COPY.cancelDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{SERVICES_COPY.cancelDialog.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={pending}>
              {SERVICES_COPY.cancelDialog.keep}
            </AlertDialogCancel>
            <Button type="button" variant="destructive" className="min-h-11" disabled={pending} onClick={cancel} data-testid="cancel-service-confirm">
              {SERVICES_COPY.cancelDialog.confirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
