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
//   5. Added `shadow-xs hover:shadow-sm` to `default` and `hover:shadow-sm` to
//      `outline` (which already carried `shadow-xs`) — the DECISION-105 depth
//      language, scaled down one Tailwind shadow step from `tile`'s
//      `shadow-sm -> hover:shadow-lg` treatment because a control this much
//      smaller than a tile would look garish at `tile`'s elevation
//      (docs/work-log/2026-08-27-button-modernization.md Phase 3(d)). Scoped
//      to `default`/`outline` only, per operator feedback naming the search
//      button and the default action row specifically; `destructive`,
//      `secondary`, `ghost`, `link`, and `tile` are untouched — `tile` already
//      has its own elevation treatment (#4 above).
//      `src/components/shared/button-group.tsx` adds an explicit
//      `shadow-none hover:shadow-none` override on its segment buttons so a
//      connected row of `outline` segments doesn't independently float on
//      hover — see that file's own comment.
//   6. Replaced `disabled:opacity-50` with `disabled:bg-muted
//      disabled:text-muted-foreground` in the shared `base` cva string
//      (`disabled:pointer-events-none` kept as-is). `disabled:opacity-50`
//      over a brand fill reads as a muddy, washed-out version of the brand
//      color rather than "this control is off" — a standing D5 violation
//      ("invisible to a 78-year-old").
//      `muted`/`muted-foreground` is an existing platform-fixed LEGAL_PAIRS
//      entry (7:1, `derives: D1`) — zero contract changes, disabled is a
//      state, not an identity, same reasoning D6 already applies to
//      `destructive`. Because this lands at `base` it reaches every variant
//      uniformly, not just `default`: `outline`/`ghost`/`tile` previously had
//      no solid disabled fill (just 50% opacity over whatever was already
//      there) and now show a flat `bg-muted` box; `link`'s disabled state
//      similarly gains a filled rectangle behind its text where today it has
//      none. Intended and uniform, not scope creep (Phase 3(c)).
//   7. 2026-08-27 (docs/work-log/2026-08-27-control-legibility.md, operator
//      feedback on three live mockups — "i wonder if the font needs to be
//      bigger or bolder on the buttons for older people?"): the shared
//      `base` cva string's `text-sm` (14px) → `text-base` (16px) and
//      `font-medium` (500) → `font-semibold` (600). Lands at `base`, so it
//      reaches every variant including `tile`. None of the `size` variants
//      (`sm`/`lg`/`icon`) declare their own text-size utility — they only
//      set height/padding/gap — so all three inherit the new 16px/600 from
//      `base` unchanged; no proportional bump was needed because there was
//      no existing per-size override to reconcile.
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import * as Slot from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-base font-semibold whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs hover:shadow-sm",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background shadow-xs hover:shadow-sm hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
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
