import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * A calm "we could not load this" block: dashed border, plain words, one way
 * to try again at a 44px target. For a read that failed, never a raw error.
 *
 * EXACTLY ONE retry affordance, enforced by the type:
 *   - `retryHref`: a `Link`, for a Server Component that can simply be
 *     re-requested (the `OrganizationsUnavailable` pattern).
 *   - `onRetry`: a `Button`, for an `error.tsx` boundary, which gets `reset()`.
 *
 * `OrganizationsUnavailable` is NOT migrated onto this: three pages pin its
 * strings (Phase 2 R2). `children` is the slot for a secondary action (the
 * console's `error.tsx` adds "Back to the dashboard").
 */
type RetryProps =
  | { retryHref: string; onRetry?: never }
  | { onRetry: () => void; retryHref?: never };

export function LoadError({
  title,
  body,
  headingLevel = 2,
  children,
  ...retry
}: {
  title: string;
  body: string;
  headingLevel?: 1 | 2 | 3;
  children?: React.ReactNode;
} & RetryProps) {
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3";

  return (
    <section
      role="alert"
      className="rounded-xl border border-dashed border-border px-4 py-10 text-center sm:px-6 sm:py-12"
    >
      <Heading className="text-lg font-semibold sm:text-xl">{title}</Heading>
      <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
        {body}
      </p>
      <div className="mt-6 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
        {retry.onRetry ? (
          <Button type="button" onClick={retry.onRetry} className="min-h-11">
            Try again
          </Button>
        ) : (
          <Button asChild className="min-h-11">
            <Link href={retry.retryHref}>Try again</Link>
          </Button>
        )}
        {children}
      </div>
    </section>
  );
}
