"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shared/use-hydrated";
import { reconnectClaimAction } from "./actions";

/**
 * Brings a removed (parked) domain back. The server confirms the ownership
 * record is in place first; if it is not, the message says to add it back.
 */
export function ReconnectButton({ slug, claimName }: { slug: string; claimName: string }) {
  const hydrated = useHydrated();
  const [pending, start] = useTransition();

  function onClick() {
    start(async () => {
      let result;
      try {
        result = await reconnectClaimAction(slug, claimName);
      } catch {
        toast.error("We couldn't reconnect it right now. Try again in a few minutes.");
        return;
      }
      if (result.ok) toast.success("Reconnected. We're checking your records again.");
      else toast.error(result.error);
    });
  }

  return (
    <Button type="button" variant="outline" className="min-h-11" disabled={!hydrated || pending} onClick={onClick}>
      {pending ? "Reconnecting…" : "Reconnect"}
    </Button>
  );
}
