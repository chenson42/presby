import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The export control: a PLAIN anchor with `download`, never `next/link`. A
 * `Link` prefetches, and a prefetch is a GET to the export route, which would
 * write an audit row for a download nobody asked for (the giving gifts page's
 * precedent, `gifts/page.tsx`). `boundaries.test.ts` pins both halves.
 */
export function ExportButton({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto">
      <a href={href} download>
        <Download className="size-4" aria-hidden />
        {label}
      </a>
    </Button>
  );
}
