import { FlaskConical } from "lucide-react";
import { TEST_MODE_BADGE } from "@/lib/giving/giving-copy";

/**
 * The "Test mode" banner shown on every giving admin page while the
 * congregation's open Stripe connection is a test-mode account - docs/work-log/
 * 2026-10-15-online-giving.md, G14 and the Component / Page Plan. Test gifts
 * never reach a total, export or statement, and a treasurer who has just made a
 * practice gift should never wonder why it is missing from the books.
 *
 * Not colour alone: an icon, the words "Test mode", and a dashed border (it
 * survives a black-and-white print). A server component with no data; the
 * decision to render it is the caller's (`admin/giving/test-mode-slot.tsx`).
 * Platform tokens only - the same neutral surface on every brand.
 */
export function TestModeBadge({ className }: { className?: string }) {
  return (
    <div
      role="status"
      data-testid="giving-test-mode-badge"
      className={`flex items-start gap-3 rounded-lg border border-dashed border-foreground/40 bg-muted p-3 text-foreground ${className ?? ""}`}
    >
      <FlaskConical className="mt-0.5 size-5 shrink-0" aria-hidden />
      <p className="text-sm">
        <span className="font-semibold">{TEST_MODE_BADGE.label}.</span> {TEST_MODE_BADGE.detail}
      </p>
    </div>
  );
}
