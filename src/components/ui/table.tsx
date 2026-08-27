"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * DIVERGENCE FROM THE SHADCN REGISTRY (docs/work-log/
 * 2026-08-26-portal-ux-fixes.md, Wave 1B, finding M1): `table-container`
 * carries a right-edge scroll cue via `TABLE_SCROLL_FADE_STYLE` below.
 * CSS-only, no measurement JS and no added DOM node — the classic
 * "background-attachment: local vs scroll" scroll-shadow technique (Lea
 * Verou). Two stacked background layers on the SAME scrollable element:
 *
 * - `local` layer: an opaque-to-transparent block of `var(--background)`,
 *   pinned to the *content's* right edge (moves with the content because
 *   `background-attachment: local` ties it to the scrollable box's own
 *   content, not its viewport).
 * - `scroll` layer: a subtle shadow gradient pinned to the *container's*
 *   right edge (`background-attachment: scroll` keeps it fixed relative to
 *   the viewport, not the content).
 *
 * When the table does NOT overflow, content-right-edge and
 * container-right-edge are the same point, so the local layer always sits
 * exactly on top of the shadow layer and fully hides it — no cue, ever,
 * regardless of table width. When it DOES overflow, at the (default)
 * scrolled-to-start position the local block sits off past the visible
 * viewport (out at the far content edge) while the shadow stays visible at
 * the container's right edge — the cue. Scrolling to the true end brings the
 * local block back over the shadow and it disappears, matching "there is
 * nothing further to scroll." This is why the fix lives here rather than at
 * each call site: every `Table` consumer gets it for free, and it degrades
 * to nothing on a table that was never going to overflow (verified against
 * `/admin/flags` at desktop, which has no action-column overflow).
 *
 * `var(--background)` is deliberate over a hardcoded color: the ORG tree
 * this primitive also renders in re-declares `--background` per DECISION-046
 * (bounded token), and the fade must track that override, not fight it.
 */
const TABLE_SCROLL_FADE_STYLE: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(to right, transparent, var(--background) 85%), " +
    "linear-gradient(to left, rgba(0, 0, 0, 0.18), transparent)",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right, right",
  backgroundSize: "40px 100%, 24px 100%",
  backgroundAttachment: "local, scroll",
}

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
      style={TABLE_SCROLL_FADE_STYLE}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
