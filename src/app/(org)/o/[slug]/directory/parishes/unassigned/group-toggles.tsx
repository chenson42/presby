import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  UNASSIGNED_GROUPS,
  UNASSIGNED_GROUP_LABELS,
  serializeHide,
  type UnassignedGroup,
} from "@/lib/parishes-pure";
import { cn } from "@/lib/utils";

/**
 * The Unassigned page's population toggles (copy C6): one pill per group, in
 * precedence order, each a real `<Link>` that flips that group in the URL's
 * `?hide=` and keeps the others. Server-rendered - no client state, so there is
 * nothing to hydrate - and the state is the URL, allowlist-parsed on the way in
 * (`parseHide`) and never persisted. A hidden group keeps its count. The pills
 * WRAP (not scroll) so all four are visible at 360px; each is a 44px target.
 * Toggling resets to page 1 (the page count changes with the filter).
 */
export function GroupToggles({
  basePath,
  hidden,
  counts,
}: {
  basePath: string;
  hidden: ReadonlySet<UnassignedGroup>;
  counts: Record<UnassignedGroup, number>;
}) {
  return (
    <div
      role="group"
      aria-label="Population groups"
      className="flex flex-wrap gap-2"
      data-testid="group-toggles"
    >
      {UNASSIGNED_GROUPS.map((group) => {
        const isHidden = hidden.has(group);
        const next = new Set(hidden);
        if (isHidden) next.delete(group);
        else next.add(group);
        const value = serializeHide(next);
        const href = value ? `${basePath}?hide=${value}` : basePath;
        const text = `${UNASSIGNED_GROUP_LABELS[group]} (${counts[group]})`;
        return (
          <Button
            key={group}
            asChild
            variant={isHidden ? "outline" : "secondary"}
            size="sm"
            className={cn(
              "min-h-11 rounded-full",
              isHidden ? "text-muted-foreground line-through" : "",
            )}
          >
            <Link
              href={href}
              aria-label={`${isHidden ? "Show" : "Hide"} ${text}`}
              data-group={group}
            >
              {text}
            </Link>
          </Button>
        );
      })}
    </div>
  );
}
