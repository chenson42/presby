"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import type { TicketStatus } from "@/lib/tickets";
import { TICKET_STATUS_LABELS } from "@/lib/tickets-labels";
import { updateTicketStatusAction } from "./actions";

/**
 * Mirrors `admin/feedback/feedback-status-control.tsx`'s optimistic
 * update-and-revert shape, widened to the tickets state machine
 * (`new -> triaged|declined -> in_progress -> resolved|declined`, one extra
 * state vs. feedback's own four-state machine).
 */
const VALID_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  new: ["triaged", "declined"],
  triaged: ["in_progress", "declined"],
  in_progress: ["resolved", "declined"],
  resolved: [],
  declined: [],
};

export function StatusControl({
  ticketId,
  currentStatus,
}: {
  ticketId: string;
  currentStatus: TicketStatus;
}) {
  const [status, setStatus] = useState<TicketStatus>(currentStatus);
  const [isPending, startTransition] = useTransition();

  const allowed = VALID_TRANSITIONS[status] ?? [];
  const isTerminal = allowed.length === 0;

  if (isTerminal) {
    return (
      <p className="mt-1 text-sm font-medium">{TICKET_STATUS_LABELS[status]}</p>
    );
  }

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as TicketStatus;
    if (!next || next === status) return;
    const previous = status;
    setStatus(next);
    startTransition(async () => {
      const result = await updateTicketStatusAction(ticketId, next);
      if (!result.ok) {
        setStatus(previous);
        toast.error(result.error ?? "Status update failed.");
      } else {
        toast.success("Status updated.");
      }
    });
  }

  return (
    <div className="relative mt-1">
      <select
        value={status}
        onChange={handleChange}
        disabled={isPending}
        aria-label="Update ticket status"
        className="w-full appearance-none rounded-md border border-input bg-background px-2 py-1.5 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
      >
        <option value={status}>{TICKET_STATUS_LABELS[status]}</option>
        {allowed.map((s) => (
          <option key={s} value={s}>
            {TICKET_STATUS_LABELS[s]}
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
