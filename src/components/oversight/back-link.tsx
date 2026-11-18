import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * The "Back to ..." link at the top of every oversight page. `href` is always a
 * static path built from the validated slug and ids (no `callbackUrl` or `next`
 * is ever read in this tree, pinned by `boundaries.test.ts`).
 */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
      {children}
    </Link>
  );
}
