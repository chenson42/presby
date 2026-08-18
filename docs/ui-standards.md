# UI Standards

Conventions for building consistent, accessible UI across the Claude Code Starter. Every rule below is checkable by reading a diff.

**Scope:** All pages under `src/app/` — auth, account, admin, and anything a fork adds. Exceptions are noted inline.

---

## Contents

- [Page Layout](#page-layout)
- [Page Header & Typography](#page-header--typography)
- [Action Bar](#action-bar)
- [Back Navigation](#back-navigation)
- [Toast Notifications](#toast-notifications)
- [Forms — State Patterns](#forms--state-patterns)
- [Forms — Unsaved Changes Guard](#forms--unsaved-changes-guard)
- [Select & Combobox Patterns](#select--combobox-patterns)
- [Loading & Error States](#loading--error-states)
- [Four-State Component Design](#four-state-component-design)
- [Empty States](#empty-states)
- [Accessibility](#accessibility)
- [CLAUDE.md Invariants (cross-reference)](#claudemd-invariants-cross-reference)
- [Pre-merge UX Audit Checklist](#pre-merge-ux-audit-checklist)

---

## Page Layout

Two patterns. Pick by **content type**, not by whether the page has a back link.

### Full-width — list and browse pages

Used for card grids, multi-column tables, and hub/index pages.

```tsx
return (
  <div className="space-y-6">
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Page Title</h1>
        <p className="text-muted-foreground text-sm">Description</p>
      </div>
      <div className="flex items-center gap-2">
        {/* action bar buttons */}
      </div>
    </div>
    <SomeContent />
  </div>
);
```

### Constrained-width — forms, settings, and detail pages

Used for single-record detail views, settings panels, and form editors. The admin shell pages and account pages use this pattern with `max-w-xl` or `max-w-4xl` depending on content density.

```tsx
return (
  <div className="max-w-2xl space-y-8">
    <h1 className="text-2xl font-semibold">Page Title</h1>
    <SomeForm />
  </div>
);
```

**Never add a second layer of `container`, `py-*`, `px-*`, or `mx-auto` inside a layout that already provides outer padding.** The admin layout (`src/app/(admin)/admin/layout.tsx`) injects `p-8` on `<main>` — pages inside it must not wrap their content in another padding container.

### Choosing the pattern

| Content type | Layout |
|---|---|
| Card grid (multiple records) | Full-width |
| Multi-column table | Full-width |
| Single-record detail | Constrained |
| Form or settings panel | Constrained |
| Simple stacked list (single column) | Constrained |

---

## Page Header & Typography

Every page has a single `<h1>`.

- `text-2xl font-semibold` — matches the existing admin and account pages in this starter.
- Follow `<h1>` immediately with a `<p className="text-sm text-muted-foreground">` description when the purpose of the page is not self-evident.
- Use `text-muted-foreground` (not `text-gray-600`) for secondary text — the starter uses CSS variable tokens throughout.
- Never use `CardTitle` for listing-card headings; use a bare `<h3>` so size is controlled explicitly.

```tsx
<h1 className="text-2xl font-semibold">Users</h1>
<p className="mt-1 text-sm text-muted-foreground">Manage user accounts and role assignments.</p>
```

---

## Action Bar

Every page that has primary actions places them top-right, inside the page header row.

**Rule: text-labeled buttons always come before icon-only buttons.**

```
[Primary action] [Secondary action] | [icon-only] [icon-only]
←— text-labeled ——————————————————→ ←—— icon-only ————————→
```

- Text-labeled buttons use the `default` or `outline` variant. Only shown when the user has the required permission.
- Icon-only utility buttons (settings, insights, help) use `variant="outline"` + `size="icon"` + a `title` attribute for accessibility. These are always icon-only — never add a text label, even when the link target has a different name.
- Icon-only buttons come **after** all text-labeled buttons, always.
- Action buttons (Create, Add, New) live in the action bar — never inside a search toolbar.

```tsx
<div className="flex items-center gap-2">
  {/* 1. Text-labeled action buttons */}
  {canCreate && (
    <button
      onClick={handleCreate}
      className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
    >
      Create item
    </button>
  )}

  {/* 2. Icon-only utility buttons — after all text buttons */}
  {canManage && (
    <a
      href="/admin/settings"
      title="Settings"
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-muted"
    >
      <SettingsIcon className="h-4 w-4" />
    </a>
  )}
</div>
```

---

## Back Navigation

Detail and sub-pages that can be reached from multiple origins use a `?from=<full-path>` convention so the back link always points to the real origin.

### Visual style

Always a plain `<Link>` (or a `<button>` when the target isn't known statically), never a `<Button>` component:

```tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

<Link
  href={backHref}
  className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
>
  <ArrowLeft className="h-4 w-4 mr-1" />
  Back to Users
</Link>
```

When `router.back()` is needed (e.g., the origin is not known at render time), use a native `<button>` with the same classes:

```tsx
"use client";
const router = useRouter();

<button
  onClick={() => router.back()}
  className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
>
  <ArrowLeft className="h-4 w-4 mr-1" />
  Back
</button>
```

### `?from=` URL convention

**Linking page** — append `?from=<current-path>` to any link that may need a back button:

```tsx
<Link href={`/admin/users/${id}?from=/admin/users`}>View user</Link>
```

**Receiving page** — read `from` from `searchParams`, validate it against known path prefixes to prevent open redirect, fall back to a sensible default:

```tsx
export default async function UserDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;

  const backHref =
    from && from.startsWith("/admin")
      ? from
      : "/admin/users"; // safe default

  return (
    <Link href={backHref} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4 mr-1" />
      Back
    </Link>
  );
}
```

**Validation rule:** Only accept `from` values that start with a known path prefix for the page. Unknown or external values must fall back to the hardcoded default. Never pass `from` through without validation.

### Multi-level chains

When an intermediate page receives a `?from=` **and** links to further sub-pages, it must embed its own full URL — including any `?from=` it received — as the `from` value on those outgoing links. Use `encodeURIComponent()` on the value; the receiving page calls `decodeURIComponent()` before validating.

### Pages with a fixed origin

Pages that always navigate back to the same place do not need `?from=`. Just hardcode the `href`:

```tsx
<Link href="/admin" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
  <ArrowLeft className="h-4 w-4 mr-1" />
  Back to Admin
</Link>
```

---

## Toast Notifications

Sonner's `<Toaster>` is already mounted in `src/app/layout.tsx` at `position="top-right"` with `richColors` and `closeButton`. Do not mount it again in nested layouts.

**Pattern: server action → client toast.**

Server actions return `ActionResult<T>` from `src/types/actions.ts`:

```typescript
// { ok: true; data?: T } | { ok: false; error: string }
```

Client components read the result and call the appropriate toast:

```tsx
const result = await updateProfile({ name: value });
if (result.ok) {
  toast.success("Name updated.");
} else {
  toast.error(result.error);
}
```

**Rules:**
- Never call `toast()` inside a `'use server'` function — it is browser-only.
- `toast.success()` — a mutation completed (saves, creates, deletes, role assignments).
- `toast.error()` — a mutation failed (server returned `ok: false`, or network error).
- `toast.info()` — background processes, informational confirmations.
- Keep messages short and action-oriented. Say "Name updated." not "The profile update operation completed successfully."
- The `error` string in `ActionResult` is **end-user-visible** — keep it short and non-technical. "Email already in use." not "UniqueConstraintViolationError: users.email".

---

## Forms — State Patterns

The starter uses plain HTML forms with `useState` and `e.preventDefault()`. This is the default.

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { myServerAction } from "./actions";

export function MyForm({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const result = await myServerAction({ value });
    setPending(false);
    if (result.ok) {
      toast.success("Saved.");
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="field" className="block text-sm font-medium">
          Field label
        </label>
        <input
          id="field"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
```

**When to add `react-hook-form` + `zod`:** When the form has more than four fields, has cross-field validation, or when per-field error display becomes unwieldy with plain `useState`. Add those dependencies via the architect agent before introducing them. If you do use RHF, add `aria-invalid` and `aria-describedby` on every field that can show an error.

**Submit button state:**
- Show a loading indicator during `pending`. Use ellipsis ("Saving…") or a spinner — not the bare button text.
- Disable the submit button while `pending` to prevent double-submission.
- After a successful save on a long form, scroll to top so the user can see the toast and page header.

**Inline validation:**
- Validate required fields client-side on submit before calling the server action. Return early with `toast.error()` for obvious failures (blank required field, invalid email format).
- The server action is always the authoritative validator — never rely solely on client-side checks.

---

## Forms — Unsaved Changes Guard

Any page with an explicit Save button and multi-field editing must guard against accidental navigation.

**Pattern:**
- Track `isDirty: boolean`; set `true` on first change, `false` after a successful save.
- Replace Back `<Link>` and Cancel elements with click handlers that check `isDirty`.
- If dirty: open a "Discard changes?" `AlertDialog` from `src/components/ui/alert-dialog.tsx`. If clean: navigate directly.

```tsx
const [isDirty, setIsDirty] = useState(false);
const [discardOpen, setDiscardOpen] = useState(false);
const [pendingHref, setPendingHref] = useState<string | null>(null);

function handleNavigateAway(href: string) {
  if (isDirty) {
    setPendingHref(href);
    setDiscardOpen(true);
  } else {
    router.push(href);
  }
}

// Back link — use a button, not <Link>, so the click can be intercepted
<button
  onClick={() => handleNavigateAway("/admin/users")}
  className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
>
  <ArrowLeft className="h-4 w-4 mr-1" />
  Back to Users
</button>

// Discard dialog
<AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Discard changes?</AlertDialogTitle>
      <AlertDialogDescription>
        You have unsaved changes. If you leave now, they will be lost.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Keep editing</AlertDialogCancel>
      <AlertDialogAction onClick={() => pendingHref && router.push(pendingHref)}>
        Discard changes
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

**When to apply:** Any page with a Save button where the user can make multiple changes before saving — editors, settings pages, detail edit forms. Does **not** apply to inline-edit patterns (a single toggle that auto-saves on change).

---

## Select & Combobox Patterns

### Searchable single-select (Popover + Command)

Use Radix UI `Popover` + `Command` + `CommandInput` for single-select fields with more than ~8 options.

Add a `justSelected` ref so keyboard users can tab to the field and start typing immediately, without the popover reopening after selection:

```tsx
const justSelected = useRef(false);

// In every onSelect handler:
onSelect={() => {
  justSelected.current = true;
  setValue(id);
  setOpen(false);
}}

// On the trigger:
<PopoverTrigger asChild>
  <button
    role="combobox"
    onFocus={() => {
      if (justSelected.current) { justSelected.current = false; return; }
      setOpen(true);
    }}
  >
    {selectedLabel ?? "Select…"}
  </button>
</PopoverTrigger>
```

- Use `"none"` as the sentinel for "no selection" — **never `""`**. Radix `CommandItem` and native `<select>` both reject empty string as a meaningful value.
- Include a clear button (X icon, ghost style) whenever a value is selected and the field is optional.

### Multi-select

Use a scrollable checkbox list (always visible, not a popover). A filter input appears automatically when there are more than ~6 options. Selected items appear as removable badges above or beside the list.

Do **not** use a command-palette-style popover for multi-select — it is harder to scan and harder to keyboard-navigate with many items.

---

## Loading & Error States

No `loading.tsx` or `error.tsx` files exist in the starter yet. Add them to any route segment that does async data fetching:

- **`loading.tsx`** — shown by Next.js while the segment's async data resolves. Use skeleton shapes that match the page layout (matching card or table skeleton) rather than a full-page spinner. A skeleton prevents cumulative layout shift.
- **`error.tsx`** — shown when an unhandled error propagates from the segment. Must be a `'use client'` component; receives `error` and `reset` props. Show a human-readable message and a "Try again" button that calls `reset()`.

```tsx
// src/app/(admin)/admin/users/loading.tsx
export default function Loading() {
  return (
    <div className="space-y-4">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-12 w-full animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

// src/app/(admin)/admin/users/error.tsx
"use client";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Something went wrong loading this page.</p>
      <button onClick={reset} className="text-sm underline">Try again</button>
    </div>
  );
}
```

Unauthenticated route groups that do server-side data fetching — `(email-verify)`, `(password-reset)` — require `error.tsx`; the boundary must not redirect to `/account`, as the user may have no session. Link to `/signin` instead.

**For in-component async states** (e.g., a data table that reloads on filter change), manage loading/error locally with `useState` and render an inline skeleton or error banner. Do not rely on segment-level `loading.tsx` for client-initiated re-fetches.

---

## Four-State Component Design

Every interactive element ships all four states. A component that only handles `default` and `hover` is incomplete.

| State | What it covers |
|---|---|
| **Default** | The resting, idle appearance |
| **Hover** | Cursor over the element; provides affordance feedback |
| **Active / Pressed** | During a click or tap; darker or inset treatment |
| **Disabled** | `disabled` prop set; `opacity-50` + `pointer-events-none` |

```tsx
// Example button — all four states via Tailwind
<button
  disabled={pending}
  className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background
             hover:opacity-90          /* hover */
             active:opacity-75         /* active/pressed */
             disabled:pointer-events-none disabled:opacity-50  /* disabled */
             transition-opacity"
>
  Save
</button>
```

For links that behave like buttons, apply the same state classes.

---

## Empty States

Never leave a list, table, or grid blank when there is no data. Every collection view needs a designed empty state.

**Minimum:** a centered card or section with:
1. A brief description of what normally appears here.
2. A clear call to action when the user can take an action to populate the list.

```tsx
{items.length === 0 && (
  <div className="rounded-lg border border-dashed border-border py-16 text-center">
    <p className="text-sm font-medium">No items yet</p>
    <p className="mt-1 text-sm text-muted-foreground">
      Create your first item to get started.
    </p>
    {canCreate && (
      <button
        onClick={handleCreate}
        className="mt-4 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
      >
        Create item
      </button>
    )}
  </div>
)}
```

A single gray sentence in the middle of the page is not an empty state.

---

## Accessibility

- **Keyboard navigation.** All interactive elements must be reachable with Tab. Verify by tabbing through the page — every button, link, and input must receive a visible focus ring.
- **Focus rings.** Use `focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2` (or the starter's `--ring` CSS variable) on all focusable elements. Do not suppress focus rings with bare `focus:outline-none` unless you replace them with a custom ring style.
- **Semantic HTML.** `<main>`, `<nav>`, `<section>`, `<h1>`–`<h6>` in proper hierarchy. Screen readers depend on landmark roles; don't bury all structure in `<div>`.
- **Contrast.** All text/background pairings must meet WCAG 2.1 AA — 4.5:1 ratio for normal text, 3:1 for large text (18px+ or 14px+ bold). Check new color pairings before shipping.
- **Error announcements.** When a form field has an error, add `aria-invalid="true"` and `aria-describedby="<field-id>-error"` to the input, and assign `id="<field-id>-error"` to the error message element. This is required any time per-field errors are shown.
- **Touch targets.** Interactive elements must be at least 44×44px (WCAG 2.5.5). Icon-only buttons use `h-9 w-9` (36px) by default — add explicit `min-h-[44px] min-w-[44px]` when the button is a primary action, not a compact toolbar control.
- **Color alone is not a signal.** Never rely solely on color to convey status (e.g., "red = error"). Always pair color with text, an icon, or an ARIA attribute.

---

## CLAUDE.md Invariants (cross-reference)

Two invariants from `CLAUDE.md` apply directly to UI:

- **No native browser dialogs.** `alert()`, `confirm()`, and `prompt()` are forbidden. Use `AlertDialog` from `src/components/ui/alert-dialog.tsx` for all confirmations (destructive and non-destructive). See CLAUDE.md → Workflow Rules, rule 2.
- **Timezone-safe date rendering.** Never call `toLocaleString()`, `toLocaleDateString()`, or `toLocaleTimeString()` in components. Use `<FormattedDate>` from `src/components/shared/formatted-date.tsx`. An ESLint rule enforces this. See CLAUDE.md → Key Invariants → Timezone-Safe Date Rendering.

---

## Pre-merge UX Audit Checklist

QA runs this in Phase 5 for any change that touches UI. A single unchecked box blocks the `PASS` verdict.

- [ ] All four interaction states present on every interactive element (default / hover / active / disabled)
- [ ] Empty state designed for every list or collection — not a blank screen, not a gray one-liner
- [ ] Loading state for every async fetch — skeleton or spinner, chosen deliberately
- [ ] Error state with helpful, non-blaming microcopy and a recovery path ("Check your connection and try again." not "500 Internal Server Error")
- [ ] No native browser dialogs (`alert`, `confirm`, `prompt`) — use `AlertDialog` instead
- [ ] Toast is called from the client component after reading `ActionResult<T>` — never inside a `'use server'` function
- [ ] `<FormattedDate>` used for all timestamp rendering — no `toLocale*()` calls
- [ ] Form inputs have associated `<label>` elements (via `for`/`htmlFor`) — no unlabeled inputs
- [ ] Error fields have `aria-invalid="true"` and `aria-describedby` pointing to the error message element
- [ ] All interactive elements reachable by Tab; focus rings visible
- [ ] Touch targets ≥44×44px for primary interactive elements
- [ ] Contrast ratios meet WCAG AA on all new text/background pairings
- [ ] Semantic HTML: `<h1>` on every page, landmark roles (`<main>`, `<nav>`, `<section>`) where applicable
- [ ] Action bar order: text-labeled buttons left of icon-only buttons
- [ ] Back links use `?from=` when the page is reachable from multiple origins, with validation on the receiving end
- [ ] No extra `container`/padding wrapper inside a layout that already provides padding (`p-8` in admin layout)
- [ ] `loading.tsx` + `error.tsx` present in any new route segment that does async data fetching
- [ ] Page tested at ≥2 viewport widths (desktop 1440px, mobile 375px)
