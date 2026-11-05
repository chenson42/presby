"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError, INPUT_CLASSES } from "@/components/worship/form-bits";
import { ACTION_COPY, NAV_COPY, SERVICES_COPY } from "@/lib/worship/copy";
import type { ServiceTypeEntry } from "@/lib/worship/reads";
import { createServiceTypeAction, updateServiceTypeAction } from "../actions";

/**
 * Create or edit a service type (Copy G4): name, usual start, length, place and the
 * teams that usually serve - one save, one transaction. The server validates (name
 * unique among live types, length 15 to 480, place up to 200) and its sentence is
 * shown inline. `existing` switches the form to edit.
 */
export function ServiceTypeForm({
  slug,
  teams,
  existing,
}: {
  slug: string;
  teams: Array<{ groupId: string; name: string }>;
  existing?: ServiceTypeEntry;
}) {
  const router = useRouter();
  const [name, setName] = useState(existing?.name ?? "");
  const [startTime, setStartTime] = useState(existing?.startTime ?? "10:00");
  const [minutes, setMinutes] = useState(existing?.durationMinutes ? String(existing.durationMinutes) : "");
  const [place, setPlace] = useState(existing?.location ?? "");
  const [picked, setPicked] = useState<string[]>(existing?.teamIds ?? []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const fields = {
      name,
      startTime,
      durationMinutes: minutes.trim() === "" ? null : Number(minutes),
      location: place.trim() === "" ? null : place,
      groupIds: picked,
    };
    try {
      const result = existing
        ? await updateServiceTypeAction(slug, { serviceTypeId: existing.id, ...fields })
        : await createServiceTypeAction(slug, fields);
      if (result.ok) {
        toast.success(SERVICES_COPY.types.toast);
        router.push(`/o/${slug}/admin/worship/service-types`);
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

  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <HydrationGate>
      <form onSubmit={onSubmit} className="space-y-4" data-testid="service-type-form">
        <Field id="type-name" label={SERVICES_COPY.types.nameLabel}>
          <Input id="type-name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" className={INPUT_CLASSES} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="type-start" label={SERVICES_COPY.types.startsAtLabel}>
            <Input id="type-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required className={INPUT_CLASSES} />
          </Field>
          <Field id="type-minutes" label={SERVICES_COPY.types.lastsLabel}>
            <Input
              id="type-minutes"
              type="number"
              inputMode="numeric"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className={INPUT_CLASSES}
            />
          </Field>
        </div>
        <Field id="type-where" label={SERVICES_COPY.types.whereLabel}>
          <Input id="type-where" value={place} onChange={(e) => setPlace(e.target.value)} autoComplete="off" className={INPUT_CLASSES} />
        </Field>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">{SERVICES_COPY.types.teamsLabel}</legend>
          {teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">{NAV_COPY.teamNone}</p>
          ) : (
            teams.map((team) => (
              <label key={team.groupId} className="flex min-h-11 items-center gap-3 text-base [overflow-wrap:anywhere]">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-primary"
                  checked={picked.includes(team.groupId)}
                  onChange={() => toggle(team.groupId)}
                />
                {team.name}
              </label>
            ))
          )}
        </fieldset>
        <FormError message={error} />
        <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={pending}>
          {pending ? NAV_COPY.saving : SERVICES_COPY.types.submit}
        </Button>
      </form>
    </HydrationGate>
  );
}
