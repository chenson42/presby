"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shared/use-hydrated";
import { movePostingAction } from "./actions";

/**
 * "Move up" and "Move down" for ONE published row (Copy S7). Only published postings
 * are orderable, so the list renders these on published rows only. Icon-only 44px
 * buttons whose accessible names carry the title ("Move {title} up"), because a list of
 * identical "Move up" names tells a screen-reader user nothing.
 *
 * `disabled` until the page has hydrated (DECISION-159): a click before the handler is
 * attached would do nothing and look like a broken button. The result is announced by a
 * visually hidden live region ("Moved {title} up."), not a toast, so a reorder does not
 * cover the list the person is rearranging. A refused move (permission, toggle, stale
 * row) is the one case that toasts, with the returned error text.
 */
export function MovePostingButtons({
  slug,
  postingId,
  title,
  isFirst,
  isLast,
}: {
  slug: string;
  postingId: string;
  title: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  async function move(direction: "up" | "down") {
    setPending(true);
    setAnnouncement("");
    const result = await movePostingAction(slug, { id: postingId, direction });
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (result.data?.moved) {
      setAnnouncement(`Moved ${title} ${direction}.`);
      router.refresh();
    }
  }

  const disabled = !hydrated || pending;

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-11"
        aria-label={`Move ${title} up`}
        disabled={disabled || isFirst}
        onClick={() => move("up")}
      >
        <ChevronUp aria-hidden />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-11"
        aria-label={`Move ${title} down`}
        disabled={disabled || isLast}
        onClick={() => move("down")}
      >
        <ChevronDown aria-hidden />
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
