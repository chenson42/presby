"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/shared/required-mark";
import {
  DAYS_OF_WEEK,
  ORDINALS,
  SIMPLE_PATTERNS,
  PATTERN_LABELS,
  buildDayOfWeekPattern,
  parsePattern,
} from "@/lib/events/recurrence";
import type { ExtendSeriesInput } from "@/lib/events";
import { extendSeriesSchema, type ExtendSeriesFormValues } from "./event-schema";
import { extendSeriesPatternAction } from "./actions";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Extends a series' pattern going forward — DECISION-113's "pattern edits
 * extend/regenerate the horizon only" made concrete in the UI. Rendered ONLY
 * on a series PARENT's own detail page (`recurrencePattern` non-null,
 * `parentEventId` null) — never on a standalone event or a child occurrence.
 *
 * `additionalCount` IS ADDITIVE, NEVER A REPLACEMENT TOTAL (Phase 3's Edge
 * Cases) — the label says so explicitly, and the server enforces the
 * 52-occurrence SERIES TOTAL cap (`existingCount + additionalCount`), not a
 * per-call limit.
 */
export function ExtendSeriesForm({
  slug,
  parentEventId,
  currentPattern,
}: {
  slug: string;
  parentEventId: string;
  currentPattern: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  // Pre-fills the form with the series' OWN CURRENT pattern, parsed via the
  // same `parsePattern` the server uses — a day-of-week series' own ordinal
  // and day, not a hardcoded "1st Monday" default, so re-submitting without
  // touching anything extends the series with the pattern it already has.
  // `parsePattern`'s return type isn't a discriminated union TS can narrow
  // automatically (same shape `recurrence.ts`'s own `getNextOccurrence`
  // documents with its identical `as` cast), so this uses the same explicit
  // cast rather than a narrowed access.
  const parsed = parsePattern(currentPattern);
  const dayOfWeekParsed =
    parsed.type === "dayofweek"
      ? (parsed.value as { ordinal: (typeof ORDINALS)[number]; day: (typeof DAYS_OF_WEEK)[number] })
      : null;
  const form = useForm<ExtendSeriesFormValues>({
    resolver: zodResolver(extendSeriesSchema),
    defaultValues: {
      patternType: parsed.type === "simple" ? "simple" : "dayofweek",
      simplePattern:
        parsed.type === "simple"
          ? (parsed.value as (typeof SIMPLE_PATTERNS)[number])
          : "weekly",
      ordinal: dayOfWeekParsed?.ordinal ?? "1st",
      dayOfWeek: dayOfWeekParsed?.day ?? "Monday",
      additionalCount: "",
    },
  });

  const {
    register,
    formState: { errors },
  } = form;
  const patternType = useWatch({ control: form.control, name: "patternType" });

  async function onSubmit(values: ExtendSeriesFormValues) {
    const pattern =
      values.patternType === "simple"
        ? values.simplePattern!
        : buildDayOfWeekPattern(values.ordinal!, values.dayOfWeek!);

    const input: ExtendSeriesInput = {
      parentEventId,
      pattern,
      additionalCount: Number(values.additionalCount),
    };

    setSubmitting(true);
    const result = await extendSeriesPatternAction(slug, input);
    setSubmitting(false);

    if (result.ok) {
      toast.success("Series extended.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Repeat pattern going forward</legend>
        <div className="flex flex-col gap-2">
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" value="simple" {...register("patternType")} className="h-4 w-4" />
            A simple interval
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" value="dayofweek" {...register("patternType")} className="h-4 w-4" />
            A specific day of the month
          </label>
        </div>
      </fieldset>

      {patternType === "simple" ? (
        <div>
          <Label htmlFor="extend-series-simple-pattern">Repeats</Label>
          <div className="relative mt-1">
            <select
              id="extend-series-simple-pattern"
              className={SELECT_CLASSES}
              {...register("simplePattern")}
            >
              {SIMPLE_PATTERNS.map((p) => (
                <option key={p} value={p}>
                  {PATTERN_LABELS[p]}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          <div className="flex-1">
            <Label htmlFor="extend-series-ordinal">Which</Label>
            <div className="relative mt-1">
              <select id="extend-series-ordinal" className={SELECT_CLASSES} {...register("ordinal")}>
                {ORDINALS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
          </div>
          <div className="flex-1">
            <Label htmlFor="extend-series-day-of-week">Day</Label>
            <div className="relative mt-1">
              <select id="extend-series-day-of-week" className={SELECT_CLASSES} {...register("dayOfWeek")}>
                {DAYS_OF_WEEK.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
          </div>
        </div>
      )}

      <div>
        <Label htmlFor="extend-series-additional-count">
          Additional occurrences to add
          <RequiredMark />
        </Label>
        <Input
          id="extend-series-additional-count"
          type="text"
          inputMode="numeric"
          placeholder="e.g. 8"
          className="mt-1"
          aria-invalid={errors.additionalCount ? "true" : undefined}
          {...register("additionalCount")}
        />
        {errors.additionalCount && (
          <p className="mt-1 text-sm text-destructive">{errors.additionalCount.message}</p>
        )}
      </div>

      <Button type="submit" disabled={submitting} className="min-h-11">
        {submitting ? "Extending…" : "Extend series"}
      </Button>
    </form>
  );
}
