"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { EventTypeIcon } from "@/components/org-portal/event-types/event-type-icon";
import { EventTypeSwatch } from "@/components/org-portal/event-types/event-type-swatch";
import type { EventTypeRow } from "@/lib/event-types";
import { moveEventTypeAction, setEventTypeActiveAction } from "./actions";
import { EventTypeForm } from "./event-type-form";

/**
 * One card per event type. The default type is listed last and has no move
 * controls and no way to retire it (its switch is disabled and says why).
 * Each row owns its pending state, so changing one never freezes the rest.
 *
 * `Switch` alone is ~18x32px, under the 44px touch-target floor, so the label
 * and switch sit in a `min-h-11` row (the `features-list.tsx` discipline).
 */
export function EventTypeList({ slug, types }: { slug: string; types: EventTypeRow[] }) {
  const movable = types.filter((t) => !t.isFallback);
  return (
    <ul className="space-y-3">
      {types.map((type) => {
        const index = movable.findIndex((t) => t.id === type.id);
        return (
          <li key={type.id}>
            <EventTypeRowCard
              slug={slug}
              type={type}
              isFirst={index === 0}
              isLast={index === movable.length - 1}
            />
          </li>
        );
      })}
    </ul>
  );
}

function EventTypeRowCard({
  slug,
  type,
  isFirst,
  isLast,
}: {
  slug: string;
  type: EventTypeRow;
  isFirst: boolean;
  isLast: boolean;
}) {
  const router = useRouter();
  const [active, setActive] = useState(type.isActive);
  const [pending, setPending] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  async function handleActiveChange(next: boolean) {
    setPending(true);
    const previous = active;
    setActive(next);
    const result = await setEventTypeActiveAction(slug, type.id, next);
    setPending(false);
    if (result.ok) {
      toast.success(next ? `${type.name} is offered again.` : `${type.name} retired.`);
      router.refresh();
    } else {
      setActive(previous);
      toast.error(result.error);
    }
  }

  async function handleMove(direction: "up" | "down") {
    setPending(true);
    const result = await moveEventTypeAction(slug, type.id, direction);
    setPending(false);
    if (result.ok) {
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <EventTypeSwatch colorToken={type.color} />
            <EventTypeIcon iconKey={type.icon} />
            <h3 className="text-base font-medium break-words">{type.name}</h3>
            {type.isFallback && (
              <Badge variant="secondary" className="text-sm">
                Default
              </Badge>
            )}
            {!active && (
              <Badge variant="outline" className="text-sm">
                Retired
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Used by {type.usageCount} {type.usageCount === 1 ? "event" : "events"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" className="min-h-11" disabled={pending}>
                <Pencil className="size-4" aria-hidden />
                Edit
                <span className="sr-only"> {type.name}</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90dvh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Edit event type</DialogTitle>
                <DialogDescription>
                  Changes apply to every event of this type.
                </DialogDescription>
              </DialogHeader>
              <EventTypeForm
                slug={slug}
                mode="edit"
                isFallback={type.isFallback}
                initial={{ id: type.id, name: type.name, color: type.color, icon: type.icon }}
                onDone={() => setEditOpen(false)}
              />
            </DialogContent>
          </Dialog>

          {!type.isFallback && (
            <>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="min-h-11 min-w-11"
                aria-label={`Move ${type.name} up`}
                title={`Move ${type.name} up`}
                disabled={pending || isFirst}
                onClick={() => handleMove("up")}
              >
                <ArrowUp className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="min-h-11 min-w-11"
                aria-label={`Move ${type.name} down`}
                title={`Move ${type.name} down`}
                disabled={pending || isLast}
                onClick={() => handleMove("down")}
              >
                <ArrowDown className="size-4" aria-hidden />
              </Button>
            </>
          )}

          <div>
            <label className="inline-flex min-h-11 items-center gap-2 text-sm">
              <span aria-hidden="true">Offered</span>
              <Switch
                aria-label={`Offered (${type.name})`}
                checked={active}
                disabled={pending || type.isFallback}
                onCheckedChange={handleActiveChange}
              />
            </label>
            {type.isFallback && (
              <p className="text-sm text-muted-foreground">The default type can&apos;t be retired.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
