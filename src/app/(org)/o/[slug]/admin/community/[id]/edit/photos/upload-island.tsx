"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { REFUSAL_COPY, UPLOAD_COPY, UPLOAD_REJECTED_COPY } from "@/lib/person-photos/copy";
import { addPersonPhotoAction } from "./actions";
import { DownscaleError, downscaleToJpeg } from "./downscale";

type Stage = "idle" | "preparing" | "uploading";

/**
 * The upload control on the photos page (docs/work-log/
 * 2026-10-26-person-photos-inc1.md, Phase 3; Copy C3). A file input with NO
 * `capture` attribute, so a phone offers both the camera and the library.
 *
 * Wrapped in `<HydrationGate>` although it has no `useForm`: a file chosen
 * before hydration would post the ORIGINAL, un-downscaled picture (a native
 * submit never runs `downscale.ts`), so the input and the button stay disabled
 * until the page is live (DECISION-159). There is no `<form>` at all: the
 * change handler downscales, builds the `FormData` and calls the action.
 *
 * Shows NO local preview (the CSP has no `blob:`; `downscale.ts`): the result
 * appears when the action revalidates the page. ANY rejection of the action
 * call, including the framework's 413 and a dropped connection, maps to the
 * one fixed string; no raw error text is ever shown.
 */
export function UploadIsland({
  slug,
  personId,
  firstName,
  disabled = false,
}: {
  slug: string;
  personId: string;
  firstName: string;
  /** The person appears to be under 18: adding is not offered. */
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const busy = stage !== "idle";

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setStage("preparing");
    try {
      let prepared: File;
      try {
        prepared = await downscaleToJpeg(file);
      } catch (err) {
        const kind = err instanceof DownscaleError ? err.kind : "undecodable";
        toast.error(kind === "too_big" ? REFUSAL_COPY.too_large(firstName) : REFUSAL_COPY.unsupported_type(firstName));
        return;
      }
      setStage("uploading");
      const body = new FormData();
      body.append("photo", prepared, prepared.name);
      let result;
      try {
        result = await addPersonPhotoAction(slug, personId, body);
      } catch {
        toast.error(UPLOAD_REJECTED_COPY);
        return;
      }
      if (result.ok) {
        toast.success(result.data?.usedForDirectory ? UPLOAD_COPY.addedDirectory(firstName) : UPLOAD_COPY.added);
      } else {
        toast.error(result.error);
      }
    } finally {
      // Clearing the value lets the same file be chosen again after a failure.
      input.value = "";
      setStage("idle");
    }
  }

  return (
    <HydrationGate>
      <div className="space-y-2">
        <Label htmlFor="person-photo-input">{UPLOAD_COPY.label}</Label>
        <input
          ref={inputRef}
          id="person-photo-input"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="sr-only"
          tabIndex={-1}
          disabled={disabled || busy}
          onChange={onChange}
        />
        <div>
          <Button
            type="button"
            className="min-h-11"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
          >
            {UPLOAD_COPY.button}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{UPLOAD_COPY.helper}</p>
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
          {stage === "preparing" ? UPLOAD_COPY.preparing : stage === "uploading" ? UPLOAD_COPY.uploading : ""}
        </p>
      </div>
    </HydrationGate>
  );
}
