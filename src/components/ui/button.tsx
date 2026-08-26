// GENERATED FILE — see `npm run ui:add`. Deliberate divergences from the
// stock shadcn registry output (P0.5 slice a, work-log
// 2026-08-19-brand-foundation, commit `a4`), the dropdown-menu.tsx way:
//
//   1. Dropped the `xs` / `icon-xs` / `icon-sm` / `icon-lg` size variants and
//      the `data-variant` / `data-size` attributes the registry emits.
//      Verified zero consumers anywhere in `src/` (grep, both the size
//      strings and the data attributes) before deleting — dead variants in a
//      generated file are lost on the next regeneration and not worth
//      recovering.
//   2. Added `focus-visible:ring-offset-2 focus-visible:ring-offset-background`
//      to the base variant. D4 (src/lib/brand/contract.ts) requires the focus
//      ring to clear 3:1 against BOTH the surface and the control it rings;
//      `--ring` equals `--primary`, so a ring drawn flush against the default
//      button is 1.00:1 — invisible, measured and documented in
//      globals.css:76-83. The offset is what makes D4 hold structurally
//      rather than depending on a lucky palette value at every brand seed.
//   3. Dropped `dark:bg-destructive/60` from the `destructive` variant. An
//      alpha-composited fill's rendered colour depends on what's behind it,
//      so it cannot be checked against LEGAL_PAIRS as a property of the pair
//      (contrast.ts's parseColor() rejects alpha notations for exactly this
//      reason) — and the corrected dark `--destructive` (globals.css slice 0)
//      makes the alpha composite unnecessary; the token now clears its own
//      floor without it.
//   4. Added a `tile` variant, not part of the stock registry output
//      (DECISION-104, docs/work-log/2026-08-26-portal-visual-modernization.md
//      Phase 3, revised same day on direct operator visual feedback — the
//      original full-bleed solid `bg-primary` fill read as a flat, unpleasant
//      block of color rather than "modern"). The portal home's tool tiles
//      (`TileGrid`) need a multi-line icon+heading+description+chevron layout
//      — building that as a one-off `className` string on a hand-rolled
//      `<Link>` would fail Component Rule 5/C2 (`check:brand-scope` bans a
//      button/table shape reconstructed outside `src/components/ui/`).
//      `tile` is now a `bg-card` surface with a border and a soft shadow that
//      deepens and lifts slightly on hover — depth communicated by elevation
//      instead of a saturated fill; the brand color moves to the icon badge
//      (`TileGrid` wraps the icon in a small `bg-primary/10 text-primary`
//      chip) so `--primary` still reads on every tile without painting the
//      whole card. `tile` adds the same layout properties as before
//      (`flex-col`, `items-start`, `h-auto`, `whitespace-normal`, `text-left`)
//      plus `rounded-xl` (operator feedback, same day) — a noticeably
//      rounder corner than the base variant's `rounded-md`, since `cn()`'s
//      `twMerge` keeps the later same-group utility.
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import * as Slot from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
        tile: "bg-card text-card-foreground border shadow-sm hover:shadow-lg hover:-translate-y-0.5 hover:border-primary/40 flex-col items-start h-auto whitespace-normal text-left rounded-xl",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
