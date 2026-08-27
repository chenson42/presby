// GENERATED FILE — see `npm run ui:add`. Deliberate divergences from the
// stock shadcn registry output:
// 1. (P0.5 slice a, commit `a4`), the dropdown-menu.tsx way: added
//    `focus-visible:ring-offset-2 focus-visible:ring-offset-background`. See
//    button.tsx's header for the full D4 rationale — it applies identically
//    here.
// 2. 2026-08-27: light-mode base changed from upstream's `bg-transparent` to
//    `bg-background` per docs/ui-standards.md's control standard
//    (`border-input bg-background`) — a transparent input paints whatever
//    surface it sits on (white inside a bg-card panel) and reads as a
//    different, greyer control than the native `<select>` sitting next to it
//    with the same border. `dark:bg-input/30` is untouched.
// 3. 2026-08-27 (docs/work-log/2026-08-27-control-legibility.md, operator
//    legibility decision): dropped the `md:text-sm` downshift. Upstream sets
//    16px on mobile (to stop iOS Safari auto-zooming a focused input) and
//    14px from `md:` up; the operator's mockup review asked for 16px
//    everywhere, so the desktop-only downshift is gone and `text-base` now
//    holds at every breakpoint.
import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
