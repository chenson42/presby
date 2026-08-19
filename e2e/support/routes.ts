/**
 * routes.ts — the route manifest the visual-parity harness walks.
 *
 * Each entry is one destination the harness screenshots at every
 * {viewport} x {colorScheme} combination in visual-parity.spec.ts. This file
 * owns WHICH routes and WHO looks at them; the spec owns HOW they are
 * captured and compared.
 *
 * Selection rules, in order:
 *
 *   1. Renders, never redirects. A route whose happy path 307s (`/launch`) or
 *      whose only reachable state is a redirect for every fixture that could
 *      view it (`/totp` — the mfa-admin fixture carries no TOTP enrollment,
 *      so it always bounces to `/account/2fa` before paint, per
 *      role-boundaries.spec.ts) is excluded. A route the harness cannot pin
 *      to one deterministic rendered page is not a visual-parity target, it's
 *      a flaky one.
 *   2. No route whose render has a side effect that changes a LATER route's
 *      content. `/access-pending` writes an audit_events row on every render
 *      (recordAudit() in the page itself) and `/admin/audit` is also in this
 *      manifest — visiting the former between the baseline and check runs
 *      would grow the latter's row count and produce a real diff that has
 *      nothing to do with CSS. Excluded for that reason, not because it's
 *      unimportant.
 *   3. Covers every route group named in Phase 3's design doc:
 *      `/`, (auth), (member), (account), (admin), (org).
 *   4. Per Phase 3 E4 (the `dark:` mechanism change is the largest population
 *      of styling that changes mechanism without changing appearance):
 *      `/admin/feedback`, `/admin/email-queue`, and `/account/2fa` are
 *      included — the densest `dark:` chip usage in the app.
 *   5. `/o/e2e-beta` (the `org-ended` fixture) exercises the one un-brandable
 *      DECISION-040 state — "named and dated" — that no other route reaches.
 *   6. `/admin/users` is DELIBERATELY EXCLUDED, and it is the one exclusion
 *      worth a paragraph rather than a line, because it was caught by running
 *      the harness rather than reasoned about in advance. Its query
 *      (`orderBy(desc(users.createdAt))`, `src/app/(admin)/admin/users/page.tsx`)
 *      has no secondary sort key. Several seeded users share an
 *      identical-to-the-millisecond `created_at` (a handful of fixture rows
 *      from a batch insert elsewhere in the seed history), and Postgres does
 *      not guarantee a stable tie order across two executions of the same
 *      query — it depends on physical row placement, which shifts on any
 *      UPDATE to the table. `globalSetup`'s upsert of the seven current e2e
 *      fixtures is exactly such an UPDATE, runs on every `visual:baseline` /
 *      `visual:check` invocation, and was enough to reorder the tied rows: a
 *      captured `visual:check` run against completely unmodified code and an
 *      unmodified server produced a real ~3,600-pixel diff on this route at
 *      every viewport/scheme, from row reordering, not from CSS. This is a
 *      genuine pre-existing gap in the page's query (worth its own fix — see
 *      docs/TODO.md), not a harness defect, and not evidence against
 *      `maxDiffPixels: 0` as the right threshold elsewhere. `/admin/feedback`
 *      and `/admin/email-queue` already satisfy rule 4's table-density
 *      requirement, so nothing is lost by leaving this route out until its
 *      ordering is fixed.
 *
 * storageState of `null` means unauthenticated: the spec must not apply a
 * storageState fixture for that route.
 */

import type { E2ERole } from "./users";

export interface VisualRoute {
  /** Pathname to visit, relative to baseURL. No query string. */
  path: string;
  /** Which fixture's cached session to use, or null for anonymous. */
  storageState: E2ERole | null;
  /** HTTP status the response must carry. */
  expectedStatus: number;
  /** One line: why this route/fixture pairing, for a reviewer scanning the list. */
  note: string;
}

export const VISUAL_ROUTES: VisualRoute[] = [
  // --- / (un-grouped) ---------------------------------------------------
  {
    path: "/",
    storageState: null,
    expectedStatus: 200,
    note: "Public landing page, signed out.",
  },

  // --- (auth) -------------------------------------------------------------
  {
    path: "/signin",
    storageState: null,
    expectedStatus: 200,
    note: "Credentials + OAuth sign-in form.",
  },
  {
    path: "/forgot-password",
    storageState: null,
    expectedStatus: 200,
    note: "Password-reset request form.",
  },

  // --- (member) -------------------------------------------------------------
  {
    path: "/home",
    storageState: "member",
    expectedStatus: 200,
    note: "Platform-shell landing: what's-new + feedback prompt.",
  },
  {
    path: "/whats-new",
    storageState: "member",
    expectedStatus: 200,
    note: "Member-facing what's-new feed.",
  },

  // --- (account) -------------------------------------------------------------
  {
    path: "/account",
    storageState: "member",
    expectedStatus: 200,
    note: "Profile, email, password sections.",
  },
  {
    path: "/account/2fa",
    storageState: "member",
    expectedStatus: 200,
    note: "TOTP enrolment UI — densest dark: chip usage (E4).",
  },

  // --- (admin) -------------------------------------------------------------
  {
    path: "/admin",
    storageState: "admin",
    expectedStatus: 200,
    note: "Admin dashboard — nav sidebar + section cards.",
  },
  // /admin/users is deliberately absent — see rule 6 above.
  {
    path: "/admin/feedback",
    storageState: "admin",
    expectedStatus: 200,
    note: "Feedback triage table — densest dark: chip usage (E4).",
  },
  {
    path: "/admin/email-queue",
    storageState: "admin",
    expectedStatus: 200,
    note: "Email queue table — densest dark: chip usage (E4).",
  },
  {
    path: "/admin/flags",
    storageState: "admin",
    expectedStatus: 200,
    note: "Feature flag toggles.",
  },
  {
    path: "/admin/audit",
    storageState: "admin",
    expectedStatus: 200,
    note: "Audit log viewer. See rule 2 — nothing upstream may write to it.",
  },
  {
    path: "/admin/whats-new",
    storageState: "admin",
    expectedStatus: 200,
    note: "What's-new CRUD list.",
  },
  {
    path: "/admin/2fa",
    storageState: "admin",
    expectedStatus: 200,
    note: "Per-congregation 2FA policy (DECISION-033).",
  },
  {
    path: "/admin/design-system",
    storageState: "admin",
    expectedStatus: 200,
    note: "Primitive/token sign-off page — includes the e1 type-pairings preview, self-hosted fonts.",
  },

  // --- (org) -------------------------------------------------------------
  {
    path: "/o/e2e-alpha",
    storageState: "org-single",
    expectedStatus: 200,
    note: "Active-relationship org portal stub.",
  },
  {
    path: "/o/e2e-beta",
    storageState: "org-ended",
    expectedStatus: 200,
    note: 'DECISION-040 "ended" state — named and dated, un-branded by construction.',
  },
  {
    path: "/orgs",
    storageState: "org-multi",
    expectedStatus: 200,
    note: "Org chooser, two cards (congregation + presbytery).",
  },
  {
    path: "/no-organization",
    storageState: "org-unmanaged",
    expectedStatus: 200,
    note: 'Zero-enterable-orgs state — "not connected to a congregation yet."',
  },
];
