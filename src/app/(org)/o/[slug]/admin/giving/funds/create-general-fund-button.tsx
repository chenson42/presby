"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shared/use-hydrated";
import { createGeneralFundAction } from "./actions";

/** The funds empty state's one-click action: an unrestricted "General Fund", not offered online. */
export function CreateGeneralFundButton({ slug }: { slug: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);

  async function create() {
    setPending(true);
    const result = await createGeneralFundAction(slug);
    setPending(false);
    if (result.ok) {
      toast.success("General Fund added.");
      router.refresh();
    } else if (result.kind === "two_factor_required" && result.redirectTo) {
      window.location.assign(result.redirectTo);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Button type="button" className="mt-4 min-h-11" disabled={!hydrated || pending} onClick={create}>
      {pending ? "Adding…" : "Create General Fund"}
    </Button>
  );
}
