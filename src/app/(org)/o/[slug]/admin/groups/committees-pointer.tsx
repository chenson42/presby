import Link from "next/link";
import { AREA, GROUPS_POINTER } from "@/lib/committees/ui-copy";

/**
 * One line above the groups list, shown only at a presbytery (C10): a presbytery's
 * committees are kept under Committees & Commissions, not here. A congregation
 * never sees it.
 */
export function CommitteesPointer({ slug, name }: { slug: string; name: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      {GROUPS_POINTER.before}
      {name}
      {GROUPS_POINTER.middle}
      <Link
        href={`/o/${slug}/admin/committees`}
        className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {AREA}
      </Link>
      {GROUPS_POINTER.after}
    </p>
  );
}
