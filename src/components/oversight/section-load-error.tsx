import Link from "next/link";
import { Button } from "@/components/ui/button";
import { STATE } from "@/lib/oversight/copy";

/** One section's reader failed: say so in place, offer "Try again", and leave the rest of the page standing. */
export function SectionLoadError({ href }: { href: string }) {
  return (
    <div role="alert" className="space-y-3 rounded-md border border-dashed border-border p-4">
      <p className="text-sm text-muted-foreground">{STATE.sectionLoadError}</p>
      <Button asChild size="sm" className="min-h-11 w-full sm:w-auto">
        <Link href={href}>{STATE.sectionTryAgain}</Link>
      </Button>
    </div>
  );
}
