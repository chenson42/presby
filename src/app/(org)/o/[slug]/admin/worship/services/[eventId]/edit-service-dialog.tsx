"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SERVICES_COPY } from "@/lib/worship/copy";
import { ServiceForm } from "../service-form";

/** "Edit details" (Copy G4): the title, time and place in a Dialog. The teams that serve are changed on the page itself. */
export function EditServiceDialog({
  slug,
  service,
}: {
  slug: string;
  service: { eventId: string; title: string; startsAt: string; endsAt: string | null; location: string | null };
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11" data-testid="edit-service-open">
          {SERVICES_COPY.page.editDetails}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{SERVICES_COPY.page.editDetails}</DialogTitle>
          <DialogDescription className="sr-only">{SERVICES_COPY.page.editDetails}</DialogDescription>
        </DialogHeader>
        <ServiceForm slug={slug} mode="edit" existing={service} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
