import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { cachedAuth } from "@/lib/auth/cached-auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await cachedAuth();
  if (!session?.user) redirect("/signin?callbackUrl=/admin");
  if (session.user.twoFactorRequired && !session.user.twoFactorVerified) {
    redirect("/totp?callbackUrl=/admin");
  }

  const nav = [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/flags", label: "Feature flags" },
    { href: "/admin/docs", label: "Release notes" },
    { href: "/admin/audit", label: "Audit Log" },
    { href: "/admin/email-queue", label: "Email queue" },
    { href: "/admin/whats-new", label: "What's new" },
    { href: "/admin/2fa", label: "2FA policy" },
  ];

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[220px_1fr]">
      <aside className="border-b border-border bg-muted/40 p-4 md:border-b-0 md:border-r">
        <div className="mb-6">
          <Link href="/" className="text-sm font-semibold">
            ← presby
          </Link>
        </div>
        <nav className="space-y-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm hover:bg-muted"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
          className="mt-8"
        >
          <button
            type="submit"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Sign out ({session.user.email})
          </button>
        </form>
      </aside>
      <main className="p-8">{children}</main>
    </div>
  );
}
