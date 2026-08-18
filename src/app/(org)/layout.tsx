import Link from "next/link";

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
 * The real organization shell — switcher, navigation, branding — is P1. What is
 * here is enough chrome that an access-denied page is not a floating paragraph.
 */
export default function OrgLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-background">
        <nav
          aria-label="Organization"
          className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6"
        >
          <Link href="/" className="text-sm font-semibold">
            presby
          </Link>
          <Link
            href="/orgs"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Switch organization
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-12">{children}</main>
    </div>
  );
}
