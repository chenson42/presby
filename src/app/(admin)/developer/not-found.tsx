import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * A missing table or diagram, inside the portal chrome. Reached only by an
 * entitled viewer: every page gates before it calls `notFound()`, so a
 * non-entitled viewer cannot tell a real table from a missing one.
 */
export default function DeveloperNotFound() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">
        We couldn&apos;t find that table or diagram
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        It may have been renamed or removed. Go back to the data model to find
        it.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href="/developer/data-model">Back to the data model</Link>
      </Button>
    </section>
  );
}
