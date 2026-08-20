"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { ChangeClass } from "@/lib/tickets";
import { CHANGE_CLASSES, CHANGE_CLASS_LABELS } from "@/lib/tickets-labels";
import { reclassifyTicketAction } from "./actions";

/**
 * Category is operator-correctable, never submitter-authoritative — unlike
 * `StatusControl`, the full controlled vocabulary is always offered (no
 * state machine to restrict it).
 */
export function ClassifyControl({
  ticketId,
  currentChangeClass,
}: {
  ticketId: string;
  currentChangeClass: ChangeClass;
}) {
  const [value, setValue] = useState<ChangeClass>(currentChangeClass);
  const [isPending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as ChangeClass;
    if (next === value) return;
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const result = await reclassifyTicketAction(ticketId, next);
      if (!result.ok) {
        setValue(previous);
        toast.error(result.error ?? "Update failed.");
      } else {
        toast.success("Category updated.");
      }
    });
  }

  return (
    <select
      value={value}
      onChange={handleChange}
      disabled={isPending}
      aria-label="Update ticket category"
      className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
    >
      {CHANGE_CLASSES.map((c) => (
        <option key={c} value={c}>
          {CHANGE_CLASS_LABELS[c]}
        </option>
      ))}
    </select>
  );
}
