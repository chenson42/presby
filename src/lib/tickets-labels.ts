import type {
  ChangeClass,
  TicketArea,
  TicketPriority,
  TicketStatus,
  FeedbackStatus,
} from "@/lib/tickets";

/**
 * Display labels — AND, below, re-declared vocabulary arrays — for the
 * support-tickets controlled vocabularies. A small, deliberate addition
 * beyond Phase 3's written contract (like commit 2's `resolveMeta()`).
 *
 * WHY THE ARRAYS ARE RE-DECLARED HERE RATHER THAN RE-EXPORTED FROM
 * `src/lib/tickets.ts`: that file opens with `import "server-only"`, so
 * importing ANY value from it — even a plain `as const` array — poisons the
 * whole module graph for a `'use client'` component that needs to render a
 * `<select>` (confirmed by a real `next build` failure during this commit,
 * not assumed). Type-only imports (`import type { ChangeClass, ... }`) ARE
 * safe — erased at compile time, never reach the bundler — so every
 * client-side `<select>` in this pipeline imports its TYPES from
 * `@/lib/tickets` and its VALUES (the arrays below) from here. The four
 * arrays must stay byte-identical to `src/lib/tickets.ts`'s own
 * `CHANGE_CLASSES`/`TICKET_AREAS`/`TICKET_PRIORITIES`/`TICKET_STATUSES` —
 * a future edit to one CHECK constraint's allowed values needs both.
 */

export const CHANGE_CLASSES = [
  "content",
  "config",
  "theme",
  "bug",
  "feature",
] as const satisfies readonly ChangeClass[];

export const TICKET_AREAS = [
  "directory",
  "roll",
  "roles",
  "giving",
  "events",
  "website",
  "account",
  "other",
] as const satisfies readonly TicketArea[];

export const TICKET_PRIORITIES = [
  "low",
  "normal",
  "high",
  "urgent",
] as const satisfies readonly TicketPriority[];

export const TICKET_STATUSES = [
  "new",
  "triaged",
  "in_progress",
  "resolved",
  "declined",
] as const satisfies readonly TicketStatus[];

export const CHANGE_CLASS_LABELS: Record<ChangeClass, string> = {
  content: "Content",
  config: "Configuration",
  theme: "Theme",
  bug: "Bug",
  feature: "Feature request",
};

export const TICKET_AREA_LABELS: Record<TicketArea, string> = {
  directory: "Directory",
  roll: "Roll",
  roles: "Roles",
  giving: "Giving",
  events: "Events",
  website: "Website",
  account: "Account",
  other: "Other",
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  new: "New",
  triaged: "Triaged",
  in_progress: "In progress",
  resolved: "Resolved",
  declined: "Declined",
};

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "New",
  promoted: "Promoted",
  dismissed: "Dismissed",
};

/**
 * Badge variant per priority/status value — existing shadcn `Badge` variants
 * only (`default` | `secondary` | `outline` | `destructive`), never a raw
 * Tailwind palette literal (`bg-yellow-100`, etc.). `docs/ui-standards.md`
 * forbids new palette literals outright and names status chips as a known,
 * tracked gap (`docs/TODO.md`) — this pipeline does not add to that debt.
 * Every badge below is always paired with its own text label (never color
 * alone as the signal), matching the Accessibility section's "color alone is
 * not a signal" rule.
 */
export const PRIORITY_BADGE_VARIANT: Record<
  TicketPriority,
  "default" | "secondary" | "outline" | "destructive"
> = {
  urgent: "destructive",
  high: "default",
  normal: "secondary",
  low: "outline",
};

export const STATUS_BADGE_VARIANT: Record<
  TicketStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  new: "outline",
  triaged: "outline",
  in_progress: "secondary",
  resolved: "default",
  declined: "destructive",
};
