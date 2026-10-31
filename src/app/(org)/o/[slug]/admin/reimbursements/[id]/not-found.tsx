"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { COPY } from "@/lib/reimbursement/copy";

/**
 * The neutral answer for `/o/<slug>/admin/reimbursements/<id>`: a request that does
 * not exist, one the viewer may not read at the treasury level, and an id that is
 * not a uuid all render this, with a real 404 status (the page calls `notFound()`;
 * this segment has no `loading.tsx`, which would flush a 200 first). One string,
 * `COPY.detail.unavailable` (EC16). A client component only to read the slug from
 * the route params for the way back to the queue; it learns nothing about the
 * request.
 */
export default function TreasuryRequestNotFound() {
  const params = useParams<{ slug?: string }>();
  const slug = typeof params?.slug === "string" ? params.slug : null;
  return (
    <section className="max-w-xl" data-testid="request-unavailable">
      <h1 className="text-2xl font-semibold">{COPY.detail.unavailable}</h1>
      {slug && (
        <Button asChild variant="outline" className="mt-6 min-h-11">
          <Link href={`/o/${slug}/admin/reimbursements`}>{COPY.detail.back}</Link>
        </Button>
      )}
    </section>
  );
}
