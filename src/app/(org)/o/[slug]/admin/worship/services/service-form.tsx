"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError, INPUT_CLASSES } from "@/components/worship/form-bits";
import { splitWallClock } from "@/components/worship/service-when";
import { ACTION_COPY, NAV_COPY, SERVICES_COPY } from "@/lib/worship/copy";
import { createServiceAction, updateServiceAction } from "../actions";

/**
 * Add one service, or edit a service's details (Copy G4). Create: title, date, start,
 * optional end, optional place and the teams that serve. When another service starts
 * at the same minute NOTHING is created and the form says so with "Add it anyway" /
 * "Cancel" - a hint, never a refusal. Edit (`existing`): the same fields minus the
 * teams (those are changed on the service page).
 */
export function ServiceForm({
  slug,
  mode,
  teams = [],
  existing,
  onDone,
}: {
  slug: string;
  mode: "create" | "edit";
  teams?: Array<{ groupId: string; name: string }>;
  existing?: { eventId: string; title: string; startsAt: string; endsAt: string | null; location: string | null };
  /** Called after a successful edit (the edit dialog closes). */
  onDone?: () => void;
}) {
  const router = useRouter();
  const start = splitWallClock(existing?.startsAt ?? null);
  const end = splitWallClock(existing?.endsAt ?? null);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [date, setDate] = useState(start.date);
  const [startTime, setStartTime] = useState(start.time || "10:00");
  const [endTime, setEndTime] = useState(end.time);
  const [place, setPlace] = useState(existing?.location ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ title: string } | null>(null);

  async function submit(allowDuplicate: boolean) {
    if (pending) return;
    setPending(true);
    setError(null);
    const startsAt = `${date}T${startTime}`;
    const endsAt = endTime ? `${date}T${endTime}` : undefined;
    try {
      if (mode === "create") {
        const result = await createServiceAction(slug, {
          title,
          startsAt,
          ...(endsAt ? { endsAt } : {}),
          ...(place.trim() ? { location: place } : {}),
          groupIds: picked,
          allowDuplicate,
        });
        if (!result.ok) {
          setError(result.error);
        } else if (result.data && result.data.created === false) {
          setDuplicate({ title: result.data.duplicate.title });
        } else if (result.data && result.data.created) {
          toast.success(SERVICES_COPY.form.toast);
          router.push(`/o/${slug}/admin/worship/services/${result.data.eventId}`);
        }
      } else if (existing) {
        const result = await updateServiceAction(slug, {
          eventId: existing.eventId,
          title,
          startsAt,
          ...(endsAt ? { endsAt } : {}),
          location: place.trim() ? place : null,
        });
        if (result.ok) {
          toast.success(SERVICES_COPY.page.editToast);
          onDone?.();
          router.refresh();
        } else {
          setError(result.error);
        }
      }
    } catch {
      setError(ACTION_COPY.generic);
    } finally {
      setPending(false);
    }
  }

  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const idp = mode === "create" ? "svc" : "svc-edit";

  return (
    <HydrationGate>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setDuplicate(null);
          void submit(false);
        }}
        className="space-y-4"
        data-testid="service-form"
      >
        <Field id={`${idp}-title`} label={SERVICES_COPY.form.titleLabel}>
          <Input id={`${idp}-title`} value={title} onChange={(e) => setTitle(e.target.value)} required autoComplete="off" className={INPUT_CLASSES} />
        </Field>
        <Field id={`${idp}-date`} label={SERVICES_COPY.form.dateLabel}>
          <Input id={`${idp}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={INPUT_CLASSES} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${idp}-start`} label={SERVICES_COPY.form.startsAtLabel}>
            <Input id={`${idp}-start`} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required className={INPUT_CLASSES} />
          </Field>
          <Field id={`${idp}-end`} label={SERVICES_COPY.form.endsAtLabel}>
            <Input id={`${idp}-end`} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={INPUT_CLASSES} />
          </Field>
        </div>
        <Field id={`${idp}-where`} label={SERVICES_COPY.form.whereLabel}>
          <Input id={`${idp}-where`} value={place} onChange={(e) => setPlace(e.target.value)} autoComplete="off" className={INPUT_CLASSES} />
        </Field>
        {mode === "create" && (
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{SERVICES_COPY.form.teamsLabel}</legend>
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
        )}
        <FormError message={error} />
        {duplicate && (
          <div role="status" className="space-y-3 rounded-lg border border-border bg-muted p-4" data-testid="service-duplicate">
            <p className="text-base [overflow-wrap:anywhere]">{SERVICES_COPY.form.duplicate(duplicate.title)}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" className="min-h-11" disabled={pending} onClick={() => void submit(true)}>
                {SERVICES_COPY.form.duplicateConfirm}
              </Button>
              <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => setDuplicate(null)}>
                {SERVICES_COPY.form.duplicateCancel}
              </Button>
            </div>
          </div>
        )}
        <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={pending || duplicate !== null}>
          {pending ? NAV_COPY.saving : mode === "create" ? SERVICES_COPY.form.submit : NAV_COPY.save}
        </Button>
      </form>
    </HydrationGate>
  );
}
