"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import type { TicketArea } from "@/lib/tickets";
import { TICKET_AREAS, TICKET_AREA_LABELS } from "@/lib/tickets-labels";
import { setTicketAreaAction } from "./actions";

/** Sibling to `ClassifyControl` — area is likewise operator-correctable. */
export function AreaControl({
  ticketId,
  currentArea,
}: {
  ticketId: string;
  currentArea: TicketArea;
}) {
  const [value, setValue] = useState<TicketArea>(currentArea);
  const [isPending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as TicketArea;
    if (next === value) return;
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const result = await setTicketAreaAction(ticketId, next);
      if (!result.ok) {
        setValue(previous);
        toast.error(result.error ?? "Update failed.");
      } else {
        toast.success("Area updated.");
      }
    });
  }

  return (
    <div className="relative mt-1">
      <select
        value={value}
        onChange={handleChange}
        disabled={isPending}
        aria-label="Update ticket area"
        className="w-full appearance-none rounded-md border border-input bg-background px-2 py-1.5 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
      >
        {TICKET_AREAS.map((a) => (
          <option key={a} value={a}>
            {TICKET_AREA_LABELS[a]}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </div>
  );
}
