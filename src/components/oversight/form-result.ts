import { toast } from "sonner";
import type { FieldValues, Path, UseFormSetError, UseFormSetFocus } from "react-hook-form";
import type { OversightActionResult } from "@/lib/oversight/contract";

type Failure = Extract<OversightActionResult, { ok: false }>;

const DUPLICATE_KINDS = new Set(["duplicate_name", "duplicate_policy_year", "duplicate_appraisal_year"]);

/**
 * Show a refused save without losing what was typed. A server `invalid` result
 * names its field and goes under it; a duplicate goes under the field that
 * collided (`duplicateField`); everything else (stale, forbidden, not found, a
 * failed save) is one fixed `copy.ts` string in a toast. The form keeps its values.
 */
export function reportFailure<T extends FieldValues>(
  result: Failure,
  tools: { setError: UseFormSetError<T>; setFocus: UseFormSetFocus<T> },
  duplicateField?: Path<T>,
): void {
  const field = result.kind === "invalid" && result.field ? (result.field as Path<T>) : undefined;
  const target = field ?? (result.kind && DUPLICATE_KINDS.has(result.kind) ? duplicateField : undefined);
  if (target) {
    tools.setError(target, { type: "server", message: result.error });
    tools.setFocus(target);
    return;
  }
  toast.error(result.error);
}
