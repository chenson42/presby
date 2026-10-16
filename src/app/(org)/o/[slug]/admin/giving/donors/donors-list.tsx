import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { DonorListRow } from "@/lib/giving/donors";

const LINK_CLASS =
  "text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** The donor list as cards (one DOM, phone first). `showContact` is true only for `giving.view`. */
export function DonorsList({
  slug,
  donors,
  showContact,
}: {
  slug: string;
  donors: Array<Pick<DonorListRow, "id" | "displayName" | "kind"> & Partial<Pick<DonorListRow, "email" | "location" | "linkedMemberName">>>;
  showContact: boolean;
}) {
  return (
    <ul className="space-y-2" data-testid="donors-list">
      {donors.map((donor) => (
        <li key={donor.id} className="rounded-lg border border-border bg-card p-4 text-card-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/o/${slug}/admin/giving/donors/${donor.id}`} className={`min-h-11 inline-flex items-center text-base font-medium ${LINK_CLASS}`}>
              {donor.displayName}
            </Link>
            {donor.kind === "unidentified" && <Badge variant="outline">Plate offering</Badge>}
            {donor.linkedMemberName && <Badge variant="secondary">Linked to {donor.linkedMemberName}</Badge>}
          </div>
          {showContact && (donor.email || donor.location) && (
            <p className="text-sm text-muted-foreground">
              {[donor.email, donor.location].filter(Boolean).join(" · ")}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
