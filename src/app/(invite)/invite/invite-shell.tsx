import type { ReactNode } from "react";
import { HelpLink } from "@/components/help/help-link";
import { helpHref } from "@/lib/help/urls";

/**
 * The frame every `/invite` state renders in: platform chrome only (the
 * `(invite)` group is un-brandable, DECISION-047/185), one column, centred, a
 * 360px-safe card. A plain function (not a layout): the group has no
 * `layout.tsx` and no `loading.tsx` by design (a Suspense boundary would flush
 * a 200 before the page's terminal state is known).
 *
 * Every state, the dead link included, carries "Help with this page" under the
 * card (user-help integration, P3-9). `rel="noreferrer"` because this page's URL
 * holds the invitation token; the route already sends `Referrer-Policy:
 * no-referrer`, so this is belt and braces.
 */
export function InviteShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-start px-4 py-10 sm:items-center sm:py-16">
      <div className="w-full">
        <div className="w-full rounded-lg border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-8">
          {children}
        </div>
        <p className="mt-4 text-center text-sm">
          <HelpLink href={helpHref("accepting-your-invitation")} rel="noreferrer">
            Help with this page
          </HelpLink>
        </p>
      </div>
    </main>
  );
}
