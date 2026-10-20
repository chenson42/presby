import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import type { ChecklistBanner } from "@/lib/domains/checklist";
import { cn } from "@/lib/utils";

/**
 * One banner per condition the checklist raises (plain English; provider text is
 * never shown, G30). Tone is an icon plus a border weight, never colour alone;
 * `error` is announced (`role="alert"`), the rest are polite status.
 */
export function DomainBanners({ banners }: { banners: readonly ChecklistBanner[] }) {
  if (banners.length === 0) return null;
  return (
    <ul className="space-y-2">
      {banners.map((b) => {
        const Icon = b.tone === "error" ? AlertCircle : b.tone === "warning" ? AlertTriangle : Info;
        return (
          <li
            key={b.code}
            data-banner={b.code}
            role={b.tone === "error" ? "alert" : "status"}
            className={cn(
              "flex gap-3 rounded-md border bg-card px-3 py-3 text-sm",
              b.tone === "error" && "border-destructive",
              b.tone === "warning" && "border-foreground/50",
              b.tone === "info" && "border-border",
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{b.message}</span>
          </li>
        );
      })}
    </ul>
  );
}
