import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The fourth branch of the miss response: the slug resolves to nothing in the
 * public organization tree. A real 404, via `notFound()` in the page.
 *
 * It says nothing about relationships or platform status, because it knows
 * nothing about either — which is what makes it a genuinely different answer
 * from the access-denied page rather than a differently-worded one.
 */
export default function OrgNotFound() {
  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-semibold">
        We couldn&apos;t find that organization
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Check the address for a typo. Organization links look like
        <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">
          /o/alder-creek
        </code>
        and never change once a congregation joins.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href="/orgs">Back to your organizations</Link>
      </Button>
    </section>
  );
}
