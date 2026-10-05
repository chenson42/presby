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
import type { SasrAggregateInput } from "@/lib/presbytery";
import {
  NUMERIC_STAT_FIELDS,
  statisticsSchema,
  type StatisticsFormValues,
} from "./statistics-schema";
import { setCongregationStatisticsAction } from "./actions";
import { HydrationGate } from "@/components/shared/hydration-gate";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

const FIELD_LABELS: Record<(typeof NUMERIC_STAT_FIELDS)[number], string> = {
  endingActive: "Active members",
  endingBaptized: "Baptized (non-communing) members",
  endingAffiliate: "Affiliate members",
  endingOtherParticipants: "Other participants",
  gainsProfessionsUnder18: "Professions of faith, under 18",
  gainsProfessions18Plus: "Professions of faith, 18+",
  gainsCertificate: "Gains by certificate",
  gainsOther: "Other gains",
  lossesCertificate: "Losses by certificate",
  lossesDeaths: "Losses by death",
  lossesOther: "Other losses",
  avgWeeklyWorshipAttendance: "Average weekly worship attendance",
  potentialGivingUnits: "Potential giving units",
  baptismsChildren: "Baptisms, children",
  baptismsAdults: "Baptisms, adults",
  officersRulingElderCount: "Ruling elders",
  officersDeaconCount: "Deacons",
};

const FIELD_GROUPS: Array<{
  heading: string;
  fields: readonly (typeof NUMERIC_STAT_FIELDS)[number][];
}> = [
  {
    heading: "Ending rolls",
    fields: ["endingActive", "endingBaptized", "endingAffiliate", "endingOtherParticipants"],
  },
  {
    heading: "Gains",
    fields: ["gainsProfessionsUnder18", "gainsProfessions18Plus", "gainsCertificate", "gainsOther"],
  },
  {
    heading: "Losses",
    fields: ["lossesCertificate", "lossesDeaths", "lossesOther"],
  },
  {
    heading: "Worship, giving & baptisms",
    fields: ["avgWeeklyWorshipAttendance", "potentialGivingUnits", "baptismsChildren", "baptismsAdults"],
  },
  {
    heading: "Officers",
    fields: ["officersRulingElderCount", "officersDeaconCount"],
  },
];

/** This congregation's affiliation window with the presbytery — see
 *  `src/lib/presbytery.ts`'s `fetchAffiliationWindows()`. `null` on either
 *  side means unbounded on that side; BOTH `null` (no affiliation row
 *  reachable at all) renders unconstrained, per orchestrator ruling 3. */
type StatisticsFormCongregation = {
  organizationId: string;
  name: string;
  affiliationMinYear: number | null;
  affiliationMaxYear: number | null;
};

/** Plain-English statement of a congregation's known affiliation bound(s),
 *  in `reports-states.tsx`'s voice — short, no jargon. `null` when neither
 *  bound is known (renders no hint at all). */
function affiliationWindowCopy(
  cong: StatisticsFormCongregation | undefined,
): string | null {
  if (!cong) return null;
  const { name, affiliationMinYear: min, affiliationMaxYear: max } = cong;
  if (min !== null && max !== null) {
    return `${name} was affiliated with this presbytery from ${min} through ${max}.`;
  }
  if (min !== null) {
    return `${name} was affiliated with this presbytery starting in ${min} — enter that year or later.`;
  }
  if (max !== null) {
    return `${name} was affiliated with this presbytery through ${max} — enter that year or earlier.`;
  }
  return null;
}

/** Same fact as `affiliationWindowCopy()`, phrased as a validation error for
 *  a year actually outside the known window. */
function affiliationWindowError(
  cong: StatisticsFormCongregation,
  year: number,
): string | null {
  const { affiliationMinYear: min, affiliationMaxYear: max } = cong;
  if (min !== null && year < min) {
    return `${cong.name} wasn't affiliated with this presbytery until ${min} — enter ${min} or later.`;
  }
  if (max !== null && year > max) {
    return `${cong.name} wasn't affiliated with this presbytery after ${max} — enter ${max} or earlier.`;
  }
  return null;
}

function defaultValues(
  congregations: Array<{ organizationId: string; name: string }>,
  year: number,
): StatisticsFormValues {
  return {
    aboutOrgId: congregations[0]?.organizationId ?? "",
    year: String(year),
    minuteReference: "",
    endingActive: "",
    endingBaptized: "",
    endingAffiliate: "",
    endingOtherParticipants: "",
    gainsProfessionsUnder18: "",
    gainsProfessions18Plus: "",
    gainsCertificate: "",
    gainsOther: "",
    lossesCertificate: "",
    lossesDeaths: "",
    lossesOther: "",
    avgWeeklyWorshipAttendance: "",
    potentialGivingUnits: "",
    baptismsChildren: "",
    baptismsAdults: "",
    officersRulingElderCount: "",
    officersDeaconCount: "",
  };
}

/**
 * Records/updates ONE congregation's `presbytery_entered` statistics for ONE
 * year — Increment 3b. `react-hook-form` + `zod`, same pattern as
 * `../credentials/record-appointment-form.tsx`. Only the CORE SASR fields
 * this increment scopes to (see `src/lib/presbytery.ts`'s header) — not the
 * full age/gender/race/disability/financial breakdown.
 */
export function StatisticsForm({
  slug,
  year,
  congregations,
}: {
  slug: string;
  year: number;
  congregations: StatisticsFormCongregation[];
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<StatisticsFormValues>({
    resolver: zodResolver(statisticsSchema),
    defaultValues: defaultValues(congregations, year),
  });

  const {
    register,
    control,
    setError,
    formState: { errors },
  } = form;

  const selectedAboutOrgId = useWatch({ control, name: "aboutOrgId" });
  const selectedCongregation = congregations.find(
    (cong) => cong.organizationId === selectedAboutOrgId,
  );
  const windowHint = affiliationWindowCopy(selectedCongregation);

  if (congregations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No member congregations are on record for this presbytery yet.
      </p>
    );
  }

  async function onSubmit(values: StatisticsFormValues) {
    const yearValue = Number(values.year);

    // UX pre-flight only — the trigger, mapped in setCongregationStatistics,
    // is what actually enforces this; a caller bypassing the client entirely
    // still gets the correct refusal server-side. See
    // docs/work-log/2026-09-28-statistics-error-mapping.md Phase 3 Design (b).
    const cong = congregations.find(
      (c) => c.organizationId === values.aboutOrgId,
    );
    if (cong) {
      const windowError = affiliationWindowError(cong, yearValue);
      if (windowError) {
        setError("year", { message: windowError });
        return;
      }
    }

    const input: SasrAggregateInput = {
      minuteReference: values.minuteReference || undefined,
    };
    for (const field of NUMERIC_STAT_FIELDS) {
      const raw = values[field];
      input[field] = raw === "" ? undefined : Number(raw);
    }

    setSubmitting(true);
    try {
      const result = await setCongregationStatisticsAction(
        slug,
        values.aboutOrgId,
        yearValue,
        input,
      );

      if (result.ok) {
        toast.success("Statistics saved.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch (err) {
      // A genuinely unexpected rejection (a DB outage, a dropped
      // connection — NOT the about-org refusal, which (c) maps to a normal
      // `{ ok: false }` and never reaches here). Phase 3 Design (e) is
      // right that this call is a client-side RPC, not a render, so
      // `error.tsx` cannot and does not catch it — without a catch here it
      // was, and would remain, TOTALLY SILENT to the user (confirmed
      // reading Design (e)'s own "no user-visible message appears at all"
      // — that observation describes the *rejection*, not an acceptable
      // end state for THIS call site, since nothing downstream ever shows
      // it). Logged to the browser console (Next.js Server Actions already
      // redact the real error into a generic digest-only message before it
      // reaches the client in production — no raw SQL/PII crosses this
      // boundary) and surfaced with the same generic toast voice
      // `reports-states.tsx` uses for a read-side load error, rather than
      // left to vanish as an unhandled rejection. Divergence from the
      // Phase 3 design doc, recorded in the work-log's Phase 4 Implementer
      // Notes: the doc's own `finally`-only text under-specified this path.
      console.error(
        "[reports] setCongregationStatisticsAction: unexpected error",
        err,
      );
      toast.error("We couldn't save this right now. Try again in a moment.");
    } finally {
      // Runs on ANY outcome — a mapped `{ ok: false }`, the catch above,
      // all of it — so the button can never wedge on "Saving…" again. See
      // Phase 3 Design (b): the one-line fix for the stuck-button bug.
      setSubmitting(false);
    }
  }

  return (
    <HydrationGate>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        // Discovered via a failing form test (docs/work-log/
        // 2026-09-28-statistics-error-mapping.md Phase 4): the `min`/`max`
        // HTML attributes on the Year field (below) make an out-of-window
        // value trip the BROWSER's native constraint validation, which cancels
        // the "submit" event before React/RHF ever sees it — the custom
        // pre-flight guard's plain-English, congregation-specific copy would
        // never render, and a caller bypassing the client (the codebase's own
        // stated adversarial concern) would get a generic, unstyled native
        // tooltip instead of the zod/RHF error path every other check in this
        // form already goes through. `noValidate` makes the resolver and the
        // guard the sole, consistently-reachable path; `min`/`max` still work
        // as spinner-arrow clamps.
        noValidate
        className="max-w-2xl space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="stats-congregation">
              Congregation
              <RequiredMark />
            </Label>
            <div className="relative mt-1">
              <select
                id="stats-congregation"
                className={SELECT_CLASSES}
                aria-required="true"
                {...register("aboutOrgId")}
              >
                {congregations.map((cong) => (
                  <option key={cong.organizationId} value={cong.organizationId}>
                    {cong.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
            {errors.aboutOrgId && (
              <p className="mt-1 text-sm text-destructive">{errors.aboutOrgId.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="stats-year">
              Year
              <RequiredMark />
            </Label>
            <Input
              id="stats-year"
              type="number"
              aria-required="true"
              className="mt-1"
              min={selectedCongregation?.affiliationMinYear ?? undefined}
              max={selectedCongregation?.affiliationMaxYear ?? undefined}
              {...register("year")}
            />
            {windowHint && !errors.year && (
              <p className="mt-1 text-sm text-muted-foreground">{windowHint}</p>
            )}
            {errors.year && (
              <p className="mt-1 text-sm text-destructive">{errors.year.message}</p>
            )}
          </div>
        </div>

        {FIELD_GROUPS.map((group) => (
          <fieldset key={group.heading} className="space-y-2">
            <legend className="text-sm font-medium">{group.heading}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {group.fields.map((field) => (
                <div key={field}>
                  <Label htmlFor={`stats-${field}`}>{FIELD_LABELS[field]}</Label>
                  <Input
                    id={`stats-${field}`}
                    type="number"
                    min={0}
                    className="mt-1"
                    {...register(field)}
                  />
                  {errors[field] && (
                    <p className="mt-1 text-sm text-destructive">{errors[field]?.message}</p>
                  )}
                </div>
              ))}
            </div>
          </fieldset>
        ))}

        <div>
          <Label htmlFor="stats-minute-reference">Minute reference (optional)</Label>
          <Input
            id="stats-minute-reference"
            type="text"
            placeholder="e.g. Session minutes, 12 Jan 2026"
            className="mt-1"
            {...register("minuteReference")}
          />
          {errors.minuteReference && (
            <p className="mt-1 text-sm text-destructive">
              {errors.minuteReference.message}
            </p>
          )}
        </div>

        <Button type="submit" disabled={submitting} className="min-h-11">
          {submitting ? "Saving…" : "Save statistics"}
        </Button>
      </form>
    </HydrationGate>
  );
}
