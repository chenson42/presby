import Link from "next/link";
import { auth, signOut } from "@/auth";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const session = await auth();
  const signedIn = !!session?.user;
  const greeting = session?.user?.name ?? session?.user?.email ?? "friend";

  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-4xl font-bold tracking-tight">presby</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Church and council management for Presbyterian congregations,
        presbyteries, and synods — the roll, officers, and directory, kept the
        way the Book of Order says they must be kept.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        Pre-release. Nothing here is a live congregation.
      </p>

      {signedIn && (
        <p className="mt-6 text-sm text-muted-foreground">
          Welcome back, <span className="font-medium text-foreground">{greeting}</span>.
        </p>
      )}

      <div className="mt-8 flex gap-3">
        {signedIn ? (
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <Button type="submit">Sign out</Button>
          </form>
        ) : (
          <Button asChild>
            <Link href="/signin">Sign in</Link>
          </Button>
        )}
        {signedIn ? (
          // /launch, not /home: it is the single post-authentication target and
          // it works out where this particular user belongs. A signed-in user
          // is entitled to read the front page, so this page never redirects
          // them (DECISION-034) — it offers the way in and nothing more.
          <Button asChild variant="outline">
            <Link href="/launch">Continue</Link>
          </Button>
        ) : null}
      </div>
    </main>
  );
}
