"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError, INPUT_CLASSES, SELECT_CLASSES, SelectBox } from "@/components/worship/form-bits";
import { ACTION_COPY, NAV_COPY, SERVICES_COPY } from "@/lib/worship/copy";
import { SERVICE_PATTERNS, type ServicePattern } from "@/lib/worship/vocab";
import { generateServicesAction } from "../actions";

/** "Add several services" (Copy G4): a service type, a first date, a repeat pattern and how many (up to 26). */
export function GenerateForm({ slug, types }: { slug: string; types: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [firstDate, setFirstDate] = useState("");
  const [pattern, setPattern] = useState<ServicePattern>("weekly");
  const [count, setCount] = useState("4");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await generateServicesAction(slug, { serviceTypeId: typeId, firstDate, pattern, count: Number(count) });
      if (result.ok) {
        toast.success(SERVICES_COPY.several.toast(result.data?.eventIds.length ?? Number(count)));
        router.push(`/o/${slug}/admin/worship/services`);
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch {
      setError(ACTION_COPY.generic);
    } finally {
      setPending(false);
    }
  }

  return (
    <HydrationGate>
      <form onSubmit={onSubmit} className="space-y-4" data-testid="generate-form">
        <Field id="gen-type" label={SERVICES_COPY.several.typeLabel}>
          <SelectBox>
            <select id="gen-type" className={SELECT_CLASSES} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </SelectBox>
        </Field>
        <Field id="gen-date" label={SERVICES_COPY.several.firstDateLabel}>
          <Input id="gen-date" type="date" value={firstDate} onChange={(e) => setFirstDate(e.target.value)} required className={INPUT_CLASSES} />
        </Field>
        <Field id="gen-repeat" label={SERVICES_COPY.several.repeatLabel}>
          <SelectBox>
            <select id="gen-repeat" className={SELECT_CLASSES} value={pattern} onChange={(e) => setPattern(e.target.value as ServicePattern)}>
              {SERVICE_PATTERNS.map((value) => (
                <option key={value} value={value}>
                  {SERVICES_COPY.several.repeatOptions[value]}
                </option>
              ))}
            </select>
          </SelectBox>
        </Field>
        <Field id="gen-count" label={SERVICES_COPY.several.countLabel}>
          <Input
            id="gen-count"
            type="number"
            inputMode="numeric"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            required
            className={INPUT_CLASSES}
          />
        </Field>
        <FormError message={error} />
        <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={pending}>
          {pending ? NAV_COPY.saving : SERVICES_COPY.several.submit}
        </Button>
      </form>
    </HydrationGate>
  );
}
