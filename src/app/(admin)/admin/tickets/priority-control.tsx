"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { TicketPriority } from "@/lib/tickets";
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABELS } from "@/lib/tickets-labels";
import { setTicketPriorityAction } from "./actions";

/** Sibling to `ClassifyControl`/`AreaControl` — same operator-correctable shape. */
export function PriorityControl({
  ticketId,
  currentPriority,
}: {
  ticketId: string;
  currentPriority: TicketPriority;
}) {
  const [value, setValue] = useState<TicketPriority>(currentPriority);
  const [isPending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as TicketPriority;
    if (next === value) return;
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const result = await setTicketPriorityAction(ticketId, next);
      if (!result.ok) {
        setValue(previous);
        toast.error(result.error ?? "Update failed.");
      } else {
        toast.success("Priority updated.");
      }
    });
  }

  return (
    <select
      value={value}
      onChange={handleChange}
      disabled={isPending}
      aria-label="Update ticket priority"
      className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
    >
      {TICKET_PRIORITIES.map((p) => (
        <option key={p} value={p}>
          {TICKET_PRIORITY_LABELS[p]}
        </option>
      ))}
    </select>
  );
}
