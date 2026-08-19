/**
 * `(org)` — the organization-scoped tree. THE CONTRACT, which every page added
 * under here inherits (CLAUDE.md → Post-Login Landing):
 *
 *   Auth-only AND org-scoped. Every page resolves its `[slug]` through
 *   `resolveOrgContext()` and reads exclusively through `withOrgContext()` on
 *   the RLS-enforced `db` connection. `getPlatformDb()` is FORBIDDEN in this
 *   subtree. No page may assume the user arrived via the chooser — deep links
 *   from bookmarks and emails must work, so every route authorizes itself. The
 *   Edge enforces authentication, active status, and 2FA for `/o/*`; it does
 *   NOT enforce membership, and it cannot (DECISION-035).
 *
 * THIS LAYOUT DELIBERATELY CONTAINS NO AUTH LOGIC. `(member)/layout.tsx`
 * hard-codes `callbackUrl=/home` on its redirect because a layout cannot see
 * the pathname, which silently loses a deep link. A page here has `params.slug`
 * and can send the user back to exactly where they were trying to go, so the
 * check lives there — and the contract sentence "every page resolves its slug"
 * stays literally true rather than becoming a layout's implicit promise.
 *
 * IT ALSO NO LONGER RENDERS THE CHROME. The header names the organization you
 * are in, and this layout sits ABOVE `[slug]`, so it cannot see which one that
 * is. The shell therefore lives in `o/[slug]/layout.tsx`, which can. What is
 * left here is the page frame every route in the group shares.
 */
export default function OrgLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen">{children}</div>;
}
