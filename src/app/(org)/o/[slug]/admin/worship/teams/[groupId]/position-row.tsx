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
import { HydrationGate } from "@/components/shared/hydration-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describedBy, Field, INPUT_CLASSES } from "@/components/worship/form-bits";
import { ACTION_COPY, NAV_COPY, TEAMS_COPY } from "@/lib/worship/copy";
import type { TeamPosition } from "@/lib/worship/reads";
import { retirePositionAction, updatePositionAction } from "../../actions";

/**
 * One position as a card: its name, how many people it takes, and the three actions
 * Copy G3 names - "Rename", "Change number", "Retire" (an AlertDialog). Editing is
 * inline (a small form in the card), never a native prompt. A position still scheduled
 * for upcoming services cannot be retired: the store's sentence ("... is still
 * scheduled for N upcoming services. Remove those people first.") is shown in a toast.
 */
export function PositionRow({ slug, groupId, position }: { slug: string; groupId: string; position: TeamPosition }) {
  void groupId;
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "rename" | "number">("idle");
  const [name, setName] = useState(position.name);
  const [slots, setSlots] = useState(String(position.slots));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retireOpen, setRetireOpen] = useState(false);
  const busy = useRef(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await updatePositionAction(slug, {
        positionId: position.id,
        name: mode === "rename" ? name : position.name,
        slots: mode === "number" ? Number(slots) : position.slots,
      });
      if (result.ok) {
        toast.success(TEAMS_COPY.page.qualificationsSaved);
        setMode("idle");
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch {
      setError(ACTION_COPY.generic);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function retire() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const result = await retirePositionAction(slug, { positionId: position.id });
      if (result.ok) {
        toast.success(TEAMS_COPY.retirePositionDialog.toast);
        setRetireOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
        setRetireOpen(false);
      }
    } catch {
      toast.error(ACTION_COPY.generic);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const fieldId = `position-${position.id}-${mode}`;
  return (
    <li className="space-y-3 rounded-lg border border-border bg-card p-4" data-testid="position-row">
      <div>
        <p className="text-lg font-semibold [overflow-wrap:anywhere]">{position.name}</p>
        <p className="text-sm text-muted-foreground">{NAV_COPY.slotsCount(position.slots)}</p>
      </div>

      {mode !== "idle" && (
        <HydrationGate>
          <form onSubmit={save} className="space-y-3">
            {mode === "rename" ? (
              <Field id={fieldId} label={TEAMS_COPY.page.positionNameLabel} error={error}>
                <Input
                  id={fieldId}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="off"
                  className={INPUT_CLASSES}
                  aria-invalid={error ? "true" : undefined}
                  aria-describedby={describedBy(fieldId, { error: Boolean(error) })}
                />
              </Field>
            ) : (
              <Field id={fieldId} label={TEAMS_COPY.page.slotsLabel} error={error}>
                <Input
                  id={fieldId}
                  type="number"
                  inputMode="numeric"
                  value={slots}
                  onChange={(e) => setSlots(e.target.value)}
                  required
                  className={INPUT_CLASSES}
                  aria-invalid={error ? "true" : undefined}
                  aria-describedby={describedBy(fieldId, { error: Boolean(error) })}
                />
              </Field>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" className="min-h-11" disabled={pending}>
                {NAV_COPY.save}
              </Button>
              <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => setMode("idle")}>
                {NAV_COPY.cancel}
              </Button>
            </div>
          </form>
        </HydrationGate>
      )}

      {mode === "idle" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" variant="outline" className="min-h-11" onClick={() => { setError(null); setMode("rename"); }}>
            {TEAMS_COPY.page.rename}
          </Button>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => { setError(null); setMode("number"); }}>
            {TEAMS_COPY.page.changeNumber}
          </Button>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setRetireOpen(true)}>
            {TEAMS_COPY.page.retire}
            <span className="sr-only"> {position.name}</span>
          </Button>
        </div>
      )}

      <AlertDialog open={retireOpen} onOpenChange={(next) => !pending && setRetireOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="[overflow-wrap:anywhere]">{TEAMS_COPY.retirePositionDialog.title(position.name)}</AlertDialogTitle>
            <AlertDialogDescription>{TEAMS_COPY.retirePositionDialog.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={pending}>
              {TEAMS_COPY.retirePositionDialog.cancel}
            </AlertDialogCancel>
            <Button type="button" variant="destructive" className="min-h-11" disabled={pending} onClick={retire} data-testid="retire-position-confirm">
              {TEAMS_COPY.retirePositionDialog.confirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
