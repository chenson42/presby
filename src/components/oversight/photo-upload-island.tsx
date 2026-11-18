"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { addBuildingPhotoAction } from "@/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/buildings/[buildingId]/photos/actions";
import { PHOTO_COPY, PHOTO_REFUSAL, TOAST } from "@/lib/oversight/copy";
import { DownscaleError, downscaleToJpeg } from "@/lib/storage/image/downscale";

type Stage = "idle" | "preparing" | "uploading";

/**
 * "Add a photo" (C14): a file input with NO `capture` attribute, so a phone
 * offers both the camera and the library, and no local preview (the CSP has no
 * `blob:`; the picture appears when the page refreshes). The change handler
 * downscales in the browser (the Server Action body limit is under 1 MiB), builds
 * the `FormData` with the one `photo` field and calls the action; there is no
 * `<form>`. Wrapped in `<HydrationGate>`: a file chosen before hydration would
 * never be downscaled (DECISION-159). A client-side failure uses the same
 * refusal strings the server does; a rejected call (the framework's 413, a
 * dropped connection) is the one fixed `uploadFailed` string, never raw text.
 */
export function PhotoUploadIsland({ slug, aboutOrgId, buildingId }: { slug: string; aboutOrgId: string; buildingId: string }) {
  const router = useRouter();
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
        toast.error(kind === "too_big" ? PHOTO_REFUSAL.too_large : PHOTO_REFUSAL.unsupported_type);
        return;
      }
      setStage("uploading");
      const body = new FormData();
      body.append("photo", prepared, prepared.name);
      let result;
      try {
        result = await addBuildingPhotoAction(slug, aboutOrgId, buildingId, body);
      } catch {
        toast.error(PHOTO_COPY.uploadFailed);
        return;
      }
      if (result.ok) {
        toast.success(TOAST.photoAdded);
        router.refresh();
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
        <input
          ref={inputRef}
          id="building-photo-input"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="sr-only"
          tabIndex={-1}
          aria-label={PHOTO_COPY.addPhoto}
          disabled={busy}
          onChange={onChange}
        />
        <Button type="button" className="min-h-11" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? PHOTO_COPY.saving : PHOTO_COPY.addPhoto}
        </Button>
      </div>
    </HydrationGate>
  );
}
