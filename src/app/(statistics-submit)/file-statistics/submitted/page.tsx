import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

/**
 * `/file-statistics/submitted` — the static confirmation page
 * `submitGrantedReturnAction()` redirects to on success. NO token, NO data,
 * NO redirect parameter, reachable by anyone (Phase 2 BINDING: rendering it
 * as a post-submit STATE of the token page would let a back-button reload
 * re-consume a spent token and need to be told apart from a genuinely spent
 * one — a distinct, static route avoids that failure state entirely). No
 * `layout.tsx`, no `loading.tsx` in this group.
 */
export default function FileStatisticsSubmittedPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4 py-16">
      <Card className="w-full">
        <CardContent className="space-y-3 text-center">
          <h1 className="text-2xl font-semibold">Report submitted</h1>
          <p className="text-sm text-muted-foreground">
            Thank you — the statistical report has been recorded and sent to
            the presbytery. This link is now closed and cannot be used again.
          </p>
          <Link
            href="/"
            className="inline-block text-sm underline-offset-4 hover:underline"
          >
            Go to presbyportal.org
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
