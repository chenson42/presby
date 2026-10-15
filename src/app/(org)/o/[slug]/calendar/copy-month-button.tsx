"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shared/use-hydrated";
import { copiedMessage } from "@/lib/calendar/clipboard";

/**
 * Copies the displayed month to the clipboard as an HTML table plus a plain
 * text fallback, for pasting into a bulletin or newsletter. The server has
 * already dropped members-only and cancelled rows, so the strings below never
 * contain them.
 *
 * DISABLED UNTIL HYDRATED (F129): a click before React attaches its handler
 * would be silently lost. The click handler is SYNCHRONOUS from its first
 * statement to `navigator.clipboard.write` - iOS Safari requires the write to
 * be traceable to the gesture, so nothing is awaited first. The HTML string is
 * never rendered into the DOM.
 */
export function CopyMonthButton({
  html,
  text,
  leftOutCount,
  filterLabel,
}: {
  html: string;
  text: string;
  leftOutCount: number;
  filterLabel: string | null;
}) {
  const hydrated = useHydrated();

  function handleClick() {
    try {
      if (
        typeof navigator === "undefined" ||
        !navigator.clipboard?.write ||
        typeof ClipboardItem === "undefined"
      ) {
        toast.error("Your browser can't copy to the clipboard.");
        return;
      }
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      });
      navigator.clipboard.write([item]).then(
        () => toast.success(copiedMessage(leftOutCount, filterLabel)),
        () => toast.error("Couldn't copy the calendar. Try again."),
      );
    } catch {
      toast.error("Couldn't copy the calendar. Try again.");
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="min-h-11"
      disabled={!hydrated}
      onClick={handleClick}
      data-testid="copy-month"
    >
      <Copy className="size-4" aria-hidden />
      Copy month
    </Button>
  );
}
