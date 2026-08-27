"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
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

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

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
  congregations: Array<{ organizationId: string; name: string }>;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<StatisticsFormValues>({
    resolver: zodResolver(statisticsSchema),
    defaultValues: defaultValues(congregations, year),
  });

  const {
    register,
    formState: { errors },
  } = form;

  if (congregations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No member congregations are on record for this presbytery yet.
      </p>
    );
  }

  async function onSubmit(values: StatisticsFormValues) {
    const input: SasrAggregateInput = {
      minuteReference: values.minuteReference || undefined,
    };
    for (const field of NUMERIC_STAT_FIELDS) {
      const raw = values[field];
      input[field] = raw === "" ? undefined : Number(raw);
    }

    setSubmitting(true);
    const result = await setCongregationStatisticsAction(
      slug,
      values.aboutOrgId,
      Number(values.year),
      input,
    );
    setSubmitting(false);

    if (result.ok) {
      toast.success("Statistics saved.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-2xl space-y-4">
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
            {...register("year")}
          />
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
  );
}
