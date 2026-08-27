import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A connected row of link-styled buttons — a segmented view-switcher, not a
 * `role="tablist"` (these are real `GET` navigations, each its own URL and
 * page load, matching `directory-nav.tsx`'s own "a `<Link>` row, not a
 * client tab switcher" rule; `role="group"` is the correct ARIA shape for a
 * set of buttons, `tablist` implies panel-swapping this isn't).
 *
 * Deliberately not built on `@radix-ui/react-toggle-group` — the visual
 * effect (adjacent buttons sharing one outer border, no gap) is a plain
 * Tailwind composition (`rounded-none` on every item, a border between
 * adjacent items, `overflow-hidden` + `rounded-md` on the group to clip the
 * end corners), and this is link navigation, not toggleable state a real
 * toggle-group primitive exists to manage. No new dependency for a look
 * `Button` already gets most of the way to.
 *
 * Each item overrides `shadow-none hover:shadow-none` (docs/work-log/
 * 2026-08-27-button-modernization.md Phase 3(d)): once `Button`'s `outline`
 * variant gained `hover:shadow-sm`, every inactive segment in this connected
 * row would independently float on hover, breaking the "one control, no
 * gaps" look this component exists to produce. Same mechanism the group
 * already uses to zero out `border` before re-adding `border-l`.
 */
export interface ButtonGroupItem {
  key: string;
  label: string;
  href: string;
  icon?: LucideIcon;
  active?: boolean;
  "aria-current"?: "page";
}

export function ButtonGroup({
  items,
  "aria-label": ariaLabel,
  className,
}: {
  items: ButtonGroupItem[];
  "aria-label": string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex flex-wrap overflow-hidden rounded-md border border-border",
        className,
      )}
    >
      {items.map((item, index) => (
        <Button
          key={item.key}
          asChild
          variant={item.active ? "default" : "outline"}
          size="sm"
          className={cn(
            "min-h-11 rounded-none border-0 shadow-none hover:shadow-none",
            index > 0 && "border-l border-border",
          )}
        >
          <Link href={item.href} aria-current={item["aria-current"]}>
            {item.icon ? <item.icon className="size-4 shrink-0" aria-hidden /> : null}
            {item.label}
          </Link>
        </Button>
      ))}
    </div>
  );
}
