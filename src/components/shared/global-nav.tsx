import Link from "next/link";
import { signOut } from "@/auth";
import { FEATURES } from "@/lib/permissions";
import type { Session } from "next-auth";

// Pure Server Component — no 'use client', no useSession().
// The session is passed in from the parent layout which already called auth().
//
// Extension point: if a fork later adds a mobile hamburger menu, the toggle
// becomes a small 'use client' island leaf; this nav shell stays Server.

export function GlobalNav({ session }: { session: Session }) {
  const isAdmin = session.user.features?.includes(FEATURES.ADMIN_DASHBOARD);

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="text-sm font-semibold">
          Claude Code Starter
        </Link>
        <nav className="flex items-center gap-4">
          <Link
            href="/account"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Account
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Admin
            </Link>
          )}
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Sign out
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
