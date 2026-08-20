"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { TicketOperator } from "@/lib/tickets-notifications";
import { assignTicketAction } from "./actions";

const UNASSIGNED = "none";

/**
 * `"none"` sentinel per docs/ui-standards.md's native-`<select>` convention
 * (an empty-string `value` collapses to "no value at all" on a controlled
 * `<select>`). `operators` is `getTicketOperatorPool()` — the pool page.tsx
 * already fetched, passed down rather than re-queried here.
 */
export function AssignControl({
  ticketId,
  currentAssigneeUserId,
  operators,
}: {
  ticketId: string;
  currentAssigneeUserId: string | null;
  operators: TicketOperator[];
}) {
  const [value, setValue] = useState(currentAssigneeUserId ?? UNASSIGNED);
  const [isPending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (next === value) return;
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const result = await assignTicketAction(
        ticketId,
        next === UNASSIGNED ? null : next,
      );
      if (!result.ok) {
        setValue(previous);
        toast.error(result.error ?? "Update failed.");
      } else {
        toast.success("Assignment updated.");
      }
    });
  }

  return (
    <select
      value={value}
      onChange={handleChange}
      disabled={isPending}
      aria-label="Update ticket assignee"
      className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
    >
      <option value={UNASSIGNED}>Unassigned</option>
      {operators.map((operator) => (
        <option key={operator.userId} value={operator.userId}>
          {operator.name ?? operator.email}
        </option>
      ))}
    </select>
  );
}
