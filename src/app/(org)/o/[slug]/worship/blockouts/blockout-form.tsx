"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError, INPUT_CLASSES, SELECT_CLASSES, SelectBox } from "@/components/worship/form-bits";
import { formatDay } from "@/components/worship/service-when";
import { ACTION_COPY, MEMBER_COPY, NAV_COPY } from "@/lib/worship/copy";
import { REASONS, type Reason } from "@/lib/worship/vocab";
import { addBlockoutAction } from "../actions";

/**
 * "Dates I can't serve" - add a range (Copy G6). Two dates and an optional reason
 * from a closed list. The server is the validator (end before start, past, over a
 * year, too many) and answers in Copy's words; this form shows that sentence inline
 * (announced) as well as in a toast. A range that joined an existing one says so; a
 * range over a date the person already agreed to saves anyway and says which.
 */
export function BlockoutForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState<Reason | "">("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    setConflicts([]);
    try {
      const result = await addBlockoutAction(slug, { startsOn: from, endsOn: to, reason: reason || null });
      if (result.ok) {
        toast.success(result.data?.merged ? MEMBER_COPY.blockouts.toastMerged : MEMBER_COPY.blockouts.toastSaved);
        setConflicts((result.data?.conflicts ?? []).map((c) => MEMBER_COPY.blockouts.conflict(formatDay(c.startsAt))));
        setFrom("");
        setTo("");
        setReason("");
        router.refresh();
      } else {
        setError(result.error);
        toast.error(result.error);
      }
    } catch {
      setError(ACTION_COPY.generic);
    } finally {
      setPending(false);
    }
  }

  return (
    <HydrationGate>
      <form onSubmit={onSubmit} className="space-y-4" data-testid="blockout-form">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="blockout-from" label={MEMBER_COPY.blockouts.fromLabel}>
            <Input id="blockout-from" type="date" required value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT_CLASSES} />
          </Field>
          <Field id="blockout-to" label={MEMBER_COPY.blockouts.toLabel}>
            <Input id="blockout-to" type="date" required value={to} onChange={(e) => setTo(e.target.value)} className={INPUT_CLASSES} />
          </Field>
        </div>
        <Field id="blockout-reason" label={MEMBER_COPY.blockouts.reasonLabel}>
          <SelectBox>
            <select id="blockout-reason" className={SELECT_CLASSES} value={reason} onChange={(e) => setReason(e.target.value as Reason | "")}>
              <option value=""></option>
              {REASONS.map((value) => (
                <option key={value} value={value}>
                  {MEMBER_COPY.request.reasonOptions[value]}
                </option>
              ))}
            </select>
          </SelectBox>
        </Field>
        <FormError message={error} />
        {conflicts.length > 0 && (
          <ul role="status" className="space-y-1 rounded-lg border border-border bg-muted p-3 text-base" data-testid="blockout-conflicts">
            {conflicts.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        )}
        <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={pending}>
          {pending ? NAV_COPY.saving : MEMBER_COPY.blockouts.submit}
        </Button>
      </form>
    </HydrationGate>
  );
}
