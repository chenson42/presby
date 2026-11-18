"use client";

import { useState, type ClipboardEvent } from "react";
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
import { mappablePair, parseCoordinateField, splitPastedPair } from "@/lib/coordinates";
import type { OversightRow } from "@/lib/presbytery";
import { oversightSchema, type OversightFormValues } from "./oversight-schema";
import { setCongregationOversightAction } from "./actions";
import { HydrationGate } from "@/components/shared/hydration-gate";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

function defaultValues(row: OversightRow): OversightFormValues {
  return {
    viabilityScore: row.viabilityScore ? (String(row.viabilityScore) as "1" | "2" | "3") : "",
    redevelopmentNotes: row.redevelopmentNotes ?? "",
    buildingsNotes: row.buildingsNotes ?? "",
    latitude: row.latitude ?? "",
    longitude: row.longitude ?? "",
  };
}

/** "" is no number; the schema has already refused anything that is not decimal text. */
function toNumberOrNull(text: string): number | null {
  const parsed = parseCoordinateField(text);
  return parsed.kind === "number" ? parsed.value : null;
}

/**
 * Records/updates the presbytery's own assessment of ONE member
 * congregation — Increment 3. `react-hook-form` + `zod`, same pattern as
 * `../../credentials/record-appointment-form.tsx`.
 *
 * Latitude/longitude ("Map location") place the congregation on the
 * presbytery's Insights & Analytics map (Increment 4b, DECISION-343). Both are
 * plain text, not `type="number"`: a number input discards a pasted
 * "39.9612, -82.9988", which a maps application copies as one string and which
 * `splitPastedPair` splits into the two boxes. No `inputMode` either: the iOS
 * decimal keypad has no minus key and a US longitude is negative. The pair
 * rules (both or neither; not exactly 0 and 0) are the server's too, from the
 * one rule in `src/lib/coordinates.ts`. `mapOn` (the oversight page computes it:
 * Insights is on and a tile key is configured) decides whether the save toast
 * may say where the pin shows.
 */
export function OversightEditForm({
  slug,
  aboutOrgId,
  row,
  mapOn = false,
}: {
  slug: string;
  aboutOrgId: string;
  row: OversightRow;
  mapOn?: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [pasteNote, setPasteNote] = useState(false);

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

  function onCoordinatePaste(event: ClipboardEvent<HTMLInputElement>) {
    const pair = splitPastedPair(event.clipboardData.getData("text"));
    if (!pair) return; // an ordinary paste is left alone
    event.preventDefault();
    form.setValue("latitude", pair.latitude, { shouldDirty: true, shouldValidate: true });
    form.setValue("longitude", pair.longitude, { shouldDirty: true, shouldValidate: true });
    setPasteNote(true);
  }

  async function onSubmit(values: OversightFormValues) {
    const latitude = toNumberOrNull(values.latitude);
    const longitude = toNumberOrNull(values.longitude);
    setSubmitting(true);
    const result = await setCongregationOversightAction(slug, aboutOrgId, {
      viabilityScore: values.viabilityScore ? Number(values.viabilityScore) : null,
      redevelopmentNotes: values.redevelopmentNotes || null,
      buildingsNotes: values.buildingsNotes || null,
      latitude,
      longitude,
    });
    setSubmitting(false);

    if (result.ok) {
      toast.success(
        "Oversight record saved.",
        mapOn && mappablePair(latitude, longitude)
          ? { description: "Congregations with a location are shown on the map in Insights & Analytics." }
          : undefined,
      );
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <HydrationGate>
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
          <Label htmlFor="oversight-buildings">Property notes</Label>
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

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Map location</legend>
          <p className="text-sm text-muted-foreground">
            Optional. Enter both numbers, or leave both blank. To fill both at once, paste a pair such as
            39.9612, -82.9988 into either box.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="oversight-latitude">Latitude</Label>
              <Input
                id="oversight-latitude"
                type="text"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="oversight-latitude-hint"
                aria-invalid={errors.latitude ? true : undefined}
                className="mt-1"
                {...register("latitude", { onChange: () => setPasteNote(false) })}
                onPaste={onCoordinatePaste}
              />
              <p id="oversight-latitude-hint" className="mt-1 text-sm text-muted-foreground">
                Decimal degrees between -90 and 90, for example 39.9612. Enter this first.
              </p>
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
                type="text"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="oversight-longitude-hint"
                aria-invalid={errors.longitude ? true : undefined}
                className="mt-1"
                {...register("longitude", { onChange: () => setPasteNote(false) })}
                onPaste={onCoordinatePaste}
              />
              <p id="oversight-longitude-hint" className="mt-1 text-sm text-muted-foreground">
                Decimal degrees between -180 and 180. Congregations in the United States have a negative
                longitude, for example -82.9988.
              </p>
              {errors.longitude && (
                <p className="mt-1 text-sm text-destructive">
                  {errors.longitude.message}
                </p>
              )}
            </div>
          </div>
          <div role="status" className="empty:hidden">
            {pasteNote && (
              <p className="text-sm text-muted-foreground">
                Filled latitude and longitude from the pasted pair. Check them before you save.
              </p>
            )}
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
    </HydrationGate>
  );
}
