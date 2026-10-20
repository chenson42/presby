import { AlertTriangle } from "lucide-react";
import type { PrimaryAdvisory } from "@/lib/domains/checklist";
import { CanonicalDialog } from "./canonical-dialog";

/**
 * Tech-lead follow-up A (1b Deviation 1). When the primary address exists but is
 * not serving (lapsed, still securing, paused) while another address is live,
 * the live one is dark for visitors: aliases only redirect to a primary that
 * works. We never swap the primary behind a church's back, so this tells them
 * why the alias is dark and offers the one-tap remedy.
 */
export function PrimaryAdvisoryBanner({ slug, advisory }: { slug: string; advisory: PrimaryAdvisory }) {
  return (
    <div
      role="status"
      data-testid="primary-advisory"
      className="flex flex-col gap-3 rounded-lg border border-foreground/50 bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="flex gap-3 text-base">
        <AlertTriangle className="mt-1 size-4 shrink-0" aria-hidden />
        <span>
          Your primary address, <strong className="break-words">{advisory.primary.displayHostname}</strong>, isn&apos;t
          serving. <strong className="break-words">{advisory.candidate.displayHostname}</strong> is live, but visitors
          can&apos;t reach it until a working address is primary.
        </span>
      </p>
      <CanonicalDialog
        slug={slug}
        domainId={advisory.candidate.id}
        hostname={advisory.candidate.displayHostname}
        variant="default"
        fullWidthOnMobile
      />
    </div>
  );
}
