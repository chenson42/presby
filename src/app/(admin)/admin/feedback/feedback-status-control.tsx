"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { updateFeedbackStatus } from "./actions";

// Mirrors the VALID_TRANSITIONS state machine in the server action.
// The select shows only legal forward transitions from the current state.
// Terminal states (done, declined) render a plain badge — no Select offered.
const VALID_TRANSITIONS: Record<string, readonly string[]> = {
  new: ["triaged", "declined"],
  triaged: ["done", "declined"],
  done: [],
  declined: [],
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  triaged: "Triaged",
  done: "Delivered",
  declined: "Declined",
};

interface FeedbackStatusControlProps {
  feedbackId: string;
  currentStatus: string;
}

export function FeedbackStatusControl({
  feedbackId,
  currentStatus,
}: FeedbackStatusControlProps) {
  const [status, setStatus] = useState(currentStatus);
  const [isPending, startTransition] = useTransition();

  const allowedTransitions = VALID_TRANSITIONS[status] ?? [];
  const isTerminal = allowedTransitions.length === 0;

  // Terminal states render a plain badge — no select to avoid confusing empty UI.
  if (isTerminal) {
    return (
      <Badge
        variant="outline"
        className={
          status === "done"
            ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-200"
            : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
        }
      >
        {STATUS_LABELS[status] ?? status}
      </Badge>
    );
  }

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStatus = e.target.value;
    if (!newStatus || newStatus === status) return;

    const previousStatus = status;
    // Optimistic update
    setStatus(newStatus);

    startTransition(async () => {
      const result = await updateFeedbackStatus(feedbackId, newStatus);
      if (!result.ok) {
        // Revert on failure
        setStatus(previousStatus);
        toast.error(result.error ?? "Status update failed.");
      }
    });
  }

  return (
    <div className="relative inline-block">
      <select
        value={status}
        onChange={handleChange}
        disabled={isPending}
        aria-label="Update feedback status"
        className="appearance-none rounded-md border border-input bg-background py-1 pr-6 pl-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-50"
      >
        {/* Current status — always shown as selected */}
        <option value={status}>{STATUS_LABELS[status] ?? status}</option>
        {/* Legal forward transitions only */}
        {allowedTransitions.map((next) => (
          <option key={next} value={next}>
            {STATUS_LABELS[next] ?? next}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-1.5 size-3 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </div>
  );
}
