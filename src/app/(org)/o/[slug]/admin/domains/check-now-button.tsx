"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shared/use-hydrated";
import { checkDomainAction } from "./actions";
import { CHECK_OUTCOME_COPY } from "./outcome-copy";

/**
 * "Check now": runs the same check the schedule runs, once, on demand. Plain
 * onClick control, so it is disabled until hydrated (a pre-hydration tap would
 * do nothing). Disabled while pending; the result is a toast. A rate limit
 * arrives from the server as end-user copy ("Try again in N minutes").
 */
export function CheckNowButton({ slug, claimName }: { slug: string; claimName: string }) {
  const hydrated = useHydrated();
  const [pending, start] = useTransition();

  function onClick() {
    start(async () => {
      let result;
      try {
        result = await checkDomainAction(slug, claimName);
      } catch {
        toast.error("We couldn't check right now. Try again in a few minutes.");
        return;
      }
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const copy = CHECK_OUTCOME_COPY[result.data!.outcome];
      if (copy.tone === "success") toast.success(copy.message);
      else if (copy.tone === "error") toast.error(copy.message);
      else toast.info(copy.message);
    });
  }

  return (
    <Button type="button" className="min-h-11" disabled={!hydrated || pending} onClick={onClick}>
      <RefreshCw className={pending ? "animate-spin" : undefined} aria-hidden />
      {pending ? "Checking…" : "Check now"}
    </Button>
  );
}
