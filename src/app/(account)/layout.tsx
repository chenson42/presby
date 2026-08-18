import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { cachedAuth } from "@/lib/auth/cached-auth";

// NOTE: The 2FA gate is intentionally absent here. Users must be able to
// reach /account/2fa to complete self-serve enrollment even when
// twoFactorRequired is true and they have not yet verified this session.

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await cachedAuth();
  if (!session?.user) redirect("/signin?callbackUrl=/account");

  const nav = [
    { href: "/account", label: "Account" },
    { href: "/account/2fa", label: "Two-Factor Auth" },
  ];

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[220px_1fr]">
      <aside className="border-b border-border bg-muted/40 p-4 md:border-b-0 md:border-r">
        <div className="mb-6">
          <Link href="/home" className="text-sm font-semibold">
            ← Home
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
