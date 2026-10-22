import type { ReactNode } from "react";

/**
 * The frame every `/invite` state renders in: platform chrome only (the
 * `(invite)` group is un-brandable, DECISION-047/185), one column, centred, a
 * 360px-safe card. A plain function (not a layout): the group has no
 * `layout.tsx` and no `loading.tsx` by design (a Suspense boundary would flush
 * a 200 before the page's terminal state is known).
 */
export function InviteShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-start px-4 py-10 sm:items-center sm:py-16">
      <div className="w-full rounded-lg border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-8">
        {children}
      </div>
    </main>
  );
}
