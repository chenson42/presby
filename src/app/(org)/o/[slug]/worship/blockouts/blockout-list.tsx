"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCalendarDay } from "@/components/worship/service-when";
import { ACTION_COPY, MEMBER_COPY } from "@/lib/worship/copy";
import type { BlockoutEntry } from "@/lib/worship/reads";
import { endBlockoutAction } from "../actions";

/** The person's live ranges as cards, each with "Remove" (a 44px target). Empty is an honest empty state. */
export function BlockoutList({ slug, items }: { slug: string; items: BlockoutEntry[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const busy = useRef(false);

  async function remove(blockoutId: string) {
    if (busy.current) return;
    busy.current = true;
    setPendingId(blockoutId);
    try {
      const result = await endBlockoutAction(slug, { blockoutId });
      if (result.ok) {
        toast.success(MEMBER_COPY.blockouts.toastRemoved);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(ACTION_COPY.generic);
    } finally {
      busy.current = false;
      setPendingId(null);
    }
  }

  if (items.length === 0) return <EmptyState title={MEMBER_COPY.blockouts.empty} />;
  return (
    <ul className="space-y-3" data-testid="blockout-list">
      {items.map((item) => (
        <li key={item.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-base [overflow-wrap:anywhere]">
            {MEMBER_COPY.blockouts.row(formatCalendarDay(item.startsOn), formatCalendarDay(item.endsOn), item.reason)}
          </p>
          <Button type="button" variant="outline" className="min-h-11" disabled={pendingId !== null} onClick={() => remove(item.id)}>
            {MEMBER_COPY.blockouts.remove}
          </Button>
        </li>
      ))}
    </ul>
  );
}
