"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HydrationGate } from "@/components/shared/hydration-gate";
import type { PhotoStateSnapshot } from "@/lib/person-photos/consequences";
import { PAGE_COPY } from "@/lib/person-photos/copy";
import { ConfirmDialog } from "./confirm-dialogs";
import { DesignateDialog } from "./designate-dialog";

type Which = "designate_directory" | "designate_website" | "stop_directory" | "stop_website" | "remove";

/**
 * The buttons under one photo tile and the dialogs they open (Copy C2, C4, C5).
 * One button per thing that can be done to THIS photo: choose or stop using it
 * for the directory, choose or stop using it for the website, and remove it.
 * `HydrationGate` keeps them inoperable until the page is live (DECISION-159);
 * the dialogs portal out of it, so they stay usable once opened.
 *
 * The group is labelled with the tile's own alt text so a screen reader hears
 * which photo "Remove" belongs to when a person has several.
 */
export function TileControls({
  slug,
  personId,
  photoId,
  label,
  isDirectory,
  isWebsite,
  name,
  state,
}: {
  slug: string;
  personId: string;
  photoId: string;
  label: string;
  isDirectory: boolean;
  isWebsite: boolean;
  name: string;
  state: PhotoStateSnapshot;
}) {
  const [open, setOpen] = useState<Which | null>(null);
  const [opened, setOpened] = useState(0);
  const show = (which: Which) => {
    setOpened((n) => n + 1);
    setOpen(which);
  };
  const close = (next: boolean) => {
    if (!next) setOpen(null);
  };

  return (
    <HydrationGate>
      <div role="group" aria-label={label} className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full justify-center"
          onClick={() => show(isDirectory ? "stop_directory" : "designate_directory")}
        >
          {isDirectory ? PAGE_COPY.stopInDirectory : PAGE_COPY.useInDirectory}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full justify-center"
          onClick={() => show(isWebsite ? "stop_website" : "designate_website")}
        >
          {isWebsite ? PAGE_COPY.stopOnWebsite : PAGE_COPY.useOnWebsite}
        </Button>
        <Button type="button" variant="outline" className="min-h-11 w-full justify-center" onClick={() => show("remove")}>
          {PAGE_COPY.remove}
        </Button>
      </div>
      <DesignateDialog
        key={`d-${opened}`}
        slug={slug}
        personId={personId}
        photoId={photoId}
        purpose={open === "designate_website" ? "website" : "directory"}
        state={state}
        name={name}
        open={open === "designate_directory" || open === "designate_website"}
        onOpenChange={close}
      />
      <ConfirmDialog
        slug={slug}
        personId={personId}
        state={state}
        action={
          open === "stop_directory"
            ? { kind: "stop_directory" }
            : open === "stop_website"
              ? { kind: "stop_website" }
              : { kind: "remove", photoId }
        }
        open={open === "stop_directory" || open === "stop_website" || open === "remove"}
        onOpenChange={close}
      />
    </HydrationGate>
  );
}
