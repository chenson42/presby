"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setStaffPositionPublicDisplayOrderAction } from "./actions";

interface DisplayOrderInputProps {
  slug: string;
  positionId: string;
  personName: string;
  publicDisplayOrder: number | null;
}

/**
 * Admin-set public-directory curation order (docs/work-log/
 * 2026-08-28-public-directory-primitives.md, Phase 3/4) — a plain numeric
 * `Input`, deliberately NO `AlertDialog` (unlike `PublicListingToggle`
 * alongside it): setting this ONLY reorders people who are ALREADY publicly
 * listed (Phase 3's own no-audit ruling — presentation-order, not a
 * disclosure fact), so there is nothing here that widens who is visible to
 * the internet, and nothing that needs a confirm-before-you-expose-PII step.
 *
 * Commits on blur or Enter, not on every keystroke — the same "commit at the
 * natural pause point" discipline as every other inline-edit numeric field
 * in this codebase. An empty input commits `null` ("no curation set,
 * alphabetical fallback" — the SQL functions' own
 * `coalesce(public_display_order, 2147483647)`), not `0` or a validation
 * error. A no-op blur (value unchanged from what's on record) never calls
 * the server action at all.
 */
export function DisplayOrderInput({
  slug,
  positionId,
  personName,
  publicDisplayOrder,
}: DisplayOrderInputProps) {
  const router = useRouter();
  const initial = publicDisplayOrder === null ? "" : String(publicDisplayOrder);
  const [value, setValue] = useState(initial);
  const [pending, setPending] = useState(false);
  const committedRef = useRef(initial);

  async function commit() {
    const trimmed = value.trim();
    if (trimmed === committedRef.current) return;

    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0)) {
      toast.error("Display order must be a whole number, 0 or greater.");
      setValue(committedRef.current);
      return;
    }

    setPending(true);
    const result = await setStaffPositionPublicDisplayOrderAction(slug, {
      positionId,
      publicDisplayOrder: parsed,
    });
    setPending(false);

    if (result.ok) {
      const confirmed =
        result.data?.publicDisplayOrder === null
          ? ""
          : String(result.data?.publicDisplayOrder);
      committedRef.current = confirmed;
      setValue(confirmed);
      router.refresh();
    } else {
      toast.error(result.error);
      setValue(committedRef.current);
    }
  }

  return (
    <div>
      <Label htmlFor={`display-order-${positionId}`} className="sr-only">
        Public display order for {personName}
      </Label>
      <Input
        id={`display-order-${positionId}`}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        className="w-20"
        value={value}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder="—"
      />
    </div>
  );
}
