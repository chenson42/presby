"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";
import { useUnsavedChangesGuard } from "@/components/shared/use-unsaved-changes-guard";
import type { OversightRow } from "@/lib/presbytery";
import { oversightSchema, type OversightFormValues } from "./oversight-schema";
import { setCongregationOversightAction } from "./actions";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function defaultValues(row: OversightRow): OversightFormValues {
  return {
    viabilityScore: row.viabilityScore ? (String(row.viabilityScore) as "1" | "2" | "3") : "",
    redevelopmentNotes: row.redevelopmentNotes ?? "",
    buildingsNotes: row.buildingsNotes ?? "",
    insuranceCarrier: row.insuranceCarrier ?? "",
    insuranceExpiresOn: row.insuranceExpiresOn ?? "",
    latitude: row.latitude ?? "",
    longitude: row.longitude ?? "",
  };
}

/**
 * Records/updates the presbytery's own assessment of ONE member
 * congregation — Increment 3. `react-hook-form` + `zod`, same pattern as
 * `../../credentials/record-appointment-form.tsx`.
 *
 * Latitude/longitude are grouped as "for the future viability map" — this
 * increment's own form covers them (Phase 3's Data Model), but nothing
 * yet renders a map (Increment 4b, dependency-gated).
 */
export function OversightEditForm({
  slug,
  aboutOrgId,
  row,
}: {
  slug: string;
  aboutOrgId: string;
  row: OversightRow;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<OversightFormValues>({
    resolver: zodResolver(oversightSchema),
    defaultValues: defaultValues(row),
  });

  const {
    register,
    formState: { errors, isDirty },
  } = form;

  const { discardOpen, setDiscardOpen, confirmDiscard } =
    useUnsavedChangesGuard(isDirty);

  async function onSubmit(values: OversightFormValues) {
    setSubmitting(true);
    const result = await setCongregationOversightAction(slug, aboutOrgId, {
      viabilityScore: values.viabilityScore ? Number(values.viabilityScore) : null,
      redevelopmentNotes: values.redevelopmentNotes || null,
      buildingsNotes: values.buildingsNotes || null,
      insuranceCarrier: values.insuranceCarrier || null,
      insuranceExpiresOn: values.insuranceExpiresOn || null,
      latitude: values.latitude !== "" ? Number(values.latitude) : null,
      longitude: values.longitude !== "" ? Number(values.longitude) : null,
    });
    setSubmitting(false);

    if (result.ok) {
      toast.success("Oversight record saved.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-xl space-y-4">
      <div>
        <Label htmlFor="oversight-viability">Viability</Label>
        <select
          id="oversight-viability"
          className={`${SELECT_CLASSES} mt-1`}
          {...register("viabilityScore")}
        >
          <option value="">Not yet assessed</option>
          <option value="1">1 — At risk</option>
          <option value="2">2 — Fair</option>
          <option value="3">3 — Healthy</option>
        </select>
        {errors.viabilityScore && (
          <p className="mt-1 text-sm text-destructive">
            {errors.viabilityScore.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="oversight-redevelopment">Redevelopment notes</Label>
        <Textarea
          id="oversight-redevelopment"
          rows={4}
          className="mt-1"
          {...register("redevelopmentNotes")}
        />
        {errors.redevelopmentNotes && (
          <p className="mt-1 text-sm text-destructive">
            {errors.redevelopmentNotes.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="oversight-buildings">Buildings notes</Label>
        <Textarea
          id="oversight-buildings"
          rows={4}
          className="mt-1"
          {...register("buildingsNotes")}
        />
        {errors.buildingsNotes && (
          <p className="mt-1 text-sm text-destructive">
            {errors.buildingsNotes.message}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="oversight-insurance-carrier">Insurance carrier</Label>
          <Input
            id="oversight-insurance-carrier"
            type="text"
            className="mt-1"
            {...register("insuranceCarrier")}
          />
          {errors.insuranceCarrier && (
            <p className="mt-1 text-sm text-destructive">
              {errors.insuranceCarrier.message}
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="oversight-insurance-expires">Insurance expires</Label>
          <Input
            id="oversight-insurance-expires"
            type="date"
            className="mt-1"
            {...register("insuranceExpiresOn")}
          />
          {errors.insuranceExpiresOn && (
            <p className="mt-1 text-sm text-destructive">
              {errors.insuranceExpiresOn.message}
            </p>
          )}
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          Map coordinates (for a future viability map)
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="oversight-latitude">Latitude</Label>
            <Input
              id="oversight-latitude"
              type="number"
              step="any"
              className="mt-1"
              {...register("latitude")}
            />
            {errors.latitude && (
              <p className="mt-1 text-sm text-destructive">
                {errors.latitude.message}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="oversight-longitude">Longitude</Label>
            <Input
              id="oversight-longitude"
              type="number"
              step="any"
              className="mt-1"
              {...register("longitude")}
            />
            {errors.longitude && (
              <p className="mt-1 text-sm text-destructive">
                {errors.longitude.message}
              </p>
            )}
          </div>
        </div>
      </fieldset>

      <Button type="submit" disabled={submitting} className="min-h-11">
        {submitting ? "Saving…" : "Save"}
      </Button>
      <UnsavedChangesDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirmDiscard={confirmDiscard}
      />
    </form>
  );
}
