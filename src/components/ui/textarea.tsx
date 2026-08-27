// GENERATED FILE — see `npm run ui:add`. One deliberate divergence from the
// stock shadcn registry output:
// 2026-08-27: light-mode base changed from upstream's `bg-transparent` to
// `bg-background` per docs/ui-standards.md's control standard (`border-input
// bg-background`) — a transparent textarea paints whatever surface it sits
// on (white inside a bg-card panel) and reads as a different, greyer control
// than the native `<select>` sitting next to it with the same border.
// `dark:bg-input/30` is untouched.
// 2026-08-27 (docs/work-log/2026-08-27-control-legibility.md, operator
// legibility decision): dropped the `md:text-sm` downshift for the same
// reason as input.tsx — 16px everywhere, not just below `md:`.
import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
