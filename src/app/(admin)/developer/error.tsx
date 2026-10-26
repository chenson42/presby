"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/shared/load-error";

/**
 * The developer portal's error boundary. Calm words, a working "Try again" and
 * a way out. It NEVER renders `error.message`: in production Next replaces it
 * with a digest anyway, and in development a message can carry values.
 *
 * It does not intercept `notFound()` (that is `not-found.tsx`) and cannot catch
 * an error thrown by its own layout, which is why the layout wraps its one live
 * read in a catch. The body matches the admin console's, so there is one phrase
 * for "render failed".
 */
export default function DeveloperError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <LoadError
      headingLevel={1}
      title="We couldn't load this right now"
      body="Something went wrong on our end. Try again in a moment."
      onRetry={reset}
    >
      <Button asChild variant="outline" className="min-h-11">
        <Link href="/developer">Back to the developer portal</Link>
      </Button>
    </LoadError>
  );
}
