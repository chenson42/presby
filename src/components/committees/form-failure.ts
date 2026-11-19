import { toast } from "sonner";
import type { FieldValues, Path, UseFormSetError, UseFormSetFocus } from "react-hook-form";
import type { CommitteesActionResult } from "@/lib/committees/contract";

type Failure = Extract<CommitteesActionResult, { ok: false }>;

/**
 * Show a refused save without losing what was typed. An `invalid` result names its
 * field and goes under it; a refusal that belongs to one field (`byKind`: a
 * duplicate name under "Committee name", an overlap under "Person") goes under that
 * field; everything else (stale, forbidden, not found, a failed save) is one fixed
 * `copy.ts` string in a toast. The form keeps its values.
 */
export function reportFailure<T extends FieldValues>(
  result: Failure,
  tools: { setError: UseFormSetError<T>; setFocus: UseFormSetFocus<T> },
  byKind: Partial<Record<NonNullable<Failure["kind"]>, Path<T>>> = {},
): void {
  const target = result.kind === "invalid" && result.field ? (result.field as Path<T>) : result.kind ? byKind[result.kind] : undefined;
  if (target) {
    tools.setError(target, { type: "server", message: result.error });
    tools.setFocus(target);
    return;
  }
  toast.error(result.error);
}
