"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { seedStandardEventTypesAction } from "./actions";

/** The empty-state action: adds the standard set (idempotent server-side). */
export function SeedStandardTypesButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    const result = await seedStandardEventTypesAction(slug);
    setPending(false);
    if (result.ok) {
      toast.success(
        result.data!.created === 0
          ? "The standard event types were already there."
          : `Added ${result.data!.created} event ${result.data!.created === 1 ? "type" : "types"}.`,
      );
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Button type="button" className="min-h-11" disabled={pending} onClick={handleClick}>
      {pending ? "Adding…" : "Add the standard event types"}
    </Button>
  );
}
