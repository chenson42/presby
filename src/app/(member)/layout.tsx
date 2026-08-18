import { redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { GlobalNav } from "@/components/shared/global-nav";

// NOTE: The 2FA gate is intentionally absent here. /home is not an admin
// surface. Forks wanting site-wide 2FA add the check here or in proxy.ts.
export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await cachedAuth();
  if (!session?.user) redirect("/signin?callbackUrl=/home");
  return (
    <div className="min-h-screen">
      <GlobalNav session={session} />
      <main className="mx-auto max-w-2xl px-6 py-12">{children}</main>
    </div>
  );
}
