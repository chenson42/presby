"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/shared/load-error";

/**
 * The console's error boundary (F274). Calm words, a working "Try again" and a
 * way out. It NEVER renders `error.message`: in production Next replaces it
 * with a digest anyway, and in development a message can carry values. It
 * logs nothing itself; Next and the server already did.
 *
 * It does not intercept `notFound()` (that is `not-found`, a separate file
 * convention), and it cannot catch an error thrown by its own layout, which is
 * why the layout wraps its one live read in a catch (R1d).
 *
 * The copy claims only that a render failed. It deliberately does not say
 * "nothing has changed": a boundary can also catch a failed action, and that
 * sentence would then be unverifiable.
 */
export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <LoadError
      headingLevel={1}
      title="We couldn't load this page"
      body="Something went wrong on our end. Try again in a moment."
      onRetry={reset}
    >
      <Button asChild variant="outline" className="min-h-11">
        <Link href="/admin">Back to the dashboard</Link>
      </Button>
    </LoadError>
  );
}
