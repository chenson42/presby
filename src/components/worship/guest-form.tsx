"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { placeGuestAction } from "@/app/(org)/o/[slug]/worship/actions";
import { ACTION_COPY, BOARD_COPY, NAV_COPY } from "@/lib/worship/copy";
import { describedBy, Field, INPUT_CLASSES } from "./form-bits";

/**
 * "Add a guest" (Copy G5): a visiting preacher or a guest musician who is not on
 * record. Just a name - the store refuses anything that looks like contact details
 * with the Copy sentence, which this form shows inline. A guest is Confirmed at
 * placement and is never emailed.
 */
export function GuestForm({
  slug,
  eventId,
  groupId,
  positionId,
  positionName,
}: {
  slug: string;
  eventId: string;
  groupId: string;
  positionId: string;
  positionName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = `guest-name-${positionId}`;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await placeGuestAction(slug, { eventId, groupId, positionId, guestName: name });
      if (result.ok) {
        toast.success(BOARD_COPY.picker.toast);
        setName("");
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch {
      setError(ACTION_COPY.generic);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setName("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11" data-testid={`add-guest-${positionId}`}>
          {BOARD_COPY.addGuest}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">{BOARD_COPY.addGuest}</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">{BOARD_COPY.picker.title(positionName)}</DialogDescription>
        </DialogHeader>
        <HydrationGate>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field id={fieldId} label={BOARD_COPY.guestNameLabel} hint={BOARD_COPY.guestHint} error={error}>
              <Input
                id={fieldId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="off"
                className={INPUT_CLASSES}
                aria-invalid={error ? "true" : undefined}
                aria-describedby={describedBy(fieldId, { hint: true, error: Boolean(error) })}
              />
            </Field>
            <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={pending}>
              {pending ? NAV_COPY.saving : NAV_COPY.guestSubmit}
            </Button>
          </form>
        </HydrationGate>
      </DialogContent>
    </Dialog>
  );
}
