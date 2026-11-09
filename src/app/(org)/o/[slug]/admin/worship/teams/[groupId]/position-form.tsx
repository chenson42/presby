"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describedBy, Field, INPUT_CLASSES } from "@/components/worship/form-bits";
import { ACTION_COPY, NAV_COPY, TEAMS_COPY } from "@/lib/worship/copy";
import { addPositionAction } from "../../actions";

/** "Add position" (Copy G3): a name and how many people it takes (1 to 20). The server's sentence is shown inline. */
export function PositionForm({ slug, groupId }: { slug: string; groupId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slots, setSlots] = useState("1");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await addPositionAction(slug, { groupId, name, slots: Number(slots) });
      if (result.ok) {
        toast.success(TEAMS_COPY.page.positionAdded);
        setName("");
        setSlots("1");
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
    <HydrationGate>
      <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-border bg-card p-4" data-testid="position-form">
        <Field id="position-name" label={TEAMS_COPY.page.positionNameLabel} error={error}>
          <Input
            id="position-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="off"
            className={INPUT_CLASSES}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={describedBy("position-name", { error: Boolean(error) })}
          />
        </Field>
        <Field id="position-slots" label={TEAMS_COPY.page.slotsLabel}>
          <Input
            id="position-slots"
            type="number"
            inputMode="numeric"
            value={slots}
            onChange={(e) => setSlots(e.target.value)}
            required
            className={INPUT_CLASSES}
          />
        </Field>
        <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={pending}>
          {pending ? NAV_COPY.saving : TEAMS_COPY.page.addPosition}
        </Button>
      </form>
    </HydrationGate>
  );
}
