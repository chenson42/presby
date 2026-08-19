"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { retryEmailAction } from "./actions";

interface RetryButtonProps {
  id: string;
}

/**
 * Client island that calls retryEmailAction and shows a toast on completion.
 * Rendered only for rows with status='failed' (enforced in page.tsx).
 */
export function RetryButton({ id }: RetryButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await retryEmailAction(id);
      if (result.ok) {
        toast.success("Retry scheduled — the worker will pick this up within 5 minutes.");
      } else {
        toast.error(result.error ?? "Unable to schedule retry — please try again.");
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={isPending}>
      {isPending ? (
        <>
          <span
            className="h-3 w-3 animate-spin rounded-full border-2 border-foreground border-t-transparent"
            aria-hidden="true"
          />
          Retrying…
        </>
      ) : (
        "Retry now"
      )}
    </Button>
  );
}
