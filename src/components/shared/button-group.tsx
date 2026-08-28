import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A segmented view-switcher tray — a rounded, muted "tray" container holding
 * every segment, with the active one rendered as a raised pill inside it
 * (the common iOS-style segmented control, docs/work-log/
 * 2026-08-28-directory-visual-refresh.md, Phase 4, item 2). NOT a
 * `role="tablist"` (these are real `GET` navigations, each its own URL and
 * page load, matching `directory-nav.tsx`'s own "a `<Link>` row, not a
 * client tab switcher" rule; `role="group"` is the correct ARIA shape for a
 * set of buttons, `tablist` implies panel-swapping this isn't).
 *
 * Deliberately not built on `@radix-ui/react-toggle-group`, and deliberately
 * not a generated shadcn `Tabs` either (checked: `npm run ui:add tabs` would
 * produce Radix's `Tabs.Root`/`Tabs.List`/`Tabs.Trigger`/`Tabs.Content`,
 * which OWNS which panel is shown — exactly the client-side state model this
 * component exists to avoid, since every segment here is its own page load,
 * not a panel Tabs would show/hide). The tray-plus-pill LOOK is a plain
 * Tailwind composition on top of the existing `Button` primitive (`ghost`
 * variant for every segment, a `bg-background shadow-sm` override on the
 * active one) — no new dependency, no hand-rolled button shape (Component
 * Rule 5): the primitive is reused, not reconstructed.
 *
 * PRIOR SHAPE (through 2026-08-27): a connected, no-gap row — `rounded-none`
 * segments sharing one outer border, the active one solid `bg-primary`. That
 * read as "one flat teal button next to two plain bordered ones," not a
 * single control (operator screenshot comparison against `../fpcw-
 * directory`'s own Members/Households/Parishes tabs). The tray/pill
 * restructure replaces the shared-border/no-gap technique with a padded
 * `bg-muted` tray and independently-rounded pill segments — the
 * `shadow-none hover:shadow-none` override below still matters for the same
 * reason it did before: `ghost` carries no shadow of its own, but the
 * ACTIVE segment's `shadow-sm` must not also gain `Button`'s hover-lift
 * transition classes fighting the tray's own flat-until-active language.
 *
 * `overflow-x-auto` + `flex-nowrap`, NOT `flex-wrap` — caught in Phase 4's
 * own live-browser verification at 375px: three labeled+iconed segments
 * (Members/Households/Parishes) don't fit one row at a phone width, and
 * `rounded-full` on a container that wraps to two rows draws a tall,
 * lopsided stadium shape around both lines rather than the intended pill —
 * worse than the underline treatment it replaced. Horizontal scroll keeps
 * the tray a single row (and therefore a correct stadium) at every width;
 * `shrink-0` on each segment stops the browser from squeezing labels
 * instead of scrolling. Directory's own three-tab case rarely needs to
 * actually scroll at typical phone widths in practice — Parishes is
 * permission-gated and often absent — but the mechanism holds regardless of
 * item count.
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
        "inline-flex max-w-full flex-nowrap items-center gap-1 overflow-x-auto rounded-full bg-muted p-1",
        className,
      )}
    >
      {items.map((item) => (
        <Button
          key={item.key}
          asChild
          variant="ghost"
          size="sm"
          className={cn(
            "min-h-11 shrink-0 rounded-full border-0 shadow-none hover:shadow-none",
            item.active
              ? "bg-background text-foreground shadow-sm hover:bg-background"
              : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
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
