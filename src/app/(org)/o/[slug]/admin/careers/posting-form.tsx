"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { RequiredMark } from "@/components/shared/required-mark";
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";
import { useUnsavedChangesGuard } from "@/components/shared/use-unsaved-changes-guard";
import { EMPLOYMENT_TYPES, LOCATION_MAX, SUMMARY_MAX, TITLE_MAX, employmentTypeLabel } from "@/lib/careers/contract";
import { closingDatePassed } from "@/lib/careers/dates";
import { GENERIC_MESSAGE, STALE_MESSAGE } from "@/lib/careers/messages";
import type { PostingRow } from "@/lib/careers/postings";
import { slugFromTitle } from "@/lib/careers/slug";
import { createPostingAction, updatePostingAction } from "./actions";
import { DescriptionEditor } from "./description-editor";
import {
  CLOSING_DATE_INPUT_MAX,
  CLOSING_DATE_INPUT_MIN,
  centsToField,
  postingFormSchema,
  toPostingInput,
  type PostingFormValues,
} from "./posting-schema";
import { StatusControls } from "./status-controls";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

const HINT = "mt-1 text-sm text-muted-foreground";
const ERROR = "mt-1 text-sm text-destructive";

function defaultsFor(posting: PostingRow | undefined): PostingFormValues {
  if (!posting) {
    return {
      title: "",
      location: "",
      employmentType: "full_time",
      payMin: "",
      payMax: "",
      payUnit: "hour",
      summary: "",
      closingDate: "",
      slug: "",
      descriptionMd: "",
    };
  }
  return {
    title: posting.title,
    location: posting.location,
    employmentType: posting.employmentType,
    payMin: centsToField(posting.payMinCents),
    payMax: centsToField(posting.payMaxCents),
    payUnit: posting.payUnit ?? "hour",
    summary: posting.summary,
    closingDate: posting.closingDate ?? "",
    slug: posting.slug,
    descriptionMd: posting.descriptionMd,
  };
}

/**
 * Creates or edits ONE job posting (docs/work-log/2026-10-25-careers-inc1.md, Phase 3;
 * Copy S6, S8). `react-hook-form` + the string-valued `postingFormSchema`
 * (`docs/ui-standards.md`: well past the four-field threshold), behind `HydrationGate`
 * (DECISION-159 - react-hook-form writes `defaultValues` over the live DOM when it
 * attaches, so nothing typed before hydration may be accepted).
 *
 * The server is the real gate: `updatePostingAction` re-parses with the same rules,
 * runs `validateDescription`, and the lib and database enforce the rest. This form's job
 * is to put the Copy S6 error next to the field before a round trip.
 *
 * EDIT. The page keys this component on `id-version`, so a successful save (or a status
 * change) re-renders the server page and REMOUNTS the form on the new version with fresh
 * defaults. A STALE save (`result.error === STALE_MESSAGE`: somebody else changed the
 * opening after this page loaded) writes nothing, keeps the typed text on screen and
 * shows the message with a "Reload" button that the person presses when ready.
 *
 * THE WEB ADDRESS (slug) is editable only until the first publish; after that the field
 * is read-only (the trigger refuses a change, and a saved or shared link must keep
 * working), and the update input omits it. On create a blank address is generated from
 * the title on the server; the field's placeholder shows the one it will use.
 *
 * Status changes (Publish, Close, Reopen, Discard) live in `StatusControls`, rendered
 * under the form. `prepare` hands it a save-first step for the two changes that make the
 * posting public.
 */
export function PostingForm({
  slug,
  posting,
  orgToday = "",
}: {
  slug: string;
  /** Present when editing. */
  posting?: PostingRow;
  /** The organization's own today, for the Reopen note. */
  orgToday?: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [stale, setStale] = useState(false);

  const form = useForm<PostingFormValues>({
    resolver: zodResolver(postingFormSchema),
    defaultValues: defaultsFor(posting),
  });
  const {
    register,
    control,
    formState: { errors, isDirty },
  } = form;
  const { discardOpen, setDiscardOpen, confirmDiscard } = useUnsavedChangesGuard(isDirty);

  const slugLocked = posting !== undefined && posting.firstPublishedAt !== null;
  const title = useWatch({ control, name: "title" });
  const slugPlaceholder = slugFromTitle(title);
  const isDraftLike = posting === undefined || posting.status === "draft";

  /** Saves the edits. Returns the new version, or null (having said why). */
  async function saveEdits(values: PostingFormValues): Promise<number | null> {
    if (!posting) return null;
    const input = toPostingInput(values);
    const { slug: _slug, ...rest } = input;
    const result = await updatePostingAction(slug, {
      ...(slugLocked ? rest : input),
      id: posting.id,
      version: posting.version,
    });
    if (result.ok) {
      setStale(false);
      return result.data!.version;
    }
    if (result.error === STALE_MESSAGE) {
      setStale(true);
    } else {
      toast.error(result.error);
    }
    return null;
  }

  async function onSubmit(values: PostingFormValues) {
    setSubmitting(true);
    try {
      if (!posting) {
        const result = await createPostingAction(slug, toPostingInput(values));
        if (result.ok) {
          toast.success("Draft saved.");
          router.push(`/o/${slug}/admin/careers/${result.data!.id}`);
          router.refresh();
        } else {
          toast.error(result.error);
        }
        return;
      }
      const version = await saveEdits(values);
      if (version !== null) {
        toast.success("Changes saved.");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  /** For Publish and Reopen: save any unsaved edits first, then hand back the version to change. */
  async function prepare(): Promise<number | null> {
    if (!posting) return null;
    if (!isDirty) return posting.version;
    const valid = await form.trigger();
    if (!valid) {
      toast.error(GENERIC_MESSAGE);
      return null;
    }
    const version = await saveEdits(form.getValues());
    if (version !== null) form.reset(form.getValues());
    return version;
  }

  return (
    <HydrationGate>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <div>
          <Label htmlFor="posting-title">
            Title
            <RequiredMark />
          </Label>
          <Input
            id="posting-title"
            type="text"
            maxLength={TITLE_MAX}
            className="mt-1"
            aria-required="true"
            aria-invalid={errors.title ? "true" : undefined}
            {...register("title")}
          />
          {errors.title && <p className={ERROR}>{errors.title.message}</p>}
        </div>

        <div>
          <Label htmlFor="posting-location">Location</Label>
          <Input id="posting-location" type="text" maxLength={LOCATION_MAX} className="mt-1" {...register("location")} />
          {errors.location && <p className={ERROR}>{errors.location.message}</p>}
        </div>

        <div>
          <Label htmlFor="posting-type">Type</Label>
          <div className="relative mt-1">
            <select id="posting-type" className={SELECT_CLASSES} {...register("employmentType")}>
              {EMPLOYMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {employmentTypeLabel(type)}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
        </div>

        <fieldset className="space-y-3">
          <legend id="posting-pay-legend" className="text-sm font-medium">
            Pay (optional)
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="posting-pay-min">Lowest</Label>
              <Input
                id="posting-pay-min"
                type="text"
                inputMode="decimal"
                className="mt-1"
                aria-invalid={errors.payMin ? "true" : undefined}
                {...register("payMin")}
              />
              {errors.payMin && <p className={ERROR}>{errors.payMin.message}</p>}
            </div>
            <div>
              <Label htmlFor="posting-pay-max">Highest</Label>
              <Input
                id="posting-pay-max"
                type="text"
                inputMode="decimal"
                className="mt-1"
                aria-invalid={errors.payMax ? "true" : undefined}
                {...register("payMax")}
              />
              {errors.payMax && <p className={ERROR}>{errors.payMax.message}</p>}
            </div>
            <div>
              {/* The legend names the group; the unit has no label of its own in the copy. */}
              <div className="relative sm:mt-[1.625rem]">
                <select
                  id="posting-pay-unit"
                  aria-labelledby="posting-pay-legend"
                  className={SELECT_CLASSES}
                  {...register("payUnit")}
                >
                  <option value="hour">per hour</option>
                  <option value="year">per year</option>
                </select>
                <ChevronDown
                  className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
              </div>
              {errors.payUnit && <p className={ERROR}>{errors.payUnit.message}</p>}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Leave blank if you don&apos;t want to show pay.</p>
        </fieldset>

        <div>
          <Label htmlFor="posting-summary">Short summary</Label>
          <Textarea
            id="posting-summary"
            rows={3}
            maxLength={SUMMARY_MAX}
            className="mt-1"
            aria-describedby="posting-summary-hint"
            {...register("summary")}
          />
          <p id="posting-summary-hint" className={HINT}>
            One or two sentences shown in the list of openings. Up to 300 characters.
          </p>
          {errors.summary && <p className={ERROR}>{errors.summary.message}</p>}
        </div>

        <div>
          <Label htmlFor="posting-closing-date">Closing date (optional)</Label>
          <Input
            id="posting-closing-date"
            type="date"
            min={CLOSING_DATE_INPUT_MIN}
            max={CLOSING_DATE_INPUT_MAX}
            className="mt-1 sm:max-w-xs"
            aria-describedby="posting-closing-date-hint"
            aria-invalid={errors.closingDate ? "true" : undefined}
            {...register("closingDate")}
          />
          <p id="posting-closing-date-hint" className={HINT}>
            The last day you will accept applications. Leave blank to keep it open until you close it.
          </p>
          {errors.closingDate && <p className={ERROR}>{errors.closingDate.message}</p>}
        </div>

        <div>
          <Label htmlFor="posting-slug">Web address</Label>
          <div className="mt-1 flex items-center gap-2">
            <span className="shrink-0 text-sm text-muted-foreground">…/careers/</span>
            <Input
              id="posting-slug"
              type="text"
              className="min-w-0 flex-1"
              placeholder={slugLocked ? undefined : slugPlaceholder}
              readOnly={slugLocked}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby="posting-slug-hint"
              aria-invalid={errors.slug ? "true" : undefined}
              {...register("slug")}
            />
          </div>
          <p id="posting-slug-hint" className={HINT}>
            {slugLocked
              ? "The web address can't be changed after an opening is published, because people may have saved or shared it."
              : "Used in this opening's web address. Letters, numbers and dashes. This can't be changed after you publish."}
          </p>
          {errors.slug && <p className={ERROR}>{errors.slug.message}</p>}
        </div>

        <Controller
          control={control}
          name="descriptionMd"
          render={({ field }) => <DescriptionEditor value={field.value} onChange={field.onChange} />}
        />

        {stale && (
          <div
            role="alert"
            data-testid="posting-stale"
            className="space-y-3 rounded-md border border-destructive/40 p-4 text-sm"
          >
            <p>{STALE_MESSAGE}</p>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        )}

        <Button type="submit" disabled={submitting} className="min-h-11">
          {isDraftLike ? "Save draft" : "Save changes"}
        </Button>
        <UnsavedChangesDialog open={discardOpen} onOpenChange={setDiscardOpen} onConfirmDiscard={confirmDiscard} />
      </form>

      {posting && (
        <div className="mt-8 border-t border-border pt-6">
          <StatusControls
            slug={slug}
            postingId={posting.id}
            title={posting.title}
            version={posting.version}
            status={posting.status}
            neverPublished={posting.status === "closed" && posting.firstPublishedAt === null}
            closingDatePassed={closingDatePassed(posting.closingDate, orgToday)}
            prepare={prepare}
          />
        </div>
      )}
    </HydrationGate>
  );
}
