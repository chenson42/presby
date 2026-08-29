"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setGroupMembershipPublicDisplayOrderAction } from "./actions";

interface DisplayOrderInputProps {
  slug: string;
  groupId: string;
  groupMembershipId: string;
  personName: string;
  publicDisplayOrder: number | null;
}

/**
 * Admin-set public-committee-directory curation order — the
 * `group_memberships` twin of `admin/staff`/`admin/officers`'s own
 * `display-order-input.tsx` (docs/work-log/2026-08-28-public-directory-
 * primitives.md). See those files' own header for the full rationale (no
 * `AlertDialog`, commit-on-blur/Enter, empty commits `null`, a no-op blur
 * never calls the server). Duplicated rather than shared, matching this
 * codebase's own per-domain-file convention for these small, structurally
 * similar controls (`end-position-dialog.tsx`/`end-term-dialog.tsx`/
 * `end-group-membership-dialog.tsx`).
 *
 * `groupId` is caller-supplied (the group detail page, which already
 * fetched `getGroup()` to render the row this input lives on) purely for
 * `revalidatePath` — mirroring `setGroupMembershipPublicListedAction`'s own
 * shape one file over.
 */
export function DisplayOrderInput({
  slug,
  groupId,
  groupMembershipId,
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
    const result = await setGroupMembershipPublicDisplayOrderAction(slug, {
      groupMembershipId,
      publicDisplayOrder: parsed,
      groupId,
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
      <Label htmlFor={`display-order-${groupMembershipId}`} className="sr-only">
        Public display order for {personName}
      </Label>
      <Input
        id={`display-order-${groupMembershipId}`}
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
