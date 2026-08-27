# UI Standards

Conventions for building consistent, accessible UI across presby. Every rule below is checkable by reading a diff.

**Scope:** All pages under `src/app/` — auth, account, admin, developer, and the church-facing surfaces as they land. Exceptions are noted inline.

---

## Contents

- [Page Layout](#page-layout)
- [Colour and Tokens](#colour-and-tokens)
- [Type Scale](#type-scale)
- [Page Header & Typography](#page-header--typography)
- [Action Bar](#action-bar)
- [Back Navigation](#back-navigation)
- [Toast Notifications](#toast-notifications)
- [Forms — State Patterns](#forms--state-patterns)
- [Forms — Unsaved Changes Guard](#forms--unsaved-changes-guard)
- [Component Rules](#component-rules)
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

## Colour and Tokens

**Source of truth: `src/lib/brand/contract.ts`.** This section is prose over that file; if the two disagree, the contract wins and this section is stale. `TOKEN_POLICY` there is the closed, three-way partition of every custom property `globals.css` declares — closed means a property that isn't classified there is a build failure (`contract.test.ts`), not an oversight someone can leave unaddressed.

**Operating rule: brand carries emphasis, neutral carries content.** Masthead, primary buttons, links, the focus ring, and selected/active states are brand-driven and will repaint per organization once per-org branding ships (P0.5 slice c onward). Table rows, form-field interiors, body copy, disabled states, and status colors are neutral and identical for every organization, forever — a clerk of session reading the roll should never have to fight a brand color for legibility.

| Policy | Meaning | Tokens |
|---|---|---|
| **brandable** | A per-org brand may re-declare this freely. | `--primary`, `--primary-foreground`, `--ring`, and the additive `--brand-raw` / `--brand-raw-foreground` (decorative, non-interactive surfaces only — not in `globals.css` until the per-org emitter ships) |
| **bounded** | A per-org brand may re-declare this only within a named constraint the ramp generator enforces. | `--background` (near-white or near-dark band — a congregation may have a cream page, not a gold one), `--foreground` (computed against `--background` at 7:1), `--accent` (a near-neutral tint of `--muted` — it is the menu/hover surface under *content*-axis text, not a second brand fill), `--accent-foreground` (computed against `--accent` at 7:1) |
| **platform** | Never re-declarable, by any organization. | `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--muted`, `--muted-foreground`, `--secondary`, `--secondary-foreground`, `--destructive`, `--destructive-foreground`, `--border`, `--input`, `--radius` (not a color), and the reserved-but-unbuilt `--success`, `--warning`, `--info` families |

Unlisted is not brandable — it's a missing classification, and it fails a test.

**`border` vs `border-input`.** These carry different values on purpose (`hsl(214 32% 91%)` vs `hsl(214 32% 59%)` in light mode). Use them by what the border is doing, not by habit:

- A border that **identifies a control** (an input, a select, anything a user types into or picks from) uses `border-input`. It carries the 3:1 non-text contrast floor (WCAG 1.4.11) — a control someone can't see the edges of is a control they can't find.
- A border that **separates content** (a card edge, a table rule, a divider between sections) uses `border`. It's decorative, not informational, and carries no contrast floor.

```tsx
<input className="rounded-md border border-input bg-background px-3 py-2 text-base" />
<div className="rounded-lg border border-border p-4">…</div>
```

`text-base` (16px), not `text-sm` — the operator legibility decision
(docs/work-log/2026-08-27-control-legibility.md): every real form control
(input, textarea, select) reads at 16px everywhere, not just on mobile.

The generated `<Input>` and `<Textarea>` primitives carry `border-input bg-background`
natively (a recorded divergence from the shadcn upstream's `bg-transparent` — see each
file's header and `docs/work-log/2026-08-27-input-background-standard.md`), so never
re-add `bg-background` in a caller's `className`; the recipe above is for raw elements
only.

**Never write a Tailwind palette literal** — `bg-blue-600`, `text-amber-700`, `border-green-500`, `dark:text-red-300`, and so on. If you need a color that isn't one of the tokens above, that's a missing token and a design decision, not a class string to reach for. Raise it — status chips (success/warning/info) are the known gap here (tracked in `docs/TODO.md`); everything else routes through the tokens.

---

## Type Scale

Seven roles, declared in `src/lib/brand/contract.ts` (`TYPE_SCALE`). Every size is `rem`, **never `px`** — a role's Tailwind class already resolves to a `rem` value, and writing a raw pixel size (`text-[14px]`) or an arbitrary value opts a piece of text out of ever being reachable by a future large-print multiplier on the root font size.

| Role | rem / px | Tailwind | Where |
|---|---|---|---|
| `display` | 1.875 / 30 | `text-3xl` | page-level hero |
| `title` | 1.5 / 24 | `text-2xl` | the single `<h1>` |
| `section` | 1.25 / 20 | `text-xl` | `<h2>` |
| `subhead` | 1.125 / 18 | `text-lg` | `<h3>` |
| `body` | 1 / 16 | `text-base` | **all body copy — the floor** |
| `dense` | 0.875 / 14 | `text-sm` | tabular cells, metadata, form labels. Never a paragraph. |
| `micro` | 0.75 / 12 | `text-xs` | **`(admin)` and `/developer` only. Forbidden on any member-facing surface.** |

**16px is the body floor, everywhere.** Nothing below 14px (`dense`) is legal on a member-facing surface — `micro` is a platform-operator-only allowance, because a 12px table cell in `/admin/audit` is a different audience than a 12px timestamp in a congregation's directory. When a page mixes both audiences, use `dense` as the floor and treat `micro` as unavailable.

Pick a role by what the text *is*, not by what looks right on your monitor: a page description under an `<h1>` is `dense`, not `body`, even though it reads fine at either size — it's metadata about the page, not the page's content.

---

## Page Header & Typography

Every page has a single `<h1>`, set at the **`title`** role (see [Type Scale](#type-scale)) — `text-2xl font-semibold`.

- `<h1>` → `title`. A standalone hero, outside the app shell, → `display`. `<h2>` → `section`. `<h3>` → `subhead`.
- Follow `<h1>` immediately with a `<p>` at the **`dense`** role (`text-sm`) description when the purpose of the page is not self-evident — a page description is metadata about the page, not body content, even where it reads fine at either size.
- Use `text-muted-foreground` (not `text-gray-600` or any other palette literal) for secondary text — the starter uses CSS variable tokens throughout.
- Never use `CardTitle` for listing-card headings; use a bare `<h3>` at the `subhead` role so size is controlled explicitly.

```tsx
<h1 className="text-2xl font-semibold">Users</h1>                          {/* title */}
<p className="mt-1 text-sm text-muted-foreground">                          {/* dense */}
  Manage user accounts and role assignments.
</p>
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
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-base"
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

## Component Rules

### Generating shadcn primitives

**`npm run ui:add -- <component…>` is the only supported way to generate a shadcn primitive in this repo.** It wraps `shadcn add`, then rewrites the registry's `import { Foo as FooPrimitive } from "radix-ui"` to the individual `@radix-ui/react-*` package this repo actually depends on, and restores the lockfile. Raw `npx shadcn add` is **not supported** — it installs the ~40-package `radix-ui` umbrella (`check:deps-drift` will fail the build if it lands).

```bash
npm run ui:add -- table input label textarea
```

If the rewrite would introduce a runtime dependency the repo doesn't already have, the script fails loudly and names it — that's deliberate. A new `@radix-ui/react-*` package (or any other new dependency) needs the architect's five-criteria pass before it's installed, not a silent `npm install` inside a generator script.

**Primitives under `src/components/ui/` are generated files — don't hand-edit them without a reason, and never without recording it.** Every deliberate divergence from the shadcn registry gets a header comment naming what changed and why, so the next re-generation doesn't silently undo it. The precedent is `src/components/ui/dropdown-menu.tsx`, which documents exactly why its Radix import is hand-corrected. A primitive missing a header comment for a divergence a reviewer can spot is a bug in the primitive, not a style nit.

---

## Select & Combobox Patterns

### Native `<select>` — what exists today

Every select and filter control in the app (`(admin)/admin/feedback/feedback-status-control.tsx`, `(admin)/admin/audit/page.tsx`, `(admin)/admin/users/page.tsx`, `shared/feedback-form.tsx`) is a plain native `<select>`. It's free keyboard support, free screen-reader support, and the platform's native picker UI on mobile — and it's the right choice for any bounded, short option list. Style it with `border-input`/`bg-background` (see [Colour and Tokens](#colour-and-tokens)) **and** `appearance-none` plus a manual chevron — without `appearance-none` the browser draws its own control chrome over the box, which reads as a different, greyer control than an `<Input>` sitting right next to it in the same row even though the CSS background color is identical underneath (found live, org-portal directory/members filter row, 2026-08-26):

```tsx
<div className="relative">
  <select
    className="w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base"
    value={value}
    onChange={(e) => setValue(e.target.value)}
  >
    <option value="all">All statuses</option>
    <option value="open">Open</option>
    <option value="closed">Closed</option>
  </select>
  <ChevronDown
    className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
    aria-hidden
  />
</div>
```

`text-base`, not `text-sm` — the same 2026-08-27 operator legibility decision
noted above; a select sitting next to a bordered `<Input>` in a filter row
reads at the same size as the input now, not one step smaller.

Always give it an associated `<label>`; use `"none"` (or another non-empty string) as the sentinel for "no selection," never `""` — a native `<select>` treats an empty-string option value the same as no `value` attribute at all, which breaks controlled-component behavior.

The pre-existing native selects listed above (and others predating this note) were not retrofitted with `appearance-none` in the same pass that added this guidance — they don't sit next to a bordered `<Input>` in the same row, so the inconsistency isn't visible there today. Retrofitting them is a `docs/TODO.md`-tracked follow-up, not implied done.

### `Select` (Radix / shadcn) — not generated yet

There is no `Popover`, `Command`, or `Select` primitive in `src/components/ui/` today, and no combobox anywhere in the tree. An earlier draft of this document described a searchable "Popover + Command" combobox pattern; it was never built, described a primitive this repo doesn't have, and has been removed. When a page's option list genuinely outgrows a native `<select>` (dozens of options, needs search), generate the real primitive with `npm run ui:add -- select` (or, for a searchable combobox, the `Command`-based pattern shadcn documents) as part of the pipeline that needs it — both pull in a new Radix package (`@radix-ui/react-select`, or `cmdk` for `Command`) that needs the architect's five-criteria pass first. Don't hand-roll a substitute in the meantime; wait for the primitive and cite the pipeline that generated it in this section's next rewrite.

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
- **Focus rings, always with a 2px offset.** `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background` on every focusable element. The offset is not polish — the platform's own `--ring` is byte-identical to `--primary`, so a ring drawn flush against the default `<Button>` measures **1.00:1, invisible, in both color schemes** (measured in `src/lib/brand/contract.ts`; the D4 test there asserts the offset is what fixes it, not the color). Drawing the ring with surface-colored space between it and the control it rings means its contrast is only ever measured against the surface, which the token contract can guarantee at every brand seed — measuring it against the control it rings cannot be guaranteed the same way. Never suppress a focus ring with bare `focus:outline-none` unless you replace it with an offset ring of your own.
- **Semantic HTML.** `<main>`, `<nav>`, `<section>`, `<h1>`–`<h6>` in proper hierarchy. Screen readers depend on landmark roles; don't bury all structure in `<div>`.
- **Contrast — AAA for body text, not AA.** All body text (paragraph copy, table cells, form labels and hints, timestamps) meets **7:1** against its surface — above the WCAG AA 4.5:1 floor, deliberately: the audience skews older, and the product's own content is about hearing loops and large-print bulletins. Non-text UI — control borders, focus rings, icon-only affordances — meets **3:1**. This is why a control border uses `border-input` and a decorative border uses `border` (see [Colour and Tokens](#colour-and-tokens)) — only the former carries the 3:1 floor. Check new color pairings against these floors before shipping; the authoritative list of legal pairs and their floors is `LEGAL_PAIRS` in `src/lib/brand/contract.ts`, not this bullet.
- **Error announcements.** When a form field has an error, add `aria-invalid="true"` and `aria-describedby="<field-id>-error"` to the input, and assign `id="<field-id>-error"` to the error message element. This is required any time per-field errors are shown.
- **Touch targets.** Interactive elements must be at least 44×44px (WCAG 2.5.5). Icon-only buttons use `h-9 w-9` (36px) by default — add explicit `min-h-[44px] min-w-[44px]` when the button is a primary action, not a compact toolbar control.
- **Color alone is not a signal.** Never rely solely on color to convey status (e.g., "red = error"). Always pair color with text, an icon, or an ARIA attribute.
- **Reduced motion.** Respect `prefers-reduced-motion: reduce`. `globals.css` carries a base rule collapsing animation and transition durations to near-zero under that media query — don't add a component-level animation (a custom `@keyframes`, a JS-driven transition) that bypasses it. If you're using the stock `animate-in`/`fade-in`/`slide-in-from-*` utilities on a generated primitive, the base rule already covers you; a hand-rolled animation is where this gets missed.
- **200% zoom.** A page's primary content must survive 200% browser zoom without horizontal scroll. Test with the browser's own zoom control, not by shrinking the viewport — a fixed-width element or an unwrapped flex row can pass a narrow-viewport check and still fail zoom, because zoom scales content inside a viewport that itself stays put.
- **Print.** Church offices print rolls, directories, and reports on monochrome laser printers. Any content page a user might reasonably print — a roll view, a report, a directory listing — must stay legible with color removed: pair a status color with an icon or a label (not just a colored chip), and keep borders and dividers that rely on `border`/`border-input` rather than a colored background alone. Check the browser's print preview, not just the screen, before shipping a page whose primary use is "print this and hand it to the clerk of session."

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
- [ ] All interactive elements reachable by Tab; focus rings visible, and drawn with a ring offset (`ring-offset-2`)
- [ ] Touch targets ≥44×44px for primary interactive elements
- [ ] Contrast ratios meet the AAA floor (7:1) for body text and 3:1 for non-text/control borders — not just AA
- [ ] Type-scale roles used for text sizing (`text-2xl` because it's `title`, not because it looked right) — no raw or arbitrary sizes
- [ ] No hard-coded Tailwind palette literals (`bg-blue-600`, `text-amber-700`, `dark:text-red-300`) — tokens only
- [ ] Semantic HTML: `<h1>` on every page, landmark roles (`<main>`, `<nav>`, `<section>`) where applicable
- [ ] Action bar order: text-labeled buttons left of icon-only buttons
- [ ] Back links use `?from=` when the page is reachable from multiple origins, with validation on the receiving end
- [ ] No extra `container`/padding wrapper inside a layout that already provides padding (`p-8` in admin layout)
- [ ] `loading.tsx` + `error.tsx` present in any new route segment that does async data fetching
- [ ] Page tested at ≥2 viewport widths (desktop 1440px, mobile 375px)
