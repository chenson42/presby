"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shared/use-hydrated";
import type { GivingTemplateKey } from "@/lib/giving/team";
import { ensureGivingRoleAction } from "./actions";

/**
 * "Set up the Giving Recorder / Treasurer role" - the P3-18 path: restores (or
 * creates) the church's own copy of a giving role from its template so the team
 * page never strands. Shown only for a template with no active role.
 */
export function SetUpRoleButton({
  slug,
  templateKey,
  label,
}: {
  slug: string;
  templateKey: GivingTemplateKey;
  label: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);

  async function setup() {
    setPending(true);
    const result = await ensureGivingRoleAction(slug, { templateKey });
    setPending(false);
    if (result.ok) {
      const skipped = result.data?.skippedKeys ?? [];
      toast.success(
        skipped.length > 0
          ? `Role set up, without ${skipped.join(", ")} (you don't hold ${skipped.length === 1 ? "it" : "them"} yourself).`
          : "Role set up.",
      );
      router.refresh();
    } else if (result.kind === "two_factor_required" && result.redirectTo) {
      window.location.assign(result.redirectTo);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Button type="button" variant="outline" className="min-h-11" disabled={!hydrated || pending} onClick={setup}>
      {pending ? "Setting up…" : label}
    </Button>
  );
}
