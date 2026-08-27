"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generatePerCapitaRecordsAction } from "./actions";

/**
 * Generates every not-yet-generated per-capita record for `billingYear` —
 * never overwrites an existing one (`src/lib/presbytery.ts`'s
 * `generatePerCapitaRecords()` header). Skipped congregations are named in
 * a toast, not silently dropped — Phase 3 Edge Cases: "skip and name, never
 * silently bill zero."
 *
 * A plain button, not a shadcn `AlertDialog` confirm — this action never
 * overwrites or destroys data (Phase 3's own no-clobber guarantee), so it
 * doesn't carry the same weight `AlertDialog`'s destructive-confirm pattern
 * exists for.
 */
export function GenerateRecordsButton({
  slug,
  billingYear,
  hasRate,
}: {
  slug: string;
  billingYear: number;
  hasRate: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function onClick() {
    setSubmitting(true);
    const result = await generatePerCapitaRecordsAction(slug, billingYear);
    setSubmitting(false);

    if (!result.ok || !result.data) {
      toast.error(!result.ok ? result.error : "Something went wrong.");
      return;
    }

    const { created, skipped } = result.data;
    if (skipped.length === 0) {
      toast.success(`Generated ${created} record${created === 1 ? "" : "s"}.`);
    } else {
      toast.success(
        `Generated ${created} record${created === 1 ? "" : "s"}. Skipped: ${skipped.join("; ")}`,
      );
    }
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="secondary"
      disabled={submitting || !hasRate}
      onClick={onClick}
      className="min-h-11"
    >
      {submitting ? "Generating…" : `Generate ${billingYear} records`}
    </Button>
  );
}
